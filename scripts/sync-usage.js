#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   sync-usage — local AI-coding usage → usage.antaresyuan.site sync agent

   Scans every configured tool's local transcripts (Claude Code, Codex, …),
   aggregates them the way kaboo's CLI does, and POSTs one payload per
   non-empty day in the trailing window.

   What changed vs v1 (and why)
   ────────────────────────────
   v1 shipped a single `tokens` scalar = input + output, dropping cache and
   reasoning counts at COLLECTION time. That's irreversible: the cache ratio
   could never be recovered later. Ported from kaboo (cli/parsers.go), this
   version keeps the five non-overlapping token categories separate on the
   wire and lets the DISPLAY layer choose which to show:

     inputTokens               fresh prompt tokens
     outputTokens              generated tokens
     cachedInputTokens         cache reads (re-served prompt prefix)
     cacheCreationInputTokens  cache writes (5m + 1h tiers)
     reasoningOutputTokens     thinking tokens (Codex/o-series)

   `tokens` is still sent, still means input+output, and still drives the
   heatmap — so the public number stays comparable to what it always was.

   Multi-device
   ────────────
   v1 asked the user to invent a unique `source` label per machine; two Macs
   both named "Mac" silently overwrote each other's KV slot. This version
   ports kaboo's canonical-hostname mechanism: the machine identity is
   resolved once, persisted to ~/.local/share/antares-usage/canonical-hostname,
   and reused forever after — so a device keeps ONE slot even if its runtime
   hostname changes. Override with ANTARES_USAGE_HOSTNAME.

   Privacy
   ───────
   The wire shape is a hardcoded allowlist (see buildPayload). model /
   project breakdowns are sent ONLY when the config opts in, and the Worker
   keeps them server-side — the public GET projection is controlled by the
   Worker's own publish config. No message content, no file paths, no
   session ids (hashed), no absolute project paths (leaf name only).

   Config: ~/.config/antares-sync-usage.json  (per machine, untracked)
   Docs:   docs/usage-sync.md

   Usage:
     node scripts/sync-usage.js               POST last 14 days
     node scripts/sync-usage.js --dry-run     print payloads, send nothing
     node scripts/sync-usage.js --window 30   bump the day window (1..90)
     node scripts/sync-usage.js --verbose     per-day + per-source detail
     node scripts/sync-usage.js --stats       local breakdown, no network
   ════════════════════════════════════════════════════════════════════════ */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync, spawnSync } = require('node:child_process');

const { resolveSources, walkFiles } = require('./lib/usage-sources.js');
const {
  dedupeEntries,
  aggregateToBuckets,
  extractSessions,
  dailyRollup,
  isPriced,
} = require('./lib/usage-aggregate.js');

// ── args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const STATS = args.includes('--stats');
/* --local-only: scan and refresh the local snapshot, never upload.
   Distinct from --dry-run, which is about previewing an upload: this is a
   real, intended mode of operation for a machine that wants the menu bar
   working without publishing anything. It needs no bearer token, so it
   works before (or entirely without) provisioning a secret. */
const LOCAL_ONLY = args.includes('--local-only');
const VERBOSE = args.includes('--verbose') || args.includes('-v');
let WINDOW = 14;
{
  /* Accept BOTH `--window 90` and `--window=90`.
     Only the space-separated form used to be parsed; the `=` form fell
     through to the default of 14 with no warning. A local snapshot built
     with `--window=90` therefore held 5 days instead of 41, and looked
     plausible enough that the loss was only caught by recomputing from the
     raw transcripts. A flag understood in one spelling and silently
     ignored in another is worse than one that errors. */
  let raw = null;
  const eq = args.find((a) => a.startsWith('--window='));
  if (eq) raw = eq.slice('--window='.length);
  const i = args.indexOf('--window');
  if (i >= 0) {
    if (args[i + 1] && !args[i + 1].startsWith('-')) raw = args[i + 1];
    else die('--window needs a value, e.g. --window 90');
  }
  if (raw !== null) {
    const t = String(raw).trim();
    const n = parseInt(t, 10);
    if (Number.isInteger(n) && n > 0 && n <= 90 && String(n) === t) WINDOW = n;
    else die(`--window must be 1..90, got ${raw}`);
  }
}

function die(msg) {
  console.error('sync-usage:', msg);
  process.exit(1);
}
function log(...a) {
  if (VERBOSE) console.log(...a);
}

