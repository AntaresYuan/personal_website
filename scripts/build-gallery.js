#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   build-gallery.js — "Gallery" in the Work space (/gallery/).

   A wall of work, after the ChatGPT Images grid: portrait tiles with the
   title on a soft scrim, category chips above. A tile opens a lightbox
   (scripts/gallery.js) with every picture of that piece, its story, and a
   link to the full write-up. Without JS a tile is just a link to the
   write-up.

   Source of truth: content/gallery.json →
     { title, sub, categories: { key: label }, items: [
         { slug, title, year, medium, category, summary, link,
           cover (optional image index), images: [{ src, thumb, caption }] } ] }
   Pieces with several pictures (a series) show them in the lightbox.
   ════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const { escapeHtml: e } = require('./lib/blog');
const shell = require('./lib/work-shell');

const root = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const site = read('content/site.json');
const SITE_URL = (site.meta?.url ?? 'https://example.com').replace(/\/$/, '');
const data = (() => { try { return read('content/gallery.json'); } catch { return { items: [] }; } })();
const items = data.items ?? [];
const cats = Object.entries(data.categories ?? {}).filter(([k]) => items.some((it) => it.category === k));

/* Pictures live in the repo (media/gallery/: a 1600px `src` and a 768px
   `thumb`, from tools or the CMS) so the page never depends on another
   host staying up. The wall and the thumbnail strip use `thumb`. A remote
   Framer URL still works and is resized by its CDN, but is not the norm. */
const sized = (src, px) => /framerusercontent\.com\/images\//.test(src || '') && !/[?]/.test(src)
  ? `${src}?scale-down-to=${px}` : src;

const tile = (it, i) => {
  const cover = (it.images ?? [])[it.cover ?? 0];
  const meta = [it.year, it.medium].filter(Boolean).map(e).join(' · ');
  return `
      <li class="tile" data-tags="${e(it.category || '')}">
        <a class="tile-link" href="${e(it.link || '#')}" data-gallery="${i}" aria-label="${e(it.title)}${meta ? ` — ${meta}` : ''}">
          ${cover ? `<img src="${e(cover.thumb || sized(cover.src, 1024))}" alt="" loading="${i < 10 ? 'eager' : 'lazy'}" decoding="async">` : ''}
          <span class="tile-caption"><strong>${e(it.title)}</strong>${meta ? `<span>${meta}</span>` : ''}</span>
        </a>
      </li>`;
};

const main = `  <section class="gallery" aria-labelledby="gallery-title">
    <header class="page-head">
      <div>
        <h1 class="page-title" id="gallery-title">${e(data.title || 'Gallery')}</h1>
        ${data.sub ? `<p class="page-sub">${e(data.sub)}</p>` : ''}
      </div>
    </header>
    ${cats.length > 1 ? `<div class="filters" role="group" aria-label="Filter by kind" data-filter-for="gallery-grid">
      <button class="filter is-on" type="button" data-filter="all" aria-pressed="true">All</button>${cats.map(([k, label]) =>
        `<button class="filter" type="button" data-filter="${e(k)}" aria-pressed="false">${e(label)}</button>`).join('')}
    </div>` : ''}
    ${items.length ? `<ul class="gallery-grid" id="gallery-grid">${items.map(tile).join('')}
    </ul>` : '<p class="empty">Nothing hung yet.</p>'}
  </section>

  <div class="lightbox" id="lightbox" role="dialog" aria-modal="true" aria-labelledby="lb-title" hidden>
    <div class="lb-scrim" data-lb-close></div>
    <div class="lb-frame">
      <figure class="lb-stage">
        <img class="lb-img" id="lb-img" alt="">
        <figcaption class="lb-cap" id="lb-cap"></figcaption>
        <button class="lb-btn lb-prev glass" type="button" id="lb-prev" aria-label="Previous picture"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6"/></svg></button>
        <button class="lb-btn lb-next glass" type="button" id="lb-next" aria-label="Next picture"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6 6 6-6 6"/></svg></button>
      </figure>
      <aside class="lb-info">
        <p class="lb-meta" id="lb-meta"></p>
        <h2 class="lb-title" id="lb-title"></h2>
        <p class="lb-summary" id="lb-summary"></p>
        <div class="lb-thumbs" id="lb-thumbs" role="group" aria-label="Pictures"></div>
        <a class="btn btn-primary lb-link" id="lb-link" href="#">Read the process log<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6 6 6-6 6"/></svg></a>
      </aside>
      <button class="lb-close glass" type="button" data-lb-close aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg></button>
    </div>
  </div>
  <script type="application/json" id="gallery-data">${JSON.stringify(items.map((it) => ({
    ...it,
    images: (it.images ?? []).map((p) => ({ ...p, src: sized(p.src, 2048), thumb: p.thumb || sized(p.src, 256) })),
  }))).replace(/</g, '\\u003c')}</script>`;

const outDir = path.join(root, 'gallery');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), shell.pageHtml({
  title: data.title || 'Gallery',
  description: data.sub,
  canonical: `${SITE_URL}/gallery/`,
  active: 'gallery',
  bodyClass: 'gallery-page',
  main,
  scripts: ['scripts/gallery.js'],
}));
console.log(`✓ wrote gallery/       (${items.length} piece${items.length === 1 ? '' : 's'})`);
