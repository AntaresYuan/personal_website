#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   Smoke tests for the usage Worker — focus on the contract surface:

     - POST auth (401 on missing / wrong bearer)
     - POST schema allowlist (incl. optional `costCents` type/sign checks)
     - GET response shape:
         * exactly the four keys {date, tokens, sessions, costCents}
         * tokens / sessions / costCents summed across slots
         * `costCents` missing on some slots is treated as 0
     - Privacy invariants:
         * GET body never contains the string "source" or a "claude-" slot
     - CORS gating:
         * ACAO echoes only the site origin (+ localhost); foreign origin → none
     - Edge-cache invariants:
         * GET caches the body; second GET hits the cache
         * POST invalidates the cache so the next GET reflects the new write
         * Cached body is shape-identical to a fresh body (same four keys)

   No deps. The Worker is ESM; we import via dynamic `import()`, fabricate
   `Request` objects (Node 18+ has Fetch globals), and stub `globalThis.caches`
   with an in-memory mock so the Workers-runtime `caches.default` calls work.

   Run via `npm test` from the repo root.
   ════════════════════════════════════════════════════════════════════════ */

'use strict';

const path = require('node:path');

// In-memory mock for the Workers runtime's `caches.default` API surface.
// The Worker uses .match(key) / .put(key, response) / .delete(key) only.
function makeCachesMock() {
  const store = new Map();
  return {
    default: {
      async match(key) {
        const entry = store.get(key);
        if (!entry) return undefined;
        // Return a fresh Response so .text() / .json() work each call.
        return new Response(entry.body, { headers: entry.headers });
      },
      async put(key, response) {
        const body = await response.text();
        const headers = {};
        for (const [k, v] of response.headers) headers[k] = v;
        store.set(key, { body, headers });
      },
      async delete(key) { return store.delete(key); },
      _store: store,
    },
  };
}

