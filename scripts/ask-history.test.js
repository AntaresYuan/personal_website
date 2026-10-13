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
assert.equal(history.load(storage, now), null);

history.save([
  { role: 'user', content: '  Tell me about Kaboo  ' },
  { role: 'assistant', content: 'Kaboo is…', via: 'local', model: 'qwen', resources: [
    { kind: 'pdf', title: 'Résumé', url: '/media/resume.pdf', description: 'English PDF', typeLabel: 'PDF' },
    { kind: 'link', title: 'unsafe', url: 'javascript:alert(1)' },
  ] },
], storage, now);
assert.deepEqual(JSON.parse(JSON.stringify(history.load(storage, now + history.ttl - 1).messages)), [
  { role: 'user', content: 'Tell me about Kaboo' },
  { role: 'assistant', content: 'Kaboo is…', via: 'local', model: 'qwen', resources: [
    { kind: 'pdf', title: 'Résumé', url: '/media/resume.pdf', description: 'English PDF', typeLabel: 'PDF' },
  ] },
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
