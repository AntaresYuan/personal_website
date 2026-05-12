#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   build-blog.js — render content/blog/*.md into a small static blog.

     /blog/                  → index (every published post, newest first)
     /blog/<slug>/index.html → one post

   Pages share the homepage's chrome (fonts, theme bootstrap, topnav,
   footer, giscus) but pull in only styles/main.css — no dashboard JS. The
   theme toggle is wired by a tiny inline script. Wired into scripts/build.js.

   Run:  node scripts/build-blog.js
   ════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadPosts, mdToHtml, escapeHtml } = require('./lib/blog');

const root = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const site = read('content/site.json');

const e = escapeHtml;   // text & attribute escaping
const SITE_NAME = site.meta?.siteName ?? site.meta?.title ?? 'Personal site';
const LANG = site.meta?.lang ?? 'en';
const SITE_URL = (site.meta?.url ?? 'https://example.com').replace(/\/$/, '');
const cssV = crypto.createHash('sha1').update(fs.readFileSync(path.join(root, 'styles/main.css'))).digest('hex').slice(0, 8);

const FONTS = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400;1,9..144,500&family=Inter:wght@400;500;600&display=swap';

// FOUC-free theme bootstrap — same logic as index.html's <head> script.
const THEME_INIT = `<script>
  (function () {
    var d = document.documentElement, m = 'auto';
    try { var t = localStorage.getItem('theme'); if (t === 'light' || t === 'dark') m = t; } catch (e) {}
    var sysDark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    d.setAttribute('data-theme-mode', m);
    d.setAttribute('data-theme', m === 'auto' ? (sysDark ? 'dark' : 'light') : m);
  })();
</script>`;

// Theme toggle interaction: auto → light → dark → auto. Kept tiny + inline so
// blog pages don't pull in the dashboard's render.js.
const THEME_TOGGLE_JS = `<script>
(function () {
  var d = document.documentElement, btn = document.getElementById('theme-toggle'); if (!btn) return;
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  function apply(mode) {
    d.setAttribute('data-theme-mode', mode);
    d.setAttribute('data-theme', mode === 'auto' ? (mq.matches ? 'dark' : 'light') : mode);
    var gi = document.querySelector('iframe.giscus-frame');
    if (gi) { try { gi.contentWindow.postMessage({ giscus: { setConfig: { theme: d.getAttribute('data-theme') } } }, 'https://giscus.app'); } catch (e) {} }
  }
  btn.addEventListener('click', function () {
    var cur = d.getAttribute('data-theme-mode') || 'auto';
    var next = cur === 'auto' ? 'light' : cur === 'light' ? 'dark' : 'auto';
    try { if (next === 'auto') localStorage.removeItem('theme'); else localStorage.setItem('theme', next); } catch (e) {}
    apply(next);
  });
  mq.addEventListener('change', function () { if ((d.getAttribute('data-theme-mode') || 'auto') === 'auto') apply('auto'); });
})();
</script>`;

const giscus = site.giscus ?? {};
const giscusReady = giscus.repo && giscus.repoId && giscus.category && giscus.categoryId;
const giscusBlock = giscusReady
  ? `<script src="https://giscus.app/client.js"
        data-repo="${e(giscus.repo)}"
        data-repo-id="${e(giscus.repoId)}"
        data-category="${e(giscus.category)}"
        data-category-id="${e(giscus.categoryId)}"
        data-mapping="pathname"
        data-strict="0"
        data-reactions-enabled="1"
        data-emit-metadata="0"
        data-input-position="bottom"
        data-theme="${e(giscus.theme ?? 'preferred_color_scheme')}"
        data-lang="en"
        crossorigin="anonymous"
        async></script>`
  : '<p class="blog-comments-off">Comments aren’t configured for this site yet.</p>';

