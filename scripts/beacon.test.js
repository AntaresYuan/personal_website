#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   beacon.test.js — guards the feature-counter beacon.

   The bulk of this file is DRIFT tests, because every real defect found
   while building this feature was a list in the Worker disagreeing with
   the code that fires the events. Three separate times the allowlist was
   written from memory and was wrong:

     - terminal_cmd listed skins/about/clear, none of which are commands,
       and omitted all fourteen that are
     - chart_open listed streak/projects/models, which do not exist
     - chart_open then listed the sub-page's five ids, which no tab can
       fire because that page has no tabs

   Each of those would have failed SILENTLY and identically: the counter
   for a real feature stays at zero, which reads as "nobody uses it"
   rather than as a bug. That is the worst possible failure for a feature
   whose entire purpose is deciding what to delete. So these tests do not
   check that the lists are well-formed — they check the lists against
   the source of truth.
   ════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

const worker = read('workers/usage/src/index.js');
const client = read('scripts/beacon.js');

/* Strip comments before scanning for forbidden APIs. The header of
   beacon.js states the guarantee in prose ("no cookie, no localStorage,
   no fingerprint"), so a raw text scan flags the promise as the
   violation — the same trap that made an earlier suite report the
   comment explaining a bug as the bug. Code-only from here. */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const clientCode = stripComments(client);
const workerCode = stripComments(worker);

// Pull one allowlist array out of the Worker.
function allowlist(event) {
  const m = worker.match(new RegExp(event + ':\\s*\\[([\\s\\S]*?)\\]'));
  if (!m) return null;
  return [...m[1].matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]);
}

console.log('beacon:');

// ── privacy: the promise this feature is built on ───────────────────
/* These are the claims made in the header comments of both files. If any
   identifier ever appears, the comments become a lie, which is worse
   than never having promised anything. */
for (const forbidden of [
  'cookie', 'localStorage', 'sessionStorage', 'visitorId', 'userId',
  'fingerprint', 'navigator.userAgent', 'document.referrer',
]) {
  ok(`client stores no ${forbidden}`, !clientCode.includes(forbidden));
}
// The Worker must never read the client address, even though Cloudflare
// offers it on every request.
for (const f of ['CF-Connecting-IP', 'cf.country', 'request.cf', 'user-agent']) {
  const beaconSection = workerCode.slice(workerCode.indexOf('handleBeacon'), workerCode.indexOf('handleBeaconGet'));
  ok(`beacon handler ignores ${f}`, !beaconSection.includes(f));
}
// Unknown fields are REJECTED, not trimmed: quietly dropping a field
// lets a client believe it is recording something that is discarded.
ok('extra fields are rejected', worker.includes('return `unexpected field: ${k}`'));
// Day granularity only.
ok('only calendar-day precision', worker.includes("new Date().toISOString().slice(0, 10)")
  && !/beacon[\s\S]{0,4000}getHours\(\)/.test(worker));

// ── drift: terminal commands ───────────────────────────────────────
{
  const real = [...read('scripts/terminal.js').matchAll(/cmds\.([a-z][a-z0-9]*)\s*=/g)].map((m) => m[1]);
  const listed = allowlist('terminal_cmd') || [];
  const missing = real.filter((c) => !listed.includes(c));
  const extra = listed.filter((c) => c !== 'unknown' && !real.includes(c));
  ok('every real terminal command is accepted', missing.length === 0, `missing: ${missing.join(', ')}`);
  ok('no invented terminal commands', extra.length === 0, `extra: ${extra.join(', ')}`);
  ok("'unknown' bucket exists", listed.includes('unknown'));
  // The hook must send the command NAME and never its arguments: `search`
  // and `ask` carry whatever the visitor typed.
  const term = read('scripts/terminal.js');
  ok('terminal hook sends name only', term.includes("window.SITE_BEACON('terminal_cmd', fn ? name.toLowerCase() : 'unknown')"));
  ok('terminal hook never sends args', !/SITE_BEACON\('terminal_cmd'[^)]*\b(args|rest|trimmed|q)\b/.test(term));
}

// ── drift: skins ───────────────────────────────────────────────────
{
  const real = [...read('scripts/skins.js').matchAll(/id:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]);
  const listed = allowlist('BEACON_SKINS') || [...worker.match(/const BEACON_SKINS = \[([\s\S]*?)\];/)[1].matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]);
  ok('all 16 skins accepted', real.every((s) => listed.includes(s)),
    `missing: ${real.filter((s) => !listed.includes(s)).join(', ')}`);
  ok('no phantom skins', listed.every((s) => real.includes(s)),
    `extra: ${listed.filter((s) => !real.includes(s)).join(', ')}`);
  ok('skin count matches', real.length === listed.length, `${real.length} vs ${listed.length}`);
}

