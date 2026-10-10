#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   ops/board-dev.js — local server for editing boards.

     npm run board            → http://127.0.0.1:4322/board-editor/?id=sample

   Serves the repo as a static site (like `npx serve`) and adds one write
   path, so the editor's Save button lands straight in the repo:

     GET /__board/ping        200 — tells the editor that saving works
     PUT /__board/<id>        body: board JSON → content/boards/<id>.json

   Bound to 127.0.0.1 only. The id must be [a-z0-9-]; the body must parse as
   a board ({ nodes: [], edges: [] }) and stay under 2 MB. Nothing else in
   the repo can be written through it.
   ════════════════════════════════════════════════════════════════════════ */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BOARDS = path.join(ROOT, 'content', 'boards');
const PORT = Number(process.env.PORT) || 4322;
const MAX = 2 * 1024 * 1024;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.ico': 'image/x-icon',
};

const send = (res, code, body, type) => {
  res.writeHead(code, { 'content-type': type || 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/__board/ping') return send(res, 200, 'ok');
  const m = /^\/__board\/([a-z0-9-]{1,64})$/.exec(url.pathname);
  if (m) {
    if (req.method !== 'PUT') return send(res, 405, 'PUT a board');
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX) { send(res, 413, 'too large'); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      let board;
      try { board = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(res, 400, 'not JSON'); }
      if (!board || !Array.isArray(board.nodes) || !Array.isArray(board.edges)) return send(res, 400, 'not a board');
      fs.mkdirSync(BOARDS, { recursive: true });
      fs.writeFileSync(path.join(BOARDS, `${m[1]}.json`), JSON.stringify(board, null, 2) + '\n');
      console.log(`  saved content/boards/${m[1]}.json (${board.nodes.length} nodes, ${board.edges.length} arrows)`);
      send(res, 200, 'saved');
    });
    return;
  }

  // Static files, confined to the repo.
  let rel = decodeURIComponent(url.pathname);
  let file = path.normalize(path.join(ROOT, rel));
  // ROOT + separator, not ROOT alone: a sibling like "personal_website-x"
  // shares the prefix.
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return send(res, 403, 'forbidden');
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    const body = fs.readFileSync(file);
    send(res, 200, body, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  } catch {
    send(res, 404, 'not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`board editor: http://127.0.0.1:${PORT}/board-editor/?id=sample`);
});
