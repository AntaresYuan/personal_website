#!/usr/bin/env node
/* Workstation status probe.
 *
 * Answers "what state is my site in right now?" — the things a resident
 * menu bar helper should surface without being asked: is the site up, is
 * there uncommitted work, did the last build pass, how much did today
 * cost.
 *
 * Deliberately a separate process from the Swift app:
 *   - the checks are I/O bound and independent, so they run concurrently
 *     here and the app just waits on one JSON blob;
 *   - `gh` and `git` are far easier to drive from node than from Swift;
 *   - it is runnable by hand (`node station.js`) which makes the data
 *     verifiable without launching a GUI. Every diagnostic mode in this
 *     project that grew its own private data path eventually lied to me,
 *     so the app and the CLI read the exact same function here.
 *
 * Every probe is individually fallible: a failing check reports
 * `{ok:false, error}` and never takes the others down with it. A resident
 * status panel that goes blank because one network call timed out is
 * worse than one that shows four greens and one grey.
 */
'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const SITE = 'https://antaresyuan.site/';
const WORKER = 'https://usage.antaresyuan.site/';

/* Wall-clock budget per probe. The panel is opened by a human waiting on
   it, so a slow probe must yield rather than hold the whole render.

   Measured on this machine over repeated runs, antaresyuan.site answers
   in 0.8-1.6s typically but occasionally takes >5s — an earlier 5s cap
   turned that ordinary jitter into a red "unreachable", which is a lie
   about the site. The curl cap is therefore 8s, and execFile gets a
   slightly longer leash so the timeout that fires is curl's own (which
   still prints a usable exit status) rather than a SIGTERM. */
/* Cloudflare account that owns the zone. Read from wrangler's config
   when present so a re-login to a different account cannot silently
   point this at someone else's numbers; the literal is only a fallback
   for a machine that has never run `wrangler login`. */
const CF_ACCOUNT = (() => {
  for (const f of [
    path.join(os.homedir(), 'Library/Preferences/.wrangler/config/default.toml'),
    path.join(os.homedir(), '.wrangler/config/default.toml'),
  ]) {
    try {
      const m = /account_id\s*=\s*"([0-9a-f]{32})"/.exec(fs.readFileSync(f, 'utf8'));
      if (m) return m[1];
    } catch (_) { /* next */ }
  }
  return '0b6cc86868178d20228e20ff3836d5f4';
})();

const CURL_MAX_S = 8;
const TIMEOUT_MS = 10000;

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd: opts.cwd || REPO, timeout: opts.timeout || TIMEOUT_MS, maxBuffer: 1 << 22 },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          code: err ? (err.code ?? 1) : 0,
          stdout: (stdout || '').toString(),
          stderr: (stderr || '').toString(),
          error: err ? String(err.message || err).split('\n')[0] : null,
        });
      }
    );
  });
}

/* ── site reachability ──────────────────────────────────────────────
   curl rather than fetch(): it reports connect-vs-TLS-vs-HTTP failures
   distinctly and honours a hard timeout, and this box already depends on
   it elsewhere. We want the status code AND the latency — a site that
   answers 200 in 9s is a different problem from one that 502s fast. */
async function probeHttp(url) {
  const r = await run(
    'curl',
    ['-s', '-o', '/dev/null', '-w', '%{http_code} %{time_total}', '--max-time', String(CURL_MAX_S), url],
    { cwd: os.tmpdir() }
  );
  if (!r.ok) return { ok: false, error: 'unreachable' };
  const [codeStr, timeStr] = r.stdout.trim().split(/\s+/);
  const code = parseInt(codeStr, 10);
  const ms = Math.round(parseFloat(timeStr) * 1000);
  if (!Number.isFinite(code) || code === 0) return { ok: false, error: 'unreachable' };
  // A reachable-but-slow site is not the same as a down one; report both
  // so the UI can show amber rather than red.
  return { ok: code >= 200 && code < 400, code, ms, slow: ms > 3000 };
}

/* ── git working tree ───────────────────────────────────────────────
   `--porcelain` is the stable machine format; the human-facing `git
   status` wording changes between versions. Counting staged and unstaged
   separately would over-report a file that is both, so we count LINES,
   which is one per path regardless of how many ways it changed. */
