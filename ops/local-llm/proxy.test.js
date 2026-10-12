/* The local-llm proxy against a fake Ollama: only /chat and /health get
   through, input is bounded, and a second request while one is running is
   turned away with 503 rather than queued. */
'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const { createProxy } = require('./proxy');

let release;
const seen = [];
const ollama = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    const body = JSON.parse(b);
    seen.push({ url: req.url, body });
    const answer = () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ message: { content: ' Hello from Qwen. ' } })); };
    if (body.messages[0].content === 'slow') release = answer; else answer();
  });
});

(async () => {
  await new Promise((r) => ollama.listen(0, '127.0.0.1', r));
  const proxy = createProxy({ ollamaUrl: `http://127.0.0.1:${ollama.address().port}`, model: 'test-model', log: () => {} });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${proxy.address().port}`;
  const post = (body, path = '/chat') => fetch(base + path, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

  let pass = 0, fail = 0;
  const t = async (name, fn) => { try { await fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}\n  ${e.message}`); } };

  await t('answers through Ollama with the configured model', async () => {
    const r = await post({ messages: [{ role: 'user', content: 'hi' }], max_tokens: 5000, temperature: 3 });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { answer: 'Hello from Qwen.', model: 'test-model' });
    const sent = seen.at(-1);
    assert.equal(sent.url, '/api/chat');
    assert.equal(sent.body.model, 'test-model');
    assert.equal(sent.body.stream, false);
    assert.equal(sent.body.options.num_predict, 900);    // capped
    assert.equal(sent.body.options.temperature, 1);      // clamped
  });
  await t('health', async () => {
    assert.deepEqual(await (await fetch(base + '/health')).json(), { ok: true, model: 'test-model' });
  });
  await t('nothing else of Ollama is reachable', async () => {
    for (const p of ['/api/pull', '/api/delete', '/api/chat', '/']) assert.equal((await post({}, p)).status, 404, p);
    assert.equal((await fetch(base + '/chat')).status, 405);
  });
  await t('input is checked', async () => {
    assert.equal((await post('not json')).status, 400);
    assert.equal((await post({ messages: [] })).status, 400);
    assert.equal((await post({ messages: [{ role: 'tool', content: 'x' }] })).status, 400);
    assert.equal((await post({ messages: [{ role: 'user', content: 'x'.repeat(30001) }] })).status, 400);
    assert.equal((await post({ messages: Array(25).fill({ role: 'user', content: 'x' }) })).status, 400);
    assert.equal((await post('x'.repeat(300 * 1024))).status, 413);
  });
  await t('one answer at a time: a second request gets 503', async () => {
    const first = post({ messages: [{ role: 'user', content: 'slow' }] });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal((await post({ messages: [{ role: 'user', content: 'hi' }] })).status, 503);
    release();
    assert.equal((await first).status, 200);
    assert.equal((await post({ messages: [{ role: 'user', content: 'hi' }] })).status, 200);
  });

  console.log(`local-llm proxy: ${pass} passed, ${fail} failed`);
  proxy.close(); ollama.close();
  if (fail) process.exit(1);
})();
