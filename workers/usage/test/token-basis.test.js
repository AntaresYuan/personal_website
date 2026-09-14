#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   Tests for the headline token basis.

   The site, the menu bar and the CLI must agree on one number. They used to
   disagree with kaboo by 2.3x because they summed input+output while kaboo's
   cli/export_cmd.go sums five categories including cache reads. kaboo's own
   migration 000006 calls the narrow basis a bug: it "understated reality by
   5-100x" while the cost column kept climbing.

   The subtle half is the fallback. 40 days of KV rows were written by the v1
   CLI on the old laptop (2026-05-01..06-20) with no detail block at all:
   totalTokens is 0 while `tokens` holds a real input+output figure. Reading
   totalTokens blindly would render those days as zero -- the chart would look
   fine and be wrong, which is the worst failure mode available here. Those
   transcripts no longer exist on any machine, so the number cannot be
   recomputed; the fallback is the only way to keep that history.

   Unlike render-stats.test.js, these do NOT re-implement the functions:
   each is extracted from the real source file, so editing the source is what
   these assertions actually exercise.
   ════════════════════════════════════════════════════════════════════════ */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('  ✗    ' + name + '\n       ' + e.message); fail++; }
}

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* Pull a `const NAME = (args) => {...};` arrow function out of a browser IIFE
   and make it callable. Throws loudly if the function is renamed or removed,
   which is the point: a silent skip would let the basis regress unnoticed. */
function extractArrow(src, name, file) {
  const start = src.indexOf(`const ${name} = (`);
  assert.ok(start !== -1, `${name} not found in ${file} — renamed or deleted?`);
  let i = src.indexOf('{', start);
  assert.ok(i !== -1, `no body for ${name}`);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  const body = src.slice(start, i + 1);
  // eslint-disable-next-line no-new-func
  return new Function(`${body}; return ${name};`)();
}

console.log('\ntoken basis');

/* ── the shared helper in the aggregate lib ───────────────────────────── */
const { headlineTokens, isLegacyBasis } = require(
  path.join(ROOT, 'scripts', 'lib', 'usage-aggregate.js'));

t('v2 row uses totalTokens (kaboo basis)', () => {
  assert.strictEqual(headlineTokens({
    tokens: 1000, totalTokens: 5000,
    inputTokens: 600, outputTokens: 400, cachedInputTokens: 4000,
  }), 5000);
});

t('v1 row falls back to tokens, not zero', () => {
  // The exact shape of the 40 old-laptop rows.
  assert.strictEqual(headlineTokens({ date: '2026-05-01', tokens: 154058, totalTokens: 0 }), 154058);
});

t('v1 row is flagged as legacy basis', () => {
  assert.strictEqual(isLegacyBasis({ tokens: 154058, totalTokens: 0 }), true);
  assert.strictEqual(isLegacyBasis({ tokens: 1000, totalTokens: 5000 }), false);
});

t('empty day is zero, not NaN', () => {
  assert.strictEqual(headlineTokens({ date: '2025-09-15', tokens: 0, totalTokens: 0 }), 0);
  assert.strictEqual(headlineTokens({}), 0);
  assert.strictEqual(headlineTokens(null), 0);
});

t('derives from input+output when both totals are absent', () => {
  assert.strictEqual(headlineTokens({ inputTokens: 60, outputTokens: 40 }), 100);
});

t('never returns less than the legacy figure it replaces', () => {
  // Guards the direction of the change: the new basis is a superset, so for
  // any row it must be >= what the page used to show.
  const rows = [
    { tokens: 154058, totalTokens: 0 },
    { tokens: 1000, totalTokens: 5000 },
    { tokens: 0, totalTokens: 0 },
    { tokens: 77, totalTokens: 77 },
  ];
  for (const r of rows) {
    assert.ok(headlineTokens(r) >= (r.tokens || 0),
      `regressed for ${JSON.stringify(r)}`);
  }
});

/* ── render.js (homepage, build-time) ─────────────────────────────────── */
const renderSrc = read('scripts/render.js');
const cellTokens = extractArrow(renderSrc, 'cellTokens', 'scripts/render.js');