async function probeGit() {
  const [status, branch, last, ahead] = await Promise.all([
    run('git', ['status', '--porcelain']),
    run('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
    run('git', ['log', '-1', '--format=%h|%s|%cI']),
    run('git', ['rev-list', '--count', '@{u}..HEAD']),
  ]);
  if (!status.ok) return { ok: false, error: 'not a git repo' };

  const lines = status.stdout.split('\n').filter((l) => l.trim());
  const [hash, subject, when] = (last.stdout.trim() || '||').split('|');
  return {
    ok: true,
    dirty: lines.length,
    branch: branch.stdout.trim() || '?',
    // `git rev-list @{u}..` fails when there is no upstream; treat that
    // as "unknown" (null) rather than as zero unpushed commits.
    unpushed: ahead.ok ? parseInt(ahead.stdout.trim(), 10) || 0 : null,
    lastCommit: hash ? { hash, subject: (subject || '').slice(0, 72), when } : null,
  };
}

/* ── latest CI run ──────────────────────────────────────────────────
   Requires `gh` to be installed AND authenticated. Both failures look
   identical to a caller that only checks the exit code, so we surface a
   distinct reason: "gh missing" is a setup task, "not authenticated" is
   a one-command fix, and a red run is actual news. */
async function probeCI() {
  const r = await run('gh', [
    'run', 'list', '--limit', '1',
    '--json', 'status,conclusion,name,createdAt,url,headBranch',
  ]);
  if (!r.ok) {
    const why = /not found|ENOENT/i.test(r.error || '') ? 'gh not installed'
      : /auth|login/i.test(r.stderr) ? 'gh not authenticated'
      : 'unavailable';
    return { ok: false, error: why };
  }
  let arr;
  try { arr = JSON.parse(r.stdout); } catch { return { ok: false, error: 'bad json' }; }
  if (!Array.isArray(arr) || !arr.length) return { ok: true, empty: true };
  const run0 = arr[0];
  return {
    ok: true,
    status: run0.status,
    conclusion: run0.conclusion,
    name: run0.name,
    branch: run0.headBranch,
    at: run0.createdAt,
    url: run0.url,
  };
}

/* ── usage snapshot ─────────────────────────────────────────────────
   Reads the same local snapshot the menu bar uses, so the panel can show
   today/this-month without a second scan of 499 transcripts.

   On the money: costCents here is a MODELLED figure — tokens multiplied
   by public API list prices. This machine authenticates Claude Code with
   an OAuth subscription (billingType "stripe_subscription"), so no
   per-call charge is actually incurred. Presenting it as money spent
   would be wrong, which is why the field is named `apiEquivalentCents`
   and the UI labels it "API-equiv". */
function probeUsage() {
  const p = process.env.ANTARES_USAGE_LOCAL_SNAPSHOT
    || path.join(
      process.env.ANTARES_USAGE_STATE_DIR || path.join(os.homedir(), '.local', 'share', 'antares-usage'),
      'usage-snapshot.json'
    );
  let doc;
  try { doc = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {
    return { ok: false, error: 'no local snapshot' };
  }
  const days = Array.isArray(doc.days) ? doc.days : [];
  const active = days.filter((d) => (d.tokens || 0) > 0);
  if (!active.length) return { ok: true, empty: true, updated: doc.updated || '' };

  const last = active[active.length - 1];
  const month = last.date.slice(0, 7);
  const inMonth = active.filter((d) => d.date.startsWith(month));

  const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  return {
    ok: true,
    updated: doc.updated || '',
    latestDate: last.date,
    latestTokens: last.tokens || 0,
    latestApiEquivalentCents: last.costCents || 0,
    monthLabel: month,
    monthTokens: sum(inMonth, 'tokens'),
    monthApiEquivalentCents: sum(inMonth, 'costCents'),
    monthActiveDays: inMonth.length,
    allActiveDays: active.length,
    allTokens: sum(active, 'tokens'),
    allApiEquivalentCents: sum(active, 'costCents'),
  };
}

/* ── which agent CLIs can take an escalation ────────────────────────
   The menu offers "Ask Claude" only when claude is actually on PATH.
   Offering an action that cannot run is worse than not offering it, and
   codex is genuinely absent on this machine despite appearing in the
   transcript history (used elsewhere), so this must be detected rather
   than assumed. */
async function probeAgents() {
  /* `which`, not `command -v`: the latter is a shell builtin and execFile
     spawns without a shell. */
  const names = ['claude', 'codex'];
  const results = await Promise.all(
    names.map((n) => run('which', [n], { cwd: os.tmpdir(), timeout: 2000 }))
  );
  const found = {};
  names.forEach((n, i) => {
    found[n] = results[i].ok ? results[i].stdout.trim().split('\n')[0] : null;
  });
  return { ok: true, claude: found.claude, codex: found.codex };
}

/* ── audience: real visitors, from Cloudflare ────────────────────────
   Visits and pageviews come from Cloudflare Web Analytics, not from our
   own beacon. Cloudflare injects its RUM script AT THE EDGE on this zone,
   so it sees every visit including ones that never run our JS, and it
   de-duplicates a visit properly — something our beacon deliberately
   cannot do, because it stores no identifier of any kind.

   Two things about this query cost time to find out:
     - the dataset is ACCOUNT-scoped (`AccountRumPageloadEvents…`), not
       zone-scoped. Querying it under `viewer.zones` fails with "unknown
       field", which reads like a permissions problem and is not one.
     - `sum{visits}` and `count` are different numbers: count is
       pageviews, visits is sessions. Reporting either as "visitors"
       would be wrong, so both are carried through and labelled.

   Auth reuses wrangler's own OAuth token from its config file. That is
   deliberate: the alternative is a second long-lived API token pasted
   into this repo's config, and a token on disk that nothing rotates is
   worse than reading the one the user already refreshes by logging in.
   No token → this probe reports unavailable, like any other probe. */
function wranglerToken() {
  const spots = [
    path.join(os.homedir(), 'Library/Preferences/.wrangler/config/default.toml'),
    path.join(os.homedir(), '.wrangler/config/default.toml'),
  ];
  for (const f of spots) {
    try {
      const m = /oauth_token\s*=\s*"([^"]+)"/.exec(fs.readFileSync(f, 'utf8'));
      if (m && m[1]) return m[1];
    } catch (_) { /* try the next location */ }
  }
  return null;
}

