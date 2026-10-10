/* ════════════════════════════════════════════════════════════════════════
   antares-comments — reactions and comments for the Work space's Writing
   posts (Cloudflare Worker + D1). Zero npm deps; the open parts it stands
   on are D1 (SQLite), Turnstile and Llama Guard on Workers AI.

   Public (CORS-locked to ALLOWED_ORIGINS):
     GET  /v1/thread?page=/blog/<slug>/     reactions + published comments
          Header X-Visitor (optional): marks the reactions this browser gave.
     POST /v1/comments    { page, name, email?, body, parent?, token }
          token = a Turnstile response. Anonymous: a nickname is enough.
          → 201 { comment, status: 'published' | 'pending' }
     POST /v1/reactions   { page, kind, on }   Header X-Visitor
          → 200 { reactions, mine }

   Owner (Authorization: Bearer <ADMIN_TOKEN>):
     GET  /admin                        the moderation page (+ /admin.js)
     GET  /v1/admin/comments?status=    pending | published | all
     POST /v1/admin/comments/<id>       { action: approve | hide | delete }
     POST /v1/admin/reply               { parent, body }   reply as the owner

   Moderation (MODERATION var):
     ai    (default) — a comment with a link, a long run of one character, or
           the owner's name waits for review; the rest goes to Llama Guard and
           is published if it says safe. A failed model call holds it.
     hold  — every comment waits for review.
     off   — everything is published (Turnstile and rate limits still apply).

   Privacy: the public GET never returns an email or an IP. IPs and visitor
   ids are stored only as salted SHA-256 (HASH_SALT); an email is stored only
   when reply notifications are on (RESEND_API_KEY + MAIL_FROM), and only to
   send them.
   ════════════════════════════════════════════════════════════════════════ */
import {
  LIMITS, ID, VISITOR, newId, kindsOf, pageOk, validateComment, parseGuard, publicComment, countsOf,
} from './lib.js';
import { ADMIN_HTML, ADMIN_JS } from './admin.js';

const GUARD_MODEL = '@cf/meta/llama-guard-3-8b';
const RATE = { windowMs: 10 * 60 * 1000, perWindow: 3, perDay: 20 };
const REACT_PER_IP = 5;            // one network may hold this many of one reaction on one page

/* ── HTTP plumbing ──────────────────────────────────────────────────────── */
const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || 'https://antaresyuan.site').split(',').map((s) => s.trim());
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Visitor',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > LIMITS.json) return null;
  try { return JSON.parse(text); } catch { return null; }
}

const notifyOn = (env) => !!(env.RESEND_API_KEY && env.MAIL_FROM);

/* ── Hashing, verification, model ──────────────────────────────────────── */
async function hash(env, value) {
  if (!env.HASH_SALT) throw new Error('HASH_SALT is not set');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.HASH_SALT}\u0000${value}`));
  return [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function turnstileOk(env, token, ip) {
  if (!env.TURNSTILE_SECRET || typeof token !== 'string' || !token || token.length > 2048) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const d = await r.json();
    return d.success === true;
  } catch {
    return false;
  }
}

async function guard(env, body) {
  if (!env.AI) return { safe: false, categories: ['no-ai'] };
  try {
    return parseGuard(await env.AI.run(GUARD_MODEL, { messages: [{ role: 'user', content: body }] }));
  } catch {
    return { safe: false, categories: ['ai-error'] };
  }
}

// Constant-time bearer check; a short or missing ADMIN_TOKEN locks the
// admin routes rather than opening them.
async function adminOk(request, env) {
  const expected = String(env.ADMIN_TOKEN || '');
  if (expected.length < 24) return false;
  const m = /^Bearer (.+)$/.exec(request.headers.get('Authorization') || '');
  if (!m) return false;
  const enc = new TextEncoder();
  const a = enc.encode(m[1]), b = enc.encode(expected);
  if (a.byteLength !== b.byteLength) { crypto.subtle.timingSafeEqual(b, b); return false; }
  return crypto.subtle.timingSafeEqual(a, b);
}

/* ── Email (optional, Resend) ──────────────────────────────────────────── */
async function sendMail(env, to, subject, text) {
  if (!notifyOn(env) || !to) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text }),
    });
  } catch { /* a lost email never fails the comment */ }
}

const site = (env) => String(env.SITE_URL || 'https://antaresyuan.site').replace(/\/$/, '');

function mailOwner(env, row) {
  const held = row.status === 'pending';
  return sendMail(env, env.OWNER_EMAIL,
    `${held ? 'Held for review' : 'New comment'} on ${row.page}`,
    `${row.name} wrote on ${site(env)}${row.page}:\n\n${row.body}\n\n` +
    (held ? `Held: ${row.moderation}\n\n` : '') +
    `Review: ${new URL('/admin', env.SELF_URL || 'https://comments.antaresyuan.site')}\n`);
}

// Tell the author of `parent` that `reply` answered them — once per reply.
async function mailReply(env, db, parent, reply) {
  if (!parent || !parent.email || reply.status !== 'published') return;
  await sendMail(env, parent.email,
    `${reply.name} replied to your comment`,
    `${reply.name} replied to your comment on ${site(env)}${reply.page}:\n\n${reply.body}\n\n` +
    `Read it: ${site(env)}${reply.page}#c-${reply.id}\n\n` +
    `You get this because you left your email with a comment on ${site(env).replace(/^https?:\/\//, '')}.\n`);
  await db.prepare('UPDATE comments SET notified = 1 WHERE id = ?').bind(reply.id).run();
}

