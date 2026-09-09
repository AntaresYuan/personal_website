/* ════════════════════════════════════════════════════════════════════════
   antares-usage — /usage dashboard backend (Cloudflare Worker).

   Three routes, one file, zero deps.

   POST /
     Headers:  Authorization: Bearer <SHARED_SECRET>
     Body:     see validatePost() — a strict allowlist. The v1 shape
               { date, source, tokens, sessions, costCents } still validates;
               v2 adds the token-category detail block + per-dimension maps.
     →  200 { "ok": true }                       on success
     →  400 { "error": "<reason>" }              malformed / wrong schema
     →  401 { "error": "unauthorized" }          missing / wrong bearer
     →  500 { "error": "kv" }                    KV write failed

     Stores at KV key `usage:YYYY-MM-DD` an object keyed by source slot:
       { "<source>": { tokens, sessions, costCents, detail?, byModel?,
                       byProject?, bySource?, updated } }
     Read-modify-write per slot, so devices never overwrite each other.

   GET /
     Public, CORS-locked to https://antaresyuan.site (+ localhost dev).
     Emits the SUMMARY projection plus whatever extra dimensions the
     publish config opts into. Never emits per-device slots.

   GET /detail
     Bearer-authed (same secret). Returns everything KV holds, including
     the dimensions the public projection withholds. This is the "私有维度
     进 KV、不进公开 GET" half of the contract: detail is collected and
     stored, but reaching it requires the secret.

   ── Privacy model (v2) ──────────────────────────────────────────────
   v1 hard-coded one public shape. v2 makes the public projection
   CONFIGURABLE while keeping "private by default":

     PUBLIC_FIELDS   which per-day scalars appear in GET /
     PUBLIC_DIMS     which breakdown maps appear in GET / (default: none)

   Both are read from the USAGE_PUBLISH env var (a JSON object in
   wrangler.toml [vars]), so flipping a dimension public is a config edit
   + redeploy — no schema change, no re-collection, and no code change.
   Anything not explicitly published stays server-side.
   ════════════════════════════════════════════════════════════════════════ */

const SITE = 'https://antaresyuan.site';
// 365 = one year, matches the GitHub-contribution-graph layout the public
// dashboard renders. KV stores all daily keys regardless, so this is purely
// a public-projection window — extend or shrink without losing older data.
const WINDOW_DAYS = 365;
const KV_PREFIX = 'usage:';
// v2 payloads carry per-model / per-project maps, so the old 1 KiB cap is
// too tight. Still bounded so a bug can't push megabytes into KV.
const MAX_BODY_BYTES = 64 * 1024;
const MAX_SOURCE_LEN = 32;          // a source label can't exceed 32 chars
const MAX_INT = 1e12;               // absurd ceiling so a bug can't write garbage
const MAX_DIM_KEYS = 64;            // per-map key cap (models/projects per day)
const MAX_DIM_KEY_LEN = 64;

// Edge-cache the assembled GET body for this long. Each cache miss costs
// WINDOW_DAYS (=365) KV reads — without caching, a handful of visitors with
// the page open blew through the 100k/day free-tier KV read quota in under
// an hour on 2026-05-14. With s-maxage=60 each PoP does at most ~1 fan-out
// per minute regardless of traffic.
/* 600s, not 60s. The upstream agent pushes every 30 minutes, so a 60-second
   window bought no freshness at all — it just multiplied cache misses by ten,
   and every miss is a KV fan-out. Anything below the agent's own interval is
   spending reads to re-derive a number that cannot have changed. */
const GET_CACHE_TTL_S = 600;
const GET_CACHE_KEY = 'https://usage.antaresyuan.site/__cache/days';

// ── token detail fields ─────────────────────────────────────────────
// The five non-overlapping token categories the sync agent measures, plus
// the derived total. Kept as one list so validation, storage, summing and
// projection can't drift apart.
const DETAIL_FIELDS = [
  'inputTokens',
  'outputTokens',
  'cachedInputTokens',
  'cacheCreationInputTokens',
  'reasoningOutputTokens',
  'totalTokens',
];
// Session-quality scalars.
const SESSION_FIELDS = [
  'activeSeconds',
  'durationSeconds',
  'messageCount',
  'userMessageCount',
];
// Breakdown maps: dimension name → { [key]: { ...DETAIL_FIELDS, costCents } }
const DIM_FIELDS = ['bySource', 'byModel', 'byProject'];