t('render.js cellTokens matches the shared helper', () => {
  const rows = [
    { tokens: 154058, totalTokens: 0 },
    { tokens: 1000, totalTokens: 5000 },
    { tokens: 0, totalTokens: 0 },
  ];
  for (const r of rows) {
    assert.strictEqual(cellTokens(r), headlineTokens(r),
      `homepage disagrees with the shared basis on ${JSON.stringify(r)}`);
  }
});

t('render.js heatmap colours by the headline basis', () => {
  // The quartile ramp and the printed number must describe one quantity.
  assert.ok(/cells\.map\(cellTokens\)/.test(renderSrc),
    'heatmap still bins on raw .tokens — the colours would contradict the total');
  assert.ok(/quartileBin\(cellTokens\(cellData\)/.test(renderSrc),
    'per-cell bin still uses raw .tokens');
});

t('render.js trend sums the headline basis', () => {
  assert.ok(/w\.total \+= cellTokens\(cell\)/.test(renderSrc),
    'trend still adds raw totalTokens — v1-only weeks would collapse to zero');
});

t('render.js headline is no longer input+output', () => {
  assert.ok(/push\(\s*'tokens',/.test(renderSrc), "the headline stat should be labelled 'tokens'");
  assert.ok(/'tokens billed'/.test(renderSrc),
    'the billed figure should remain available as a secondary line');
});

/* ── usage-page.js (the /usage/ sub-page, runtime) ────────────────────── */
const pageSrc = read('scripts/usage-page.js');
const dayTokens = extractArrow(pageSrc, 'dayTokens', 'scripts/usage-page.js');

t('usage-page dayTokens matches the shared helper', () => {
  const rows = [
    { tokens: 154058, totalTokens: 0 },
    { tokens: 1000, totalTokens: 5000 },
    { tokens: 0, totalTokens: 0 },
    {},
  ];
  for (const r of rows) {
    assert.strictEqual(dayTokens(r), headlineTokens(r),
      `usage page disagrees on ${JSON.stringify(r)}`);
  }
});

t('usage-page has no raw (d.tokens || 0) basis left', () => {
  assert.ok(!/filter\(\(d\) => \(d\.tokens \|\| 0\) > 0\)/.test(pageSrc),
    'an active-day filter still uses the narrow basis');
  assert.ok(!/bins\(activeDays\.map\(\(d\) => d\.tokens \|\| 0\)\)/.test(pageSrc),
    'the calendar still bins on the narrow basis');
});

/* ── the menu bar popover ─────────────────────────────────────────────── */
for (const f of ['ops/menubar/popover.html',
                 'ops/menubar/usagebar.app/Contents/Resources/popover.html']) {
  const src = read(f);
  const label = f.includes('.app/') ? 'popover (bundled copy)' : 'popover (source)';
  const pop = extractArrow(src, 'dayTokens', f);
  const slot = extractArrow(src, 'slotTokens', f);

  t(`${label}: dayTokens matches the shared helper`, () => {
    for (const r of [{ tokens: 154058, totalTokens: 0 },
                     { tokens: 1000, totalTokens: 5000 },
                     { tokens: 0, totalTokens: 0 }]) {
      assert.strictEqual(pop(r), headlineTokens(r), JSON.stringify(r));
    }
  });

  t(`${label}: per-platform split uses the slot's own total`, () => {
    assert.strictEqual(slot({ inputTokens: 60, outputTokens: 40, totalTokens: 5000 }), 5000);
    // A v1 slot has no totalTokens; it must still report its real figure.
    assert.strictEqual(slot({ inputTokens: 60, outputTokens: 40 }), 100);
    assert.strictEqual(slot(null), 0);
  });

  t(`${label}: day total no longer reads raw .tokens`, () => {
    assert.ok(!/tok \+= Number\(x\.tokens\) \|\| 0/.test(src),
      'the window total still uses the narrow basis');
  });
}

/* The bundled copy is what actually runs when the app is launched; a stale
   copy would show different numbers from the source and from the site. */
t('the bundled popover is in sync with the source', () => {
  const a = read('ops/menubar/popover.html');
  const b = read('ops/menubar/usagebar.app/Contents/Resources/popover.html');
  assert.strictEqual(a, b,
    'ops/menubar/popover.html and the copy inside usagebar.app have diverged — rerun ./bundle.sh');
});

console.log(`\ntoken-basis: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
