/* Byte-equality + read-count proof for the KV cost fix.

   Runs the OLD worker (kv_before.js) and the NEW one against the same
   in-memory KV, with a real 40-day dataset shaped like production, and
   asserts two things:
     1. the JSON responses are byte-identical  (this is a cost fix, not a
        data change — if the bytes differ, the fix is wrong)
     2. the new one issues far fewer billed KV operations

   Reads/writes/lists are counted separately because they are billed
   separately, and because a "fix" that trades 365 reads for 365 lists
   would look like a win on a single counter and be no cheaper at all. */
const fs = require('fs');
const path = require('path');

const NEW_FILE = path.join(__dirname, '../src/index.js');

function makeKV(days) {
  const store = new Map();
  const stats = { get: 0, list: 0, put: 0 };
  for (const d of days) {
    store.set('usage:' + d.date, JSON.stringify({
      codex: {
        tokens: d.tokens, sessions: 2, costCents: 12,
        inputTokens: Math.floor(d.tokens * 0.4),
        outputTokens: Math.floor(d.tokens * 0.6),
        cachedInputTokens: 0, cacheCreationInputTokens: 0,
        reasoningOutputTokens: 0, messageCount: 5,
        updated: d.date + 'T10:00:00.000Z',
      },
    }));
  }
  return {
    stats,
    kv: {
      async get(k) { stats.get++; return store.has(k) ? store.get(k) : null; },
      async put(k, v) { stats.put++; store.set(k, v); },
      async list({ prefix, cursor } = {}) {
        stats.list++;
        const keys = [...store.keys()]
          .filter((k) => !prefix || k.startsWith(prefix))
          .map((name) => ({ name }));
        return { keys, list_complete: true, cursor: null };
      },
    },
  };
}

// A cache that always misses, so every run exercises the expensive path.
// Measuring the cached path would flatter both versions equally and prove
// nothing about the fan-out.
function missCache() {
  const puts = [];
  return {
    default: {
      async match() { return undefined; },
      async put(k, r) { puts.push(k); return undefined; },
    },
    puts,
  };
}

async function loadWorker(file) {
  const src = fs.readFileSync(file, 'utf8').replace(/export default/, 'globalThis.__W =');
  const sandbox = { console, Response, Request, URL, Date, JSON, Math, Number,
                    Object, Array, Set, Map, TextEncoder, Promise, caches: null };
  const fn = new Function('globalThis', 'caches', src + '; return globalThis.__W;');
  return fn;
}

