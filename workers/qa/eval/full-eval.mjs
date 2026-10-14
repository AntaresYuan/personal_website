#!/usr/bin/env node
/* Run every real-model evaluation even when one suite fails, then return one
   combined exit status for CI. An optional first argument overrides the live
   Worker endpoint for both suites. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const endpoint = process.argv[2];
const scripts = [
  new URL('./agent-eval.mjs', import.meta.url),
  new URL('./user-reported-eval.mjs', import.meta.url),
];

let failed = false;
for (const script of scripts) {
  const result = spawnSync(process.execPath, [fileURLToPath(script), ...(endpoint ? [endpoint] : [])], {
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(result.error.message);
    failed = true;
  } else if (result.status !== 0) {
    failed = true;
  }
}

if (failed) process.exitCode = 1;