// ── rhythm vectors ──────────────────────────────────────────────────
// Fixed-length integer arrays describing WHEN the prompts happened, in the
// device's LOCAL time (the agent normalises before sending — see
// buildPayload). Kept separate from DIM_FIELDS because they're positional
// arrays, not keyed maps: summing across devices is element-wise, and
// there are no strings to leak.
//
// promptHours     24 slots, hour 0..23
// promptWeekHours 168 slots, weekday*24 + hour (weekday 0 = Sunday)
const VECTOR_FIELDS = { promptHours: 24, promptWeekHours: 168 };
// Scalar that annotates the vectors rather than accumulating: summing
// timezone offsets across devices would be meaningless, so the merge keeps
// the value from the most recently written slot.
const TZ_FIELD = 'tzOffsetMinutes';

/* ── tool-category tallies ───────────────────────────────────────────
   A third shape, distinct from both DIM_FIELDS and VECTOR_FIELDS: a map
   with a FIXED, closed key set. It isn't a dim map (those accept arbitrary
   keys like model ids and hold nested detail objects) and it isn't a
   positional vector (the keys are meaningful names, and adding a category
   later must not silently shift older data the way an index would).

   The closed key set is the privacy control. The agent classifies each
   tool call into one of these buckets locally and never sends a tool, MCP
   server or skill NAME — so a server named after an internal system can't
   reach this endpoint even if the agent were modified. Validating the key
   set here rather than trusting the agent is what makes that a guarantee
   instead of a convention. */
const TOOL_COUNT_FIELD = 'toolCounts';
const TOOL_COUNT_KEYS = ['read', 'edit', 'shell', 'search', 'browser', 'task', 'other', 'mcp'];

const ALL_NUMERIC_FIELDS = [
  'tokens',
  'sessions',
  'costCents',
  ...DETAIL_FIELDS,
  ...SESSION_FIELDS,
];

// ── publish config ──────────────────────────────────────────────────
// Private by default: only the v1 four scalars are public unless the
// deployment opts into more. Set USAGE_PUBLISH in wrangler.toml, e.g.
//   USAGE_PUBLISH = '{"fields":["cachedInputTokens"],"dims":["bySource"]}'
const DEFAULT_PUBLIC_FIELDS = ['tokens', 'sessions', 'costCents'];

function publishConfig(env) {
  let cfg = {};
  const raw = env && env.USAGE_PUBLISH;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) cfg = parsed;
    } catch {
      // Malformed config → fall back to private-by-default rather than
      // accidentally publishing everything.
      cfg = {};
    }
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    cfg = raw;
  }

  const wanted = Array.isArray(cfg.fields) ? cfg.fields : [];
  const fields = new Set(DEFAULT_PUBLIC_FIELDS);
  for (const f of wanted) {
    // Only fields we actually store can be published.
    if (ALL_NUMERIC_FIELDS.includes(f)) fields.add(f);
  }

  const wantedDims = Array.isArray(cfg.dims) ? cfg.dims : [];
  // Vector names are publishable through the same `dims` list as the keyed
  // breakdown maps — one opt-in mechanism, so there's only one place to look
  // when auditing what the public endpoint emits.
  const publishableDims = [...DIM_FIELDS, ...Object.keys(VECTOR_FIELDS), TOOL_COUNT_FIELD];
  const dims = wantedDims.filter((d) => publishableDims.includes(d));

  return { fields, dims };
}

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
function badInt(v) {
  return !Number.isInteger(v) || v < 0 || v > MAX_INT;
}

