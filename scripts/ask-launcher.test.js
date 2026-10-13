'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));

assert.strictEqual(json('content/strings.json').shell.ask.placeholder, 'Ask Antares anything');
assert.strictEqual(json('content/zh/strings.json').shell.ask.placeholder, 'Ask Antares anything');

const css = read('styles/work.css');
assert.match(css, /\.ask-shell\s*\{[^}]*width:\s*238px;/s,
  'collapsed Ask launcher should fit its content instead of reserving a wide input');
assert.match(css, /\.ask:not\(\.is-open\) \.ask-send\s*\{\s*display:\s*none;/,
  'hidden send button should not reserve space in the collapsed launcher');

console.log('Ask launcher tests passed');
