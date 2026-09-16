#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   Generate /work/<slug>/ — one real page per project.

   Real routes rather than a modal or a #hash, because this site's whole pitch
   is being answerable by agents: a crawler, a shared link and the assistant
   itself all need a URL that returns the project's content on its own. A modal
   has no address, and a hash route serves an empty shell to anything that does
   not run JavaScript.

   Routing key is `slug`, not `id`: board.json has duplicate ids (two cards each
   for shipped-2 and now-4), so ids cannot address a page. Slugs are derived
   from titles, verified unique, and stored in board.json so a later title edit
   cannot silently move a published URL.

   The AI panel opens on the right here — on a detail page the visitor is
   already looking at one specific thing, which is exactly when asking about it
   makes sense. The home page does the opposite; see build-html.js.
   ───────────────────────────────────────────────────────────────────────── */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

const site = read('content/site.json');
const board = read('content/board.json');

const SITE_NAME = site.meta?.siteName ?? site.meta?.title ?? 'Antares Yuan';
const BASE = (site.meta?.url ?? '').replace(/\/+$/, '');

const e = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const hashOf = (rel) => crypto.createHash('sha1')
  .update(fs.readFileSync(path.join(root, rel))).digest('hex').slice(0, 8);

const cssV = hashOf('styles/main.css');
const skinsV = hashOf('scripts/skins.js');
const skinRtV = hashOf('scripts/skin-runtime.js');
const spacesV = hashOf('scripts/spaces.js');
const workV = hashOf('scripts/work-detail.js');
const selV = hashOf('scripts/ask-selection.js');

const STATUS_LABEL = { shipped: 'SHIPPED', now: 'NOW', next: 'NEXT', later: 'LATER' };

const cards = (board.cards ?? []).filter((c) => c.slug);

/* Prev/next within the same column, so the pager walks a coherent list
   (shipped → shipped) instead of jumping between unrelated statuses. */
const byStatus = {};
cards.forEach((c) => {
  (byStatus[c.status] = byStatus[c.status] || []).push(c);
});
Object.values(byStatus).forEach((list) =>
  list.sort((a, b) => (a.order ?? 99) - (b.order ?? 99)));