/* ── Reactions ──────────────────────────────────────────────────────────── */
async function reactionState(db, page, kinds, voter) {
  const counts = await db.prepare('SELECT kind, COUNT(*) AS n FROM reactions WHERE page = ? GROUP BY kind').bind(page).all();
  const mine = voter
    ? (await db.prepare('SELECT kind FROM reactions WHERE page = ? AND voter = ?').bind(page, voter).all()).results.map((r) => r.kind)
    : [];
  return { reactions: countsOf(counts.results, kinds), mine: mine.filter((k) => kinds.includes(k)) };
}

async function visitorHash(request, env) {
  const v = request.headers.get('X-Visitor') || '';
  return VISITOR.test(v) ? hash(env, `v:${v}`) : null;
}

/* ── Routes ─────────────────────────────────────────────────────────────── */
async function getThread(request, env, url, cors) {
  const page = url.searchParams.get('page') || '';
  if (!pageOk(page, env.PAGE_PATTERN)) return json({ error: 'bad-page' }, 400, cors);
  const kinds = kindsOf(env);
  const [state, rows] = await Promise.all([
    reactionState(env.DB, page, kinds, await visitorHash(request, env)),
    env.DB.prepare(`SELECT id, parent, name, body, created_at, owner FROM comments
                    WHERE page = ? AND status = 'published' ORDER BY created_at LIMIT 500`).bind(page).all(),
  ]);
  return json({ page, kinds, ...state, comments: rows.results.map(publicComment), notify: notifyOn(env) }, 200, cors);
}