// ── canonical hostname (ported from kaboo cli/config.go) ──────────
// Resolution order: env override → persisted canonical → os.hostname().
// The first resolution is written to disk and reused forever, so a machine
// whose runtime hostname rotates (VMs, DHCP-renamed Macs, CI) doesn't
// re-upload its whole history as a brand-new device.
//
// ANTARES_USAGE_STATE_DIR redirects that persisted identity, so the local
// preview can simulate a second device without pinning (or overwriting) the
// real one on this Mac.
const STATE_DIR =
  process.env.ANTARES_USAGE_STATE_DIR ||
  path.join(os.homedir(), '.local', 'share', 'antares-usage');
const CANONICAL_HOSTNAME_PATH = path.join(STATE_DIR, 'canonical-hostname');

function sanitizeSlot(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

function loadCanonicalHostname() {
  try {
    return fs.readFileSync(CANONICAL_HOSTNAME_PATH, 'utf8').trim();
  } catch {
    return '';
  }
}

function saveCanonicalHostnameIfAbsent(hostname) {
  if (!hostname) return;
  if (loadCanonicalHostname()) return;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    // Atomic write: temp file + rename, so a crash mid-write can't leave a
    // truncated identity behind.
    const tmp = CANONICAL_HOSTNAME_PATH + '.tmp';
    fs.writeFileSync(tmp, hostname + '\n', { mode: 0o600 });
    fs.renameSync(tmp, CANONICAL_HOSTNAME_PATH);
  } catch (e) {
    log(`warning: could not persist canonical hostname: ${e.message}`);
  }
}

function resolveHostname(cfg) {
  const envHost = sanitizeSlot(process.env.ANTARES_USAGE_HOSTNAME);
  if (envHost) return envHost;

  const canonical = sanitizeSlot(loadCanonicalHostname());
  if (canonical) return canonical;

  // Explicit config wins over os.hostname() on first resolution, so an
  // existing v1 install keeps writing to the slot it already owns.
  const configured = sanitizeSlot(cfg.source);
  const chosen = configured || sanitizeSlot(os.hostname()) || 'unknown-device';
  saveCanonicalHostnameIfAbsent(chosen);
  return chosen;
}

// ── config ────────────────────────────────────────────────────────
// ANTARES_USAGE_CONFIG lets a throwaway config drive the agent without
// touching the real ~/.config entry — that's what the local preview server
// (ops/preview.js) uses to point this agent at 127.0.0.1 instead of the
// production Worker.
const CONFIG_PATH =
  process.env.ANTARES_USAGE_CONFIG ||
  path.join(os.homedir(), '.config', 'antares-sync-usage.json');
function loadConfig({ tolerateMissing = false } = {}) {
  let raw;
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch {
    // `doctor` must be able to report a missing config rather than exit on
    // it — diagnosing that exact state is the point of the command.
    if (tolerateMissing) return { __missing: true };
    die(
      `missing config at ${CONFIG_PATH} — copy scripts/sync-usage.config.example.json there and edit`
    );
  }
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (e) {
    die(`config is not valid JSON: ${e.message}`);
  }
  if (typeof cfg.endpoint !== 'string' || !cfg.endpoint) die('config.endpoint missing');
  cfg.endpoint = cfg.endpoint.replace(/\/+$/, '');

  // `source` is now optional — canonical hostname covers it. When present
  // it seeds the first canonical resolution (back-compat with v1 installs).
  if (cfg.source !== undefined) {
    if (typeof cfg.source !== 'string' || !cfg.source) die('config.source must be a non-empty string when set');
    if (!/^[a-z0-9._-]+$/i.test(cfg.source)) die(`config.source must match [a-z0-9._-]+, got ${cfg.source}`);
    if (cfg.source.length > 32) die('config.source must be <= 32 chars');
  }

  // Which private dimensions to upload. Default: send them (the Worker
  // keeps them server-side and decides what to publish). Opt out entirely
  // by setting these to false.
  cfg.sendModelBreakdown = cfg.sendModelBreakdown !== false;
  cfg.sendProjectBreakdown = cfg.sendProjectBreakdown !== false;
  cfg.sendHourBreakdown = cfg.sendHourBreakdown !== false;
  cfg.sendToolBreakdown = cfg.sendToolBreakdown !== false;
  return cfg;
}

// ── secret: keychain first, fall back to config field ─────────────
/* The keychain account name.
   Resolved in Node rather than left to the shell as "$USER": launchd gives a
   job a minimal environment where $USER is EMPTY, so `-a "$USER"` silently
   looked up the wrong account and every scheduled upload fell back to
   "no secret" without erroring. os.userInfo() reads the real uid, so it works
   the same from a terminal and from launchd. */