// Validate one breakdown map: { key: { <numeric fields> } }.
function validateDimMap(name, map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    return `${name} must be an object`;
  }
  const keys = Object.keys(map);
  if (keys.length > MAX_DIM_KEYS) return `${name} has too many keys (max ${MAX_DIM_KEYS})`;
  const allowed = new Set([...DETAIL_FIELDS, 'costCents']);
  for (const k of keys) {
    if (typeof k !== 'string' || k.length > MAX_DIM_KEY_LEN) {
      return `${name} key too long: ${String(k).slice(0, 16)}…`;
    }
    const entry = map[k];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return `${name}["${k}"] must be an object`;
    }
    for (const f of Object.keys(entry)) {
      if (!allowed.has(f)) return `unexpected field in ${name}["${k}"]: ${f}`;
      if (badInt(entry[f])) return `${name}["${k}"].${f} must be a non-negative integer`;
    }
  }
  return null;
}

// Validate one fixed-length vector of non-negative ints.
function validateVector(name, arr, len) {
  if (!Array.isArray(arr)) return `${name} must be an array`;
  if (arr.length !== len) return `${name} must have exactly ${len} entries`;
  for (const v of arr) {
    if (badInt(v)) return `${name} entries must be non-negative integers`;
  }
  return null;
}

/* Validate the fixed-key tool tally. Unknown keys are REJECTED rather than
   ignored: silently dropping them would let a future agent think it was
   publishing a category that never arrives, and — more importantly — an
   ignored key is one that nobody audits. */
function validateToolCounts(name, map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    return `${name} must be an object`;
  }
  for (const k of Object.keys(map)) {
    if (!TOOL_COUNT_KEYS.includes(k)) return `unexpected key in ${name}: ${String(k).slice(0, 24)}`;
    if (badInt(map[k])) return `${name}.${k} must be a non-negative integer`;
  }
  return null;
}

// Allowlist-based: any key outside the known set → reject. Every v2 field is
// OPTIONAL so a v1 agent keeps working unchanged (backward compat is the
// reason the old four scalars are still the only required ones).
function validatePost(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'body must be a JSON object';
  }
  const allowed = new Set([
    'date',
    'source',
    'tokens',
    'sessions',
    'costCents',
    ...DETAIL_FIELDS,
    ...SESSION_FIELDS,
    ...DIM_FIELDS,
    ...Object.keys(VECTOR_FIELDS),
    TZ_FIELD,
    TOOL_COUNT_FIELD,
  ]);
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
  if (badInt(body.tokens)) return 'tokens must be a non-negative integer';
  if (badInt(body.sessions)) return 'sessions must be a non-negative integer';

  // costCents stayed optional in v1 for older agents; keep that.
  if (body.costCents !== undefined && badInt(body.costCents)) {
    return 'costCents must be a non-negative integer';
  }
  for (const f of [...DETAIL_FIELDS, ...SESSION_FIELDS]) {
    if (body[f] !== undefined && badInt(body[f])) {
      return `${f} must be a non-negative integer`;
    }
  }
  for (const d of DIM_FIELDS) {
    if (body[d] === undefined) continue;
    const err = validateDimMap(d, body[d]);
    if (err) return err;
  }
  for (const [name, len] of Object.entries(VECTOR_FIELDS)) {
    if (body[name] === undefined) continue;
    const err = validateVector(name, body[name], len);
    if (err) return err;
  }
  // Real-world offsets span UTC-12..UTC+14; allow the range and nothing else.
  if (body[TZ_FIELD] !== undefined) {
    const v = body[TZ_FIELD];
    if (!Number.isInteger(v) || v < -720 || v > 840) {
      return `${TZ_FIELD} must be an integer between -720 and 840`;
    }
  }
  if (body[TOOL_COUNT_FIELD] !== undefined) {
    const err = validateToolCounts(TOOL_COUNT_FIELD, body[TOOL_COUNT_FIELD]);
    if (err) return err;
  }
  return null;
}