/* opts.token exists purely so the failure paths are testable. On this
   machine wrangler is always logged in, so the no-token and bad-token
   branches never execute during a normal run — and those are exactly the
   branches that must not report "0 visitors", since zero is a believable
   number for a personal site and would hide a broken probe forever. */
async function probeAudience(opts = {}) {
  const token = 'token' in opts ? opts.token : wranglerToken();
  if (!token) return { ok: false, error: 'no wrangler login' };
  const since = new Date(Date.now() - 7 * 86400000).toISOString().replace(/\.\d+Z$/, 'Z');
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const query = `query($acc:String!,$since:Time!,$now:Time!){viewer{accounts(filter:{accountTag:$acc}){
    rumPageloadEventsAdaptiveGroups(limit:1,filter:{datetime_geq:$since,datetime_leq:$now}){
      count sum{visits}}}}}`;
  const body = JSON.stringify({ query, variables: { acc: CF_ACCOUNT, since, now } });
  /* run() resolves with {ok, stdout, …} and never rejects — it does not
     return a bare string. Passing the object straight to JSON.parse
     produced `"[object Object]" is not valid JSON`, and because the call
     sat inside a try/catch the real curl failure was replaced by that
     nonsense message. Read .stdout, and check .ok first. */
  const r = await run('curl', [
    '-s', '--max-time', String(CURL_MAX_S),
    'https://api.cloudflare.com/client/v4/graphql',
    '-H', 'Authorization: Bearer ' + token,
    '-H', 'Content-Type: application/json',
    '--data', body,
  ]);
  if (!r.ok) return { ok: false, error: (r.error || 'curl failed').slice(0, 60) };
  try {
    const j = JSON.parse(r.stdout);
    // GraphQL answers 200 with an errors array; a bare try/catch around
    // JSON.parse would treat that as success and report zero visitors.
    if (j.errors && j.errors.length) {
      const msg = String(j.errors[0].message);
      /* wrangler's OAuth token lives about an hour, so "Authentication
         error" is the NORMAL state most of the time, not a fault — the row
         was showing it instead of the visitor count within two hours of
         logging in. wrangler refreshes the token from its stored refresh
         token on any command, so spend one cheap invocation and retry once.
         Bounded by `retry` so a genuinely revoked login cannot loop. */
      if (/auth/i.test(msg) && !opts.retry) {
        const refreshed = await run('npx', ['wrangler', 'whoami'],
          { cwd: path.join(REPO, 'workers/usage'), timeout: 25000 });
        if (refreshed.ok) {
          const tok = wranglerToken();
          // Only retry if the token actually changed; otherwise the refresh
          // silently failed and retrying would just repeat the same error.
          if (tok && tok !== token) return probeAudience({ token: tok, retry: true });
        }
        return { ok: false, error: 'auth expired — run: wrangler login' };
      }
      return { ok: false, error: msg.slice(0, 60) };
    }
    const rows = j?.data?.viewer?.accounts?.[0]?.rumPageloadEventsAdaptiveGroups || [];
    if (!rows.length) return { ok: true, visits: 0, views: 0, days: 7, empty: true };
    return {
      ok: true, days: 7,
      visits: Number(rows[0]?.sum?.visits) || 0,
      views: Number(rows[0]?.count) || 0,
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 60) };
  }
}

