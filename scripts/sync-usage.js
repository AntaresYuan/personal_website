#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   sync-usage — local Claude Code usage → usage.antaresyuan.site sync agent

   Walks `~/.claude/projects/<project-slug>/<session-uuid>.jsonl`, sums per
   day per session, and POSTs the last 14 days to the Worker as
     { date, source, tokens, sessions, costCents }

   Source identifier comes from config so multi-device aggregation works
   (claude-mbp, claude-imac, ...). The Worker stores each source as its
   own slot under the day key, so re-running this script overwrites only
   THIS device's slot — never other devices'.

   The Worker is the single privacy chokepoint: it strict-validates the
   POST schema (any extra field → 400) and the public GET only emits the
   summed total per day. Per-source data never leaves the Worker.

   Privacy gate on THIS side: the script's POST body is built from a
   hardcoded allowlist of 5 fields. No message content, no project name,
   no model id, no session ids, no event counts, no hourly distribution
   ever leaves the machine — by construction, not just by trust. costCents
   is a SCALAR aggregate computed locally using the model-pricing table
   below — the per-model token split that feeds it stays on this device.

   Config: ~/.config/antares-sync-usage.json  (per machine, untracked)
   Example: scripts/sync-usage.config.example.json
   Docs:    docs/usage-sync.md

   Usage:
     node scripts/sync-usage.js              POST last 14 days
     node scripts/sync-usage.js --dry-run    print POST payloads, send nothing
     node scripts/sync-usage.js --window 30  bump the day window (default 14)
   ════════════════════════════════════════════════════════════════════════ */

'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const os   = require('node:os');
const { execSync } = require('node:child_process');

// ── args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose') || args.includes('-v');
let WINDOW = 14;
{
  const i = args.indexOf('--window');
  if (i >= 0 && args[i + 1]) {
    const n = parseInt(args[i + 1], 10);
    if (Number.isInteger(n) && n > 0 && n <= 90) WINDOW = n;
    else die(`--window must be 1..90, got ${args[i + 1]}`);
  }
}

function die(msg) {
  console.error('sync-usage:', msg);
  process.exit(1);
}
function log(...a) { if (VERBOSE) console.log(...a); }

// ── config ────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(os.homedir(), '.config', 'antares-sync-usage.json');
function loadConfig() {
  let raw;
  try { raw = fs.readFileSync(CONFIG_PATH, 'utf8'); }
  catch { die(`missing config at ${CONFIG_PATH} — copy scripts/sync-usage.config.example.json there and edit`); }
  let cfg;
  try { cfg = JSON.parse(raw); }
  catch (e) { die(`config is not valid JSON: ${e.message}`); }
  if (typeof cfg.endpoint !== 'string' || !cfg.endpoint) die('config.endpoint missing');
  if (typeof cfg.source !== 'string'   || !cfg.source)   die('config.source missing');
  if (!/^[a-z0-9._-]+$/i.test(cfg.source)) die(`config.source must match [a-z0-9._-]+, got ${cfg.source}`);
  if (cfg.source.length > 32) die(`config.source must be <= 32 chars`);
  cfg.claudeProjectsDir = (cfg.claudeProjectsDir || '~/.claude/projects')
    .replace(/^~/, os.homedir());
  cfg.endpoint = cfg.endpoint.replace(/\/+$/, '');
  return cfg;
}

// ── secret: keychain first, fall back to config field ─────────────
function loadSecret(cfg) {
  if (typeof cfg.secret === 'string' && cfg.secret.length > 0) {
    log('using secret from config file');
    return cfg.secret;
  }
  try {
    const out = execSync(
      'security find-generic-password -a "$USER" -s "antares-sync-usage" -w',
      { shell: '/bin/zsh', stdio: ['ignore', 'pipe', 'ignore'] }
    ).toString().trim();
    if (out) {
      log('using secret from macOS keychain (antares-sync-usage)');
      return out;
    }
  } catch { /* keychain miss → fall through */ }
  die('no secret available — set "secret" in config OR run:\n' +
      '  security add-generic-password -a "$USER" -s "antares-sync-usage" -w "<bearer>"');
}