async function postComment(request, env, ctx, cors) {
  const input = await readJson(request);
  const { value, error } = validateComment(input, { pagePattern: env.PAGE_PATTERN, ownerName: env.OWNER_NAME });
  if (error) return json({ error }, 400, cors);

  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!(await turnstileOk(env, input.token, ip))) return json({ error: 'verification-failed' }, 403, cors);

  const db = env.DB;
  const now = Date.now();
  const ipHash = await hash(env, `ip:${ip}`);
  const recent = await db.prepare(`SELECT
      SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) AS win,
      COUNT(*) AS day
    FROM comments WHERE ip_hash = ? AND created_at > ?`).bind(now - RATE.windowMs, ipHash, now - 86400000).first();
  if ((recent?.win || 0) >= RATE.perWindow || (recent?.day || 0) >= RATE.perDay) return json({ error: 'slow-down' }, 429, cors);

  // Replies are one level deep: answering a reply attaches to its parent.
  let parent = null;
  if (value.parent) {
    parent = await db.prepare('SELECT id, parent, page, status, name, email FROM comments WHERE id = ?').bind(value.parent).first();
    if (!parent || parent.page !== value.page || parent.status !== 'published') return json({ error: 'bad-parent' }, 400, cors);
    if (parent.parent) parent = await db.prepare('SELECT id, parent, page, status, name, email FROM comments WHERE id = ?').bind(parent.parent).first();
  }

  const mode = env.MODERATION || 'ai';
  const reasons = [...value.reasons];
  if (mode === 'hold') reasons.push('hold-all');
  else if (mode === 'ai' && !reasons.length) {
    const g = await guard(env, value.body);
    if (!g.safe) reasons.push(`guard:${g.categories.join(',') || 'unsafe'}`);
  }
  const status = mode === 'off' || !reasons.length ? 'published' : 'pending';

  const row = {
    id: newId(), page: value.page, parent: parent ? parent.id : null, name: value.name,
    email: notifyOn(env) ? value.email : null, body: value.body, status, owner: 0,
    moderation: reasons.join(' ') || null, ip_hash: ipHash, created_at: now,
  };
  await db.prepare(`INSERT INTO comments (id, page, parent, name, email, body, status, owner, moderation, ip_hash, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(row.id, row.page, row.parent, row.name, row.email, row.body, row.status, row.owner, row.moderation, row.ip_hash, row.created_at).run();

  ctx.waitUntil(Promise.all([mailOwner(env, row), mailReply(env, db, parent, row)]));
  return json({ comment: publicComment(row), status }, 201, cors);
}

async function postReaction(request, env, cors) {
  const input = await readJson(request);
  const kinds = kindsOf(env);
  if (!input || !pageOk(input.page, env.PAGE_PATTERN) || !kinds.includes(input.kind)) return json({ error: 'bad-reaction' }, 400, cors);
  const voter = await visitorHash(request, env);
  if (!voter) return json({ error: 'bad-visitor' }, 400, cors);

  const db = env.DB;
  if (input.on) {
    const ipHash = await hash(env, `ip:${request.headers.get('CF-Connecting-IP') || ''}`);
    const held = await db.prepare('SELECT COUNT(*) AS n FROM reactions WHERE page = ? AND kind = ? AND ip_hash = ? AND voter != ?')
      .bind(input.page, input.kind, ipHash, voter).first();
    if ((held?.n || 0) >= REACT_PER_IP) return json({ error: 'slow-down' }, 429, cors);
    await db.prepare('INSERT OR IGNORE INTO reactions (page, kind, voter, ip_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(input.page, input.kind, voter, ipHash, Date.now()).run();
  } else {
    await db.prepare('DELETE FROM reactions WHERE page = ? AND kind = ? AND voter = ?').bind(input.page, input.kind, voter).run();
  }
  return json(await reactionState(db, input.page, kinds, voter), 200, cors);
}

/* ── Admin ──────────────────────────────────────────────────────────────── */
const ADMIN_CSP = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

async function adminList(env, url) {
  const status = url.searchParams.get('status') || 'pending';
  const where = status === 'all' ? '' : 'WHERE status = ?';
  const stmt = env.DB.prepare(`SELECT id, page, parent, name, email, body, status, owner, moderation, created_at
                               FROM comments ${where} ORDER BY created_at DESC LIMIT 200`);
  const rows = await (status === 'all' ? stmt : stmt.bind(status === 'published' ? 'published' : 'pending')).all();
  return json({ comments: rows.results });
}

async function adminAct(env, ctx, id, request) {
  if (!ID.test(id)) return json({ error: 'bad-id' }, 400);
  const input = await readJson(request);
  const db = env.DB;
  const row = await db.prepare('SELECT * FROM comments WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'not-found' }, 404);
  if (input?.action === 'approve') {
    await db.prepare("UPDATE comments SET status = 'published' WHERE id = ?").bind(id).run();
    if (row.parent && !row.notified) {
      const parent = await db.prepare('SELECT * FROM comments WHERE id = ?').bind(row.parent).first();
      ctx.waitUntil(mailReply(env, db, parent, { ...row, status: 'published' }));
    }
  } else if (input?.action === 'hide') {
    await db.prepare("UPDATE comments SET status = 'pending' WHERE id = ?").bind(id).run();
  } else if (input?.action === 'delete') {
    await db.prepare('DELETE FROM comments WHERE id = ? OR parent = ?').bind(id, id).run();
  } else {
    return json({ error: 'bad-action' }, 400);
  }
  return json({ ok: true });
}

async function adminReply(env, ctx, request) {
  const input = await readJson(request);
  const parentId = String(input?.parent || '');
  const body = String(input?.body || '').trim();
  if (!ID.test(parentId) || !body || [...body].length > LIMITS.body) return json({ error: 'bad-reply' }, 400);
  const db = env.DB;
  let parent = await db.prepare('SELECT * FROM comments WHERE id = ?').bind(parentId).first();
  if (!parent) return json({ error: 'not-found' }, 404);
  if (parent.parent) parent = await db.prepare('SELECT * FROM comments WHERE id = ?').bind(parent.parent).first();
  const row = {
    id: newId(), page: parent.page, parent: parent.id, name: env.OWNER_NAME || 'Author', body,
    status: 'published', owner: 1, created_at: Date.now(),
  };
  await db.prepare(`INSERT INTO comments (id, page, parent, name, email, body, status, owner, moderation, ip_hash, created_at)
                    VALUES (?, ?, ?, ?, NULL, ?, 'published', 1, NULL, NULL, ?)`)
    .bind(row.id, row.page, row.parent, row.name, row.body, row.created_at).run();
  ctx.waitUntil(mailReply(env, db, parent, row));
  return json({ comment: publicComment(row) }, 201);
}

/* ── Entry ──────────────────────────────────────────────────────────────── */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    const cors = corsHeaders(request, env);

    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

      if (pathname === '/v1/thread' && request.method === 'GET') return await getThread(request, env, url, cors);
      if (pathname === '/v1/comments' && request.method === 'POST') return await postComment(request, env, ctx, cors);
      if (pathname === '/v1/reactions' && request.method === 'POST') return await postReaction(request, env, cors);

      if (pathname === '/admin' || pathname === '/admin/') {
        return new Response(ADMIN_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': ADMIN_CSP, 'x-robots-tag': 'noindex' } });
      }
      if (pathname === '/admin.js') {
        return new Response(ADMIN_JS, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' } });
      }
      if (pathname.startsWith('/v1/admin/')) {
        if (!(await adminOk(request, env))) return json({ error: 'unauthorized' }, 401);
        if (pathname === '/v1/admin/comments' && request.method === 'GET') return await adminList(env, url);
        if (pathname === '/v1/admin/reply' && request.method === 'POST') return await adminReply(env, ctx, request);
        const m = /^\/v1\/admin\/comments\/([^/]+)$/.exec(pathname);
        if (m && request.method === 'POST') return await adminAct(env, ctx, m[1], request);
      }
      return json({ error: 'not-found' }, 404, cors);
    } catch (err) {
      console.error(err);
      return json({ error: 'server' }, 500, cors);
    }
  },
};
