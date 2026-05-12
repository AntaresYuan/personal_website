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
const profile = read('content/profile.json');

const e = escapeHtml;   // text & attribute escaping
const SITE_NAME = site.meta?.siteName ?? site.meta?.title ?? 'Personal site';
const LANG = site.meta?.lang ?? 'en';
const SITE_URL = (site.meta?.url ?? 'https://example.com').replace(/\/$/, '');
const abs = (p) => p ? `/${String(p).replace(/^\/+/, '')}` : '';   // root-absolute URL (blog pages aren't at the root)
const AUTHOR = [profile.name, profile.nameAccent].filter(Boolean).join(' ') || SITE_NAME;
const AVATAR = abs(profile.avatar?.calm || 'media/avatar-calm.png');
const OG_IMAGE = site.meta?.ogImage ? `${SITE_URL}${abs(site.meta.ogImage)}` : '';
const FEED_TITLE = `Writing — ${SITE_NAME}`;
const FEED_DESC = `Writeups and notes from building — by ${AUTHOR}.`;
const cssV = crypto.createHash('sha1').update(fs.readFileSync(path.join(root, 'styles/main.css'))).digest('hex').slice(0, 8);

// rough reading time, ~200 wpm — strip Markdown punctuation first.
const readMinutes = (md) => {
  const words = String(md).replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`~\-\[\]()!|]/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
};
// "2026-05-12" → "Tue, 12 May 2026 00:00:00 GMT"  (RSS pubDate)
const rfc822 = (ymd) => { const d = new Date(`${ymd}T12:00:00Z`); return isNaN(d) ? new Date().toUTCString() : d.toUTCString(); };
// root-relative URLs → absolute, for the feed's HTML payload
const absUrls = (html) => String(html).replace(/(href|src)="\/(?!\/)/g, `$1="${SITE_URL}/`);
const cdata = (s) => `<![CDATA[${String(s).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

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

// The blog pages' only JS — kept tiny + inline so they don't pull in the
// dashboard's render.js: the theme toggle (auto → light → dark → auto) and the
// reading-progress bar (post pages only).
const BLOG_JS = `<script>
(function () {
  // ── theme toggle: auto → light → dark → auto ─────────────────────────
  var d = document.documentElement, btn = document.getElementById('theme-toggle');
  if (btn) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var apply = function (mode) {
      d.setAttribute('data-theme-mode', mode);
      d.setAttribute('data-theme', mode === 'auto' ? (mq.matches ? 'dark' : 'light') : mode);
      var gi = document.querySelector('iframe.giscus-frame');
      if (gi) { try { gi.contentWindow.postMessage({ giscus: { setConfig: { theme: d.getAttribute('data-theme') } } }, 'https://giscus.app'); } catch (e) {} }
    };
    btn.addEventListener('click', function () {
      var cur = d.getAttribute('data-theme-mode') || 'auto';
      var next = cur === 'auto' ? 'light' : cur === 'light' ? 'dark' : 'auto';
      try { if (next === 'auto') localStorage.removeItem('theme'); else localStorage.setItem('theme', next); } catch (e) {}
      apply(next);
    });
    mq.addEventListener('change', function () { if ((d.getAttribute('data-theme-mode') || 'auto') === 'auto') apply('auto'); });
  }
  // ── reading progress bar (post pages only) ───────────────────────────
  var bar = document.querySelector('.blog-progress-bar');
  if (bar && document.body.classList.contains('blog-post-page')) {
    var update = function () {
      var h = document.documentElement, max = (h.scrollHeight - h.clientHeight) || 1;
      bar.style.transform = 'scaleX(' + Math.min(1, Math.max(0, (h.scrollTop || window.pageYOffset) / max)) + ')';
    };
    addEventListener('scroll', update, { passive: true });
    addEventListener('resize', update);
    update();
  }
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
<link rel="alternate" type="application/rss+xml" title="${e(FEED_TITLE)}" href="/blog/feed.xml">
<meta name="theme-color" content="#FAF7F0" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#14130D" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta property="og:type" content="${e(ogType || 'website')}">
<meta property="og:url" content="${e(canonical)}">
<meta property="og:site_name" content="${e(SITE_NAME)}">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(desc)}">${OG_IMAGE ? `\n<meta property="og:image" content="${e(OG_IMAGE)}">` : ''}
<meta name="twitter:card" content="${OG_IMAGE ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${e(title)}">
<meta name="twitter:description" content="${e(desc)}">${OG_IMAGE ? `\n<meta name="twitter:image" content="${e(OG_IMAGE)}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="${FONTS}"></noscript>
${THEME_INIT}
<link rel="stylesheet" href="/styles/main.css?v=${cssV}">
</head>
<body class="${e(bodyClass)}">
<div class="blog-progress" aria-hidden="true"><span class="blog-progress-bar"></span></div>
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
    <span><a href="/">home</a> · <a href="/blog/">blog</a> · <a href="/blog/feed.xml">rss</a> · <a href="/admin/">edit</a> · <a href="https://github.com/AntaresYuan/personal_website" title="Open-source template — fork it freely; a link back is appreciated">source</a></span>
  </footer>
</main>
${BLOG_JS}
</body>
</html>
`;
}

/* ── render ───────────────────────────────────────────────────────────── */
const posts = loadPosts().map((p) => ({ ...p, readMin: readMinutes(p.body) }));

const byline = (p, big) => `<div class="blog-byline${big ? ' blog-byline-lg' : ''}">
        <img class="blog-byline-avatar" src="${e(AVATAR)}" alt="${e(AUTHOR)}" width="${big ? 40 : 24}" height="${big ? 40 : 24}" loading="lazy">
        <span class="blog-byline-text"><span class="blog-byline-name">${e(AUTHOR)}</span><span class="blog-byline-meta">${p.date ? `<time datetime="${e(p.date)}">${e(p.date)}</time> · ` : ''}${p.readMin} min read</span></span>
      </div>`;

// /blog/  — index ("publication" masthead + a roomy card per post)
const indexMain = `  <section class="section blog-index">
    <header class="blog-index-head">
      <h1 class="blog-index-title">Writing</h1>
      <p class="blog-index-sub">Writeups, teardowns, and notes from building — by ${e(AUTHOR)}.</p>
    </header>
    ${posts.length
    ? `<ul class="blog-list">
${posts.map((p) => `      <li class="blog-list-item">
        <a class="blog-list-link" href="/blog/${e(p.slug)}/">
          <h2 class="blog-list-title">${e(p.title)}</h2>
          ${p.summary ? `<p class="blog-list-summary">${e(p.summary)}</p>` : ''}
          <p class="blog-list-meta">${p.date ? `<time datetime="${e(p.date)}">${e(p.date)}</time> · ` : ''}${p.readMin} min read</p>
        </a>
      </li>`).join('\n')}
    </ul>`
    : '<p class="blog-empty">Nothing here yet.</p>'}
  </section>`;

fs.mkdirSync(path.join(root, 'blog'), { recursive: true });
fs.writeFileSync(path.join(root, 'blog', 'index.html'), pageShell({
  title: 'Writing',
  description: `Writeups and notes from building — by ${AUTHOR}.`,
  canonical: `${SITE_URL}/blog/`,
  ogType: 'website',
  bodyClass: 'blog-page blog-index-page',
  main: indexMain,
}));

// /blog/<slug>/  — one page per post (Medium-ish: big title, byline w/ avatar
// + read time, progress bar, serif reading column, then comments)
let postPages = 0;
for (const p of posts) {
  const main = `  <article class="section blog-post">
    <p class="blog-post-back"><a href="/blog/">← all writing</a></p>
    <header class="blog-post-head">
      <h1 class="blog-post-title">${e(p.title)}</h1>
      ${p.summary ? `<p class="blog-post-lead">${e(p.summary)}</p>` : ''}
      ${byline(p, true)}
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

// Drop stale post directories — a post that was deleted or flipped to draft.
const keep = new Set(posts.map((p) => p.slug));
for (const ent of fs.readdirSync(path.join(root, 'blog'), { withFileTypes: true })) {
  if (ent.isDirectory() && !keep.has(ent.name)) {
    fs.rmSync(path.join(root, 'blog', ent.name), { recursive: true, force: true });
  }
}

// /blog/feed.xml — RSS 2.0. Full post HTML in content:encoded (so readers and
// Medium's "import from RSS" get the whole post), with absolute URLs.
const feedItems = posts.map((p) => `    <item>
      <title>${e(p.title)}</title>
      <link>${SITE_URL}/blog/${e(p.slug)}/</link>
      <guid isPermaLink="true">${SITE_URL}/blog/${e(p.slug)}/</guid>${p.date ? `\n      <pubDate>${rfc822(p.date)}</pubDate>` : ''}
      <dc:creator>${e(AUTHOR)}</dc:creator>${p.summary ? `\n      <description>${e(p.summary)}</description>` : ''}
      <content:encoded>${cdata(absUrls(mdToHtml(p.body)))}</content:encoded>
    </item>`).join('\n');
const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${e(FEED_TITLE)}</title>
    <link>${SITE_URL}/blog/</link>
    <atom:link href="${SITE_URL}/blog/feed.xml" rel="self" type="application/rss+xml"/>
    <description>${e(FEED_DESC)}</description>
    <language>${e(LANG)}</language>${posts[0]?.date ? `\n    <lastBuildDate>${rfc822(posts[0].date)}</lastBuildDate>` : ''}
    <generator>scripts/build-blog.js</generator>
${feedItems}
  </channel>
</rss>
`;
fs.writeFileSync(path.join(root, 'blog', 'feed.xml'), feed);

console.log(`✓ wrote blog/          (index + ${postPages} post page${postPages === 1 ? '' : 's'} + feed.xml)`);
