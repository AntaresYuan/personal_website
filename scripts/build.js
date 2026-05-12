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
  // the PNG it produced. (Async, and a no-op if @resvg/resvg-wasm isn't
  // installed — the rest of the build still runs.)
  try { await require('./build-og')(); }
  catch (e) { console.error('  (OG cards failed:', (e && e.message) || e, '— continuing)'); process.exitCode = 1; }

  require('./build-html');
  require('./build-blog');
  require('./build-llms');
  require('./build-sitemap');
  require('./build-agent-brief');
})();
