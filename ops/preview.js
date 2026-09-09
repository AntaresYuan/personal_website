#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   ops/preview.js — one-command local preview of the usage dashboard.

   Runs the WHOLE stack on 127.0.0.1 with no Cloudflare account, no login,
   and no writes to your real config:

     ┌ static site (index.html, scripts/, content/) ─────────────┐
     │ /                     → the actual built site             │
     │ /api/usage/*          → the REAL Worker code, in-process   │
     └───────────────────────────────────────────────────────────┘

   Why it runs the real Worker instead of a stub: the whole point of a
   preview is to catch things a stub would paper over — the publish
   projection, the auth check, the validator, the KV merge semantics. So
   workers/usage/src/index.js is imported as-is and handed a Map-backed
   stand-in for the KV binding. Only the storage is fake.

   The static layer rewrites site.json's usage.endpoint on the fly, so the
   page fetches this local Worker rather than usage.antaresyuan.site. The
   committed content/site.json is never modified.

   Usage:
     node ops/preview.js                 # serve + seed from your real data
     node ops/preview.js --port 8888
     node ops/preview.js --no-seed       # start empty
     node ops/preview.js --demo          # synthetic data, ignores local logs
     node ops/preview.js --publish '{"fields":["totalTokens"],"dims":[]}'

   Stop with Ctrl-C. Nothing persists: the KV lives in memory only.
   ════════════════════════════════════════════════════════════════════════ */

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const REPO_ROOT = path.join(__dirname, '..');
const WORKER_SRC = path.join(REPO_ROOT, 'workers', 'usage', 'src', 'index.js');
const WRANGLER_TOML = path.join(REPO_ROOT, 'workers', 'usage', 'wrangler.toml');
const SYNC_JS = path.join(REPO_ROOT, 'scripts', 'sync-usage.js');
const SITE_JSON_REL = 'content/site.json';

// ── args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valOf = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const PORT = parseInt(valOf('--port', '8787'), 10);
const SEED = !has('--no-seed');
const DEMO = has('--demo');
const PUBLISH_OVERRIDE = valOf('--publish', null);
const PREVIEW_SECRET = 'local-preview-secret';

if (has('-h') || has('--help')) {
  const src = fs.readFileSync(__filename, 'utf8');
  console.log(src.slice(src.indexOf('ops/preview.js'), src.indexOf('════', 200)).replace(/^ {3}/gm, ''));
  process.exit(0);
}

// ── read the publish projection straight out of wrangler.toml ─────
// Parsing the committed value (rather than hardcoding one here) is what
// makes the preview show your ACTUAL public/private split. --publish
// overrides it so you can A/B a setting before editing the toml.
function publishFromToml() {
  try {
    const toml = fs.readFileSync(WRANGLER_TOML, 'utf8');
    // Skip commented examples; take the last live assignment.
    const live = toml
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .filter((l) => l.includes('USAGE_PUBLISH'));
    if (!live.length) return '{}';
    const m = live[live.length - 1].match(/USAGE_PUBLISH\s*=\s*'([^']*)'/);
    return m ? m[1] : '{}';
  } catch {
    return '{}';
  }
}
const USAGE_PUBLISH = PUBLISH_OVERRIDE !== null ? PUBLISH_OVERRIDE : publishFromToml();

// ── in-memory stand-in for the KV binding ─────────────────────────
// Only get/put are needed by the Worker (verified against src/index.js).
function makeMemoryKV() {
  const store = new Map();
  return {
    store,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, String(value));
    },
  };
}

