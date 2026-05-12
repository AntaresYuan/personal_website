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

  require('./build-html');
  require('./build-blog');
  require('./build-llms');
  require('./build-sitemap');
  require('./build-agent-brief');
})().catch((e) => { console.error('[build]', e); process.exitCode = 1; });