function keychainAccount() {
  return process.env.USER || process.env.LOGNAME || os.userInfo().username;
}

function keychainSecret() {
  // Pass the account as an argv element, not interpolated into a shell string,
  // so a name with a space or quote cannot alter the command.
  const r = spawnSync(
    'security',
    ['find-generic-password', '-a', keychainAccount(), '-s', 'antares-sync-usage', '-w'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  );
  return r.status === 0 ? String(r.stdout || '').trim() : '';
}

function loadSecret(cfg) {
  if (typeof cfg.secret === 'string' && cfg.secret.length > 0) {
    log('using secret from config file');
    return cfg.secret;
  }
  const fromKeychain = keychainSecret();
  if (fromKeychain) {
    log('using secret from macOS keychain (antares-sync-usage)');
    return fromKeychain;
  }
  die(
    'no secret available — set "secret" in config OR run:\n' +
      '  security add-generic-password -a "$USER" -s "antares-sync-usage" -w "<bearer>"'
  );
}

// ── collect across all sources ────────────────────────────────────
function collect(cfg) {
  const sources = resolveSources(cfg);
  const allEntries = [];
  const allEvents = [];
  const allToolCalls = [];
  const scanned = [];

  for (const src of sources) {
    if (!src.exists) {
      if (src.explicit) log(`  ${src.name}: dir not found (${src.dir}) — skipped`);
      continue;
    }
    const t0 = Date.now();
    const { entries, events, toolCalls } = src.parse(src.dir, src.name);
    allEntries.push(...entries);
    allEvents.push(...events);
    if (Array.isArray(toolCalls)) allToolCalls.push(...toolCalls);
    scanned.push({
      name: src.name,
      label: src.label,
      entries: entries.length,
      events: events.length,
      toolCalls: Array.isArray(toolCalls) ? toolCalls.length : 0,
      ms: Date.now() - t0,
    });
    log(
      `  ${src.name}: ${entries.length} usage events, ${events.length} session events, ` +
        `${Array.isArray(toolCalls) ? toolCalls.length : 0} tool calls (${Date.now() - t0}ms)`
    );
  }

  if (scanned.length === 0) {
    die(
      'no transcript directories found — checked: ' +
        sources.map((s) => s.dir).join(', ')
    );
  }

  const beforeDedup = allEntries.length;
  const deduped = dedupeEntries(allEntries);
  if (beforeDedup !== deduped.length) {
    log(`  dedup: ${beforeDedup} → ${deduped.length} entries (${beforeDedup - deduped.length} fork copies dropped)`);
  }

  const buckets = aggregateToBuckets(deduped);
  const sessions = extractSessions(allEvents);
  log(`  aggregated into ${buckets.length} half-hour buckets, ${sessions.length} sessions`);

  return { days: dailyRollup(buckets, sessions, allToolCalls), scanned };
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
// This function defines the ONLY shape that leaves the machine. The Worker
// re-validates; this is the first line of defense.
function buildPayload(day, hostname, cfg) {
  // `tokens` keeps its v1 meaning — input + output — so the public heatmap
  // and every historical KV row stay on one consistent scale.
  const tokens = (day.inputTokens || 0) + (day.outputTokens || 0);

  const p = {
    date: day.date,
    source: hostname,
    tokens,
    sessions: day.sessions || 0,
    costCents: day.costCents || 0,
    // ── detail block (new in v2) ──
    inputTokens: day.inputTokens || 0,
    outputTokens: day.outputTokens || 0,
    cachedInputTokens: day.cachedInputTokens || 0,
    cacheCreationInputTokens: day.cacheCreationInputTokens || 0,
    reasoningOutputTokens: day.reasoningOutputTokens || 0,
    totalTokens: day.totalTokens || 0,
    activeSeconds: day.activeSeconds || 0,
    durationSeconds: day.durationSeconds || 0,
    messageCount: day.messageCount || 0,
    userMessageCount: day.userMessageCount || 0,
    bySource: day.bySource || {},
  };

  // Rhythm data: prompt counts per local hour, and per local weekday×hour.
  // Sent flat (24 and 168 ints) rather than nested arrays so the Worker's
  // numeric validator and summing logic apply unchanged. Counts are prompt
  // TALLIES — never content, never timestamps, so no single session can be
  // located in time from them.
  if (cfg.sendHourBreakdown) {
    p.promptHours = (day.promptHours || []).map((n) => n || 0);
    // Flatten [weekday][hour] → weekday * 24 + hour.
    const flat = new Array(168).fill(0);
    const wk = day.promptWeekHours || [];
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        flat[d * 24 + h] = (wk[d] && wk[d][h]) || 0;
      }
    }
    p.promptWeekHours = flat;
    // The offset the hours above were computed in, so a later reader can tell
    // "18:00 local" apart from "18:00 somewhere else". Minutes east of UTC.
    p.tzOffsetMinutes = -new Date(day.date + 'T12:00:00').getTimezoneOffset();
  }

  if (cfg.sendModelBreakdown) p.byModel = day.byModel || {};
  if (cfg.sendProjectBreakdown) p.byProject = day.byProject || {};

  /* Tool-category mix. Ported in spirit from kaboo's per-tool / per-MCP /
     per-skill counters, but deliberately NOT ported literally: kaboo ships
     raw tool, MCP-server and skill NAMES, which is fine for an internal
     tool and not fine here. A scan of this machine found MCP servers and
     skills named after internal systems, so names never leave — only the
     seven fixed categories plus an `mcp` tally. See usage-sources.js.

     Counts are per-day integers, so they carry the same disclosure profile
     as promptHours: no content, no ordering, no way back to a session. */
  if (cfg.sendToolBreakdown) {
    const tc = day.toolCounts || {};
    const out = {};
    // Explicit key list: a category the parser invents later cannot slip
    // into the payload without a change here.
    for (const k of ['read', 'edit', 'shell', 'search', 'browser', 'task', 'other', 'mcp']) {
      out[k] = tc[k] || 0;
    }
    p.toolCounts = out;
  }
  return p;
}

