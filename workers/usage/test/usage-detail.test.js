/* Tests for functions/api/usage-detail.js — the Access-gated, same-origin
 * proxy for the private usage feed.
 *
 * These run the REAL module (imported, not re-implemented) against a stubbed
 * global fetch, so a change to the source is actually exercised. What matters
 * most here is the failure direction: every unhappy path must fail CLOSED. A
 * proxy that leaks private data when misconfigured is worse than one that is
 * simply broken, because nothing visibly breaks.
 */
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('  ✗    ' + name + '\n       ' + e.message); fail++; }
}
async function ta(name, fn) {
  try { await fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('  ✗    ' + name + '\n       ' + e.message); fail++; }
}

/* Node prints MODULE_TYPELESS_PACKAGE_JSON because the Function is ESM while
   this package is CommonJS. Adding "type":"module" would break every existing
   CommonJS script in scripts/, and Pages runs ESM Functions natively, so the
   warning is a local test artefact only -- suppressed here rather than
   "fixed" by changing the repo's module system. */
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name === 'MODULE_TYPELESS_PACKAGE_JSON' ||
      /MODULE_TYPELESS_PACKAGE_JSON/.test(String(w.code || ''))) return;
  console.warn(w.stack || String(w));
});

const SRC = path.join(__dirname, '..', '..', '..', 'functions', 'api', 'usage-detail.js');

/* A request with the knobs each test needs. */
function req({ jwt, cookie, url } = {}) {
  const h = new Map();
  if (jwt) h.set('cf-access-jwt-assertion', jwt);
  if (cookie) h.set('cookie', cookie);
  return {
    url: url || 'https://antaresyuan.site/api/usage-detail?days=365',
    headers: { get: (k) => h.get(String(k).toLowerCase()) || null },
  };
}

