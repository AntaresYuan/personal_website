#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   selftest.js — runs the menu bar app's own --check suite from `npm test`.

   The Swift binary has an internal assertion suite (formatters, title
   budget, JSON tolerance) but nothing invoked it outside build.sh, so a
   regression could sit in the repo unnoticed. This adapter runs it if the
   binary exists and skips cleanly when it doesn't — the site must stay
   testable on a machine with no Swift toolchain, and on CI, which has no
   business building a macOS app.
   ════════════════════════════════════════════════════════════════════════ */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BIN = path.join(__dirname, 'usagebar');

if (!fs.existsSync(BIN)) {
  console.log('menubar: skipped (not built — run ops/menubar/build.sh)');
  process.exit(0);
}

// Staleness check: a binary older than its source means --check is
// validating code that is no longer what the repo contains, which is worse
// than not running it, because it passes.
const src = path.join(__dirname, 'usagebar.swift');
if (fs.existsSync(src)) {
  const binAge = fs.statSync(BIN).mtimeMs;
  const srcAge = fs.statSync(src).mtimeMs;
  if (srcAge > binAge) {
    console.log('menubar: ✗ binary is older than usagebar.swift — rebuild with ops/menubar/build.sh');
    process.exit(1);
  }
}

let out;
try {
  out = execFileSync(BIN, ['--check'], { encoding: 'utf8', timeout: 30000 });
} catch (err) {
  console.log('menubar: ✗ --check failed');
  process.stdout.write((err.stdout || '') + (err.stderr || ''));
  process.exit(1);
}

// Report in the same shape as the other suites rather than dumping output.
// The Swift suite prints one "ok <label>" line per assertion and a final
// "all checks passed"; count the lines rather than parse a total it does
// not print. (Assuming a "N passed" summary is exactly the kind of guess
// that makes a green test meaningless.)
const okCount = (out.match(/^\s*ok\s/gm) || []).length;
const failLines = (out.match(/^\s*FAIL\s.*$/gm) || []);

if (failLines.length > 0) {
  console.log(`menubar: ${okCount} passed, ${failLines.length} failed`);
  failLines.forEach((l) => console.log('  ' + l.trim()));
  process.exit(1);
}
if (!/all checks passed/.test(out) || okCount === 0) {
  // Unrecognised output — show it rather than claiming success.
  console.log('menubar: --check ran but did not report success:');
  process.stdout.write(out);
  process.exit(1);
}
console.log(`menubar: ${okCount} passed, 0 failed`);