// ── local snapshot (offline source for the menu bar) ──────────────

// Where the menu bar looks. Kept beside the other CLI state so uninstalling
// removes it too; overridable for tests.
const LOCAL_SNAPSHOT_PATH =
  process.env.ANTARES_USAGE_LOCAL_SNAPSHOT ||
  path.join(STATE_DIR, 'usage-snapshot.json');

/* Emit the SAME shape the public endpoint serves — {days, since, updated} —
   so a consumer can swap one for the other without a second parser. This is
   the whole point: the menu bar has one decoder, and the local file is just
   another source for it.

   Note this writes what WOULD be published: payloadsFor() has already run
   every field through the privacy allowlist in buildPayload(). Caching the
   raw scan instead would put un-filtered fields on disk under a name that
   reads like published data, which is exactly the kind of thing that later
   gets uploaded by accident. */
function writeLocalSnapshot(payloads, hostname) {
  try {
    const days = payloads
      .map((p) => {
        const d = {
          date: p.date,
          tokens: p.tokens || 0,
          sessions: p.sessions || 0,
          costCents: p.costCents || 0,
        };
        // Optional fields: mirror them when present so the popover's cache
        // donut and tool mix work offline too.
        for (const k of [
          'totalTokens', 'cachedInputTokens', 'cacheCreationInputTokens',
          'reasoningOutputTokens', 'messageCount', 'inputTokens', 'outputTokens',
        ]) {
          if (p[k] != null) d[k] = p[k];
        }
        if (p.toolCounts) d.toolCounts = p.toolCounts;
        /* Per-platform split. buildPayload() already produces this and the
           uploader already sends it; only the local snapshot was dropping
           it, so the menu bar could show a total but never "how much of
           this was Claude vs Codex" — the one breakdown a resident panel
           is actually asked for. Source NAMES are tool identities
           (claude / codex), not project or MCP names, so they carry
           nothing private. */
        if (p.bySource) d.bySource = p.bySource;
        return d;
      })
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    const doc = {
      days,
      since: days.length ? days[0].date : null,
      updated: new Date().toISOString(),
      // Not served publicly; local-only provenance so a stale file from
      // another machine is identifiable rather than silently trusted.
      source: hostname,
    };

    fs.mkdirSync(path.dirname(LOCAL_SNAPSHOT_PATH), { recursive: true });
    const tmp = LOCAL_SNAPSHOT_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(doc));
    // Atomic: the menu bar polls this file and must never observe a
    // half-written document.
    fs.renameSync(tmp, LOCAL_SNAPSHOT_PATH);
    log(`  local snapshot: ${days.length} days → ${LOCAL_SNAPSHOT_PATH}`);
  } catch (e) {
    // Never fail a sync because the cache could not be written.
    console.error(`  local snapshot failed: ${e.message}`);
  }
}

