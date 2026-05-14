/* ════════════════════════════════════════════════════════════════════════
   antares-usage — /usage dashboard backend (Cloudflare Worker).

   Two routes, one file, zero deps.

   POST /
     Headers:  Authorization: Bearer <SHARED_SECRET>
     Body:     { "date": "YYYY-MM-DD", "source": "<slot>",
                 "tokens": <int>, "sessions": <int> }
     →  200 { "ok": true }                       on success
     →  400 { "error": "<reason>" }              malformed / wrong schema
     →  401 { "error": "unauthorized" }          missing / wrong bearer
     →  500 { "error": "kv" }                    KV write failed

     Stores at KV key `usage:YYYY-MM-DD` an object:
       { "<source>": { "tokens": int, "sessions": int, "updated": "<iso>" } }
     Read-modify-write the per-day map: each source owns its own slot in
     the JSON value, so concurrent writes from different sources don't
     overwrite each other's data. The parent KV key itself is shared, so
     two near-simultaneous writes CAN race at the KV level (last-write
     wins on the whole object); each carries absolute counters and sync
     cadence is hourly per source, so realistic loss is zero. Same-source
     concurrent writes are last-wins by design.

   GET /
     Public, CORS-locked to https://antaresyuan.site (+ localhost dev).
     →  200 { "days": [{ "date": "...", "tokens": int, "sessions": int }, ...],
              "since": "YYYY-MM-DD", "updated": "<iso-of-newest-write>" }

     Last 90 days inclusive, summed across sources, zero-days included for
     heatmap continuity. **Per-source data never leaves this Worker.**

   Privacy contract (HARD LINE — see #149 + workers/usage/README.md):
     The GET response is exactly `{date, tokens, sessions}` per day.
     Source labels, per-source breakdowns, hourly distribution, model ids,
     project names, and any identifier are server-side-only and never
     echoed by GET. Worker logs record date + source for ops; never the
     request body, never message content.
   ════════════════════════════════════════════════════════════════════════ */

const SITE = 'https://antaresyuan.site';
const WINDOW_DAYS = 90;
const KV_PREFIX = 'usage:';
const MAX_BODY_BYTES = 1024;        // generous for {date,source,tokens,sessions}
const MAX_SOURCE_LEN = 32;          // a source label can't exceed 32 chars
const MAX_INT = 1e12;               // absurd ceiling so a bug can't write garbage

// ── CORS ────────────────────────────────────────────────────────────
// GET is locked to the public site origin (+ localhost for dev).
// POST is machine-to-machine, bearer-auth, not browser-driven — CORS
// isn't relevant to it and we deliberately don't echo Origin there.
function corsForGet(origin) {
  const ok = origin === SITE
    || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
  return ok
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      }
    : { Vary: 'Origin' };
}

function reply(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(headers || {}),
    },
  });
}

// ── Date helpers ────────────────────────────────────────────────────
// Strict YYYY-MM-DD validator: catches both shape and real-date drift
// (e.g. "2026-02-30" → false because Date roundtrips to March).
function isValidISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === s;
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

// Last N days inclusive, ending today (UTC), oldest → newest.
function lastNDays(n) {
  const out = [];
  const base = new Date(todayUTC() + 'T00:00:00Z').getTime();
  const day = 86400000;
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(base - i * day).toISOString().slice(0, 10));
  }
  return out;
}

// ── POST schema validation ──────────────────────────────────────────
// Allowlist-based: any key outside {date, source, tokens, sessions} →
// reject. Each field type-checked. Returns null on OK, else an error.
function validatePost(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'body must be a JSON object';
  }
  const allowed = new Set(['date', 'source', 'tokens', 'sessions']);
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) return `unexpected field: ${k}`;
  }
  if (!isValidISODate(body.date)) return 'date must be YYYY-MM-DD';
  if (typeof body.source !== 'string' || !body.source.length || body.source.length > MAX_SOURCE_LEN) {
    return 'source must be a non-empty string of <= 32 chars';
  }
  if (!/^[a-z0-9._-]+$/i.test(body.source)) {
    return 'source must match [a-z0-9._-]+';
  }
  if (!Number.isInteger(body.tokens) || body.tokens < 0 || body.tokens > MAX_INT) {
    return 'tokens must be a non-negative integer';
  }
  if (!Number.isInteger(body.sessions) || body.sessions < 0 || body.sessions > MAX_INT) {
    return 'sessions must be a non-negative integer';
  }
  return null;
}

// ── Handlers ────────────────────────────────────────────────────────
async function handlePost(request, env) {
  // bearer auth
  const auth = request.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  const expected = env.SHARED_SECRET;
  if (!expected) return reply({ error: 'server misconfigured' }, 500);
  if (!m || m[1] !== expected) return reply({ error: 'unauthorized' }, 401);

  // body cap + parse
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return reply({ error: 'body too large' }, 400);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return reply({ error: 'invalid json' }, 400);
  }
  const err = validatePost(body);
  if (err) return reply({ error: err }, 400);

  // read-modify-write the per-day source map
  const key = KV_PREFIX + body.date;
  let day = {};
  try {
    const raw = await env.USAGE_KV.get(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) day = parsed;
    }
  } catch {
    day = {};   // corrupted entry → overwrite cleanly
  }
  day[body.source] = {
    tokens: body.tokens,
    sessions: body.sessions,
    updated: new Date().toISOString(),
  };

  try {
    await env.USAGE_KV.put(key, JSON.stringify(day));
  } catch {
    return reply({ error: 'kv' }, 500);
  }

  // Ops log: date + source label only. Never the body, never PII.
  console.log(`POST ok date=${body.date} source=${body.source}`);
  return reply({ ok: true }, 200);
}

async function handleGet(request, env) {
  const origin = request.headers.get('origin') || '';
  const headers = corsForGet(origin);

  const dates = lastNDays(WINDOW_DAYS);
  const reads = await Promise.all(
    dates.map(d => env.USAGE_KV.get(KV_PREFIX + d))
  );

  let updated = null;
  const days = dates.map((date, i) => {
    let tokens = 0, sessions = 0;
    const raw = reads[i];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const slot of Object.keys(parsed)) {
            const e = parsed[slot];
            if (!e || typeof e !== 'object') continue;
            if (Number.isFinite(e.tokens))   tokens   += e.tokens;
            if (Number.isFinite(e.sessions)) sessions += e.sessions;
            if (typeof e.updated === 'string' && (!updated || e.updated > updated)) {
              updated = e.updated;
            }
          }
        }
      } catch {
        // corrupted day → treat as zero, don't fail the whole response
      }
    }
    return { date, tokens, sessions };
  });

  return reply(
    { days, since: dates[0], updated },
    200,
    headers,
  );
}

// ── Router ──────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/') return reply({ error: 'not found' }, 404);

    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('origin') || '';
      return new Response(null, { status: 204, headers: corsForGet(origin) });
    }
    if (request.method === 'GET')  return handleGet(request, env);
    if (request.method === 'POST') return handlePost(request, env);
    return reply({ error: 'method not allowed' }, 405);
  },
};