/* Capture what the proxy sends upstream. */
function stubFetch(impl) {
  const calls = [];
  global.fetch = async (u, opts) => {
    calls.push({ url: String(u), opts: opts || {} });
    return impl ? impl(String(u), opts) : okJson({ days: [], since: null, updated: null });
  };
  return calls;
}
function okJson(obj, status = 200) {
  const body = JSON.stringify(obj);
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

(async () => {
  console.log('\nusage-detail proxy');
  const mod = await import(pathToFileURL(SRC).href);
  const handler = mod.onRequestGet;

  const source = require('fs').readFileSync(SRC, 'utf8');

  /* ── the gate ─────────────────────────────────────────────────────── */

  await ta('no Access session → 401', async () => {
    stubFetch();
    const res = await handler({ request: req(), env: { USAGE_DETAIL_TOKEN: 'k' } });
    assert.strictEqual(res.status, 401);
  });

  await ta('no Access session → never calls upstream', async () => {
    const calls = stubFetch();
    await handler({ request: req(), env: { USAGE_DETAIL_TOKEN: 'k' } });
    assert.strictEqual(calls.length, 0, 'upstream was contacted without a session');
  });

  await ta('no Access session → body carries no usage data', async () => {
    stubFetch(() => okJson({ days: [{ date: '2026-09-01', tokens: 999 }] }));
    const res = await handler({ request: req(), env: { USAGE_DETAIL_TOKEN: 'k' } });
    const text = await res.text();
    assert.ok(!text.includes('999'), 'private numbers leaked in the 401 body');
  });

  await ta('JWT header alone is accepted', async () => {
    stubFetch();
    const res = await handler({ request: req({ jwt: 'x.y.z' }), env: { USAGE_DETAIL_TOKEN: 'k' } });
    assert.strictEqual(res.status, 200);
  });

  await ta('CF_Authorization cookie alone is accepted', async () => {
    stubFetch();
    const res = await handler({
      request: req({ cookie: 'foo=1; CF_Authorization=abc; bar=2' }),
      env: { USAGE_DETAIL_TOKEN: 'k' },
    });
    assert.strictEqual(res.status, 200);
  });

  /* A near-miss cookie name must not satisfy the gate. Substring matching
     would wave this through. */
  await ta('look-alike cookie name is rejected', async () => {
    stubFetch();
    const res = await handler({
      request: req({ cookie: 'CF_AuthorizationSomethingElse=abc' }),
      env: { USAGE_DETAIL_TOKEN: 'k' },
    });
    assert.strictEqual(res.status, 401);
  });

  await ta('cookie at string start is accepted', async () => {
    stubFetch();
    const res = await handler({
      request: req({ cookie: 'CF_Authorization=abc' }),
      env: { USAGE_DETAIL_TOKEN: 'k' },
    });
    assert.strictEqual(res.status, 200);
  });

  /* ── misconfiguration is distinct from rejection ──────────────────── */

  await ta('missing token binding → 503, not 401', async () => {
    stubFetch();
    const res = await handler({ request: req({ jwt: 'x' }), env: {} });
    assert.strictEqual(res.status, 503,
      'a missing binding must not masquerade as a failed login');
  });

  await ta('missing token binding → never calls upstream', async () => {
    const calls = stubFetch();
    await handler({ request: req({ jwt: 'x' }), env: {} });
    assert.strictEqual(calls.length, 0);
  });

  /* ── the bearer stays server-side ─────────────────────────────────── */

  await ta('bearer is attached upstream', async () => {
    const calls = stubFetch();
    await handler({ request: req({ jwt: 'x' }), env: { USAGE_DETAIL_TOKEN: 'sekret' } });
    assert.strictEqual(calls[0].opts.headers.authorization, 'Bearer sekret');
  });

  await ta('bearer never appears in the response', async () => {
    stubFetch(() => okJson({ days: [] }));
    const res = await handler({ request: req({ jwt: 'x' }), env: { USAGE_DETAIL_TOKEN: 'sekret' } });
    const text = await res.text();
    assert.ok(!text.includes('sekret'), 'the bearer leaked to the browser');
    for (const [, v] of Object.entries(res.headers || {})) {
      assert.ok(!String(v).includes('sekret'), 'the bearer leaked in a header');
    }
  });

  /* ── parameter handling ───────────────────────────────────────────── */

  await ta('days is passed through when valid', async () => {
    const calls = stubFetch();
    await handler({
      request: req({ jwt: 'x', url: 'https://s/api/usage-detail?days=30' }),
      env: { USAGE_DETAIL_TOKEN: 'k' },
    });
    assert.ok(calls[0].url.endsWith('days=30'), calls[0].url);
  });

  await ta('out-of-range days is clamped, not forwarded', async () => {
    const calls = stubFetch();
    await handler({
      request: req({ jwt: 'x', url: 'https://s/api/usage-detail?days=99999' }),
      env: { USAGE_DETAIL_TOKEN: 'k' },
    });
    assert.ok(calls[0].url.endsWith('days=365'), calls[0].url);
  });

  await ta('non-numeric days falls back to the default', async () => {
    const calls = stubFetch();
    await handler({
      request: req({ jwt: 'x', url: 'https://s/api/usage-detail?days=../../etc' }),
      env: { USAGE_DETAIL_TOKEN: 'k' },
    });
    assert.ok(calls[0].url.endsWith('days=365'), calls[0].url);
  });

  /* Only `days` may cross. Forwarding the whole query string would open a
     door onto any future upstream parameter. */
  await ta('extra query params are not forwarded', async () => {
    const calls = stubFetch();
    await handler({
      request: req({ jwt: 'x', url: 'https://s/api/usage-detail?days=5&admin=1&source=leak' }),
      env: { USAGE_DETAIL_TOKEN: 'k' },
    });
    assert.ok(!calls[0].url.includes('admin'), calls[0].url);
    assert.ok(!calls[0].url.includes('source'), calls[0].url);
  });

  /* ── upstream faults must not read as "no data" ───────────────────── */

  await ta('upstream 401 surfaces as 502, not an empty 200', async () => {
    stubFetch(() => okJson({ error: 'unauthorized' }, 401));
    const res = await handler({ request: req({ jwt: 'x' }), env: { USAGE_DETAIL_TOKEN: 'stale' } });
    assert.strictEqual(res.status, 502,
      'a rotated/stale token would otherwise render as "you have no usage"');
  });

  await ta('upstream 500 surfaces as 502', async () => {
    stubFetch(() => okJson({ error: 'boom' }, 500));
    const res = await handler({ request: req({ jwt: 'x' }), env: { USAGE_DETAIL_TOKEN: 'k' } });
    assert.strictEqual(res.status, 502);
  });

  await ta('network failure surfaces as 502, not a crash', async () => {
    global.fetch = async () => { throw new TypeError('network down'); };
    const res = await handler({ request: req({ jwt: 'x' }), env: { USAGE_DETAIL_TOKEN: 'k' } });
    assert.strictEqual(res.status, 502);
  });

  await ta('happy path passes the payload through verbatim', async () => {
    const payload = { days: [{ date: '2026-09-01', tokens: 42 }], since: '2026-09-01', updated: 'z' };
    stubFetch(() => okJson(payload));
    const res = await handler({ request: req({ jwt: 'x' }), env: { USAGE_DETAIL_TOKEN: 'k' } });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(JSON.parse(await res.text()), payload);
  });

  /* ── caching: private data must not be stored ─────────────────────── */

  await ta('success is no-store and private', async () => {
    stubFetch();
    const res = await handler({ request: req({ jwt: 'x' }), env: { USAGE_DETAIL_TOKEN: 'k' } });
    const cc = res.headers.get('cache-control');
    assert.ok(/no-store/.test(cc), cc);
    assert.ok(/private/.test(cc), cc);
  });

  await ta('401 is also no-store', async () => {
    stubFetch();
    const res = await handler({ request: req(), env: { USAGE_DETAIL_TOKEN: 'k' } });
    assert.ok(/no-store/.test(res.headers.get('cache-control')));
  });

  /* ── source-level guards ──────────────────────────────────────────── */

  /* The CLI reaches the Worker directly. If this proxy ever became the only
     path, every machine's unattended upload would break, so the proxy must
     stay read-only: no POST handler belongs in this file. */
  t('proxy exposes GET only (no POST/PUT handler)', () => {
    assert.ok(!/onRequestPost|onRequestPut|onRequestDelete|onRequest\b\s*=/.test(source),
      'a write handler here would put the CLI upload path behind Access');
  });

  t('the gate is not disabled by a constant', () => {
    assert.ok(!/hasAccessSession\s*\([^)]*\)\s*\|\|\s*true/.test(source));
    assert.ok(!/return\s+true;\s*\/\/\s*TODO/.test(source));
  });

  /* Guards the *mechanism*, so a future refactor to plain `cookie.includes()`
     is caught here even if someone deletes the behavioural test above. Matches
     the source loosely on purpose — asserting an exact regex literal would
     break on harmless reformatting. */
  t('cookie match is anchored, not a bare substring test', () => {
    const anchored = /\(\?:\^\|;/.test(source) || /\bsplit\(['"];['"]\)/.test(source);
    assert.ok(anchored, 'cookie name must be matched at a boundary');
    assert.ok(!/cookie\s*\.\s*includes\s*\(\s*JWT_COOKIE/.test(source),
      'substring matching would accept CF_AuthorizationSomethingElse');
  });

  console.log(`\nusage-detail: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
