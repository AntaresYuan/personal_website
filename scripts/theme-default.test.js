'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const workRuntime = read('scripts/work.js');
assert.match(workRuntime, /\? t : 'auto';/,
  'Work runtime should default to automatic theme selection');
assert.match(workRuntime, /catch \(e\) \{ return 'auto'; \}/,
  'Work runtime should still follow the system when storage is unavailable');

for (const rel of ['index.html', 'scripts/lib/work-shell.js', 'scripts/build-projects.js']) {
  const source = read(rel);
  assert.match(source, /var d = document\.documentElement, m = 'auto';/,
    `${rel} should resolve the initial Work theme from the system`);
  assert.doesNotMatch(source, /var d = document\.documentElement, m = 'dark';/,
    `${rel} must not force dark before the runtime loads`);
}

assert.doesNotMatch(read('index.html'), /else dark/i,
  'Work home documentation should describe the system-following default');

console.log('theme default tests passed');
