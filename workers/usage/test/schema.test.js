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

  /* ════════════════════════════════════════════════════════════════════
     v2: token-category detail, configurable public projection, /detail
     ════════════════════════════════════════════════════════════════════ */

  // A full v2 payload as the upgraded sync agent builds it.
  const v2Payload = (over = {}) => ({
    date: today,
    source: 'mbp',
    tokens: 300,                        // input+output, v1 meaning preserved
    sessions: 2,
    costCents: 450,
    inputTokens: 100,
    outputTokens: 200,
    cachedInputTokens: 5000,
    cacheCreationInputTokens: 80,
    reasoningOutputTokens: 40,
    totalTokens: 5420,
    activeSeconds: 600,
    durationSeconds: 900,
    messageCount: 20,
    userMessageCount: 8,
    bySource: { claude: { inputTokens: 60, outputTokens: 120, cachedInputTokens: 5000, cacheCreationInputTokens: 80, reasoningOutputTokens: 0, totalTokens: 5260, costCents: 300 } },
    byModel:  { 'claude-sonnet-5': { inputTokens: 60, outputTokens: 120, cachedInputTokens: 5000, cacheCreationInputTokens: 80, reasoningOutputTokens: 0, totalTokens: 5260, costCents: 300 } },
    byProject:{ kaboo: { inputTokens: 100, outputTokens: 200, cachedInputTokens: 5000, cacheCreationInputTokens: 80, reasoningOutputTokens: 40, totalTokens: 5420, costCents: 450 } },
    ...over,
  });

  function getWith(env, origin = 'https://antaresyuan.site') {
    return worker.fetch(new Request('https://usage.example/', {
      method: 'GET', headers: { origin },
    }), env);
  }
  function detail(env, { auth = `Bearer ${SECRET}`, days } = {}) {
    const u = new URL('https://usage.example/detail');
    if (days) u.searchParams.set('days', String(days));
    return worker.fetch(new Request(u, {
      method: 'GET', headers: auth ? { authorization: auth } : {},
    }), env);
  }

  console.log('\nv2 detail fields: accepted + stored');
  {
    resetCaches();
    const env = makeEnv();
    let r = await post(env, v2Payload());
    ok('full v2 payload → 200', r.status === 200, await r.text());

    const stored = JSON.parse(env._store.get('usage:' + today));
    eq('slot keeps cachedInputTokens', stored.mbp.cachedInputTokens, 5000);
    eq('slot keeps reasoningOutputTokens', stored.mbp.reasoningOutputTokens, 40);
    eq('slot keeps byModel', Object.keys(stored.mbp.byModel), ['claude-sonnet-5']);
    eq('slot keeps activeSeconds', stored.mbp.activeSeconds, 600);

    // Still an allowlist: an unknown key must be rejected even in v2.
    r = await post(env, v2Payload({ somethingNew: 1 }));
    ok('unknown v2 field → 400', r.status === 400);

    r = await post(env, v2Payload({ cachedInputTokens: -5 }));
    ok('negative cachedInputTokens → 400', r.status === 400);

    r = await post(env, v2Payload({ byModel: { m: { inputTokens: 'x' } } }));
    ok('non-int inside byModel → 400', r.status === 400);

    r = await post(env, v2Payload({ byModel: { m: { unknownField: 1 } } }));
    ok('unknown field inside byModel → 400', r.status === 400);
  }

  console.log('\nv2 privacy: detail withheld from public GET by default');
  {
    resetCaches();
    const env = makeEnv();                    // no USAGE_PUBLISH set
    await post(env, v2Payload());
    const r = await getWith(env);
    const body = await r.json();
    const row = body.days.find(x => x.date === today);

    eq('default public row keys stay v1-shaped',
       Object.keys(row).sort(), ['costCents', 'date', 'sessions', 'tokens']);
    ok('public body has no cachedInputTokens', !JSON.stringify(body).includes('cachedInputTokens'));
    ok('public body has no model id', !JSON.stringify(body).includes('claude-sonnet-5'));
    ok('public body has no project name', !JSON.stringify(body).includes('kaboo'));
    ok('public body has no device slot', !JSON.stringify(body).includes('mbp'));
    eq('public tokens still summed', row.tokens, 300);
  }

  console.log('\nv2 opt-in: publish chosen fields + dims');
  {
    resetCaches();
    const env = makeEnv();
    env.USAGE_PUBLISH = JSON.stringify({
      fields: ['cachedInputTokens', 'totalTokens'],
      dims: ['byModel'],
    });
    await post(env, v2Payload());
    const r = await getWith(env);
    const body = await r.json();
    const row = body.days.find(x => x.date === today);

    eq('opted-in field appears', row.cachedInputTokens, 5000);
    eq('opted-in totalTokens appears', row.totalTokens, 5420);
    eq('opted-in dim appears', Object.keys(row.byModel), ['claude-sonnet-5']);
    ok('non-opted dim stays hidden', row.byProject === undefined);
    ok('non-opted field stays hidden', row.reasoningOutputTokens === undefined);
    ok('device slot still never exposed', !JSON.stringify(body).includes('"mbp"'));
  }

  console.log('\nv2 publish config is fail-closed');
  {
    resetCaches();
    const env = makeEnv();
    env.USAGE_PUBLISH = '{not valid json';
    await post(env, v2Payload());
    const body = await (await getWith(env)).json();
    const row = body.days.find(x => x.date === today);
    eq('malformed config → v1 shape only',
       Object.keys(row).sort(), ['costCents', 'date', 'sessions', 'tokens']);

    resetCaches();
    const env2 = makeEnv();
    env2.USAGE_PUBLISH = JSON.stringify({ fields: ['../etc/passwd', 'nope'], dims: ['bySecret'] });
    await post(env2, v2Payload());
    const row2 = (await (await getWith(env2)).json()).days.find(x => x.date === today);
    eq('unknown field/dim names ignored',
       Object.keys(row2).sort(), ['costCents', 'date', 'sessions', 'tokens']);
  }

  console.log('\nv2 /detail endpoint: authed full read');
  {
    resetCaches();
    const env = makeEnv();
    await post(env, v2Payload());

    let r = await detail(env, { auth: '' });
    ok('/detail without bearer → 401', r.status === 401);
    r = await detail(env, { auth: 'Bearer wrong' });
    ok('/detail wrong bearer → 401', r.status === 401);

    r = await detail(env);
    ok('/detail authed → 200', r.status === 200);
    const body = await r.json();
    const row = body.days.find(x => x.date === today);
    eq('/detail exposes cachedInputTokens', row.cachedInputTokens, 5000);
    eq('/detail exposes byProject', Object.keys(row.byProject), ['kaboo']);
    eq('/detail exposes bySource', Object.keys(row.bySource), ['claude']);
    ok('/detail omits empty days', body.days.every(d => d.tokens > 0 || d.totalTokens > 0));

    // The private read must not poison the public edge cache.
    const pub = await (await getWith(env)).json();
    ok('/detail did not leak into public GET cache',
       !JSON.stringify(pub).includes('kaboo'));
  }

  console.log('\nv2 back-compat: a v1 agent still works unchanged');
  {
    resetCaches();
    const env = makeEnv();
    const r = await post(env, { date: today, source: 'old-mac', tokens: 42, sessions: 3, costCents: 7 });
    ok('v1 payload → 200', r.status === 200);
    const stored = JSON.parse(env._store.get('usage:' + today));
    eq('v1 slot has no detail keys',
       Object.keys(stored['old-mac']).sort(),
       ['costCents', 'sessions', 'tokens', 'updated']);
    const row = (await (await getWith(env)).json()).days.find(x => x.date === today);
    eq('v1 data still aggregates', row.tokens, 42);
  }

  console.log('\nv2 multi-device: slots sum, never overwrite');
  {
    resetCaches();
    const env = makeEnv();
    await post(env, v2Payload({ source: 'mbp',  tokens: 100, cachedInputTokens: 1000, sessions: 1 }));
    await post(env, v2Payload({ source: 'imac', tokens: 250, cachedInputTokens: 3000, sessions: 4 }));
    env.USAGE_PUBLISH = JSON.stringify({ fields: ['cachedInputTokens'], dims: [] });
    resetCaches();   // drop the cache so the new publish config takes effect
    const row = (await (await getWith(env)).json()).days.find(x => x.date === today);
    eq('two devices sum tokens', row.tokens, 350);
    eq('two devices sum sessions', row.sessions, 5);
    eq('two devices sum detail', row.cachedInputTokens, 4000);

    const stored = JSON.parse(env._store.get('usage:' + today));
    eq('both slots retained', Object.keys(stored).sort(), ['imac', 'mbp']);
  }

  console.log('\nv3 rhythm vectors: validated, summed, opt-in');
  {
    // A 168-slot vector with one prompt at Tue 17:00 (weekday 2 → 2*24+17).
    const vec = (idx, n) => { const a = new Array(168).fill(0); a[idx] = n; return a; };
    const hours = (idx, n) => { const a = new Array(24).fill(0); a[idx] = n; return a; };

    resetCaches();
    const env = makeEnv();
    const r = await post(env, v2Payload({
      source: 'mbp',
      promptHours: hours(17, 5),
      promptWeekHours: vec(2 * 24 + 17, 5),
      tzOffsetMinutes: 480,
    }));
    ok('vectors accepted → 200', r.status === 200);
    const slot = JSON.parse(env._store.get('usage:' + today))['mbp'];
    eq('promptWeekHours stored at full length', slot.promptWeekHours.length, 168);
    eq('promptHours stored at full length', slot.promptHours.length, 24);
    eq('tz offset stored', slot.tzOffsetMinutes, 480);

    // Wrong length must be rejected — a truncated vector would silently
    // misalign every weekday downstream.
    const bad = await post(env, v2Payload({ source: 'mbp', promptWeekHours: new Array(24).fill(0) }));
    eq('wrong-length vector → 400', bad.status, 400);
    const neg = await post(env, v2Payload({ source: 'mbp', promptHours: hours(3, -1) }));
    eq('negative vector entry → 400', neg.status, 400);
    const badTz = await post(env, v2Payload({ source: 'mbp', tzOffsetMinutes: 9999 }));
    eq('absurd tz offset → 400', badTz.status, 400);
  }
  {
    // Private by default: publishing nothing must not leak the vectors.
    resetCaches();
    const env = makeEnv();
    const a = new Array(168).fill(0); a[50] = 9;
    await post(env, v2Payload({ source: 'mbp', promptWeekHours: a, tzOffsetMinutes: 480 }));
    const row = (await (await getWith(env)).json()).days.find(x => x.date === today);
    ok('vectors withheld from default public GET', row.promptWeekHours === undefined);
    ok('tz withheld too', row.tzOffsetMinutes === undefined);

    // Opt in through the same dims list the keyed maps use.
    env.USAGE_PUBLISH = JSON.stringify({ fields: [], dims: ['promptWeekHours'] });
    resetCaches();
    const row2 = (await (await getWith(env)).json()).days.find(x => x.date === today);
    eq('published vector has 168 slots', row2.promptWeekHours.length, 168);
    eq('published vector keeps its value', row2.promptWeekHours[50], 9);
    eq('tz rides along when a vector is published', row2.tzOffsetMinutes, 480);
    ok('publishing a vector does not leak byModel', row2.byModel === undefined);
  }
  {
    // Two devices in the same slot-day must add element-wise.
    resetCaches();
    const env = makeEnv();
    const a = new Array(168).fill(0); a[10] = 4;
    const b = new Array(168).fill(0); b[10] = 6; b[11] = 1;
    await post(env, v2Payload({ source: 'mbp',  promptWeekHours: a }));
    await post(env, v2Payload({ source: 'imac', promptWeekHours: b }));
    env.USAGE_PUBLISH = JSON.stringify({ fields: [], dims: ['promptWeekHours'] });
    resetCaches();
    const row = (await (await getWith(env)).json()).days.find(x => x.date === today);
    eq('vectors sum element-wise', row.promptWeekHours[10], 10);
    eq('non-overlapping slot preserved', row.promptWeekHours[11], 1);
    eq('untouched slot stays zero', row.promptWeekHours[0], 0);
  }
  {
    // A v1/v2 agent that sends no vectors must not gain empty ones.
    resetCaches();
    const env = makeEnv();
    await post(env, v2Payload({ source: 'mbp' }));
    env.USAGE_PUBLISH = JSON.stringify({ fields: [], dims: ['promptWeekHours'] });
    resetCaches();
    const row = (await (await getWith(env)).json()).days.find(x => x.date === today);
    ok('no vector data → field absent, not 168 zeros', row.promptWeekHours === undefined);
  }

  /* ── toolCounts: the fixed-key tool tally ───────────────────────────
     This field exists so the site can show WHAT KIND of work happened,
     without ever shipping a tool / MCP-server / skill name. The closed key
     set is the privacy boundary, so the rejection cases below matter more
     than the happy path. */
  {
    resetCaches();
    const env = makeEnv();
    const r = await post(env, v2Payload({
      source: 'mbp',
      toolCounts: { read: 3, edit: 4, shell: 10, search: 1, browser: 2, task: 1, other: 0, mcp: 5 },
    }));
    eq('toolCounts accepted', r.status, 200);
  }
  {
    // An arbitrary key must be REJECTED, not ignored. This is the check
    // that stops a modified agent from smuggling a server name through as
    // a map key.
    resetCaches();
    const env = makeEnv();
    const r = await post(env, v2Payload({
      source: 'mbp',
      toolCounts: { shell: 1, 'mcp__internal-system__query': 7 },
    }));
    eq('unknown toolCounts key rejected', r.status, 400);
    const body = await r.json();
    ok('error names the offending field', /unexpected key in toolCounts/.test(body.error));
  }
  {
    resetCaches();
    const env = makeEnv();
    const r = await post(env, v2Payload({ source: 'mbp', toolCounts: { shell: -2 } }));
    eq('negative tool count rejected', r.status, 400);
    const r2 = await post(env, v2Payload({ source: 'mbp', toolCounts: { shell: 1.5 } }));
    eq('fractional tool count rejected', r2.status, 400);
    const r3 = await post(env, v2Payload({ source: 'mbp', toolCounts: [1, 2, 3] }));
    eq('array instead of object rejected', r3.status, 400);
  }
  {
    // Private by default: the tally must not appear until it's opted in.
    resetCaches();
    const env = makeEnv();
    await post(env, v2Payload({ source: 'mbp', toolCounts: { shell: 9 } }));
    resetCaches();
    const row = (await (await getWith(env)).json()).days.find(x => x.date === today);
    ok('toolCounts private by default', row.toolCounts === undefined);

    env.USAGE_PUBLISH = JSON.stringify({ fields: [], dims: ['toolCounts'] });
    resetCaches();
    const row2 = (await (await getWith(env)).json()).days.find(x => x.date === today);
    eq('toolCounts published when opted in', row2.toolCounts.shell, 9);
    // Absent keys must read as 0, not undefined, so a chart can sum them.
    eq('absent category reads as 0', row2.toolCounts.browser, 0);
  }
  {
    // Two devices must add up per category.
    resetCaches();
    const env = makeEnv();
    await post(env, v2Payload({ source: 'mbp',  toolCounts: { shell: 10, edit: 2 } }));
    await post(env, v2Payload({ source: 'imac', toolCounts: { shell: 5,  read: 3 } }));
    env.USAGE_PUBLISH = JSON.stringify({ fields: [], dims: ['toolCounts'] });
    resetCaches();
    const row = (await (await getWith(env)).json()).days.find(x => x.date === today);
    eq('shell sums across devices', row.toolCounts.shell, 15);
    eq('edit from one device only', row.toolCounts.edit, 2);
    eq('read from the other device only', row.toolCounts.read, 3);
  }
  {
    // No tally sent → field absent rather than eight zeros, matching how
    // the vectors behave.
    resetCaches();
    const env = makeEnv();
    await post(env, v2Payload({ source: 'mbp' }));
    env.USAGE_PUBLISH = JSON.stringify({ fields: [], dims: ['toolCounts'] });
    resetCaches();
    const row = (await (await getWith(env)).json()).days.find(x => x.date === today);
    ok('no tool data → field absent', row.toolCounts === undefined);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(2); });