function payloadsFor(days, hostname, cfg, window) {
  const dates = lastNDates(window);
  const out = [];
  for (const date of dates) {
    const day = days.get(date);
    if (!day) continue;
    const p = buildPayload(day, hostname, cfg);
    if (p.tokens > 0 || p.sessions > 0 || p.costCents > 0 || p.totalTokens > 0) {
      out.push(p);
    }
  }
  return out;
}

// ── POST one payload ──────────────────────────────────────────────
async function post(endpoint, secret, payload) {
  const res = await fetch(endpoint + '/', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

// ── local stats view (--stats) ────────────────────────────────────
const fmt = (n) => Number(n || 0).toLocaleString();
function printStats(days, hostname, scanned) {
  const all = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  const sum = (k) => all.reduce((a, d) => a + (d[k] || 0), 0);

  console.log(`\ndevice: ${hostname}`);
  console.log('sources scanned:');
  for (const s of scanned) {
    console.log(`  ${s.label.padEnd(14)} ${fmt(s.entries).padStart(9)} usage events  ${s.ms}ms`);
  }

  const totalAll = sum('totalTokens');
  console.log(`\nall-time (${all.length} active days, ${fmt(sum('sessions'))} sessions)`);
  console.log(`  input            ${fmt(sum('inputTokens')).padStart(15)}`);
  console.log(`  output           ${fmt(sum('outputTokens')).padStart(15)}`);
  console.log(`  cache read       ${fmt(sum('cachedInputTokens')).padStart(15)}`);
  console.log(`  cache write      ${fmt(sum('cacheCreationInputTokens')).padStart(15)}`);
  console.log(`  reasoning        ${fmt(sum('reasoningOutputTokens')).padStart(15)}`);
  console.log(`  ── total         ${fmt(totalAll).padStart(15)}`);
  console.log(`  public "tokens"  ${fmt(sum('inputTokens') + sum('outputTokens')).padStart(15)}  (input+output only)`);
  if (totalAll > 0) {
    const cachePct = ((sum('cachedInputTokens') / totalAll) * 100).toFixed(1);
    console.log(`  cache read share ${String(cachePct).padStart(14)}%`);
  }
  console.log(`  cost             ${('$' + (sum('costCents') / 100).toFixed(2)).padStart(15)}`);

  const byModel = {};
  const bySource = {};
  for (const d of all) {
    for (const [m, v] of Object.entries(d.byModel || {})) {
      byModel[m] = (byModel[m] || 0) + v.totalTokens;
    }
    for (const [s, v] of Object.entries(d.bySource || {})) {
      bySource[s] = (bySource[s] || 0) + v.totalTokens;
    }
  }
  const top = (obj, n) =>
    Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n);

  console.log('\nby tool');
  for (const [s, v] of top(bySource, 10)) {
    console.log(`  ${s.padEnd(24)} ${fmt(v).padStart(15)}`);
  }
  console.log('\nby model');
  for (const [m, v] of top(byModel, 10)) {
    console.log(`  ${(m || '(unknown)').padEnd(24)} ${fmt(v).padStart(15)}`);
  }

  // Surface model ids that fell back to DEFAULT_PRICING — their cost is a
  // guess, so they're the first thing to fix when a total looks wrong.
  const unpriced = Object.keys(byModel).filter((m) => m && !isPriced(m));
  if (unpriced.length) {
    console.log('\n⚠ unpriced models (billed at default Sonnet-class rates):');
    for (const m of unpriced) {
      console.log(`  ${m.padEnd(24)} ${fmt(byModel[m]).padStart(15)}  → add to MODEL_PRICING`);
    }
  }

  // Tool-category mix — what the work actually consisted of.
  const tool = {};
  for (const d of all) {
    for (const [k, v] of Object.entries(d.toolCounts || {})) {
      tool[k] = (tool[k] || 0) + v;
    }
  }
  // `mcp` is a cross-cutting tally, not a category, so it must not be
  // counted into the denominator or the shares would exceed 100%.
  const catTotal = ['read', 'edit', 'shell', 'search', 'browser', 'task', 'other']
    .reduce((a, k) => a + (tool[k] || 0), 0);
  if (catTotal > 0) {
    console.log(`\ntool mix (${fmt(catTotal)} calls)`);
    for (const k of ['shell', 'edit', 'read', 'browser', 'search', 'task', 'other']) {
      const n = tool[k] || 0;
      if (!n) continue;
      const pct = ((n / catTotal) * 100).toFixed(1);
      const bar = '█'.repeat(Math.max(1, Math.round((n / catTotal) * 28)));
      console.log(`  ${k.padEnd(9)} ${fmt(n).padStart(8)}  ${String(pct).padStart(5)}%  ${bar}`);
    }
    if (tool.mcp) {
      console.log(`  ${'via MCP'.padEnd(9)} ${fmt(tool.mcp).padStart(8)}  ` +
        `${String(((tool.mcp / catTotal) * 100).toFixed(1)).padStart(5)}%  (cross-cutting)`);
    }
  }
  console.log('');
}

/* ── status ────────────────────────────────────────────────────────────
   Ported from kaboo's `menubar status` (cli/menubar_cmd.go:134). The value
   is that when sync silently stops, you can see WHY without reading any
   code: every path is printed, the agent's real state comes from launchctl
   rather than from the file merely existing, and the last log line tells
   you what the last run actually did.

   This repo had none of that — the only way to check was to run a sync and
   watch it. */
function printStatus() {
  // Use the module's real CONFIG_PATH rather than re-deriving it — an
  // out-of-sync copy here would make this command lie about the very thing
  // it exists to report.
  const cfgPath = CONFIG_PATH;
  /* Use the module's STATE_DIR, not a second copy of the expression. This
     line used to hardcode `.local/state/antares-usage` while the rest of
     the file uses `.local/share/antares-usage`, so `status` reported
     State ✗ on a machine whose state directory existed and was actively
     being written — exactly the lie the comment above warns about. */
  const stateDir = STATE_DIR;
  const logPath = path.join(os.homedir(), 'Library', 'Logs', 'antares-sync-usage.log');
  const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.antaresyuan.sync-usage.plist');

  const exists = (p) => { try { fs.statSync(p); return true; } catch { return false; } };
  const mark = (b) => (b ? '✓' : '✗');

  console.log('sync-usage status\n');
  console.log(`  Config:    ${cfgPath} ${mark(exists(cfgPath))}`);
  console.log(`  State:     ${stateDir} ${mark(exists(stateDir))}`);
  console.log(`  Log:       ${logPath} ${mark(exists(logPath))}`);
  console.log(`  Agent:     ${plist} ${mark(exists(plist))}`);
  console.log(`  Platform:  ${process.platform} / node ${process.version}`);

  // Config detail, with the secret's PRESENCE reported but never its value.
  let cfg = null;
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch { /* absent */ }
  console.log('');
  if (cfg) {
    console.log(`  Endpoint:  ${cfg.endpoint || '(unset)'}`);
    console.log(`  Device:    ${resolveHostname(cfg)}`);
    const flags = ['sendModelBreakdown', 'sendProjectBreakdown', 'sendHourBreakdown', 'sendToolBreakdown']
      .map((k) => `${k.replace('send', '').replace('Breakdown', '').toLowerCase()}=${cfg[k] !== false}`)
      .join(' ');
    console.log(`  Uploads:   ${flags}`);
  } else {
    console.log('  Endpoint:  (no config — run ops/setup-sync.sh)');
  }

  // Secret: report only whether one is reachable.
  let hasSecret = Boolean(cfg && cfg.secret);
  let secretFrom = hasSecret ? 'config' : '';
  if (!hasSecret && keychainSecret()) { hasSecret = true; secretFrom = 'keychain'; }
  console.log(`  Secret:    ${hasSecret ? `✓ present (${secretFrom})` : '✗ not found'}`);

  /* Scheduled agent: ask launchctl, don't infer from the plist file. A
     plist that exists but was never loaded is the exact failure mode this
     command is meant to catch — and it is the state of THIS machine. */
  console.log('');
  if (process.platform === 'darwin') {
    let loaded = false;
    let line = '';
    try {
      line = execSync('launchctl list | grep com.antaresyuan.sync-usage || true',
        { shell: '/bin/zsh', stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      loaded = line.length > 0;
    } catch { /* treat as not loaded */ }
    if (loaded) {
      // Columns are: PID  last-exit-status  label
      const [pid, status] = line.split(/\s+/);
      console.log(`  Scheduled: ✓ loaded (pid ${pid === '-' ? 'idle' : pid}, last exit ${status})`);
      if (status && status !== '0') {
        console.log(`             ⚠ last run exited non-zero — see the log`);
      }
    } else if (exists(plist)) {
      console.log('  Scheduled: ⚠ plist present but NOT loaded — run:');
      console.log(`             launchctl load ${plist}`);
    } else {
      console.log('  Scheduled: ✗ not installed — run ops/launchagent/install.sh');
      console.log('             (without it nothing syncs automatically)');
    }
  } else {
    console.log(`  Scheduled: n/a on ${process.platform}`);
  }

  // Last activity, straight from the log tail.
  if (exists(logPath)) {
    let tail = '';
    try {
      const txt = fs.readFileSync(logPath, 'utf8').trimEnd().split('\n');
      tail = txt.slice(-3).join('\n             ');
    } catch { /* unreadable */ }
    const st = fs.statSync(logPath);
    const ageH = (Date.now() - st.mtimeMs) / 3600000;
    console.log('');
    console.log(`  Last log:  ${new Date(st.mtimeMs).toISOString()} (${ageH.toFixed(1)}h ago)`);
    if (ageH > 3) console.log('             ⚠ older than the 1h cadence — sync may be stalled');
    if (tail) console.log(`             ${tail}`);
  }
  console.log('');
}

/* ── doctor ────────────────────────────────────────────────────────────
   Runs the checks that actually predict a broken sync, and exits non-zero
   if any fail, so it can be used as a cron guard rather than only read by
   a human. */
function runDoctor(cfg) {
  const checks = [];
  const add = (ok, label, hint) => checks.push({ ok, label, hint });

  // 0. Config file itself — the most common cause of "nothing happens".
  add(!cfg.__missing, cfg.__missing ? 'config file missing' : 'config file present',
    `expected at ${CONFIG_PATH} — copy scripts/sync-usage.config.example.json`);

  // 1. Transcript dirs present and non-empty.
  for (const src of resolveSources(cfg)) {
    let n = 0;
    if (src.exists) {
      try { n = walkFiles(src.dir, (p) => p.endsWith('.jsonl')).length; } catch { n = 0; }
    }
    add(src.exists && n > 0, `${src.label}: ${src.exists ? `${n} transcripts` : 'dir missing'}`,
      src.exists ? 'directory exists but holds no .jsonl' : `expected at ${src.dir}`);
  }

  // 2. Endpoint reachable, and its public projection parses.
  add(Boolean(cfg.endpoint), 'endpoint configured', 'set "endpoint" in the config file');

  // 3. Secret reachable (presence only).
  let hasSecret = Boolean(cfg.secret);
  if (!hasSecret) hasSecret = Boolean(keychainSecret());
  /* A missing secret is only a fault if this machine actually uploads.
     A local-only install — scanning to keep the menu bar current, never
     publishing — legitimately has no bearer token, and failing it here
     would train the reader to ignore a red doctor. Detect that case from
     the installed agent's own arguments rather than guessing. */
  let localOnlyAgent = false;
  if (process.platform === 'darwin') {
    try {
      const pl = path.join(os.homedir(), 'Library', 'LaunchAgents',
        'com.antaresyuan.sync-usage.plist');
      const body = fs.readFileSync(pl, 'utf8');
      const script = /<string>([^<]*refresh-snapshot[^<]*)<\/string>/.exec(body);
      if (script && fs.existsSync(script[1])) {
        localOnlyAgent = /--local-only/.test(fs.readFileSync(script[1], 'utf8'));
      }
    } catch { /* no agent, or unreadable — treat as an uploading install */ }
  }
  if (localOnlyAgent) {
    add(true, 'upload secret not required (local-only install)', '');
  } else {
    add(hasSecret, 'upload secret reachable', 'add to keychain or config');
  }

  // 4. The scheduled agent is actually loaded — the check this machine fails.
  if (process.platform === 'darwin') {
    let loaded = false;
    try {
      loaded = Boolean(execSync('launchctl list | grep com.antaresyuan.sync-usage || true',
        { shell: '/bin/zsh', stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim());
    } catch { /* not loaded */ }
    add(loaded, 'hourly agent loaded', 'run ops/launchagent/install.sh');
  }

  console.log('sync-usage doctor\n');
  let bad = 0;
  for (const c of checks) {
    console.log(`  ${c.ok ? '✓' : '✗'} ${c.label}`);
    if (!c.ok) { console.log(`      → ${c.hint}`); bad++; }
  }
  console.log(`\n${checks.length - bad}/${checks.length} checks passed\n`);
  return bad === 0 ? 0 : 1;
}

// ── main ──────────────────────────────────────────────────────────
(async () => {
  /* Subcommands are checked before any config is loaded, because `status`
     and `doctor` have to work on a machine where the config is the thing
     that's broken. */
  const sub = args[0] && !args[0].startsWith('-') ? args[0] : '';
  if (sub === 'status') {
    printStatus();
    process.exit(0);
  }
  if (sub === 'help' || args.includes('--help') || args.includes('-h')) {
    console.log(`sync-usage — collect local agent usage and upload it

usage:
  node scripts/sync-usage.js [subcommand] [flags]

subcommands:
  status              where everything lives, and whether the hourly agent
                      is actually loaded (not just installed)
  doctor              run the checks that predict a broken sync; exits
                      non-zero on failure, so it works as a cron guard

flags:
  --dry-run           print what would be POSTed, send nothing
  --stats             local all-time summary, including the tool mix
  --window N          days to upload (1..90, default 14)
  -v, --verbose       per-source detail
`);
    process.exit(0);
  }

  const cfg = loadConfig({ tolerateMissing: sub === 'doctor' });

  if (sub === 'doctor') {
    process.exit(runDoctor(cfg));
  }

  const hostname = resolveHostname(cfg);
  const secret = DRY || STATS || LOCAL_ONLY ? null : loadSecret(cfg);

  log(`device slot: ${hostname}`);
  log('scanning sources …');
  const { days, scanned } = collect(cfg);
  log(`aggregated ${days.size} active days across all sources`);

  if (STATS) {
    printStats(days, hostname, scanned);
    process.exit(0);
  }

  const payloads = payloadsFor(days, hostname, cfg, WINDOW);

  /* Write the local snapshot before uploading, and regardless of whether
     the upload later succeeds.

     Borrowed from kaboo, which caches its scan to menubar_local_usage.json
     as a by-product of the same daemon pass that uploads (daemon.go:1144)
     — one scan, two consumers. That means its menu bar keeps working when
     the network is down or the account is logged out.

     One deliberate difference. kaboo's merge only falls back to the local
     cache when a server field is EMPTY (menubar_local_usage.go:282 —
     `if len(period.MCP) == 0`), because its backend is live and therefore
     authoritative. Ours is not: this site's Worker is deployed by hand and
     currently sits three months behind the machine that produced the data.
     Server-first would mean permanently showing stale numbers, so the
     consumer prefers whichever side is FRESHER — see the menu bar's
     endpoint chain. This file just makes sure a local copy exists at all. */
  writeLocalSnapshot(payloads, hostname);

  if (LOCAL_ONLY) {
    // Print unconditionally: writeLocalSnapshot uses log(), which is quiet
    // in non-verbose runs, and a scheduled job that says nothing is
    // indistinguishable from one that never ran.
    const active = payloads.length;
    const total = payloads.reduce((a, p) => a + (p.tokens || 0), 0);
    console.log(
      `local snapshot updated: ${active} active day(s), ${total.toLocaleString()} tokens → ${LOCAL_SNAPSHOT_PATH}`
    );
    process.exit(0);
  }

  if (DRY) {
    console.log(
      `[dry-run] would POST ${payloads.length} non-empty days to ${cfg.endpoint} as source="${hostname}":`
    );
    for (const p of payloads) {
      const detail = [
        `in=${fmt(p.inputTokens)}`,
        `out=${fmt(p.outputTokens)}`,
        `cacheR=${fmt(p.cachedInputTokens)}`,
        `cacheW=${fmt(p.cacheCreationInputTokens)}`,
        `reason=${fmt(p.reasoningOutputTokens)}`,
        `sess=${p.sessions}`,
        `$${(p.costCents / 100).toFixed(2)}`,
      ].join(' ');
      console.log(`  ${p.date}  ${detail}`);
      if (VERBOSE) console.log('    ' + JSON.stringify(p));
    }
    if (payloads.length === 0) {
      console.log('  (none — no activity in the trailing window)');
    }
    process.exit(0);
  }

  if (payloads.length === 0) {
    log('no non-empty days in the trailing window — nothing to POST');
    process.exit(0);
  }

  let ok = 0,
    fail = 0;
  for (const p of payloads) {
    try {
      const r = await post(cfg.endpoint, secret, p);
      if (r.status === 200) {
        ok++;
        log(
          `  POST ${p.date} ok (${fmt(p.tokens)} tokens, ${p.sessions} sessions, $${(p.costCents / 100).toFixed(2)})`
        );
      } else {
        // Worker error bodies are terse validator strings — never the payload.
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
