#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   build.js — runs every build step in order. Use after editing anything
   in /content (or via /admin/) to keep the static HTML and the agent-
   readable text files in sync with the JSON source of truth.

   Run:  node scripts/build.js
   ════════════════════════════════════════════════════════════════════════ */
require('./build-html');
require('./build-llms');
require('./build-sitemap');
require('./build-agent-brief');
