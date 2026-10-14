#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const data = new Map();
const storage = {
  getItem: (key) => data.has(key) ? data.get(key) : null,
  setItem: (key, value) => data.set(key, String(value)),
  removeItem: (key) => data.delete(key),
};
const context = { window: { localStorage: storage }, Date };
vm.createContext(context);
vm.runInContext(fs.readFileSync('scripts/ask-history.js', 'utf8'), context);

const history = context.window.ASK_HISTORY;
const now = 1_800_000_000_000;

assert.equal(history.ttl, 60 * 60 * 1000);
assert.equal(history.key, 'antares.ask.history.v2');
assert.equal(history.load(storage, now), null);

history.save([
  { role: 'user', content: '  Tell me about Kaboo  ' },
  { role: 'assistant', content: 'Kaboo is…', via: 'tool', model: 'get_token_usage', traceId: 'AQ-20261013-ABC12345', resources: [
    { kind: 'pdf', title: 'Résumé', url: '/media/resume(test file).pdf', description: 'English PDF', typeLabel: 'PDF' },
    { kind: 'link', title: 'unsafe', url: 'javascript:alert(1)' },
  ], ui: [{
    version: 1, id: 'AQ-20261013-ABC12345-UI1', type: 'choice', title: 'Choose one',
    options: [{ id: 'en', label: 'English' }, { id: 'zh', label: 'Chinese' }],
    submitted: true, summary: 'English',
  }] },
], storage, now);
assert.deepEqual(JSON.parse(JSON.stringify(history.load(storage, now + history.ttl - 1).messages)), [
  { role: 'user', content: 'Tell me about Kaboo' },
  { role: 'assistant', content: 'Kaboo is…', via: 'tool', model: 'get_token_usage', traceId: 'AQ-20261013-ABC12345', resources: [
    { kind: 'pdf', title: 'Résumé', url: '/media/resume%28test%20file%29.pdf', description: 'English PDF', typeLabel: 'PDF' },
  ], ui: [{
    version: 1, id: 'AQ-20261013-ABC12345-UI1', type: 'choice', title: 'Choose one',
    options: [{ id: 'en', label: 'English' }, { id: 'zh', label: 'Chinese' }],
    submitted: true, summary: 'English',
  }] },
]);

assert.equal(history.load(storage, now + history.ttl), null, 'history expires after one hour');
assert.equal(storage.getItem(history.key), null, 'expired history is removed');

storage.setItem(history.key, '{broken');
assert.equal(history.load(storage, now), null, 'malformed history fails closed');
assert.equal(storage.getItem(history.key), null, 'malformed history self-heals');

const many = Array.from({ length: 45 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
history.save(many, storage, now);
assert.equal(history.load(storage, now).messages.length, 40, 'cache is bounded');
assert.equal(history.load(storage, now).messages[0].content, 'm5', 'oldest messages are discarded first');

history.clear(storage);
assert.equal(history.load(storage, now), null);

const work = fs.readFileSync('scripts/work.js', 'utf8');
assert.match(work, /openCachedHistory/);
assert.match(work, /historyCache\.save\(convo\)/);
assert.match(work, /historyCache\.clear\(\)/);

console.log('Ask history cache tests passed');