// ── model pricing (USD per million tokens) ────────────────────────
// [input, output, cache_write, cache_read]. Match by substring of the
// `ev.message.model` field so we don't have to enumerate every dated
// snapshot id ("claude-opus-4-7-20251101" etc.). Fallback to Sonnet
// rates (safe middle ground — Opus would over-quote, Haiku would
// under-quote). Edit when Anthropic publishes a new tier or when a new
// family ships; the dashboard rebuilds on next sync.
const MODEL_PRICING = {
  'opus-4-7':   [15.00, 75.00, 18.75, 1.50],
  'opus-4-6':   [15.00, 75.00, 18.75, 1.50],
  'sonnet-4-6': [ 3.00, 15.00,  3.75, 0.30],
  'sonnet-4-5': [ 3.00, 15.00,  3.75, 0.30],
  'haiku-4-5':  [ 0.80,  4.00,  1.00, 0.08],
};
const DEFAULT_PRICING = [3.00, 15.00, 3.75, 0.30];

function priceFor(model) {
  if (typeof model !== 'string') return DEFAULT_PRICING;
  for (const key of Object.keys(MODEL_PRICING)) {
    if (model.includes(key)) return MODEL_PRICING[key];
  }
  return DEFAULT_PRICING;
}

// Cost of a single assistant turn in USD. Includes cache_creation +
// cache_read at their real billing rates — these are charged by Anthropic
// even though they don't count as "fresh work" in the tokens metric. On
// 1M-context Opus sessions cache_read can be the dominant cost line.
function eventCostUsd(u, model) {
  const [pi, po, pcw, pcr] = priceFor(model);
  return (
    (u.input_tokens                || 0) / 1e6 * pi  +
    (u.output_tokens               || 0) / 1e6 * po  +
    (u.cache_creation_input_tokens || 0) / 1e6 * pcw +
    (u.cache_read_input_tokens     || 0) / 1e6 * pcr
  );
}

// ── walk jsonl + aggregate ────────────────────────────────────────
// Returns Map<dateYYYYMMDD, { tokens: int, sessions: Set<sessionId>, costUsd: number }>
function aggregate(projectsDir) {
  const buckets = new Map();
  let projects;
  try { projects = fs.readdirSync(projectsDir, { withFileTypes: true }); }
  catch { die(`can't read claudeProjectsDir: ${projectsDir}`); }

  for (const ent of projects) {
    if (!ent.isDirectory()) continue;
    const projDir = path.join(projectsDir, ent.name);
    let files;
    try { files = fs.readdirSync(projDir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const full = path.join(projDir, f);
      let content;
      try { content = fs.readFileSync(full, 'utf8'); } catch { continue; }
      // jsonl: parse line by line, tolerate corrupt lines
      let lineNo = 0;
      for (const line of content.split('\n')) {
        lineNo++;
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        if (!ev || ev.type !== 'assistant') continue;
        const u = ev.message && ev.message.usage;
        if (!u) continue;
        const ts = ev.timestamp;
        if (typeof ts !== 'string' || ts.length < 10) continue;
        const date = ts.slice(0, 10);   // UTC date
        // "Tokens" = input + output only — the fresh content the user and
        // model exchanged this turn. Matches the convention used by the
        // Anthropic billing dashboard and popular Claude-usage CLIs
        // (ccusage etc.), so this number is comparable to what visitors see
        // in other tools.
        //
        // Deliberately excluded:
        //   cache_creation_input_tokens — Claude Code writes its tools +
        //     system prompt to cache once per new session (~hundreds of K
        //     tokens of fixed overhead per session). Treating that as
        //     "work" lets session count, not actual usage, drive the chart.
        //   cache_read_input_tokens — the cached prompt being re-served
        //     each turn. On a 1M-context session a single re-read is 500K+
        //     already-paid-for tokens; counting it inflated dailies 50-100×.
        const tokens =
          (u.input_tokens  || 0) +
          (u.output_tokens || 0);
        if (!Number.isFinite(tokens) || tokens <= 0) continue;
        // Cost uses real Anthropic billing — input + output + cache_creation
        // + cache_read at per-model rates. Diverges from `tokens` on purpose:
        // tokens = "fresh work this turn", costUsd = "what Anthropic charged".
        const model = ev.message && ev.message.model;
        const cost = eventCostUsd(u, model);
        let b = buckets.get(date);
        if (!b) { b = { tokens: 0, sessions: new Set(), costUsd: 0 }; buckets.set(date, b); }
        b.tokens += tokens;
        b.costUsd += cost;
        if (ev.sessionId) b.sessions.add(ev.sessionId);
      }
    }
  }
  return buckets;
}

// ── trailing-window date list (UTC, oldest → newest) ──────────────
function lastNDates(n) {
  const today = new Date().toISOString().slice(0, 10);
  const base = new Date(today + 'T00:00:00Z').getTime();
  const day = 86400000;
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(base - i * day).toISOString().slice(0, 10));
  }
  return out;
}