// ── beacon: site interaction counters ───────────────────────────────
/* Counts which parts of the site people actually touch: skins, charts,
   terminal, Q&A. Deliberately NOT a general analytics endpoint.

   This route is PUBLIC. The POST / route above is authenticated with a
   bearer token, but a browser cannot hold a secret — shipping one in a
   script tag publishes it. So instead of pretending to authenticate,
   /beacon is designed to be safe while open:

     - a fixed allowlist of event names; unknown names are rejected, so
       the endpoint can never become a general-purpose key/value store
     - values must match a per-event allowlist too, so `skin` cannot
       accumulate an unbounded set of keys from crafted requests
     - counters only. No identifiers of any kind are accepted or derived:
       no cookie, no visitor id, no IP, no user agent, no referrer, no
       timestamp beyond the calendar day. A payload carrying extra keys
       is rejected rather than quietly trimmed, so a future client that
       starts sending more gets a loud failure instead of silently
       logging something this endpoint promised not to store
     - one bounded increment per request, so the worst a flood achieves
       is inflating a public counter — which is why nothing here is used
       for anything that matters

   The privacy cost is real and worth stating: because nothing is
   correlated, "16 people changed skin once" and "one person changed
   skin 16 times" are indistinguishable. That is the intended trade. */

const BEACON_PREFIX = 'beacon:';
const BEACON_MAX_BODY = 512;

// event -> allowed values. null means "no value, just count the event".
const BEACON_EVENTS = {
  skin_pick: 'SKINS',          // resolved below against the real skin list
  // The three real apply() call sites in skin-runtime.js: a picker click
  // (opts.boot), a page-load restore, and a reduced-motion re-apply.
  skin_source: ['picker', 'restore', 'motion'],
  /* Every chart id that exists, across BOTH surfaces:
       - homepage rotator (VIEWS in scripts/render.js): calendar, rhythm,
         trend — rhythm and trend are conditional on there being enough
         data, so a fresh site shows fewer
       - /usage/ (put() calls in scripts/usage-page.js): the same calendar
         and rhythm plus hours, weekday, mix, sessions, tools
     The /usage/ sub-page renders all seven of its charts at once with no
     tabs, so there is no "open" event to count there — its ids are
     deliberately NOT listed. Listing them would create keys that can
     never increment, and a permanently-zero counter is indistinguishable
     from a broken hook. Add them here only if that page gains tabs.

     Two earlier drafts were wrong in opposite directions: the first
     invented ids that do not exist (streak/projects/models); the second
     added the sub-page's five extra ids without checking that anything
     could ever fire them. */
  chart_open: ['calendar', 'rhythm', 'trend'],
  /* Real command names, read off cmds.* in scripts/terminal.js. An
     earlier version of this list was guessed (skins/about/clear) and
     would have rejected every actual command while accepting three that
     do not exist — the counters would have read as "nobody uses the
     terminal" no matter how much it was used. beacon.test.js now
     asserts this against terminal.js. */
  terminal_cmd: [
    'help', 'whoami', 'projects', 'now', 'cat', 'open', 'search', 'ask',
    'recent', 'stats', 'fortune', 'lens', 'contact', 'cv', 'clear', 'unknown',
  ],
  qa_ask: ['answered', 'unanswered'],
  page_view: ['home', 'usage', 'blog'],
};

/* Skin ids are enumerated rather than accepting free text: an open field
   would let anyone create unbounded keys in the day map, and a typo in
   the client would silently create a phantom skin that looks like real
   data. Keep in sync with scripts/skins.js — beacon.test.js asserts it. */
const BEACON_SKINS = [
  'default', 'meadow', 'solar', 'press', 'dossier', 'blueprint',
  'terminal', 'hud', 'neon', 'dusk', 'observatory', 'abyss',
  'dumpling', 'vocal', 'workshop', 'hereva',
];

function beaconAllowedValues(event) {
  const spec = BEACON_EVENTS[event];
  if (spec === 'SKINS') return BEACON_SKINS;
  return spec;
}

function validateBeacon(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'object required';
  // Reject unknown keys instead of ignoring them: silently accepting a
  // field means a client can believe it is recording something that is
  // actually being dropped.
  for (const k of Object.keys(body)) {
    if (k !== 'event' && k !== 'value') return `unexpected field: ${k}`;
  }
  const { event, value } = body;
  if (typeof event !== 'string' || !Object.prototype.hasOwnProperty.call(BEACON_EVENTS, event)) {
    return 'unknown event';
  }
  const allowed = beaconAllowedValues(event);
  if (allowed === null) {
    if (value !== undefined) return `${event} takes no value`;
    return null;
  }
  if (typeof value !== 'string' || !allowed.includes(value)) {
    return `invalid value for ${event}`;
  }
  return null;
}

