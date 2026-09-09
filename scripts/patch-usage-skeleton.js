#!/usr/bin/env node
/* One-off: add the view-tab row, caption line and "full data" link to the
   usage section skeleton in index.html.

   Done with a script rather than an editor because index.html holds the
   pre-rendered 12x7 heatmap as a single ~40k-character line, which makes
   whole-file string tools unreliable here. Anchored on unique markers and
   idempotent — running it twice changes nothing.

   After this, scripts/build-html.js keeps the new nodes in sync (it fills
   them by id, same as usage-stats). */
'use strict';
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'index.html');
let html = fs.readFileSync(file, 'utf8');
const before = html;

// 1. Tab row — sits between the title and the chart wrap.
const titleAnchor = '<h2 class="usage-title">Antares\'s <em>Token Consumption</em></h2>';
if (!html.includes('id="usage-views"')) {
  if (!html.includes(titleAnchor)) {
    console.error('anchor not found: usage-title');
    process.exit(1);
  }
  html = html.replace(
    titleAnchor,
    titleAnchor +
      '\n      <div class="usage-views" id="usage-views" role="group" aria-label="Chart view" hidden></div>'
  );
}

// 2. Caption line — the per-view summary (peak hour, weekly delta; empty for
//    the calendar view). It belongs INSIDE .usage-heatmap-inner, directly
//    after the legend: it describes the chart, so it has to share the chart's
//    width and left edge. Anchored on the stats row it rendered centred and
//    full-bleed while the stats grid drew its own rules, so the line landed
//    on top of them and read as belonging to neither.
if (!html.includes('id="usage-caption"')) {
  const legendClose = '<span>More</span>\n                </div>';
  const i = html.indexOf(legendClose);
  if (i < 0) {
    console.error('anchor not found: legend close (for usage-caption)');
    process.exit(1);
  }
  const at = i + legendClose.length;
  html = html.slice(0, at) +
    '\n          <div class="usage-caption" id="usage-caption" hidden></div>' +
    html.slice(at);
}

// 3. "full data" link into the sub-page, in the flourish row.
const flourishAnchor = '<span class="usage-foot" id="usage-foot">';
if (!html.includes('usage-more-link')) {
  const i = html.indexOf(flourishAnchor);
  if (i < 0) {
    console.error('anchor not found: usage-foot');
    process.exit(1);
  }
  html = html.slice(0, i) +
    '<a class="usage-more-link" href="/usage/">all charts →</a>\n        ' +
    '<span class="usage-stat-sep usage-flourish-sep" aria-hidden="true">·</span>\n        ' +
    html.slice(i);
}

if (html === before) {
  console.log('· index.html already patched — no change');
} else {
  fs.writeFileSync(file, html);
  console.log('✓ patched index.html (view tabs + caption + sub-page link)');
}