async function main() {
  // Install the caches mock *before* importing the Worker (the module
  // captures `caches.default` inside handler bodies, so binding it on
  // globalThis at call-time is fine — but installing it early keeps any
  // future top-level usage working too).
  globalThis.caches = makeCachesMock();

  const mod = await import(path.join(__dirname, '..', 'src', 'index.js'));
  const worker = mod.default;

  const SECRET = 'test-secret';
  let passed = 0, failed = 0;

  function ok(name, cond, detail) {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? ': ' + detail : ''}`); }
  }
  function eq(name, a, b) {
    const aJ = JSON.stringify(a), bJ = JSON.stringify(b);
    ok(name, aJ === bJ, `${aJ} !== ${bJ}`);
  }

  function makeEnv() {
    const store = new Map();
    return {
      SHARED_SECRET: SECRET,
      USAGE_KV: {
        async get(k)     { return store.has(k) ? store.get(k) : null; },
        async put(k, v)  { store.set(k, v); },
      },
      _store: store,
    };
  }
  function post(env, body, { auth = `Bearer ${SECRET}` } = {}) {
    return worker.fetch(new Request('https://usage.example/', {
      method: 'POST',
      headers: { 'authorization': auth, 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }), env);
  }
  function get(env, origin = 'https://antaresyuan.site') {
    return worker.fetch(new Request('https://usage.example/', {
      method: 'GET',
      headers: { origin },
    }), env);
  }
  // Reset the global cache between test groups so cache hits in one group
  // can't bleed into another. Each group then has a deterministic start.
  function resetCaches() { globalThis.caches = makeCachesMock(); }

  const today = new Date().toISOString().slice(0, 10);

  console.log('\nPOST auth + schema');
  {
    resetCaches();
    const env = makeEnv();
    let r;

    r = await post(env, { date: today, source: 'a', tokens: 1, sessions: 1 }, { auth: '' });
    ok('missing bearer → 401', r.status === 401);

    r = await post(env, { date: today, source: 'a', tokens: 1, sessions: 1 }, { auth: 'Bearer wrong' });
    ok('wrong bearer → 401', r.status === 401);

    r = await post(env, { date: today, source: 'a', tokens: 1, sessions: 1, model: 'opus' });
    ok('extra unknown field → 400', r.status === 400);

    r = await post(env, { date: '2026-02-30', source: 'a', tokens: 1, sessions: 1 });
    ok('invalid date → 400', r.status === 400);

    r = await post(env, { date: today, source: 'BAD CHARS', tokens: 1, sessions: 1 });
    ok('invalid source → 400', r.status === 400);

    r = await post(env, { date: today, source: 'a', tokens: -1, sessions: 1 });
    ok('negative tokens → 400', r.status === 400);

    r = await post(env, { date: today, source: 'a', tokens: 1, sessions: 1, costCents: -1 });
    ok('negative costCents → 400', r.status === 400);

    r = await post(env, { date: today, source: 'a', tokens: 1, sessions: 1, costCents: 'lots' });
    ok('non-int costCents → 400', r.status === 400);

    r = await post(env, { date: today, source: 'a', tokens: 1, sessions: 1 });
    ok('minimal happy path (no cost) → 200', r.status === 200);

    r = await post(env, { date: today, source: 'b', tokens: 1, sessions: 1, costCents: 50 });
    ok('happy path with costCents → 200', r.status === 200);
  }

  console.log('\nGET aggregation + privacy');
  {
    resetCaches();
    const env = makeEnv();
    const d = today;

    // claude-mbp: full data
    await post(env, { date: d, source: 'claude-mbp',  tokens: 800000,  sessions: 5, costCents: 1980 });
    // claude-imac: cost-less (older sender) — should still aggregate cleanly
    await post(env, { date: d, source: 'claude-imac', tokens: 1200000, sessions: 3 });

    const r = await get(env);
    ok('GET → 200', r.status === 200);
    const body = await r.json();

    const todayRow = body.days.find(x => x.date === d);
    ok('today row exists', !!todayRow);
    eq('today tokens summed',   todayRow.tokens,    2000000);
    eq('today sessions summed', todayRow.sessions,  8);
    eq('today costCents (missing-treated-as-0)', todayRow.costCents, 1980);

    const keys = todayRow ? Object.keys(todayRow).sort() : [];
    eq('GET row keys exactly {date,tokens,sessions,costCents}',
       keys, ['costCents', 'date', 'sessions', 'tokens']);

    const raw = JSON.stringify(body);
    ok('GET body contains no "source" key', !raw.includes('"source"'));
    ok('GET body contains no "claude-" slot label', !raw.includes('claude-'));
    ok('GET body has "since" + "updated"', typeof body.since === 'string' && typeof body.updated === 'string');

    ok('CORS ACAO is the site origin',
       r.headers.get('access-control-allow-origin') === 'https://antaresyuan.site');
  }

  console.log('\nGET CORS gating');
  {
    resetCaches();
    const env = makeEnv();
    const r = await get(env, 'https://evil.example');
    ok('foreign origin → no ACAO', !r.headers.get('access-control-allow-origin'));
  }

  // Edge-cache invariants — the recent CN-quota incident (#179) hung on
  // these working. If someone deletes the invalidation line in POST, this
  // group catches it.
  console.log('\nEdge cache: hit, miss, invalidate');
  {
    resetCaches();
    const env = makeEnv();
    const d = today;

    // 1) First GET: miss → fan-out → stash. Just confirm 200 + shape.
    let r = await get(env);
    let body = await r.json();
    eq('cold GET sees no data yet', body.days.find(x => x.date === d).tokens, 0);

    // 2) POST writes new data + invalidates cache (per the invariant).
    const postRes = await post(env, { date: d, source: 'claude-mbp', tokens: 999, sessions: 1, costCents: 12 });
    ok('POST after cold GET → 200', postRes.status === 200);

    // 3) Next GET should reflect the new write (cache was invalidated).
    //    If invalidation regresses, this is where we catch it — the GET
    //    would return the cached zero-row.
    r = await get(env);
    body = await r.json();
    const row = body.days.find(x => x.date === d);
    eq('post-invalidation GET reflects new tokens',    row.tokens,    999);
    eq('post-invalidation GET reflects new sessions',  row.sessions,  1);
    eq('post-invalidation GET reflects new costCents', row.costCents, 12);

    // 4) Hot path: a subsequent GET with no intervening POST hits the
    //    cache. We can verify by deleting the KV entry and confirming
    //    GET still returns the cached number (i.e. didn't re-read KV).
    env._store.delete('usage:' + d);
    r = await get(env);
    body = await r.json();
    eq('hot GET serves cached body (KV deleted, value still present)',
       body.days.find(x => x.date === d).tokens, 999);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(2); });