(async () => {
  // 40 active days scattered over the last ~80, like the real namespace:
  // gaps matter, because the old code paid for every gap.
  const days = [];
  const today = Date.now();
  for (let i = 0; i < 40; i++) {
    const t = today - (i * 2) * 86400000;
    days.push({ date: new Date(t).toISOString().slice(0, 10), tokens: 1000 + i * 137 });
  }

  const results = {};
  for (const [label, file] of [
    ['old', path.join(__dirname, 'fixtures/worker-pre-kvfix.js')],
    ['new', NEW_FILE],
  ]) {
    const { kv, stats } = makeKV(days);
    const c = missCache();
    const src = fs.readFileSync(file, 'utf8');
    const body = src.replace(/export default\s*/, 'const __W = ') + '\n;return __W;';
    const W = new Function('caches', body)(c);
    const req = new Request('https://usage.antaresyuan.site/', {
      headers: { origin: 'https://antaresyuan.site' },
    });
    const res = await W.fetch(req, { USAGE_KV: kv, USAGE_PUBLISH: '' }, { waitUntil() {} });
    results[label] = { text: await res.text(), stats: { ...stats }, status: res.status };
  }

  const a = results.old, b = results.new;
  console.log('kv-cost old:', a.status, a.text.length, 'bytes | KV', JSON.stringify(a.stats));
  console.log('new:', b.status, b.text.length, 'bytes | KV', JSON.stringify(b.stats));

  let fails = 0;
  const ok = (label, cond, detail) => {
    if (cond) console.log('  ok   ' + label);
    else { fails++; console.log('  FAIL ' + label + (detail ? ' — ' + detail : '')); }
  };

  ok('both return 200', a.status === 200 && b.status === 200, `${a.status}/${b.status}`);
  ok('response is byte-identical', a.text === b.text,
    a.text === b.text ? '' : `len ${a.text.length} vs ${b.text.length}`);
  if (a.text !== b.text) {
    const A = JSON.parse(a.text), B = JSON.parse(b.text);
    console.log('    days:', A.days.length, 'vs', B.days.length,
                '| since:', A.since, B.since, '| updated:', A.updated, B.updated);
    for (let i = 0; i < Math.max(A.days.length, B.days.length); i++) {
      if (JSON.stringify(A.days[i]) !== JSON.stringify(B.days[i])) {
        console.log('    first diff at', i, JSON.stringify(A.days[i]), 'vs', JSON.stringify(B.days[i]));
        break;
      }
    }
  }
  // The whole point: fewer billed operations. list() is counted in.
  const billedOld = a.stats.get + a.stats.list;
  const billedNew = b.stats.get + b.stats.list;
  ok('new issues fewer billed KV ops', billedNew < billedOld, `${billedNew} vs ${billedOld}`);
  ok('new reads only existing days', b.stats.get <= 40, String(b.stats.get));
  ok('list is used sparingly, not per-day', b.stats.list <= 2, String(b.stats.list));
  ok('neither version writes on GET', a.stats.put === 0 && b.stats.put === 0);
  /* The list() fallback is load-bearing, so it gets its own assertion.
     A mutation that swallowed the error returned 365 empty days and looked
     completely plausible: same shape, same length, every number zero. On a
     usage dashboard that reads as "you used nothing this year", which is a
     far worse outcome than paying for the old fan-out. */
  {
    const src = fs.readFileSync(NEW_FILE, 'utf8');
    const body = src.replace(/export default\s*/, 'const __W = ') + '\n;return __W;';
    const W = new Function('caches', body)(missCache());
    let gets = 0;
    const kv = {
      async get() { gets++; return null; },
      async put() {},
      async list() { throw new Error('list unavailable'); },
    };
    const res = await W.fetch(
      new Request('https://usage.antaresyuan.site/', { headers: { origin: 'https://antaresyuan.site' } }),
      { USAGE_KV: kv, USAGE_PUBLISH: '' }, { waitUntil() {} });
    const d = JSON.parse(await res.text());
    ok('list() failure falls back to a full read, not an empty history',
      gets > 0, `gets=${gets}`);
    ok('list() failure still returns the full window', d.days.length === 365,
      String(d.days.length));
  }

  /* The cache TTL must not drop below the interval at which the data can
     actually change (the agent pushes every 30 min). A shorter TTL buys no
     freshness and multiplies the fan-out — that is exactly how this hit 91%
     of the free daily allowance. */
  {
    const src = fs.readFileSync(NEW_FILE, 'utf8');
    const m = /const GET_CACHE_TTL_S = (\d+);/.exec(src);
    ok('cache TTL is declared', !!m);
    ok('cache TTL is at least 5 minutes', m && Number(m[1]) >= 300,
      m ? m[1] + 's' : 'n/a');
    // Both GET endpoints must be cached; /beacon originally was not.
    ok('beacon GET is edge-cached', /__cache\/beacon\//.test(src));
    ok('beacon cache key varies by window',
      /__cache\/beacon\/\$\{n\}/.test(src));
    ok('beacon reads only days that exist',
      /list\(\{ prefix: BEACON_PREFIX/.test(src));
  }

  console.log(`\nkv-cost billed ops: ${billedOld} → ${billedNew}` +
    (billedOld ? `  (${(100 - billedNew / billedOld * 100).toFixed(1)}% fewer)` : ''));
  process.exit(fails ? 1 : 0);
})();