// ── drift: charts ──────────────────────────────────────────────────
{
  const home = [...read('scripts/render.js').match(/const VIEWS = \[([\s\S]*?)\n    \];/)[1]
    .matchAll(/id: '([a-z]+)'/g)].map((m) => m[1]);
  const listed = allowlist('chart_open') || [];
  ok('homepage chart ids accepted', home.every((v) => listed.includes(v)));
  /* The sub-page's extra charts must NOT be listed: it renders all of
     them at once, so nothing can fire them and the keys would sit at
     zero forever, looking exactly like a broken hook. */
  const subOnly = [...new Set([...read('scripts/usage-page.js').matchAll(/put\('([a-z]+)'/g)]
    .map((m) => m[1]))].filter((id) => !home.includes(id));
  ok('unfirable sub-page ids not listed', subOnly.every((id) => !listed.includes(id)),
    `listed but unfirable: ${subOnly.filter((id) => listed.includes(id)).join(', ')}`);
}

// ── hook wiring: a correct list is useless if nothing calls it ──────
{
  const sr = read('scripts/skin-runtime.js');
  ok('skin pick is hooked', sr.includes("window.SITE_BEACON('skin_pick', id)"));
  ok('skin source distinguishes picker from restore',
    sr.includes("'skin_source', 'picker'") && sr.includes("'skin_source', 'restore'"));
  const rd = read('scripts/render.js');
  ok('chart open is hooked', rd.includes("window.SITE_BEACON('chart_open', id)"));
  /* Auto-rotation also changes the view every 5s. Counting that would
     measure how long the tab stayed open, not anyone's interest. */
  ok('rotation is excluded from chart counts', rd.includes("id !== currentView"));
  ok('qa outcome is hooked', rd.includes("'qa_ask', m ? 'answered' : 'unanswered'"));
  ok('qa never sends the question', !/SITE_BEACON\('qa_ask'[^)]*\bq\b/.test(rd));

  // Every hook must be guarded: telemetry may not break the page.
  const guards = (sr + rd + read('scripts/terminal.js'))
    .match(/typeof window\.SITE_BEACON === 'function'/g) || [];
  const calls = (sr + rd + read('scripts/terminal.js')).match(/window\.SITE_BEACON\(/g) || [];
  ok('every hook is feature-detected', guards.length >= 4 && calls.length >= 5,
    `${guards.length} guards / ${calls.length} calls`);
}

// ── client behaviour ───────────────────────────────────────────────
ok('honours DNT and GPC', client.includes('globalPrivacyControl') && client.includes('doNotTrack'));
/* Without this, every debugging click lands in production counters and
   "most popular skin" means "the one being worked on". */
ok('localhost is suppressed', client.includes("h === 'localhost'") && client.includes('DISABLED'));
ok('per-event cap exists', /var CAP = \d+/.test(client));
ok('uses sendBeacon so unload-time clicks survive', client.includes('navigator.sendBeacon'));
ok('fetch fallback is keepalive', client.includes('keepalive: true'));
ok('failures are swallowed', (client.match(/catch/g) || []).length >= 4);

// ── build wiring ───────────────────────────────────────────────────
{
  const bh = read('scripts/build-html.js');
  const bu = read('scripts/build-usage-page.js');
  ok('beacon is cache-busted', bh.includes("'scripts/beacon.js'"));
  ok('homepage injects the tag', bh.includes('feature-beacon'));
  /* /usage/ has its own generator and did not inherit the homepage's
     injection — it would have been the one page whose visits went
     uncounted, and it is the page whose traffic decides whether to keep
     adding charts. */
  ok('usage page injects the tag', bu.includes('BEACON_TAG'));
  ok('both are gated on one config flag',
    bh.includes('site.analytics?.featureBeacon === true')
    && bu.includes('featureBeacon === true'));
  const site = JSON.parse(read('content/site.json'));
  ok('config flag is present', typeof site.analytics.featureBeacon === 'boolean');
}

// ── endpoint behaviour, against the real handler ────────────────────
(async () => {
  let src = worker.replace(/export default/, 'const __w =');
  const store = new Map();
  const env = {
    USAGE_KV: {
      get: async (k) => (store.has(k) ? store.get(k) : null),
      put: async (k, v) => { store.set(k, v); },
    },
    SHARED_SECRET: 'test', USAGE_PUBLISH: '{}',
  };
  global.caches = { default: { delete: async () => {}, put: async () => {}, match: async () => undefined } };
  const w = eval(src + '; __w');
  const SITE_ORIGIN = 'https://antaresyuan.site';
  const hit = (body, origin = SITE_ORIGIN) => w.fetch(new Request(
    'https://usage.antaresyuan.site/beacon',
    { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) },
  ), env);

  for (const [name, body, want] of [
    ['valid skin_pick', { event: 'skin_pick', value: 'hereva' }, 204],
    ['valid terminal_cmd', { event: 'terminal_cmd', value: 'whoami' }, 204],
    ['valid qa_ask', { event: 'qa_ask', value: 'unanswered' }, 204],
    ['unknown event', { event: 'evil', value: 'x' }, 400],
    ['unlisted skin', { event: 'skin_pick', value: 'notaskin' }, 400],
    ['smuggled field', { event: 'qa_ask', value: 'answered', ip: '1.2.3.4' }, 400],
    ['missing value', { event: 'skin_pick' }, 400],
    ['array body', ['skin_pick'], 400],
    ['unlisted chart', { event: 'chart_open', value: 'tools' }, 400],
  ]) {
    const r = await hit(body);
    ok(`endpoint: ${name} → ${want}`, r.status === want, `got ${r.status}`);
  }
  const foreign = await hit({ event: 'skin_pick', value: 'hereva' }, 'https://evil.example');
  ok('endpoint: foreign origin → 403', foreign.status === 403, `got ${foreign.status}`);

  // Counting actually accumulates.
  await hit({ event: 'skin_pick', value: 'hereva' });
  const day = new Date().toISOString().slice(0, 10);
  const stored = JSON.parse(store.get('beacon:' + day) || '{}');
  ok('counts accumulate', stored['skin_pick:hereva'] === 2, JSON.stringify(stored));
  // And nothing else got written.
  ok('no identifier keys in KV',
    Object.keys(stored).every((k) => /^[a-z_]+(:[a-z0-9-]+)?$/.test(k)), Object.keys(stored).join(','));

  console.log(`\nbeacon: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