function beaconCors(origin) {
  const ok = origin === SITE
    || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
  return ok
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        /* navigator.sendBeacon ALWAYS sends in credentials:'include' mode, and
           that mode rejects a response without this header even when the
           origin is allowed. Without it every beacon from a real browser was
           dropped at the CORS layer while curl kept returning 204 — curl sends
           no credentials, so it never exercised this path.

           sendBeacon() also returns true on failure (true means "queued", not
           "delivered"), so nothing on the page could notice, and the counters
           just stayed empty as though no visitor had ever clicked anything.

           Echoing the exact origin, never '*': the wildcard is illegal in
           credentialed mode, and the allowlist above is what limits this. */
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      }
    : { Vary: 'Origin' };
}

async function handleBeacon(request, env) {
  const origin = request.headers.get('origin') || '';
  const ch = beaconCors(origin);
  // No ACAO means the origin is not ours. Refuse rather than counting a
  // hit from an unknown embedder.
  if (!ch['Access-Control-Allow-Origin']) return reply({ error: 'forbidden' }, 403, ch);

  const text = await request.text();
  if (text.length > BEACON_MAX_BODY) return reply({ error: 'body too large' }, 400, ch);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return reply({ error: 'invalid json' }, 400, ch);
  }
  const err = validateBeacon(body);
  if (err) return reply({ error: err }, 400, ch);

  /* Day bucket in UTC. Using the visitor's local date would require
     reading a client-supplied offset, which is a (weak) fingerprinting
     signal for exactly zero benefit to a counter. */
  const day = new Date().toISOString().slice(0, 10);
  const key = BEACON_PREFIX + day;

  let counts = {};
  try {
    const raw = await env.USAGE_KV.get(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) counts = parsed;
    }
  } catch {
    counts = {};
  }

  const field = body.value ? `${body.event}:${body.value}` : body.event;
  const prev = Number.isInteger(counts[field]) ? counts[field] : 0;
  counts[field] = prev + 1;

  try {
    await env.USAGE_KV.put(key, JSON.stringify(counts));
  } catch {
    return reply({ error: 'kv' }, 500, ch);
  }
  // 204: nothing to return, and sendBeacon ignores the body anyway.
  return new Response(null, { status: 204, headers: ch });
}

/* GET /beacon — the aggregate, for the site to display. Public by
   design: these counts are site trivia ("most-picked skin"), and the
   owner chooses on the page which of them to actually show. */
async function handleBeaconGet(request, env) {
  const origin = request.headers.get('origin') || '';
  const ch = { ...beaconCors(origin), 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
  const n = Math.min(Math.max(parseInt(new URL(request.url).searchParams.get('days') || '30', 10) || 30, 1), 90);
  const dates = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) {
    dates.push(new Date(now - i * 86400000).toISOString().slice(0, 10));
  }
  /* Same two fixes as handleGet, for the same reason.

     As written this fanned out n KV gets on EVERY call with no cache at all,
     and the menu bar polls it every 15 minutes. Counters only move when a
     visitor does something, so serving a 10-minute-old tally costs no real
     accuracy and removes almost all of the reads.

     The cache key includes n: `?days=7` and `?days=90` are different answers
     and must not share an entry. Keying on the raw request URL instead would
     also split on unrelated query junk, quietly making the cache useless. */
  const cache = caches.default;
  const ckey = `https://usage.antaresyuan.site/__cache/beacon/${n}`;
  const hit = await cache.match(ckey);
  if (hit) {
    return new Response(await hit.text(), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8',
                 'cache-control': 'no-store', ...ch },
    });
  }

  // Read only days that exist: on a namespace where beacon counters have
  // barely been written, 30 gets is 30 billed reads returning nothing.
  const present = new Set();
  try {
    let cursor;
    do {
      const page = await env.USAGE_KV.list({ prefix: BEACON_PREFIX, cursor });
      for (const k of page.keys) present.add(k.name.slice(BEACON_PREFIX.length));
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
  } catch {
    for (const d of dates) present.add(d);   // correctness over cost
  }
  const reads = await Promise.all(
    dates.filter((d) => present.has(d)).map((d) => env.USAGE_KV.get(BEACON_PREFIX + d))
  );
  const total = {};
  for (const raw of reads) {
    if (!raw) continue;
    let parsed;
    try { parsed = JSON.parse(raw); } catch { continue; }
    if (!parsed || typeof parsed !== 'object') continue;
    for (const [k, v] of Object.entries(parsed)) {
      if (Number.isInteger(v)) total[k] = (total[k] || 0) + v;
    }
  }
  const payload = JSON.stringify({ counts: total, since: dates[0], days: n });
  cache.put(ckey, new Response(payload, {
    headers: { 'content-type': 'application/json; charset=utf-8',
               'cache-control': `public, s-maxage=${GET_CACHE_TTL_S}` },
  })).catch(() => { /* stashing is best-effort */ });
  return new Response(payload, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8',
               'cache-control': 'no-store', ...ch },
  });
}