/* ── page shell — shared head/topnav/footer ───────────────────────────── */
function pageShell({ title, description, canonical, ogType, bodyClass, main }) {
  const desc = (description || site.meta?.description || '').replace(/\s+/g, ' ').trim();
  return `<!DOCTYPE html>
<!--
  Open-source template by Antares Yuan — https://github.com/AntaresYuan/personal_website (MIT).
  GENERATED — do not edit by hand. Source: content/blog/*.md → scripts/build-blog.js
-->
<html lang="${e(LANG)}">
<head>
<meta name="generator" content="personal_website by Antares Yuan — https://github.com/AntaresYuan/personal_website">
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${e(title)} · ${e(SITE_NAME)}</title>
<meta name="description" content="${e(desc)}">
<meta name="author" content="${e(site.meta?.author ?? SITE_NAME)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${e(canonical)}">
<meta name="theme-color" content="#FAF7F0" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#14130D" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta property="og:type" content="${e(ogType || 'website')}">
<meta property="og:url" content="${e(canonical)}">
<meta property="og:site_name" content="${e(SITE_NAME)}">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(desc)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${e(title)}">
<meta name="twitter:description" content="${e(desc)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="${FONTS}"></noscript>
${THEME_INIT}
<link rel="stylesheet" href="/styles/main.css?v=${cssV}">
</head>
<body class="${e(bodyClass)}">
<a class="skip-link" href="#main-content">Skip to content</a>
<main class="page" id="main-content">
  <nav class="topnav">
    <div class="brand"><a class="brand-link" href="/"><span class="dot"></span><span>${e(SITE_NAME)}</span></a></div>
    <div class="topnav-end">
      <a class="topnav-link" href="/blog/">blog</a>
      <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Theme" title="Theme">
        <span class="tt-icon tt-auto"  aria-hidden="true">◐</span>
        <span class="tt-icon tt-light" aria-hidden="true">☀</span>
        <span class="tt-icon tt-dark"  aria-hidden="true">☾</span>
      </button>
    </div>
  </nav>
${main}
  <footer class="site-footer">
    <span>${e(site.footer?.copyright ?? '')}${site.footer?.tagline ? ` · <em>${e(site.footer.tagline)}</em>` : ''}</span>
    <span><a href="/">home</a> · <a href="/blog/">blog</a> · <a href="/admin/">edit</a> · <a href="https://github.com/AntaresYuan/personal_website" title="Open-source template — fork it freely; a link back is appreciated">source</a></span>
  </footer>
</main>
${THEME_TOGGLE_JS}
</body>
</html>
`;
}

/* ── render ───────────────────────────────────────────────────────────── */
const posts = loadPosts();

// /blog/  — index
const indexMain = `  <section class="section blog-index">
    <header class="sec-head">
      <span class="sec-cmd">$ /blog</span>
      <span class="sec-title">writing</span>
      <span class="sec-meta">${posts.length} post${posts.length === 1 ? '' : 's'}</span>
    </header>
    ${posts.length
    ? `<ul class="blog-list">
${posts.map((p) => `      <li class="blog-list-item">
        <a class="blog-list-link" href="/blog/${e(p.slug)}/">
          <span class="blog-list-date">${e(p.date)}</span>
          <span class="blog-list-text">
            <span class="blog-list-title">${e(p.title)}</span>
            ${p.summary ? `<span class="blog-list-summary">${e(p.summary)}</span>` : ''}
          </span>
        </a>
      </li>`).join('\n')}
    </ul>`
    : '<p class="blog-empty">Nothing here yet.</p>'}
  </section>`;

fs.mkdirSync(path.join(root, 'blog'), { recursive: true });
fs.writeFileSync(path.join(root, 'blog', 'index.html'), pageShell({
  title: 'Writing',
  description: `Writing by ${SITE_NAME}.`,
  canonical: `${SITE_URL}/blog/`,
  ogType: 'website',
  bodyClass: 'blog-page blog-index-page',
  main: indexMain,
}));

// /blog/<slug>/  — one page per post
let postPages = 0;
for (const p of posts) {
  const main = `  <article class="section blog-post">
    <p class="blog-post-back"><a href="/blog/">← all writing</a></p>
    <header class="blog-post-head">
      ${p.date ? `<p class="blog-post-date">${e(p.date)}</p>` : ''}
      <h1 class="blog-post-title">${e(p.title)}</h1>
      ${p.summary ? `<p class="blog-post-lead">${e(p.summary)}</p>` : ''}
    </header>
    <div class="blog-post-body prose">
${mdToHtml(p.body)}
    </div>
    <hr class="blog-post-rule">
    <section class="blog-comments" aria-label="Comments">
      ${giscusBlock}
    </section>
  </article>`;
  const dir = path.join(root, 'blog', p.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), pageShell({
    title: p.title,
    description: p.summary,
    canonical: `${SITE_URL}/blog/${p.slug}/`,
    ogType: 'article',
    bodyClass: 'blog-page blog-post-page',
    main,
  }));
  postPages++;
}

console.log(`✓ wrote blog/          (index + ${postPages} post page${postPages === 1 ? '' : 's'})`);
