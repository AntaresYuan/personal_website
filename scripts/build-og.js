#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   build-og.js — render a 1200×630 social-share card (PNG) per blog post.

     blog/<slug>/og.png    — one per published post (title + site name + url)
     blog/og.png           — the /blog/ index card ("Writing")

   Build-time, via @resvg/resvg-wasm (WASM, no native build) + the vendored
   JetBrains Mono TTFs in vendor/fonts/. Wired into scripts/build.js (runs
   first, so build-blog.js can point each post's <og:image> at the PNG). If
   the dep isn't installed it logs a note and skips — `node scripts/build.js`
   still works; the HTML then falls back to the avatar OG image, and CI (which
   runs `npm ci`) regenerates the cards.
   ════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');

let Resvg, initWasm;
try { ({ Resvg, initWasm } = require('@resvg/resvg-wasm')); }
catch { console.log('  (skip OG cards — `npm install` to enable @resvg/resvg-wasm)'); module.exports = async () => {}; return; }

const { loadPosts, escapeHtml } = require('./lib/blog');

const root = path.join(__dirname, '..');
const site = JSON.parse(fs.readFileSync(path.join(root, 'content/site.json'), 'utf8'));
const profile = (() => { try { return JSON.parse(fs.readFileSync(path.join(root, 'content/profile.json'), 'utf8')); } catch { return {}; } })();
const SITE_NAME = [profile.name, profile.nameAccent].filter(Boolean).join(' ') || site.meta?.siteName || site.meta?.title || 'Personal site';
const SITE_HOST = (site.meta?.url ?? 'example.com').replace(/^https?:\/\//, '').replace(/\/$/, '');

const FONT_BOLD = path.join(root, 'vendor/fonts/JetBrainsMono-Bold.ttf');
const FONT_REG  = path.join(root, 'vendor/fonts/JetBrainsMono-Regular.ttf');

const W = 1200, H = 630;
const BG = '#14130D', INK = '#F7F4ED', DIM = '#8D8979', FAINT = '#6B6B78', ACCENT = '#F5C518';

// JetBrains Mono advances ≈ 0.6em — so monospace wrapping is exact.
const wrap = (text, fontSize, maxW) => {
  const max = Math.max(8, Math.floor(maxW / (fontSize * 0.6)));
  const words = String(text).trim().split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= max) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > 4) { lines.length = 4; lines[3] = lines[3].slice(0, Math.max(1, max - 1)).trimEnd() + '…'; }
  return lines;
};

const card = ({ title, footer }) => {
  const t = String(title).trim();
  const fontSize = t.length <= 26 ? 74 : t.length <= 52 ? 60 : 50;
  const innerW = W - 90 - 70;            // left margin 90, right margin 70
  const lines = wrap(t, fontSize, innerW);
  const lh = Math.round(fontSize * 1.22);
  const blockH = lines.length * lh;
  const regionTop = 178, regionH = 360;  // y-band the title lives in
  const firstBaseline = Math.round(regionTop + (regionH - blockH) / 2 + fontSize * 0.78);
  const titleSvg = lines.map((ln, i) =>
    `<text x="90" y="${firstBaseline + i * lh}" font-family="JetBrains Mono" font-weight="700" font-size="${fontSize}" fill="${INK}">${escapeHtml(ln)}</text>`
  ).join('\n  ');
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <rect x="0" y="0" width="10" height="${H}" fill="${ACCENT}"/>
  <circle cx="92" cy="84" r="9" fill="${ACCENT}"/>
  <text x="116" y="93" font-family="JetBrains Mono" font-weight="700" font-size="26" fill="${DIM}">${escapeHtml(SITE_NAME)}</text>
  ${titleSvg}
  <text x="90" y="556" font-family="JetBrains Mono" font-size="24" fill="${FAINT}">${escapeHtml(footer)}</text>
</svg>`;
};

module.exports = async function buildOg() {
  if (!fs.existsSync(FONT_BOLD) || !fs.existsSync(FONT_REG)) {
    console.log('  (skip OG cards — vendor/fonts/JetBrainsMono-*.ttf missing)');
    return;
  }
  const wasmPath = path.join(path.dirname(require.resolve('@resvg/resvg-wasm')), 'index_bg.wasm');
  try { await initWasm(fs.readFileSync(wasmPath)); } catch (e) { /* already initialised in this process */ if (!/already/i.test(String(e && e.message))) throw e; }
  const fontBuffers = [fs.readFileSync(FONT_BOLD), fs.readFileSync(FONT_REG)];
  const opts = { font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: 'JetBrains Mono' }, fitTo: { mode: 'original' } };
  const renderPng = (svg, out) => {
    const png = new Resvg(svg, opts).render().asPng();
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, png);
  };

  const posts = loadPosts();
  fs.mkdirSync(path.join(root, 'blog'), { recursive: true });

  // index card
  renderPng(card({ title: 'Writing', footer: `${SITE_HOST}/blog · ${SITE_NAME}` }), path.join(root, 'blog', 'og.png'));

  // one per post
  for (const p of posts) {
    renderPng(card({ title: p.title, footer: `${SITE_HOST}/blog/${p.slug}${p.date ? ' · ' + p.date : ''}` }), path.join(root, 'blog', p.slug, 'og.png'));
  }
  console.log(`✓ wrote blog/          (${posts.length + 1} OG card${posts.length === 0 ? '' : 's'})`);
};