// ── Cache API polyfill ────────────────────────────────────────────
// The Worker uses `caches.default` (a Cloudflare global) to hold the public
// GET body for 60s and to purge it after a POST. Plain Node has no such
// global, so without this the real handler throws "caches is not defined".
// Polyfilling it — rather than stubbing the calls out — keeps the preview
// exercising the same cache-hit / invalidate-on-write paths as production.
function installCachesPolyfill() {
  if (globalThis.caches && globalThis.caches.default) return;
  const store = new Map();   // url → { body, expiresAt }
  const def = {
    async match(key) {
      const url = typeof key === 'string' ? key : key.url;
      const hit = store.get(url);
      if (!hit) return undefined;
      if (hit.expiresAt && Date.now() > hit.expiresAt) {
        store.delete(url);
        return undefined;
      }
      return new Response(hit.body, {
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    },
    async put(key, res) {
      const url = typeof key === 'string' ? key : key.url;
      const body = await res.text();
      // Honour s-maxage the way the edge would, so the 60s TTL is real here.
      const cc = res.headers.get('cache-control') || '';
      const m = /s-maxage=(\d+)/.exec(cc);
      const ttlMs = m ? parseInt(m[1], 10) * 1000 : 0;
      store.set(url, { body, expiresAt: ttlMs ? Date.now() + ttlMs : 0 });
    },
    async delete(key) {
      const url = typeof key === 'string' ? key : key.url;
      return store.delete(url);
    },
  };
  globalThis.caches = { default: def, open: async () => def };
  return store;
}

// ── static file serving ───────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const rel = decoded.replace(/^\/+/, '');
  const abs = path.join(root, rel);
  // Contain path traversal — this server reads from the repo only.
  if (!abs.startsWith(root)) return null;
  return abs;
}

function serveStatic(req, res) {
  let abs = safeJoin(REPO_ROOT, req.url);
  if (!abs) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    if (fs.statSync(abs).isDirectory()) abs = path.join(abs, 'index.html');
  } catch {
    /* fall through to ENOENT below */
  }

  let body;
  try {
    body = fs.readFileSync(abs);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('404 — ' + req.url);
    return;
  }

  // Point the page at THIS server's worker mount instead of production,
  // without touching the committed file on disk.
  if (path.relative(REPO_ROOT, abs) === SITE_JSON_REL.split('/').join(path.sep)) {
    try {
      const cfg = JSON.parse(body.toString('utf8'));
      if (cfg.usage) {
        // Echo back whichever host the browser used. Hardcoding 127.0.0.1
        // here made the endpoint cross-origin for a page opened on
        // http://localhost:PORT, and the dashboard's fetch was silently
        // blocked — the section just sat on its skeleton em-dashes.
        const host = (req.headers.host || `127.0.0.1:${PORT}`).replace(/\/+$/, '');
        cfg.usage.endpoint = `http://${host}/api/usage`;
        cfg.usage.enabled = true;
      }
      body = Buffer.from(JSON.stringify(cfg, null, 2));
    } catch (e) {
      console.warn('  ! could not rewrite site.json endpoint:', e.message);
    }
  }

  // Defeat webview caches that ignore `cache-control: no-store`.
  //
  // Some embedded browsers keep a private persistent cache, so an edited
  // render.js can keep executing an old copy — indistinguishable from "the
  // change didn't work". Rewriting the asset URLs is the only reliable fix:
  // a different URL cannot hit the previous cache entry. Stamp every local
  // script/style reference with the file's real mtime, so the URL changes
  // exactly when the file does.
  if (path.extname(abs) === '.html') {
    const stamp = (rel) => {
      try {
        return String(Math.floor(fs.statSync(path.join(REPO_ROOT, rel)).mtimeMs));
      } catch {
        return '';
      }
    };
    body = Buffer.from(
      body
        .toString('utf8')
        // src="scripts/render.js?v=abc"  /  href="/styles/main.css"
        .replace(
          /((?:src|href)=")(\/?(?:scripts|styles)\/[A-Za-z0-9._/-]+\.(?:js|css))(\?[^"]*)?"/g,
          (all, lead, rel, qs) => {
            const mt = stamp(rel.replace(/^\//, ''));
            if (!mt) return all;
            // Preserve an existing query but force our own cache key last.
            const base = qs ? qs.replace(/([?&])mt=[^&]*/g, '$1').replace(/[?&]$/, '') : '';
            const sep = base ? '&' : '?';
            return `${lead}${rel}${base}${sep}mt=${mt}"`;
          }
        )
    );
  }

  res.writeHead(200, {
    'content-type': MIME[path.extname(abs)] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(body);
}

// ── bridge node's req/res to the Worker's fetch() ─────────────────
async function handleWorker(req, res, worker, env) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  // Strip the /api/usage mount prefix so the Worker sees "/" and "/detail".
  const innerPath = req.url.replace(/^\/api\/usage/, '') || '/';
  const request = new Request(`http://127.0.0.1:${PORT}${innerPath}`, {
    method: req.method,
    headers: req.headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
  });

  let workerRes;
  try {
    workerRes = await worker.fetch(request, env, { waitUntil() {} });
  } catch (e) {
    console.error('  ! worker threw:', e.stack || e.message);
    res.writeHead(500, { 'content-type': 'text/plain' }).end('worker error: ' + e.message);
    return;
  }

  const outHeaders = {};
  workerRes.headers.forEach((v, k) => {
    outHeaders[k] = v;
  });
  const text = await workerRes.text();
  res.writeHead(workerRes.status, outHeaders);
  res.end(text);
}

// ── seeding ───────────────────────────────────────────────────────
// Real seeding runs the actual sync agent against a throwaway config so the
// same code path that will run in production fills the preview. Demo seeding
// synthesises a year of plausible days for when you'd rather not surface
// your own numbers.
//
// This MUST be async (spawn, not spawnSync): the child POSTs back into this
// very server, so blocking the event loop while waiting for it deadlocks —
// the agent waits on an HTTP response that this process can't serve until
// the child exits.
function seedFromRealData(port) {
  return new Promise((resolve) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-preview-'));
    const cfgPath = path.join(tmpDir, 'config.json');
    const sources = {};
    if (fs.existsSync(path.join(os.homedir(), '.claude', 'projects'))) {
      sources.claude = '~/.claude/projects';
    }
    if (fs.existsSync(path.join(os.homedir(), '.codex', 'sessions'))) {
      sources.codex = '~/.codex/sessions';
    }
    if (!Object.keys(sources).length) {
      console.log('  – no local transcripts found; starting empty (try --demo)');
      resolve({ ok: false, tmpDir });
      return;
    }

    fs.writeFileSync(
      cfgPath,
      JSON.stringify({
        endpoint: `http://127.0.0.1:${port}/api/usage`,
        secret: PREVIEW_SECRET,
        sources,
        sendModelBreakdown: true,
        sendProjectBreakdown: true,
      })
    );

    console.log('  (scanning transcripts — this takes ~30s on a busy machine)');
    const child = spawn(process.execPath, [SYNC_JS, '--window', '90'], {
      env: {
        ...process.env,
        ANTARES_USAGE_CONFIG: cfgPath,
        // Keep the preview's identity out of the real state dir.
        ANTARES_USAGE_STATE_DIR: path.join(tmpDir, 'state'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let errTail = '';
    child.stderr.on('data', (d) => {
      errTail = (errTail + d.toString()).slice(-500);
    });
    child.on('close', (code) => {
      if (code !== 0) {
        console.warn('  ! seed sync failed:', errTail.trim().split('\n')[0] || `exit ${code}`);
      }
      resolve({ ok: code === 0, tmpDir });
    });
  });
}

async function seedDemo(worker, env, port) {
  // A year of synthetic-but-plausible days: weekday-heavy, high cache ratio
  // (mirroring how Claude Code actually behaves), two devices, three models.
  const today = new Date().toISOString().slice(0, 10);
  const base = new Date(today + 'T00:00:00Z').getTime();
  const devices = ['studio-mac', 'macbook-air'];
  const models = ['claude-sonnet-5', 'claude-opus-4', 'gpt-5.6-sol'];
  let posted = 0;

  for (let i = 364; i >= 0; i--) {
    const date = new Date(base - i * 86400000).toISOString().slice(0, 10);
    const dow = new Date(date + 'T00:00:00Z').getUTCDay();
    // Deterministic pseudo-random so repeated runs look the same.
    const seed = (i * 2654435761) % 4294967296;
    const rnd = (seed / 4294967296);
    if ((dow === 0 || dow === 6) && rnd > 0.35) continue;
    if (rnd > 0.88) continue;

    for (const device of devices) {
      if (device === 'macbook-air' && rnd > 0.5) continue;
      const input = Math.floor(2000 + rnd * 9000);
      const output = Math.floor(4000 + rnd * 15000);
      const cacheRead = Math.floor((input + output) * (18 + rnd * 20));
      const cacheWrite = Math.floor(cacheRead * 0.04);
      const reasoning = Math.floor(output * rnd * 0.4);
      const model = models[Math.floor(rnd * models.length) % models.length];
      const total = input + output + cacheRead + cacheWrite;

      const payload = {
        date,
        source: device,
        tokens: input + output,
        sessions: 1 + Math.floor(rnd * 5),
        costCents: Math.floor((input * 3 + output * 15 + cacheRead * 0.3) / 1000),
        inputTokens: input,
        outputTokens: output,
        cachedInputTokens: cacheRead,
        cacheCreationInputTokens: cacheWrite,
        reasoningOutputTokens: reasoning,
        totalTokens: total,
        activeSeconds: Math.floor(600 + rnd * 9000),
        durationSeconds: Math.floor(1200 + rnd * 20000),
        messageCount: Math.floor(20 + rnd * 200),
        userMessageCount: Math.floor(5 + rnd * 40),
        bySource: {
          // Breakdown maps accept the five token categories + costCents
          // only — `sessions` is a day-level scalar, not a per-dim one.
          [device.startsWith('studio') ? 'claude' : 'codex']: {
            inputTokens: input,
            outputTokens: output,
            cachedInputTokens: cacheRead,
            totalTokens: total,
          },
        },
        byModel: {
          [model]: {
            inputTokens: input,
            outputTokens: output,
            cachedInputTokens: cacheRead,
            totalTokens: total,
          },
        },
        byProject: {
          'personal-website': { totalTokens: total },
        },
      };

      const res = await worker.fetch(
        new Request(`http://127.0.0.1:${port}/`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${PREVIEW_SECRET}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
        }),
        env,
        { waitUntil() {} }
      );
      if (res.status === 200) posted++;
      else {
        // Fail fast and loud: a rejected payload means the demo generator
        // and the validator disagree, which is a bug worth seeing once
        // rather than 700 times.
        console.error(`  ! demo POST rejected: ${res.status} ${await res.text()}`);
        console.error('    (stopping demo seed — fix the generator shape)');
        return posted;
      }
    }
  }
  return posted;
}

// ── main ──────────────────────────────────────────────────────────
(async () => {
  for (const f of [WORKER_SRC, SYNC_JS]) {
    if (!fs.existsSync(f)) {
      console.error(`preview: missing ${f}`);
      process.exit(1);
    }
  }
  if (!fs.existsSync(path.join(REPO_ROOT, 'index.html'))) {
    console.error('preview: index.html not found — run `npm run build` first');
    process.exit(1);
  }

  const mod = await import(pathToFileURL(WORKER_SRC).href);
  const worker = mod.default;
  if (!worker || typeof worker.fetch !== 'function') {
    console.error('preview: worker has no default export with fetch()');
    process.exit(1);
  }

  // Must be in place before the first worker.fetch() — handleGet touches
  // caches.default on every request.
  installCachesPolyfill();

  const kv = makeMemoryKV();
  const env = {
    USAGE_KV: kv,
    SHARED_SECRET: PREVIEW_SECRET,
    USAGE_PUBLISH,
  };

  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/usage')) {
      handleWorker(req, res, worker, env).catch((e) => {
        console.error('  ! bridge error:', e.message);
        if (!res.headersSent) res.writeHead(500).end('bridge error');
      });
    } else {
      serveStatic(req, res);
    }
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`preview: port ${PORT} already in use — try --port ${PORT + 1}`);
      process.exit(1);
    }
    throw e;
  });

  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

  console.log('');
  console.log('── local usage-dashboard preview ──────────────────────');
  console.log(`  site      http://127.0.0.1:${PORT}/#usage`);
  console.log(`  worker    http://127.0.0.1:${PORT}/api/usage/`);
  console.log(`  publish   ${USAGE_PUBLISH}`);
  console.log('  storage   in-memory (nothing persists, real KV untouched)');
  console.log('');

  let tmpDir = null;
  if (DEMO) {
    console.log('Seeding synthetic demo data (365 days, 2 devices, 3 models) …');
    const n = await seedDemo(worker, env, PORT);
    console.log(`  ✓ ${n} day-slots written`);
  } else if (SEED) {
    console.log('Seeding from your real local transcripts (last 90 days) …');
    const r = await seedFromRealData(PORT);
    tmpDir = r.tmpDir;
    console.log(`  ${r.ok ? '✓' : '!'} ${kv.store.size} day-keys in memory KV`);
  } else {
    console.log('Starting empty (--no-seed).');
  }

  console.log('');
  console.log('  Try:');
  console.log(`    curl -s http://127.0.0.1:${PORT}/api/usage/ | head -c 400`);
  console.log(`    curl -s -H "authorization: Bearer ${PREVIEW_SECRET}" \\`);
  console.log(`         http://127.0.0.1:${PORT}/api/usage/detail | head -c 400`);
  console.log('');
  console.log('  Ctrl-C to stop.');
  console.log('');

  const shutdown = () => {
    console.log('\nstopping …');
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})();
