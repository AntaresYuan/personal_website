#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   Tests for the usage DISPLAY layer (scripts/render.js).

   The Worker tests cover the wire contract; these cover the arithmetic the
   visitor actually reads in the stats row. Both matter: a correct payload
   rendered wrong is still wrong on the page.

   Focus: the "N/7 days active" counter.

   Why this file exists — the original implementation was
   `cells.slice(-7).filter(...)`. buildHeatmapGrid fills the grid COLUMN-major
   (col outer, row inner), so the last 7 array entries are the last COLUMN —
   the current week's Sun..Sat, including empty placeholders for days that
   haven't happened yet. Rendered on a Monday with near-daily activity that
   printed "1/7 days active" directly beneath a heatmap full of colour.

   render.js is a browser IIFE, not a module, so rather than import it we
   re-implement the two pure functions under test and assert the invariant
   they must satisfy. The grid builder is copied verbatim from render.js so a
   change in fill order breaks these tests too.

   Run via `npm test` from the repo root.
   ════════════════════════════════════════════════════════════════════════ */

'use strict';

const HEATMAP_COLS = 12;
const HEATMAP_ROWS = 7;

let passed = 0;
let failed = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}\n      got  ${g}\n      want ${w}`);
  }
}

// ── verbatim from scripts/render.js ───────────────────────────────────
const buildHeatmapGrid = (days, todayUTC) => {
  const todayDow = new Date(todayUTC + 'T00:00:00Z').getUTCDay();
  const todayMs = new Date(todayUTC + 'T00:00:00Z').getTime();
  const byDate = new Map();
  for (const d of days) byDate.set(d.date, d);
  const cells = [];
  for (let col = 0; col < HEATMAP_COLS; col++) {
    for (let row = 0; row < HEATMAP_ROWS; row++) {
      const weeksBack = HEATMAP_COLS - 1 - col;
      const daysAgo = todayDow - row + 7 * weeksBack;
      if (daysAgo < 0) {
        cells.push({ col, row, tokens: 0, sessions: 0, costCents: 0, date: '' });
        continue;
      }
      const date = new Date(todayMs - daysAgo * 86400000).toISOString().slice(0, 10);
      const e = byDate.get(date) || { date, tokens: 0, sessions: 0, costCents: 0 };
      cells.push({ col, row, ...e });
    }
  }
  return cells;
};

// ── the counter under test (mirrors render.js) ────────────────────────
const last7ActiveOf = (cells) => {
  const dated = cells.filter(c => c.date);
  let newest = '';
  for (const c of dated) if (c.date > newest) newest = c.date;
  if (!newest) return 0;
  const cutoffMs = new Date(newest + 'T00:00:00Z').getTime() - 6 * 86400000;
  const seen = new Set();
  for (const c of dated) {
    if (c.tokens > 0 && new Date(c.date + 'T00:00:00Z').getTime() >= cutoffMs) {
      seen.add(c.date);
    }
  }
  return seen.size;
};

// The pre-fix implementation, kept so the regression stays visible.
const last7ActiveBuggy = (cells) => cells.slice(-7).filter(c => c.tokens > 0).length;

// ── helpers ──────────────────────────────────────────────────────────
const daysBack = (todayUTC, n) => {
  const base = new Date(todayUTC + 'T00:00:00Z').getTime();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(base - i * 86400000).toISOString().slice(0, 10));
  }
  return out;
};
const activeEvery = (todayUTC, n, tokens = 1000) =>
  daysBack(todayUTC, n).map(date => ({ date, tokens, sessions: 1, costCents: 10 }));

function main() {
  console.log('days-active counter — every weekday of the week');
  {
    // Walk all seven weekdays: the answer must be 7 regardless of which day
    // "today" lands on. This is exactly what the column-major bug got wrong.
    const mondayThroughSunday = [
      '2026-08-31', // Mon
      '2026-09-01', // Tue
      '2026-09-02', // Wed
      '2026-09-03', // Thu
      '2026-09-04', // Fri
      '2026-09-05', // Sat
      '2026-09-06', // Sun
    ];
    for (const today of mondayThroughSunday) {
      const dow = new Date(today + 'T00:00:00Z').toUTCString().slice(0, 3);
      const cells = buildHeatmapGrid(activeEvery(today, 84), today);
      eq(`${today} (${dow}) → 7/7 when active daily`, last7ActiveOf(cells), 7);
    }
  }

  console.log('\nthe bug this replaced');
  {
    const monday = '2026-08-31';
    const cells = buildHeatmapGrid(activeEvery(monday, 84), monday);
    // Row 0 of the grid is Sunday, so on a Monday the final column holds
    // just Sun + Mon as real dates and 5 future placeholders — the old
    // implementation therefore reported 2/7 while every one of the last
    // seven days actually had activity.
    eq('old slice(-7) undercounted on a Monday', last7ActiveBuggy(cells), 2);
    eq('fixed version reports the truth', last7ActiveOf(cells), 7);
  }
  {
    // The undercount is worst right after the week rolls over: on a Sunday
    // the last column has exactly one real date.
    const sunday = '2026-09-06';
    const cells = buildHeatmapGrid(activeEvery(sunday, 84), sunday);
    eq('old slice(-7) reported 1/7 on a Sunday', last7ActiveBuggy(cells), 1);
    eq('fixed version still reports 7', last7ActiveOf(cells), 7);
  }

  console.log('\npartial and sparse activity');
  {
    const today = '2026-09-02';   // Wednesday
    // Active on 3 of the last 7 days, plus older activity that must NOT count.
    const recent = daysBack(today, 7).slice(0, 3);
    const older = daysBack(today, 30).slice(0, 10);
    const days = [
      ...recent.map(date => ({ date, tokens: 500, sessions: 1, costCents: 5 })),
      ...older.map(date => ({ date, tokens: 900, sessions: 1, costCents: 9 })),
    ];
    const cells = buildHeatmapGrid(days, today);
    eq('counts only the trailing 7 days', last7ActiveOf(cells), 3);
  }
  {
    const today = '2026-09-02';
    const cells = buildHeatmapGrid([], today);
    eq('no data → 0', last7ActiveOf(cells), 0);
  }
  {
    const today = '2026-09-02';
    // Zero-token days are present in the grid but must not count as active.
    const days = daysBack(today, 7).map(date => ({ date, tokens: 0, sessions: 0, costCents: 0 }));
    const cells = buildHeatmapGrid(days, today);
    eq('zero-token days are not active', last7ActiveOf(cells), 0);
  }
  {
    const today = '2026-09-02';
    const days = [{ date: today, tokens: 10, sessions: 1, costCents: 1 }];
    const cells = buildHeatmapGrid(days, today);
    eq('single active day → 1', last7ActiveOf(cells), 1);
  }
  {
    // Exactly on the boundary: the 7th day back counts, the 8th does not.
    const today = '2026-09-02';
    const seventh = daysBack(today, 7)[0];
    const eighth = daysBack(today, 8)[0];
    eq('7th day back is inside the window',
       last7ActiveOf(buildHeatmapGrid([{ date: seventh, tokens: 5, sessions: 1, costCents: 1 }], today)),
       1);
    eq('8th day back is outside the window',
       last7ActiveOf(buildHeatmapGrid([{ date: eighth, tokens: 5, sessions: 1, costCents: 1 }], today)),
       0);
  }

  console.log('\nplaceholder cells');
  {
    // Future days in the current week carry date:'' — they must never be
    // counted, and must not break the "newest date" scan.
    const today = '2026-08-31';   // Monday → 6 placeholders in the last column
    const cells = buildHeatmapGrid(activeEvery(today, 84), today);
    const placeholders = cells.filter(c => !c.date).length;
    eq('grid has placeholder cells for future days', placeholders > 0, true);
    eq('placeholders excluded from the count', last7ActiveOf(cells), 7);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
