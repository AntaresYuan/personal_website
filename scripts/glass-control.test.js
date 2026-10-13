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
for (const token of [
  '--glass-bg-alpha', '--glass-blur', '--glass-panel-blur', '--glass-sat',
  '--glass-rim-opacity', '--glass-chroma-opacity', '--glass-glare-idle',
  '--glass-shadow-alpha', '--glass-inner-alpha'
]) {
  assert.ok(runtime.includes(token), `${token} should respond to the control`);
}
assert.match(runtime, /amount \* amount \* \(3 - \(2 \* amount\)\)/,
  'The material should use a perceptual curve rather than an imperceptible linear fade');
assert.match(runtime, /mixGlass\(0\.94, 0\.035, liquid\)/,
  'The subtle and liquid endpoints should have visibly different transmission');

assert.match(css, /\.glass-control-panel/);
assert.match(css, /\.glass-control-range::-webkit-slider-thumb/);
assert.match(css, /var\(--glass-bg-alpha/,
  'Glass surfaces should consume the dynamic alpha token');
assert.match(css, /var\(--glass-lens-sat/,
  'Refractive surfaces should consume the dynamic lens token');
assert.match(css, /var\(--glass-chroma-opacity/,
  'Liquid surfaces should gain a chromatic refractive edge');
assert.match(css, /var\(--glass-shadow-alpha/,
  'Liquid surfaces should gain depth as the material increases');

console.log('Liquid Glass control tests passed');