function detailPage(card) {
  const url = `${BASE}/work/${card.slug}/`;
  const status = STATUS_LABEL[card.status] || String(card.status || '').toUpperCase();
  const siblings = byStatus[card.status] || [];
  const idx = siblings.indexOf(card);
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;

  const tags = (card.tags ?? []).map((t) =>
    `<span class="wd-tag">${e(t)}</span>`).join('');

  const links = (card.links ?? []).map((l) =>
    `<a class="wd-link" href="${e(l.href)}" target="_blank" rel="noopener">${e(l.label)} ↗</a>`
  ).join('');

  /* `details` is empty on most cards today. Rather than printing a blank slab,
     fall back to the summary and let the assistant carry the rest — the panel
     is right there and knows the whole board. */
  const bodyText = (card.details || '').trim() || (card.summary || '').trim();

  const dates = [
    card.started ? `started ${e(card.started)}` : '',
    card.updated ? `updated ${e(card.updated)}` : ''
  ].filter(Boolean).join(' · ');

  return `<!DOCTYPE html>
<!--
  GENERATED — do not edit by hand.
  Source: content/board.json → scripts/build-work.js
-->
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${e(card.title)} · ${e(SITE_NAME)}</title>
<meta name="description" content="${e(card.summary || '')}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${e(url)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${e(card.title)}">
<meta property="og:description" content="${e(card.summary || '')}">
<meta property="og:url" content="${e(url)}">
<meta name="theme-color" content="#FAF7F0" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#14130D" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/styles/main.css?v=${cssV}">
<script>
  /* Inline and first: applying the stored theme and skin after paint is a
     visible flash of the wrong palette on every page load. */
  (function () {
    try {
      var t = localStorage.getItem('theme');
      if (t && t !== 'auto') document.documentElement.setAttribute('data-theme', t);
      var s = localStorage.getItem('skin');
      if (s) document.documentElement.setAttribute('data-skin', s);
    } catch (e) {}
  })();
</script>
</head>
<body class="work-detail-page">

<nav class="topnav">
  <div class="brand" id="space-switcher">
    <button class="brand-btn" id="space-trigger" type="button"
            aria-haspopup="menu" aria-expanded="false" aria-controls="space-menu">
      <span class="dot" aria-hidden="true"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg></span>
      <span id="brand-name">${e(SITE_NAME)}</span>
      <svg class="brand-caret" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"
           fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"
           stroke-linejoin="round"><path d="M3 4.6L6 7.6L9 4.6"/></svg>
    </button>
    <div class="space-menu" id="space-menu" role="menu" aria-labelledby="space-trigger" hidden></div>
  </div>
  <div class="topnav-end">
    <a class="topnav-link" href="/">home</a>
    <a class="topnav-link" href="/blog/">blog</a>
  </div>
</nav>

<main class="page work-detail">
  <nav class="wd-crumb" aria-label="Breadcrumb">
    <a href="/">home</a> <span aria-hidden="true">/</span> <span>${e(card.title)}</span>
  </nav>

  <header class="wd-head">
    <span class="wd-status wd-status-${e(card.status)}">${e(status)}</span>
    <h1 class="wd-title">${e(card.title)}</h1>
    ${card.summary ? `<p class="wd-summary">${e(card.summary)}</p>` : ''}
    ${dates ? `<p class="wd-dates">${dates}</p>` : ''}
  </header>

  ${tags ? `<div class="wd-tags">${tags}</div>` : ''}

  ${bodyText ? `<div class="wd-body"><p>${e(bodyText)}</p></div>` : ''}

  ${card.impact ? `<section class="wd-block">
    <h2 class="wd-block-title">Impact</h2>
    <p>${e(card.impact)}</p>
  </section>` : ''}

  ${links ? `<section class="wd-block">
    <h2 class="wd-block-title">Links</h2>
    <div class="wd-links">${links}</div>
  </section>` : ''}

  <nav class="wd-pager" aria-label="Other projects">
    ${prev ? `<a class="wd-pager-item" href="/work/${e(prev.slug)}/">
      <span class="wd-pager-dir">← previous</span>
      <span class="wd-pager-title">${e(prev.title)}</span></a>` : '<span></span>'}
    ${next ? `<a class="wd-pager-item wd-pager-next" href="/work/${e(next.slug)}/">
      <span class="wd-pager-dir">next →</span>
      <span class="wd-pager-title">${e(next.title)}</span></a>` : '<span></span>'}
  </nav>
</main>

<!-- The ask panel, same markup as the home page so scripts/work-detail.js can
     drive it with the shared stylesheet. It opens automatically here. -->
<div class="ask-panel" id="ask-panel" role="complementary" aria-label="Ask Antares" hidden>
  <div class="ask-panel-head">
    <span class="ask-panel-title">
      <svg class="ask-mark" viewBox="0 0 32 32" width="21" height="21" aria-hidden="true">
        <path d="M16 0 L18.4 13.6 L32 16 L18.4 18.4 L16 32 L13.6 18.4 L0 16 L13.6 13.6 Z"
              transform="translate(7.2 6.65) scale(0.92)"/>
        <path d="M16 0 L18.4 13.6 L32 16 L18.4 18.4 L16 32 L13.6 18.4 L0 16 L13.6 13.6 Z"
              class="ask-spark ask-spark-1" transform="translate(2.2 2.65) scale(0.34)"/>
        <path d="M16 0 L18.4 13.6 L32 16 L18.4 18.4 L16 32 L13.6 18.4 L0 16 L13.6 13.6 Z"
              class="ask-spark ask-spark-2" transform="translate(23.2 3.65) scale(0.27)"/>
        <path d="M16 0 L18.4 13.6 L32 16 L18.4 18.4 L16 32 L13.6 18.4 L0 16 L13.6 13.6 Z"
              class="ask-spark ask-spark-3" transform="translate(3.2 21.65) scale(0.25)"/>
      </svg>
      ask Antares
    </span>
    <span class="ask-panel-actions">
      <button class="ask-panel-btn" id="ask-panel-clear" type="button" title="New conversation" aria-label="New conversation">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor"
             stroke-width="1.5" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>
      </button>
      <button class="ask-panel-btn" id="ask-panel-close" type="button" title="Close" aria-label="Close">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor"
             stroke-width="1.5" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
      </button>
    </span>
  </div>
  <div class="ask-panel-log" id="ask-panel-log" role="log" aria-live="polite"></div>
  <div class="ask-quote-chip" id="ask-quote-chip" hidden></div>
  <form class="ask-panel-form" id="ask-panel-form" autocomplete="off">
    <div class="ask-panel-field">
      <input class="ask-panel-input" id="ask-panel-input" type="text"
             placeholder="Ask a follow-up…" aria-label="Ask a question">
      <button class="ask-panel-send" type="submit" aria-label="Send">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor"
             stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8 13V3M4 6.5L8 2.7l4 3.8"/></svg>
      </button>
    </div>
    <p class="ask-panel-foot">AI answers from this site's content — it can be wrong.</p>
  </form>
</div>

<script>window.WORK_CARD = ${JSON.stringify({ slug: card.slug, title: card.title, status: card.status })};</script>
<script src="/scripts/skins.js?v=${skinsV}" defer></script>
<script src="/scripts/skin-runtime.js?v=${skinRtV}" defer></script>
<script src="/scripts/spaces.js?v=${spacesV}" defer></script>
<script src="/scripts/work-detail.js?v=${workV}" defer></script>
<script src="/scripts/ask-selection.js?v=${selV}" defer></script>
</body>
</html>
`;
}

let written = 0;
cards.forEach((card) => {
  const dir = path.join(root, 'work', card.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), detailPage(card));
  written += 1;
});

console.log(`✓ wrote work/          (${written} project pages)`);