// ── Handlers ────────────────────────────────────────────────────────
function bearerOk(request, env) {
  const auth = request.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  const expected = env.SHARED_SECRET;
  if (!expected) return null;              // misconfigured
  return Boolean(m && m[1] === expected);
}

async function handlePost(request, env) {
  const authed = bearerOk(request, env);
  if (authed === null) return reply({ error: 'server misconfigured' }, 500);
  if (!authed) return reply({ error: 'unauthorized' }, 401);

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

  const slot = {
    tokens: body.tokens,
    sessions: body.sessions,
    costCents: Number.isInteger(body.costCents) ? body.costCents : 0,
    updated: new Date().toISOString(),
  };
  // Store detail only when the agent sent it, so a v1 agent's slot stays
  // byte-identical to what it wrote before.
  for (const f of [...DETAIL_FIELDS, ...SESSION_FIELDS]) {
    if (Number.isInteger(body[f])) slot[f] = body[f];
  }
  for (const d of DIM_FIELDS) {
    if (body[d] && typeof body[d] === 'object') slot[d] = body[d];
  }
  for (const name of Object.keys(VECTOR_FIELDS)) {
    if (Array.isArray(body[name])) slot[name] = body[name];
  }
  if (Number.isInteger(body[TZ_FIELD])) slot[TZ_FIELD] = body[TZ_FIELD];
  if (body[TOOL_COUNT_FIELD] && typeof body[TOOL_COUNT_FIELD] === 'object') {
    slot[TOOL_COUNT_FIELD] = body[TOOL_COUNT_FIELD];
  }
  day[body.source] = slot;

  try {
    await env.USAGE_KV.put(key, JSON.stringify(day));
  } catch {
    return reply({ error: 'kv' }, 500);
  }

  // Invalidate the GET cache so a sync agent's POST shows up on the next
  // GET, not after the 60s TTL expires. Local-PoP only — other PoPs may
  // still serve a 60s-stale response, which we accept (matches frontend
  // refetch cadence).
  try { await caches.default.delete(GET_CACHE_KEY); } catch { /* noop */ }

  // Ops log: date + source label only. Never the body, never PII.
  console.log(`POST ok date=${body.date} source=${body.source}`);
  return reply({ ok: true }, 200);
}

