#!/usr/bin/env node
/* Tests for the workstation probe and the popover's station rendering.
 *
 * The probe shells out to curl / git / gh, so the value of a test here is
 * NOT "does the network work" — it is "does a failing probe stay contained
 * and produce a shape the UI can render". A resident panel that blanks out
 * because one check failed is the actual risk, so most cases below force a
 * failure and assert the rest survives.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

let pass = 0;
const fails = [];
function ok(label, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fails.push(label + (detail ? ` — ${detail}` : '')); console.log('  FAIL ' + label + (detail ? ` — ${detail}` : '')); }
}
const eq = (label, got, want) =>
  ok(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const station = require('./station.js');

(async () => {
  console.log('station probe:');

  // ── usage snapshot reading ────────────────────────────────────────
  // Point at a temp dir with a known snapshot so the assertions are about
  // the maths, not about whatever this machine happens to have scanned.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'station-test-'));
  const snapPath = path.join(tmp, 'usage-snapshot.json');
  fs.writeFileSync(snapPath, JSON.stringify({
    updated: '2026-09-07T00:00:00.000Z',
    days: [
      { date: '2026-08-30', tokens: 100, costCents: 10 },
      { date: '2026-09-01', tokens: 200, costCents: 20 },
      { date: '2026-09-04', tokens: 300, costCents: 30 },
      { date: '2026-09-05', tokens: 0,   costCents: 0 },   // inactive
    ],
  }));
  process.env.ANTARES_USAGE_LOCAL_SNAPSHOT = snapPath;
  const u = station.probeUsage();
  ok('reads a snapshot', u.ok === true);
  eq('counts only active days', u.allActiveDays, 3);
  eq('all-time tokens summed', u.allTokens, 600);
  // Month scoping is by the LATEST ACTIVE day, not by today's wall clock:
  // opening the panel on the 1st of a new month should still describe the
  // month the data is actually in rather than showing an empty current one.
  eq('month derived from latest active day', u.monthLabel, '2026-09');
  eq('month excludes prior month', u.monthTokens, 500);
  eq('month active days', u.monthActiveDays, 2);
  eq('latest day is the last ACTIVE one', u.latestDate, '2026-09-04');

  // The field name must carry the caveat: this figure is API list price,
  // not money charged, because Claude Code here is on a subscription.
  ok('cost field is named as API-equivalent',
    'allApiEquivalentCents' in u && !('allCostCents' in u));

  // ── missing / malformed snapshot ──────────────────────────────────
  process.env.ANTARES_USAGE_LOCAL_SNAPSHOT = path.join(tmp, 'nope.json');
  const missing = station.probeUsage();
  ok('missing snapshot fails soft', missing.ok === false && !!missing.error);

  const badPath = path.join(tmp, 'bad.json');
  fs.writeFileSync(badPath, '{not json');
  process.env.ANTARES_USAGE_LOCAL_SNAPSHOT = badPath;
  ok('malformed snapshot fails soft', station.probeUsage().ok === false);

  const emptyPath = path.join(tmp, 'empty.json');
  fs.writeFileSync(emptyPath, JSON.stringify({ days: [] }));
  process.env.ANTARES_USAGE_LOCAL_SNAPSHOT = emptyPath;
  const empty = station.probeUsage();
  ok('empty snapshot reports empty, not error', empty.ok === true && empty.empty === true);

  // Snapshot with days but all zero tokens — the 41-vs-40 case that
  // actually occurs in this machine's data.
  const zeroPath = path.join(tmp, 'zero.json');
  fs.writeFileSync(zeroPath, JSON.stringify({
    days: [{ date: '2026-08-18', tokens: 0, costCents: 0 }],
  }));
  process.env.ANTARES_USAGE_LOCAL_SNAPSHOT = zeroPath;
  ok('all-zero days count as empty', station.probeUsage().empty === true);

  // ── http probe ────────────────────────────────────────────────────
  const dead = await station.probeHttp('http://127.0.0.1:1/');
  ok('unreachable host reports not-ok', dead.ok === false);
  ok('unreachable host carries a reason', typeof dead.error === 'string');
  ok('unreachable host does not throw', !('code' in dead) || dead.code === undefined);

  // ── git probe ─────────────────────────────────────────────────────
  const g = await station.probeGit();
  ok('git probe returns', g.ok === true, g.error || '');
  ok('dirty count is a number', typeof g.dirty === 'number');
  ok('branch is a string', typeof g.branch === 'string' && g.branch.length > 0);
  // `git rev-list @{u}..` throws without an upstream; null (unknown) is
  // correct there, silently reporting 0 unpushed commits would not be.
  ok('unpushed is a number or null',
    g.unpushed === null || typeof g.unpushed === 'number');

  // ── agents probe ──────────────────────────────────────────────────
  const a = await station.probeAgents();
  ok('agent probe returns', a.ok === true);
  ok('claude is a path or null', a.claude === null || typeof a.claude === 'string');
  ok('codex is a path or null', a.codex === null || typeof a.codex === 'string');
  // Guards the bug where an unresolved `command -v` left every entry null:
  // claude IS installed on this box, so a null here means the probe broke.
  ok('claude detected on this machine', typeof a.claude === 'string' && a.claude.includes('claude'),
    String(a.claude));

  // ── collect() shape ───────────────────────────────────────────────
  delete process.env.ANTARES_USAGE_LOCAL_SNAPSHOT;
  const all = await station.collect();
  for (const k of ['site', 'worker', 'git', 'ci', 'usage', 'agents']) {
    ok(`collect includes ${k}`, all[k] && typeof all[k] === 'object');
  }
  ok('collect reports elapsed', typeof all.elapsedMs === 'number');
  ok('collect output is JSON-serialisable', (() => {
    try { JSON.parse(JSON.stringify(all)); return true; } catch { return false; }
  })());

  // ── popover render contract ───────────────────────────────────────
  // The page and the host agree on action names by string. A rename on one
  // side alone silently produces a dead button, so assert both directions.
  console.log('popover wiring:');
  const html = fs.readFileSync(path.join(__dirname, 'popover.html'), 'utf8');
  const swift = fs.readFileSync(path.join(__dirname, 'popover.swift'), 'utf8');

  const sent = new Set();
  for (const m of html.matchAll(/act\('([a-z_]+)'\)/g)) sent.add(m[1]);
  for (const m of html.matchAll(/send\(\{\s*action:\s*'([a-z_]+)'/g)) sent.add(m[1]);
  /* The status rows pass their action through row()'s parameter, so the
     literal never appears inside an act('…') call and the scan above
     misses it. Listing them explicitly is the point: these four were in
     fact wired, but the scan reported "all handled" without ever checking
     them — a green result covering nothing is worse than a red one. */
  for (const a of ['open_site_row', 'open_worker', 'open_repo', 'open_ci']) {
    ok(`page can emit "${a}"`, html.includes(`'${a}'`));
    sent.add(a);
  }
  ok('page emits actions', sent.size >= 9, [...sent].join(','));

  for (const a of sent) {
    ok(`host handles "${a}"`, swift.includes(`case "${a}"`), 'no case in popover.swift');
  }

  // The station rows must not reuse the footer's action name: both would
  // fire "open usage page" and the site row would go to the wrong place.
  ok('site row uses its own action', html.includes('open_site_row'));
  ok('footer keeps open_site', html.includes("action:'open_site'"));

  // Async arrival: the probe lands seconds after first paint, so the page
  // must cache the usage payload to re-render with.
  ok('page caches payload for re-render', /__lastData\s*=\s*json/.test(html));
  ok('re-render calls the real entry point', html.includes('window.__render(window.__lastData)'));
  ok('host has a station channel', swift.includes('func pushStation'));
  ok('station flushed once page loads', /pendingStation\s*\{\s*pushStation/.test(swift.replace(/\s+/g, ' ')) ||
    swift.includes('if let st = pendingStation { pushStation(st) }'));

  // Cost labelling — the figure is modelled, not billed.
  ok('all-time cost is labelled API-equiv', html.includes('API-equiv'));

  /* Failure must be VISIBLE. The station block shipped with only two
     states — "checking…" and populated — so a stale binary left the panel
     spinning forever with no way to tell "working on it" from "never
     going to finish". That is exactly how this bug reached the user. */
  ok('page has an error state', html.includes('window.stationError'));
  ok('error state is rendered, not just stored', html.includes('__error'));
  ok('host can report failure', swift.includes('func stationFailed'));
  // The fast failures (missing script, no node) fire BEFORE didFinish, so
  // an unqueued error message is dropped precisely when it matters most.
  ok('failure is queued until the page loads', swift.includes('pendingStationError'));
  ok('queued failure is flushed on load',
    swift.includes('else if let e = pendingStationError { stationFailed(e) }'));
  // Every silent `return` in runStation is a permanent "checking…".
  const bar = fs.readFileSync(path.join(__dirname, 'usagebar.swift'), 'utf8');
  const runStation = bar.slice(bar.indexOf('private func runStation'),
                               bar.indexOf('@objc private func runSync'));
  const silentReturns = (runStation.match(/else \{ return \}|\s+return\s*$/gm) || []).length;
  ok('runStation reports every failure path',
    runStation.includes('node not found') &&
    runStation.includes('probe missing') &&
    runStation.includes('probe exited') &&
    runStation.includes('probe returned nothing'),
    `${silentReturns} bare returns`);

  /* Long reasons carry absolute paths. A grid item defaults to
     min-width:auto and refuses to shrink below its content, so the row
     grew to 487px inside a 380px panel and spilled past the edge —
     measured, not guessed. */
  ok('error row can shrink below content width',
    html.includes('minmax(0,1fr)') && html.includes('min-width:0'));
  ok('error detail ellipsises', html.includes('text-overflow:ellipsis'));

  /* REACHABILITY. Every assertion above passed while the feature was dead
     code: runStation() was hung off a pushToPopover() helper that no real
     path called, so the app never probed at all — and --popover, being a
     separate process with its own wiring, rendered perfectly the whole
     time. Testing that a function is correct is worthless if nothing
     calls it, so assert the call graph, not just the definitions. */
  const callsRunStation = bar.split('\n').filter((l) => {
    const t = l.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false;
    // Both `runStation()` and `self.runStation()` are real calls; an
    // earlier version of this regex only accepted `self?.` and under-counted,
    // reporting a wiring bug that did not exist.
    return /^(self\??\.)?runStation\(\)/.test(t);
  }).length;
  ok('runStation is actually called', callsRunStation > 0, `${callsRunStation} call sites`);

  // Each place the popover is handed usage data must also kick the probe,
  // otherwise the panel populates on one code path and hangs on another.
  const pushSites = (bar.match(/popover\?\.push\(/g) || []).length;
  ok('every push site has a matching probe kick', callsRunStation >= pushSites,
    `${pushSites} push sites vs ${callsRunStation} runStation calls`);

  // The dead wrapper must stay gone.
  ok('no unreachable push helper', !bar.includes('private func pushToPopover'));

  /* ── compact usage table ──────────────────────────────────────────
     The panel spent ~700 of 850px on usage detail; it is now one table
     of three windows. Guard the properties that made the old layout
     unreadable so they cannot creep back. */
  ok('usage is a table', html.includes('table class="usage"'));
  ok('four windows', ["'today'", "'7 days'", "'30 days'", "'all time'"]
    .every((l) => html.includes(l)));

  /* all-time must cover EVERY row, not a large day count. A magic 36500
     looks equivalent today and silently starts truncating the moment the
     record outgrows it, at which point the row is quietly no longer
     "all time" and nothing reports that it changed meaning. */
  ok('all time is unbounded', html.includes('days: null')
    && html.includes('n === null ? days :'));

  // Platform order keys off the all-time row. Indexing windows[2] tied the
  // sort to a row POSITION, so inserting a row silently re-sorted columns.
  ok('platform order keys off all-time', html.includes('allTime.per[b]')
    && !html.includes('windows[2].per'));

  // The cumulative row is not a fourth rolling period.
  ok('all-time row is set apart', html.includes("w.key === 'all' ? 'total' : ''")
    && /tr\.total th/.test(html));

  // It moved out of the caption when it became a row; leaving both would
  // print the same pair of figures twice, three lines apart.
  ok('all-time not duplicated in caption', !html.includes("API-equiv all time"));

  /* "today" must mean today. Anchoring the windows on the last ACTIVE day
     made an idle stretch reprint a stale figure in the today row: after
     three quiet days it still showed the last working day's tokens, and
     nothing on the panel said the number was three days old. */
  ok('windows anchor on the document date',
    html.includes("d.updated ? Date.parse(String(d.updated).slice(0, 10)")
    && html.includes('Number.isFinite(stamp)'));
  ok('anchor falls back when undated', html.includes("Date.parse(latest.date + 'T00:00:00Z')"));
  ok('figures are tabular-lining', html.includes('font-variant-numeric: tabular-nums'));

  // Windows are date-anchored; slice(-N) counts rows, which on a sparse
  // snapshot silently spans far more calendar days than asked for.
  /* Scan CODE only: the comment above the window helper cites slice(-7)
     as the bug it exists to prevent, and a naive whole-file scan flags
     that explanation as the defect it warns about. */
  // Strip /* */ blocks wholesale rather than line-prefix filtering: this
  // file's block comments wrap onto continuation lines that begin with a
  // bare word, so a per-line filter leaves most of the prose behind.
  const codeLines = html.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  ok('windows anchor on dates',
    html.includes('anchor - n * dayMs') && !/slice\(-\d+\)/.test(codeLines));

  // A lone platform column would restate the tokens column verbatim.
  ok('single platform hides the split', html.includes('allPlatforms.length > 1 ? allPlatforms : []'));
  ok('single platform is still named', html.includes('all via ${allPlatforms[0]}'));

  // Days predating bySource must read "—", not a fabricated zero.
  ok('missing split renders em dash', html.includes("!w.hasSplit) return '<td class=\"n dim\">—</td>'"));

  // .cap was styled only as `.spark .cap`; deleting the sparkline left it
  // inheriting body type as a 3-line block above the footer.
  ok('.cap has standalone styling', /^\s*\.cap \{/m.test(html));

  // Header says "workstation" already; the status block must not repeat it.
  ok('status block can drop its heading', html.includes('renderStation({ heading: false })'));

  // Removed views must not leave dead code behind.
  for (const gone of ['function spark(', 'function donut(', '.hero {', '.card {'])
    ok(`removed: ${gone.trim()}`, !html.includes(gone));

  // The snapshot writer must persist the split, or the table has nothing
  // to break down and every platform cell falls back to "—".
  const sync = fs.readFileSync(path.join(__dirname, '../../scripts/sync-usage.js'), 'utf8');
  ok('snapshot persists bySource', sync.includes('if (p.bySource) d.bySource = p.bySource;'));


  /* ── audience + features ─────────────────────────────────────────────
     These two probes hit the network, so the assertions are about SHAPE
     and about not lying when things go wrong — a probe that reports
     "0 visitors" when it actually failed is worse than one that says it
     failed, because zero is a plausible number for a personal site. */
  {
    const a = await station.probeAudience();
    ok('audience answers with ok:boolean', typeof a.ok === 'boolean',
      JSON.stringify(a).slice(0, 90));
    if (a.ok) {
      // visits and views must BOTH be present: they answer different
      // questions and the popover labels them separately.
      ok('audience carries visits and views',
        Number.isFinite(a.visits) && Number.isFinite(a.views),
        JSON.stringify(a));
      ok('audience states its window', a.days === 7, String(a.days));
      // Pageviews cannot be fewer than visits; if they are, the two
      // fields got swapped somewhere.
      ok('views >= visits (else fields are swapped)', a.views >= a.visits,
        `views ${a.views} visits ${a.visits}`);
      ok('audience counts are non-negative', a.visits >= 0 && a.views >= 0);
    } else {
      ok('failed audience explains itself', !!a.error, JSON.stringify(a));
      // The crucial one: a failure must NOT look like a real zero.
      ok('failed audience reports no counts',
        a.visits === undefined && a.views === undefined, JSON.stringify(a));
    }

    const f = await station.probeFeatures();
    ok('features answers with ok:boolean', typeof f.ok === 'boolean',
      JSON.stringify(f).slice(0, 90));
    if (f.ok) {
      ok('features totals are numeric',
        Number.isFinite(f.total) && Number.isFinite(f.cmdTotal) &&
        Number.isFinite(f.chartTotal), JSON.stringify(f));
      ok('features states its window', f.days > 0 && f.days <= 90, String(f.days));
      // Zero activity is a legitimate answer, not an error state.
      ok('empty counters still report ok', f.total !== 0 || f.ok === true);
      // A top skin can only exist if at least one skin was counted.
      ok('topSkin implies skinCount', !f.topSkin || f.skinCount > 0,
        JSON.stringify({ t: f.topSkin, c: f.skinCount }));
      ok('unanswered never exceeds total qa', f.qaUnanswered <= f.qaTotal,
        `${f.qaUnanswered} of ${f.qaTotal}`);
    } else {
      ok('failed features explains itself', !!f.error, JSON.stringify(f));
    }

    /* Failure paths, forced rather than hoped for. Without injection these
       never run here (wrangler is logged in), so the mutation "return
       zeros instead of an error" passed the whole suite unnoticed. */
    const noTok = await station.probeAudience({ token: null });
    ok('no token → reports failure, not zero visitors',
      noTok.ok === false && noTok.visits === undefined, JSON.stringify(noTok));
    ok('no token → names the fix', /wrangler login/.test(noTok.error || ''),
      noTok.error);
    /* An expired token recovers instead of showing an error. wrangler's OAuth
       token lasts about an hour, so within two hours of logging in this row
       was reading "Authentication error" rather than the visitor count. It
       must self-heal via wrangler's stored refresh token. */
    const stale = await station.probeAudience({ token: 'expired-looking-token' });
    ok('an expired token self-heals into real numbers',
      stale.ok === true && Number.isFinite(stale.visits),
      JSON.stringify(stale).slice(0, 100));
    // …but the retry must be bounded, or a revoked login loops forever.
    const noRetry = await station.probeAudience({ token: 'bad', retry: true });
    ok('retry is bounded — a second failure gives up',
      noRetry.ok === false, JSON.stringify(noRetry).slice(0, 90));

    const badTok = await station.probeAudience({ token: 'not-a-real-token' });
    /* With auto-refresh in place a bad token may legitimately RECOVER, so
       demanding failure here would now be wrong. The invariant that actually
       matters is unchanged: never present a broken probe as a real zero. */
    ok('rejected token never reports a fake zero',
      badTok.ok === true ? Number.isFinite(badTok.visits)
                         : badTok.visits === undefined && !!badTok.error,
      JSON.stringify(badTok).slice(0, 100));

    // The GraphQL dataset is account-scoped; a zone-scoped query fails with
    // "unknown field", which looks like a permission error and is not one.
    // Pin the shape so a future edit cannot quietly reintroduce that.
    const src = fs.readFileSync(path.join(__dirname, 'station.js'), 'utf8');
    ok('RUM query is account-scoped, not zone-scoped',
      /accounts\(filter:\{accountTag/.test(src) && !/zones\(filter:\{zoneTag/.test(src));
    ok('audience asks for both count and visits',
      /count\s+sum\{visits\}/.test(src));
    // run() resolves {ok,stdout,…} and never rejects: reading it as a
    // string yields `"[object Object]" is not valid JSON`, which a
    // try/catch then reports as the error instead of the real cause.
    ok('probes read run().stdout, not the result object',
      !/JSON\.parse\(\s*out\s*\)/.test(src));
    ok('probes check run().ok before parsing',
      (src.match(/if \(!r\.ok\) return \{ ok: false/g) || []).length >= 2);
    // GraphQL returns HTTP 200 with an errors array; ignoring it would
    // surface as zero visitors rather than as a failure.
    ok('graphql errors array is checked', /j\.errors && j\.errors\.length/.test(src));
    ok('account id is discovered, not only hardcoded',
      /account_id\\s\*=/.test(src) || /account_id\s*=/.test(src));

    // The popover must not colour a missing wrangler login red: it is a
    // normal state on a fresh machine, not a fault in the site.
    const pop = fs.readFileSync(path.join(__dirname, 'popover.html'), 'utf8');
    ok('missing login is not rendered as a fault',
      /wrangler login/.test(pop) && /login \? '' : 'bad'/.test(pop));
    ok('zero feature activity is not rendered as a fault',
      /no activity/.test(pop) && !/row\('bad', 'features', `no activity/.test(pop));
    ok('visitors row is rendered', /'visitors'/.test(pop));
    ok('visitors row shows views alongside visits', /views · \$\{au\.days\}d/.test(pop));
    // A clickable row needs a handler, or clicking it silently does nothing.
    const sw = fs.readFileSync(path.join(__dirname, 'popover.swift'), 'utf8');
    ok('open_analytics has a Swift handler', /case "open_analytics":/.test(sw));
    ok('analytics link targets this zone, not the account root',
      /antaresyuan\.site\/analytics\/web/.test(sw));
  }


  console.log('');
  if (fails.length) {
    console.log(`station: ${pass} passed, ${fails.length} failed`);
    process.exit(1);
  }
  console.log(`station: ${pass} passed, 0 failed`);
})();