/* ── features: which parts of the site got touched ──────────────────
   Our own counters (GET /beacon). This answers what Cloudflare cannot:
   whether anyone picks a skin, runs a terminal command or opens a chart.
   Empty is a normal state, not an error — it means nobody has touched a
   counted feature in the window, which is itself the answer. */
async function probeFeatures() {
  const r = await run('curl', [
    '-s', '--max-time', String(CURL_MAX_S),
    '-H', 'origin: ' + SITE.replace(/\/$/, ''),
    WORKER.replace(/\/$/, '') + '/beacon?days=30',
  ]);
  if (!r.ok) return { ok: false, error: (r.error || 'curl failed').slice(0, 60) };
  try {
    const j = JSON.parse(r.stdout);
    const counts = (j && j.counts) || {};
    const of = (prefix) => Object.entries(counts)
      .filter(([k]) => k.startsWith(prefix + ':'))
      .map(([k, v]) => [k.slice(prefix.length + 1), Number(v) || 0])
      .sort((a, b) => b[1] - a[1]);
    const skins = of('skin_pick');
    const cmds = of('terminal_cmd');
    const charts = of('chart_open');
    const qa = of('qa_ask');
    return {
      ok: true, days: j.days || 30,
      total: Object.values(counts).reduce((a, v) => a + (Number(v) || 0), 0),
      topSkin: skins[0] ? { name: skins[0][0], n: skins[0][1] } : null,
      skinCount: skins.length,
      cmdTotal: cmds.reduce((a, x) => a + x[1], 0),
      topCmd: cmds[0] ? { name: cmds[0][0], n: cmds[0][1] } : null,
      chartTotal: charts.reduce((a, x) => a + x[1], 0),
      // Unanswered questions are the one counter that names a concrete
      // next action, so it is surfaced separately rather than summed.
      qaUnanswered: (qa.find(([k]) => k === 'unanswered') || [null, 0])[1],
      qaTotal: qa.reduce((a, x) => a + x[1], 0),
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 60) };
  }
}

async function collect() {
  const started = Date.now();
  const [site, worker, git, ci, agents, audience, features] = await Promise.all([
    probeHttp(SITE),
    probeHttp(WORKER),
    probeGit(),
    probeCI(),
    probeAgents(),
    probeAudience(),
    probeFeatures(),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    repo: REPO,
    site,
    worker,
    git,
    ci,
    usage: probeUsage(),
    agents,
    audience,
    features,
  };
}

if (require.main === module) {
  const pretty = process.argv.includes('--pretty');
  collect()
    .then((d) => {
      process.stdout.write(JSON.stringify(d, null, pretty ? 2 : 0) + '\n');
    })
    .catch((e) => {
      process.stdout.write(JSON.stringify({ error: String(e && e.message || e) }) + '\n');
      process.exit(1);
    });
}

module.exports = { collect, probeHttp, probeGit, probeCI, probeUsage, probeAgents,
  probeAudience, probeFeatures, wranglerToken, CF_ACCOUNT };
