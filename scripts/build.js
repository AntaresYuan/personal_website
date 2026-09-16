#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   build.js — runs every build step in order. Use after editing anything
   in /content (or via /admin/) to keep the static HTML and the agent-
   readable text files in sync with the JSON source of truth.

   Run:  node scripts/build.js
   ════════════════════════════════════════════════════════════════════════ */
'use strict';
(async () => {
  // OG share cards first — so build-blog can point each post's <og:image> at
  // the PNG it produced. Best-effort: it never throws, and even if it somehow
  // did we swallow it — a missing OG card must NOT fail the build (this script
  // is also a deploy build command, so a non-zero exit here breaks the site).
  try { await require('./build-og')(); } catch (e) { console.log('  (OG cards skipped: ' + ((e && e.message) || e) + ')'); }

  // Skin character art, baked from DiceBear into a plain JS file so the
  // site keeps zero runtime dependencies and makes no third-party calls.
  // Best-effort for the same reason as the OG cards: @dicebear is a
  // devDependency, the generated file is committed, and someone building
  // from a fresh clone without dev deps must still get a working site.
  try { require('./gen-characters'); } catch (e) { console.log('  (characters skipped: ' + ((e && e.message) || e) + ')'); }

  /* build-html.js still owns the shared pieces other builders read; the Work
     page itself is now generated wholesale by build-work-page.js below. */
  require('./build-html');
  require('./build-blog');
  /* After build-html: it rewrites index.html in place, and the personal space
     is derived from the finished file. */
  require('./build-spaces');
  /* After build-spaces: Personal is built from its own template and must be
     written before index.html is overwritten with the one-screen CV. */
  require('./build-work-page');
  require('./build-work');
  // /usage/ — the full dashboard. After build-html so the homepage skeleton
  // (and its "all charts →" link) is already in place.
  require('./build-usage-page');
  require('./build-llms');
  require('./build-sitemap');
  require('./build-agent-brief');
  require('./build-glyphs');
})().catch((e) => { console.error('[build]', e); process.exitCode = 1; });
