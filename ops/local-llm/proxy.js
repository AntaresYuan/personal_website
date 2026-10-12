#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   ops/local-llm/proxy.js — the narrow door between the internet and Ollama.

   The qa Worker reaches Antares's Mac through a Cloudflare Tunnel guarded by
   an Access service token; the tunnel points here, not at Ollama, because
   Ollama's own API can also pull, copy and delete models. This proxy lets
   exactly one thing through:

     POST /chat    { messages: [{role, content}], max_tokens?, temperature? }
                   → { answer, model }   ·   503 when already answering one
     GET  /health  → { ok, model }

   One answer at a time: a second visitor gets 503 at once and the Worker
   answers them from the cloud, instead of queueing behind a long reply.
   Nothing about a conversation is logged — only status and duration.

   Settings (environment): PORT (11435), OLLAMA_URL (http://127.0.0.1:11434),
   LLM_MODEL (qwen3.5:4b), NUM_CTX (16384), KEEP_ALIVE (30m).
   Zero dependencies. ops/local-llm/install.sh runs it at login.
   ════════════════════════════════════════════════════════════════════════ */
'use strict';
const http = require('node:http');

const LIMITS = { body: 256 * 1024, messages: 24, content: 30000, total: 120000, tokens: 900 };
const ROLES = new Set(['system', 'user', 'assistant']);

function validate(body) {
  if (!body || !Array.isArray(body.messages)) return 'messages must be an array';
  const m = body.messages;
  if (!m.length || m.length > LIMITS.messages) return `1–${LIMITS.messages} messages`;
  let total = 0;
  for (const x of m) {
    if (!x || !ROLES.has(x.role) || typeof x.content !== 'string') return 'each message needs a role and text content';
    if (x.content.length > LIMITS.content) return 'a message is too long';
    total += x.content.length;
  }
  if (total > LIMITS.total) return 'the conversation is too long';
  return null;
}

function createProxy(opts = {}) {
  const ollama = (opts.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const model = opts.model || 'qwen3.5:4b';
  const numCtx = Number(opts.numCtx) || 16384;
  const keepAlive = opts.keepAlive || '30m';
  const log = opts.log || ((line) => console.log(line));
  let busy = false;

  const send = (res, status, obj) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(obj));
  };

  async function chat(body) {
    const payload = {
      model, messages: body.messages, stream: false, think: false, keep_alive: keepAlive,
      options: {
        num_ctx: numCtx,
        num_predict: Math.min(Number(body.max_tokens) || 600, LIMITS.tokens),
        temperature: Math.min(Math.max(Number(body.temperature ?? 0.3), 0), 1),
      },
    };
    let r = await fetch(`${ollama}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(90000) });
    if (r.status === 400) {
      // Older models reject the `think` switch; ask again without it.
      delete payload.think;
      r = await fetch(`${ollama}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(90000) });
    }
    if (!r.ok) throw new Error(`ollama ${r.status}`);
    const d = await r.json();
    return { answer: String(d?.message?.content || '').trim(), model };
  }

  return http.createServer((req, res) => {
    const started = Date.now();
    const done = (status, obj) => { send(res, status, obj); log(`${new Date().toISOString()} ${req.method} ${req.url} ${status} ${Date.now() - started}ms`); };

    if (req.method === 'GET' && req.url === '/health') return done(200, { ok: true, model });
    if (req.url !== '/chat') return done(404, { error: 'not found' });
    if (req.method !== 'POST') return done(405, { error: 'POST only' });
    if (busy) return done(503, { error: 'busy' });

    let size = 0;
    const parts = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > LIMITS.body) { done(413, { error: 'too large' }); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', async () => {
      if (res.writableEnded) return;
      let body;
      try { body = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { return done(400, { error: 'not JSON' }); }
      const bad = validate(body);
      if (bad) return done(400, { error: bad });
      if (busy) return done(503, { error: 'busy' });
      busy = true;
      try {
        const out = await chat(body);
        done(out.answer ? 200 : 502, out.answer ? out : { error: 'empty answer' });
      } catch (e) {
        done(502, { error: 'model unavailable' });
      } finally {
        busy = false;
      }
    });
  });
}

module.exports = { createProxy, validate, LIMITS };

if (require.main === module) {
  const port = Number(process.env.PORT) || 11435;
  createProxy({
    ollamaUrl: process.env.OLLAMA_URL,
    model: process.env.LLM_MODEL,
    numCtx: process.env.NUM_CTX,
    keepAlive: process.env.KEEP_ALIVE,
  }).listen(port, '127.0.0.1', () => console.log(`local-llm proxy on http://127.0.0.1:${port} → ${process.env.LLM_MODEL || 'qwen3.5:4b'}`));
}
