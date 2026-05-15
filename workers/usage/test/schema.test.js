#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   Smoke tests for the usage Worker — focus on the contract surface:
     - POST schema allowlist (with the new optional `costCents`)
     - GET response shape (sums tokens / sessions / costCents across slots,
       drops the source map, includes zero-day fills)
     - Auth + CORS basics

   No deps; just a plain `node workers/usage/test/schema.test.js`. The
   Worker module exports its `default.fetch(request, env)` handler; we
   call it with fabricated Requests and an in-memory KV mock.
   ════════════════════════════════════════════════════════════════════════ */

'use strict';

const path = require('node:path');

// Dynamic import — the Worker source is ESM (`export default { fetch }`).
async function main() {
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
  const today = new Date().toISOString().slice(0, 10);

  console.log('\nPOST auth + schema');
  {
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

  console.log('\nGET aggregation');
  {
    const env = makeEnv();
    const d = today;

    // claude-mbp: tokens 800k, sessions 5, costCents 1980
    await post(env, { date: d, source: 'claude-mbp',  tokens: 800000,  sessions: 5, costCents: 1980 });
    // claude-imac: tokens 1.2M, sessions 3, NO costCents (older sender)
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
    const env = makeEnv();
    const r = await get(env, 'https://evil.example');
    ok('foreign origin → no ACAO', !r.headers.get('access-control-allow-origin'));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(2); });
