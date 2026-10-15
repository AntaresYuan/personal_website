/* Every owner-reported bad case is a permanent deterministic contract.
   This fast suite runs without a model: it checks the fallback route, exact
   resource cards, and the passages that must ground the answer. The weekly
   live eval checks the same cases against the real agent and models. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normTurns, replyLang } from '../src/lib.js';
import { routeQuestion, planFor } from '../src/skills.js';
import { cardsFor } from '../src/index.js';

const root = new URL('../../../', import.meta.url);
const index = JSON.parse(fs.readFileSync(new URL('ask-index.json', root), 'utf8'));
const fixture = JSON.parse(fs.readFileSync(new URL('user-reported-cases.json', import.meta.url), 'utf8'));

assert.equal(fixture.schemaVersion, 2, 'unsupported bad-case schema');
assert.ok(Array.isArray(fixture.cases) && fixture.cases.length, 'bad-case dataset is empty');
assert.equal(new Set(fixture.cases.map((item) => item.id)).size, fixture.cases.length, 'report ids must be unique');

let passed = 0;
let openPassed = 0;
const failures = [];
const knownFailures = [];
for (const item of fixture.cases) {
  try {
    assert.match(item.id, /^(?:AQ-\d{8}-[A-F0-9]{8}|REPORTED-\d{8}-[A-Z0-9-]+)$/, 'invalid report id');
    assert.ok(item.title && item.regression, 'title and regression are required');
    const status = item.status || 'fixed';
    assert.ok(status === 'fixed' || status === 'open', `unsupported status ${status}`);
    assert.ok(Array.isArray(item.fixedBy), 'fixedBy must be an array');
    if (status === 'fixed') assert.ok(item.fixedBy.length, 'a fixed case must name its fixing commit');
    if (item.performance) {
      for (const key of ['maxDurationMs', 'maxFirstTokenMs']) {
        if (item.performance[key] != null) assert.ok(Number.isFinite(item.performance[key]) && item.performance[key] > 0, `${key} must be positive`);
      }
    }
    for (const pattern of item.expected.answerMatchesAll || []) assert.doesNotThrow(() => new RegExp(pattern, 'u'), `invalid answer pattern ${pattern}`);
    const turns = normTurns({ messages: item.messages });
    assert.equal(turns.length, item.messages.length, 'messages must alternate and end with the visitor');
    const current = turns.at(-1).content;
    const lang = replyLang(current, item.lang);
    const route = routeQuestion({ turns, index });
    const plan = planFor(route, index);
    const cards = cardsFor(index, route, current, lang);
    const tools = [
      ...(cards.length ? ['find_resources'] : []),
      ...(plan.site ? ['search_work'] : []),
      ...(route.skill === 'token-usage' ? ['get_token_usage'] : []),
    ];
    const urls = cards.map((card) => card.url);

    const allowedSkills = item.expected.skillsAllowed || [item.expected.skill];
    assert.ok(allowedSkills.includes(route.skill), `skill ${route.skill} (${route.reason}); expected ${allowedSkills.join(' or ')}`);
    for (const tool of item.expected.toolsInclude || []) assert.ok(tools.includes(tool), `missing tool ${tool}; got ${tools.join(', ') || 'none'}`);
    for (const url of item.expected.resourceUrlsInclude || []) assert.ok(urls.includes(url), `missing resource ${url}; got ${urls.join(', ') || 'none'}`);
    for (const url of item.expected.resourceUrlsExclude || []) assert.ok(!urls.includes(url), `unexpected resource ${url}`);
    if (item.expected.resourcesMax != null) assert.ok(cards.length <= item.expected.resourcesMax, `too many resources: ${cards.length}`);
    if (item.expected.toolsMax != null) assert.ok(tools.length <= item.expected.toolsMax, `too many tools: ${tools.join(', ') || 'none'}`);
    for (const prefix of item.expected.passagePrefixesInclude || []) {
      assert.ok(plan.must.some((id) => id === prefix || id.startsWith(`${prefix}-`) || id.startsWith(`${prefix}#`)), `missing required passage ${prefix}; got ${plan.must.join(', ') || 'none'}`);
    }
    if (status === 'open') openPassed++;
    else passed++;
  } catch (error) {
    const line = `  ${item.id} ${item.title}: ${error.message}`;
    if ((item.status || 'fixed') === 'open') knownFailures.push(line);
    else failures.push(line);
  }
}

const fixedCount = fixture.cases.filter((item) => (item.status || 'fixed') === 'fixed').length;
const openCount = fixture.cases.length - fixedCount;
console.log(`user-reported regressions: fixed ${passed}/${fixedCount} passed; open ${openPassed}/${openCount} already pass offline`);
if (knownFailures.length) {
  console.log('known open bad cases:');
  console.log(knownFailures.join('\n'));
}
if (failures.length) {
  console.log('fixed-case regressions:');
  console.log(failures.join('\n'));
  process.exit(1);
}
