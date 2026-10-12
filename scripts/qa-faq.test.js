const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync('scripts/qa-faq-data.js', 'utf8'), context);
vm.runInNewContext(fs.readFileSync('scripts/qa-faq.js', 'utf8'), context);

const { FAQ, starters, match } = context.window.QA;
assert.ok(FAQ.length >= 3);
assert.deepEqual(Array.from(starters(3), (f) => f.q), [
  'are you looking for a job / open to roles?',
  'walk me through your most mature project.',
  'what are you building right now?',
]);
assert.match(match('介绍一下你最成熟的项目。').answer, /Agentic Hiring/);
assert.equal(match('walk me through your most mature project.').href, '/projects/agentic-hiring/');

console.log('qa FAQ browser data tests passed');