// Merge every source slot of one KV day into a single aggregate.
// `full` = true keeps all detail (authed /detail); false keeps only what the
// publish config allows.
function aggregateDay(raw, projection) {
  const agg = { tokens: 0, sessions: 0, costCents: 0 };
  for (const f of [...DETAIL_FIELDS, ...SESSION_FIELDS]) agg[f] = 0;
  const dims = {};
  for (const d of DIM_FIELDS) dims[d] = {};
  // Element-wise accumulators for the rhythm vectors. Lazily created so a day
  // with no vector data reports nothing rather than 24/168 zeros.
  const vectors = {};
  // Tool tallies sum across devices key-by-key, same as the vectors: two
  // machines' shell counts genuinely add up.
  let toolCounts = null;
  let tzOffset = null;
  let tzFrom = '';         // `updated` of the slot tzOffset came from
  let updated = null;
  let present = false;

  if (raw) {
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const slotName of Object.keys(parsed)) {
        const e = parsed[slotName];
        if (!e || typeof e !== 'object') continue;
        present = true;
        for (const f of ['tokens', 'sessions', 'costCents', ...DETAIL_FIELDS, ...SESSION_FIELDS]) {
          if (Number.isFinite(e[f])) agg[f] += e[f];
        }
        for (const d of DIM_FIELDS) {
          const m = e[d];
          if (!m || typeof m !== 'object') continue;
          for (const k of Object.keys(m)) {
            const src = m[k];
            if (!src || typeof src !== 'object') continue;
            if (!dims[d][k]) {
              dims[d][k] = {};
              for (const f of [...DETAIL_FIELDS, 'costCents']) dims[d][k][f] = 0;
            }
            for (const f of [...DETAIL_FIELDS, 'costCents']) {
              if (Number.isFinite(src[f])) dims[d][k][f] += src[f];
            }
          }
        }
        // Two devices in the same timezone sum cleanly; two in different
        // zones produce a blended shape, which is the honest answer for
        // "when was this person working" across machines.
        for (const [name, len] of Object.entries(VECTOR_FIELDS)) {
          const v = e[name];
          if (!Array.isArray(v) || v.length !== len) continue;
          if (!vectors[name]) vectors[name] = new Array(len).fill(0);
          for (let i = 0; i < len; i++) {
            if (Number.isFinite(v[i])) vectors[name][i] += v[i];
          }
        }
        // Offsets can't be summed — keep the newest slot's value.
        if (Number.isInteger(e[TZ_FIELD])) {
          const stamp = typeof e.updated === 'string' ? e.updated : '';
          if (tzOffset === null || stamp > tzFrom) {
            tzOffset = e[TZ_FIELD];
            tzFrom = stamp;
          }
        }
        // Tool tallies: sum over the closed key set. A key the slot doesn't
        // carry contributes nothing rather than NaN.
        const tc = e[TOOL_COUNT_FIELD];
        if (tc && typeof tc === 'object' && !Array.isArray(tc)) {
          if (!toolCounts) {
            toolCounts = {};
            for (const k of TOOL_COUNT_KEYS) toolCounts[k] = 0;
          }
          for (const k of TOOL_COUNT_KEYS) {
            if (Number.isFinite(tc[k])) toolCounts[k] += tc[k];
          }
        }
        if (typeof e.updated === 'string' && (!updated || e.updated > updated)) {
          updated = e.updated;
        }
      }
    }
  }

  // Project down to what the caller is allowed to see.
  const out = {};
  if (projection === 'full') {
    for (const f of ['tokens', 'sessions', 'costCents', ...DETAIL_FIELDS, ...SESSION_FIELDS]) {
      out[f] = agg[f];
    }
    for (const d of DIM_FIELDS) out[d] = dims[d];
    for (const name of Object.keys(VECTOR_FIELDS)) {
      if (vectors[name]) out[name] = vectors[name];
    }
    if (toolCounts) out[TOOL_COUNT_FIELD] = toolCounts;
    if (tzOffset !== null) out[TZ_FIELD] = tzOffset;
  } else {
    for (const f of projection.fields) out[f] = agg[f] || 0;
    // `dims` mixes keyed maps, positional vectors and the fixed-key tool
    // tally; route each name to the right accumulator so no shape lands
    // under another's key.
    for (const d of projection.dims) {
      if (d === TOOL_COUNT_FIELD) {
        if (toolCounts) out[d] = toolCounts;
      } else if (VECTOR_FIELDS[d]) {
        if (vectors[d]) out[d] = vectors[d];
      } else if (dims[d]) {
        out[d] = dims[d];
      }
    }
    const wantsVector = projection.dims.some((d) => VECTOR_FIELDS[d]);
    if (wantsVector && tzOffset !== null) out[TZ_FIELD] = tzOffset;
  }
  return { day: out, updated, present };
}