// ── build the payload list — STRICT allowlist (privacy gate) ──────
// This function defines the ONLY shape that leaves the machine. The
// Worker re-validates, but the first line of defense is here.
function payloadsFor(buckets, source, window) {
  const dates = lastNDates(window);
  return dates.map(date => {
    const b = buckets.get(date);
    // costCents = integer USD-cents. Wire as int (not float) so KV
    // round-trips are exact and Worker validation can use Number.isInteger.
    // Capped at the Worker's MAX_INT just in case a bug fed a daily bucket
    // that exploded.
    const costCents = b ? Math.round(b.costUsd * 100) : 0;
    return {
      date,
      source,
      tokens:    b ? b.tokens        : 0,
      sessions:  b ? b.sessions.size : 0,
      costCents,
    };
  }).filter(p => p.tokens > 0 || p.sessions > 0 || p.costCents > 0);
  // Skip empty days — they're zero on the Worker anyway, and posting them
  // would just churn KV writes. The Worker's lastNDays(90) fills zero-days
  // back in on GET for heatmap continuity.
}

// ── POST one payload ──────────────────────────────────────────────
async function post(endpoint, secret, payload) {
  const res = await fetch(endpoint + '/', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${secret}`,
      'content-type':  'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

// ── main ──────────────────────────────────────────────────────────
(async () => {
  const cfg = loadConfig();
  const secret = DRY ? null : loadSecret(cfg);

  log(`scanning ${cfg.claudeProjectsDir} …`);
  const buckets = aggregate(cfg.claudeProjectsDir);
  log(`aggregated ${buckets.size} active days across all sessions`);

  const payloads = payloadsFor(buckets, cfg.source, WINDOW);

  if (DRY) {
    console.log(`[dry-run] would POST ${payloads.length} non-empty days to ${cfg.endpoint}:`);
    for (const p of payloads) console.log('  ' + JSON.stringify(p));
    if (payloads.length === 0) {
      console.log('  (none — no activity in the trailing window)');
    }
    process.exit(0);
  }

  if (payloads.length === 0) {
    log('no non-empty days in the trailing window — nothing to POST');
    process.exit(0);
  }

  let ok = 0, fail = 0;
  for (const p of payloads) {
    try {
      const r = await post(cfg.endpoint, secret, p);
      if (r.status === 200) { ok++; log(`  POST ${p.date} ok (${p.tokens} tokens, ${p.sessions} sessions, $${(p.costCents/100).toFixed(2)})`); }
      else {
        // Worker error bodies are terse, schema-validator strings ('unexpected
        // field: foo' or 'date must be YYYY-MM-DD') — never echoes the payload.
        // If that ever changes, sanitize before logging.
        fail++;
        console.error(`  POST ${p.date} FAILED status=${r.status} body=${r.body}`);
      }
    } catch (e) {
      fail++;
      console.error(`  POST ${p.date} threw: ${e.message}`);
    }
  }
  log(`done: ${ok} ok, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
