/* ─────────────────────────────────────────────────────────────────────────
   Pure helpers for the comments Worker: input checks, the spam heuristics,
   reading Llama Guard's verdict, and the public shape of a comment. No
   bindings and no I/O, so test/lib.test.js runs them under plain Node.
   ───────────────────────────────────────────────────────────────────────── */

export const LIMITS = { name: 40, email: 254, body: 2000, page: 200, json: 16 * 1024 };
export const DEFAULT_KINDS = ['like', 'love', 'insight', 'fun'];

// Comment ids: "c_" + 12 base-36 characters.
export const ID = /^c_[a-z0-9]{12}$/;
// The visitor id a browser keeps in localStorage to remember its reactions.
export const VISITOR = /^[A-Za-z0-9_-]{16,64}$/;
const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']+\.[^\s@<>"']{2,}$/;
// A URL, or something that reads like a bare domain. Comments with one are
// held for review; a name with one is refused.
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(com|net|org|io|co|cn|xyz|top|ru|info|biz|me|app|dev|site|online|shop|club|vip|cc|tk|link|live|ly|gg)\b)/i;
// Control characters, zero-width and bidi overrides: nothing a comment needs.
const STRIP = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩﻿]/g;

export const clean = (s) => String(s ?? '').replace(/\r\n?/g, '\n').replace(STRIP, '');
export const charCount = (s) => [...s].length;

export function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return 'c_' + [...bytes].map((b) => (b % 36).toString(36)).join('');
}

export function kindsOf(env) {
  const list = String(env?.REACTIONS || '').split(',').map((s) => s.trim()).filter((s) => /^[a-z]{2,16}$/.test(s));
  return list.length ? list.slice(0, 8) : DEFAULT_KINDS;
}

export function pageOk(page, pattern) {
  if (typeof page !== 'string' || !page || page.length > LIMITS.page || page.includes('..')) return false;
  try { return new RegExp(pattern || '^/blog/[a-z0-9-]+/$').test(page); } catch { return false; }
}

/* A new comment from a visitor → { value } or { error }. The error is a
   short code the client turns into a sentence. */
export function validateComment(input, { pagePattern, ownerName } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'bad-json' };
  const page = String(input.page ?? '');
  if (!pageOk(page, pagePattern)) return { error: 'bad-page' };

  const name = clean(input.name).replace(/\s+/g, ' ').trim();
  if (!name) return { error: 'name-required' };
  if (charCount(name) > LIMITS.name) return { error: 'name-too-long' };
  if (LINK.test(name)) return { error: 'name-has-link' };

  const email = clean(input.email).trim();
  if (email && (email.length > LIMITS.email || !EMAIL.test(email))) return { error: 'bad-email' };

  const body = clean(input.body).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!body) return { error: 'body-required' };
  if (charCount(body) > LIMITS.body) return { error: 'body-too-long' };

  const parent = input.parent ? String(input.parent) : null;
  if (parent && !ID.test(parent)) return { error: 'bad-parent' };

  const value = { page, name, email: email || null, body, parent };
  value.reasons = reviewReasons(value, ownerName);
  return { value };
}

/* Why a comment should wait for a human, before the model is asked. */
export function reviewReasons({ name, body }, ownerName) {
  const out = [];
  if (LINK.test(body)) out.push('link');
  if (/(.)\1{14,}/u.test(body)) out.push('repeat');
  if (ownerName && name.trim().toLowerCase() === String(ownerName).trim().toLowerCase()) out.push('owner-name');
  return out;
}

/* Llama Guard on Workers AI answers either { response: { safe, categories } }
   or plain text ("safe" / "unsafe\nS1,S10"). Anything unreadable is unsafe:
   when in doubt, a person decides. */
export function parseGuard(out) {
  const r = out && typeof out === 'object' && 'response' in out ? out.response : out;
  if (r && typeof r === 'object' && typeof r.safe === 'boolean') {
    return { safe: r.safe, categories: Array.isArray(r.categories) ? r.categories.map(String) : [] };
  }
  if (typeof r === 'string') {
    const t = r.trim().toLowerCase();
    if (t === 'safe') return { safe: true, categories: [] };
    if (t.startsWith('unsafe')) return { safe: false, categories: t.split(/\s+/).slice(1).join(',').split(',').filter(Boolean).map((c) => c.toUpperCase()) };
  }
  return { safe: false, categories: ['unreadable'] };
}

// What the public GET shows of a comment: never the email or the IP hash.
export const publicComment = (row) => ({
  id: row.id,
  parent: row.parent || null,
  name: row.name,
  body: row.body,
  at: row.created_at,
  owner: !!row.owner,
});

// The reaction summary for one page, from `SELECT kind, COUNT(*) n`.
export function countsOf(rows, kinds) {
  const counts = Object.fromEntries(kinds.map((k) => [k, 0]));
  for (const r of rows || []) if (r.kind in counts) counts[r.kind] = Number(r.n) || 0;
  return counts;
}
