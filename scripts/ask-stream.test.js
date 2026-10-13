/* Offline tests for the Ask Antares NDJSON reader. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({ window: {}, TextDecoder });
vm.runInContext(fs.readFileSync('scripts/ask-stream.js', 'utf8'), context);
const stream = context.window.ASK_STREAM;

const encode = new TextEncoder();
const chunks = [
  '{"type":"meta","traceId":"AQ-1","via":"local","model":"qwen","resources":[]',
  '}\n{"type":"delta","text":"你',
  '好"}\n{"type":"delta","text":" world"}\n',
  '{"type":"done","traceId":"AQ-1","via":"local","model":"qwen"}\n',
].map((value) => encode.encode(value));
let index = 0;
const response = {
  headers: { get: () => 'application/x-ndjson; charset=utf-8' },
  body: { getReader: () => ({ read: async () => index < chunks.length ? { value: chunks[index++], done: false } : { done: true } }) },
};

(async () => {
  const types = [];
  const result = await stream.consume(response, (event) => types.push(event.type));
  assert.deepEqual(types, ['meta', 'delta', 'delta', 'done']);
  assert.equal(result.answer, '你好 world');
  assert.equal(result.traceId, 'AQ-1');
  assert.equal(result.via, 'local');
  assert.equal(result.model, 'qwen');
  assert.equal(stream.isStreaming({ headers: { get: () => 'application/json' }, body: {} }), false);
  console.log('ask stream: 6 passed, 0 failed');
})().catch((error) => { console.error(error); process.exit(1); });
