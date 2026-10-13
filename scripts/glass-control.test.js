#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (rel) => fs.readFileSync(rel, 'utf8');
const shell = read('scripts/lib/work-shell.js');
const runtime = read('scripts/work.js');
const css = read('styles/work.css');
const en = JSON.parse(read('content/strings.json'));
const zh = JSON.parse(read('content/zh/strings.json'));

for (const [lang, strings] of [['English', en], ['Chinese', zh]]) {
  assert.ok(strings.shell.glass?.aria, `${lang} should label the Liquid Glass control`);
  assert.ok(strings.shell.glass?.low, `${lang} should label the subtle end of the scale`);
  assert.ok(strings.shell.glass?.high, `${lang} should label the liquid end of the scale`);
}

assert.match(shell, /id="glass-control-trigger"/);
assert.match(shell, /id="glass-control-range"/);
assert.match(shell, /id="glass-control-output"/);

assert.match(runtime, /GLASS_KEY = 'antares\.glass'/,
  'Liquid Glass preference should persist separately from colour theme');
assert.match(runtime, /GLASS_DEFAULT = 80/,
  'The default should favor a distinctly liquid material');
assert.match(runtime, /glassRange\.addEventListener\('input'/,
  'The material should update while the slider is dragged');
for (const token of ['--glass-bg-alpha', '--glass-blur', '--glass-sat', '--glass-rim-opacity', '--glass-glare-idle']) {
  assert.ok(runtime.includes(token), `${token} should respond to the control`);
}

assert.match(css, /\.glass-control-panel/);
assert.match(css, /\.glass-control-range::-webkit-slider-thumb/);
assert.match(css, /var\(--glass-bg-alpha/,
  'Glass surfaces should consume the dynamic alpha token');
assert.match(css, /var\(--glass-lens-sat/,
  'Refractive surfaces should consume the dynamic lens token');

console.log('Liquid Glass control tests passed');