async function handleGet(request, env) {
  const origin = request.headers.get('origin') || '';
  const headers = corsForGet(origin);
  const projection = publishConfig(env);

  // Edge-cache hit path: shared body across origins; CORS headers per request.
  const cache = caches.default;
  const cached = await cache.match(GET_CACHE_KEY);
  if (cached) {
    const body = await cached.text();
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        ...headers,
      },
    });
  }

  /* Cache miss: assemble the window.

     This used to `get()` all WINDOW_DAYS keys unconditionally. With 365 days
     in the window and ~40 days of real data, 89% of those reads returned null
     — and a KV read costs the same whether the key exists or not. Measured on
     2026-09-07 that came to 91,291 reads in one day, 91% of the free daily
     allowance, from a personal site with 11 visitors.

     `list()` is ONE billed operation and names exactly the keys that exist,
     so we read only those. A day with no key is synthesized through the same
     aggregateDay(null) path as before, which returns the identical zero-filled
     shape — so the response stays byte-for-byte what it was. That equality is
     the whole point: this is a cost fix, and it must not become a data change.

     list() paginates at 1000 keys. This namespace holds ~40, but the loop is
     here because silently truncating would drop the OLDEST days and leave a
     plausible-looking response — the kind of bug you find months later. */
  const dates = lastNDays(WINDOW_DAYS);
  const existing = new Set();
  try {
    let cursor;
    do {
      const page = await env.USAGE_KV.list({ prefix: KV_PREFIX, cursor });
      for (const k of page.keys) existing.add(k.name.slice(KV_PREFIX.length));
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
  } catch {
    // If list() fails we must not report an empty history as if it were the
    // truth. Fall back to the old fan-out: expensive, but correct.
    for (const d of dates) existing.add(d);
  }

  const wanted = dates.filter((d) => existing.has(d));
  const fetched = await Promise.all(
    wanted.map((d) => env.USAGE_KV.get(KV_PREFIX + d))
  );
  const byDate = new Map(wanted.map((d, i) => [d, fetched[i]]));

  let updated = null;
  const days = dates.map((date) => {
    // undefined for a day with no key — aggregateDay treats it exactly as it
    // treated the null that a get() on a missing key used to return.
    const r = aggregateDay(byDate.get(date), projection);
    if (r.updated && (!updated || r.updated > updated)) updated = r.updated;
    return { date, ...r.day };
  });

  const body = JSON.stringify({ days, since: dates[0], updated });
  // Stash with s-maxage so this PoP's edge cache holds it for GET_CACHE_TTL_S.
  // No await needed — fire-and-forget so we don't block the response.
  cache.put(GET_CACHE_KEY, new Response(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, s-maxage=${GET_CACHE_TTL_S}`,
    },
  })).catch(() => { /* cache stash failure is non-fatal */ });

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

// Authed full-detail read. Never edge-cached (the public cache key must not
// be able to serve private data) and never CORS-exposed to the browser.
async function handleDetail(request, env) {
  const authed = bearerOk(request, env);
  if (authed === null) return reply({ error: 'server misconfigured' }, 500);
  if (!authed) return reply({ error: 'unauthorized' }, 401);

  const url = new URL(request.url);
  const nRaw = parseInt(url.searchParams.get('days') || '', 10);
  const n = Number.isInteger(nRaw) && nRaw > 0 && nRaw <= WINDOW_DAYS ? nRaw : 30;

  const dates = lastNDays(n);
  const reads = await Promise.all(dates.map(d => env.USAGE_KV.get(KV_PREFIX + d)));

  let updated = null;
  const days = [];
  for (let i = 0; i < dates.length; i++) {
    const r = aggregateDay(reads[i], 'full');
    if (r.updated && (!updated || r.updated > updated)) updated = r.updated;
    if (r.present) days.push({ date: dates[i], ...r.day });
  }
  return reply({ days, since: dates[0], updated }, 200);
}

// ── Router ──────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/beacon') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: beaconCors(request.headers.get('origin') || '') });
      }
      if (request.method === 'POST') return handleBeacon(request, env);
      if (request.method === 'GET') return handleBeaconGet(request, env);
      return reply({ error: 'method not allowed' }, 405);
    }
    if (url.pathname === '/detail') {
      if (request.method !== 'GET') return reply({ error: 'method not allowed' }, 405);
      return handleDetail(request, env);
    }
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
