#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   build-blog.js — render content/blog/*.md into a small static blog.

     /blog/                  → index (every published post, newest first)
     /blog/<slug>/index.html → one post

   "Writing" in the Work space: pages are built on the Work shell
   (scripts/lib/work-shell.js — rail, top controls, ask, footer) and styled
   by styles/work.css. Wired into scripts/build.js.

   Run:  node scripts/build-blog.js
   ════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const { loadPosts, mdToHtml, escapeHtml } = require('./lib/blog');
const shell = require('./lib/work-shell');
const i18n = require('./lib/i18n');

const root = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const site = read('content/site.json');
const profile = read('content/profile.json');

const e = escapeHtml;   // text & attribute escaping
const SITE_NAME = site.meta?.siteName ?? site.meta?.title ?? 'Personal site';
const LANG = site.meta?.lang ?? 'en';
const SITE_URL = (site.meta?.url ?? 'https://example.com').replace(/\/$/, '');
const AUTHOR = [profile.name, profile.nameAccent].filter(Boolean).join(' ') || SITE_NAME;
const FEED_TITLE = `Writing — ${SITE_NAME}`;
const FEED_DESC = `Writeups and notes from building — by ${AUTHOR}.`;
const readMinutes = (md) => {
  const text = String(md).replace(/```[\s\S]*?```/g, ' ');
  // Chinese has no spaces to count words by: ~400 characters a minute, and
  // ~200 words a minute for whatever is written in Latin script.
  const han = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const words = text.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ').replace(/[#>*_`~\-\[\]()!|]/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200 + han / 400));
};
// "2026-05-12" → "Tue, 12 May 2026 00:00:00 GMT"  (RSS pubDate)
const rfc822 = (ymd) => { const d = new Date(`${ymd}T12:00:00Z`); return isNaN(d) ? new Date().toUTCString() : d.toUTCString(); };
// root-relative URLs → absolute, for the feed's HTML payload
const absUrls = (html) => String(html).replace(/(href|src)="\/(?!\/)/g, `$1="${SITE_URL}/`);
const cdata = (s) => `<![CDATA[${String(s).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

const giscus = site.giscus ?? {};
const giscusReady = giscus.repo && giscus.repoId && giscus.category && giscus.categoryId;
/* A placeholder, not the script — scripts/giscus-lazy.js swaps it for the real
   <script> once the section nears the viewport. Even on a post, where comments
   are part of the content rather than a footer afterthought, they sit below
   the article and the widget was consistently the last request to finish,
   holding the load event open behind a cross-border round trip. */
const giscusBlock = giscusReady
  ? `<div class="giscus-lazy"
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
        data-lang="en"></div>
     <script src="/scripts/giscus-lazy.js" defer></script>`
  : '<p class="blog-comments-off">Comments aren’t configured for this site yet.</p>';

/* Our own reactions + comments (workers/comments/, scripts/comments.js) take
   over from giscus once site.json → comments.endpoint is set; until then the
   giscus block above stays. COMMENTS_ENDPOINT / COMMENTS_SITEKEY override
   both for a preview against a local Worker (`wrangler dev`). */
const comments = site.comments ?? {};
const discussEndpoint = process.env.COMMENTS_ENDPOINT || comments.endpoint || '';
const discussKey = process.env.COMMENTS_SITEKEY || comments.turnstileSiteKey || '';


/* ── render ───────────────────────────────────────────────────────────── */
// Pages per language (L); the RSS feed and posts.json stay English-only.
let L = 'en';
const t = (key, vars) => i18n.t(key, L, vars);
const href = (p) => i18n.localPath(p, L);

const metaLine = (p) => [p.date ? `<time datetime="${e(p.date)}">${e(i18n.fmtDate(p.date, L, true))}</time>` : '', e(t('blog.minRead', { n: p.readMin }))]
  .filter(Boolean).join('<span aria-hidden="true"> · </span>');
// A frontmatter cover stays out of the article body. Older posts can still
// use their first Markdown image as a backwards-compatible fallback.
const coverOf = (md) => { const m = /!\[[^\]]*\]\(\s*([^)\s]+)/.exec(md || ''); return m ? m[1] : ''; };
const HUES = [262, 305, 200, 285, 150, 235];   // OKLCH hue angles, as the projects
const tagSlug = (x) => String(x).toLowerCase();
const tagList = (tags) => (tags && tags.length)
  ? `<ul class="post-tags">${tags.map((x) => `<li>${e(x)}</li>`).join('')}</ul>` : '';

const postCard = (p, i) => {
  const cover = p.cover || coverOf(p.body);
  const art = cover
    ? `<img src="${e(cover)}" alt="" loading="${i < 3 ? 'eager' : 'lazy'}" decoding="async">`
    : `<span class="post-cover-mark">${e((p.title || '?').trim().charAt(0))}</span>`;
  return `
      <li class="post-card${i === 0 ? ' is-feature' : ''}" data-tags="${e((p.tags || []).map(tagSlug).join('|'))}">
        <a class="post-link" href="${href(`/blog/${e(p.slug)}/`)}">
          <div class="post-cover" style="--hue: ${HUES[i % HUES.length]}">${art}</div>
          <div class="post-body">
            <p class="post-meta">${metaLine(p)}</p>
            <h2 class="post-title">${e(p.title)}</h2>
            ${p.summary ? `<p class="post-summary">${e(p.summary)}</p>` : ''}
            ${tagList(p.tags)}
          </div>
        </a>
      </li>`;
};

// Topic chips: the most used tags, only when there is more than one to pick.
const filterRow = (posts) => {
  const tagCounts = new Map();
  posts.forEach((p) => (p.tags || []).forEach((x) => tagCounts.set(x, (tagCounts.get(x) || 0) + 1)));
  const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([x]) => x);
  return topTags.length > 1
    ? `<div class="filters" role="group" aria-label="${e(t('blog.filterAria'))}" data-filter-for="post-grid">
      <button class="filter is-on" type="button" data-filter="all" aria-pressed="true">${e(t('blog.all'))}</button>${topTags.map((x) =>
        `<button class="filter" type="button" data-filter="${e(tagSlug(x))}" aria-pressed="false">${e(x)}</button>`).join('')}
    </div>`
    : '';
};

// /blog/ — the Writing index
const indexMain = (posts) => `  <section class="writing" aria-labelledby="writing-title">
    <header class="page-head">
      <div>
        <h1 class="page-title" id="writing-title">${e(t('blog.title'))}</h1>
        <p class="page-sub">${e(t('blog.sub'))}</p>
      </div>
      <a class="pill-link" href="/blog/feed.xml">RSS</a>
    </header>
    ${filterRow(posts)}
    ${posts.length
    ? `<ul class="post-grid" id="post-grid">${posts.map(postCard).join('')}
    </ul>`
    : `<p class="empty">${e(t('blog.empty'))}</p>`}
  </section>`;

const discussBlock = (slug) => `<section class="discuss" data-discuss
        data-endpoint="${e(discussEndpoint)}"
        data-page="/blog/${e(slug)}/"
        data-turnstile="${e(discussKey)}"
        aria-labelledby="discuss-title">
      <h2 class="discuss-title" id="discuss-title">${e(t('blog.comments'))}</h2>
      <noscript><p class="discuss-note">${e(t('blog.commentsNeedJs'))}</p></noscript>
    </section>`;

const ogCard = (rel) => fs.existsSync(path.join(root, rel)) ? `${SITE_URL}/${rel}` : undefined;
let posts = [];
let postPages = 0;
for (const lang of i18n.LANGS) {
  L = lang;
  posts = loadPosts({ lang }).map((p) => ({ ...p, readMin: readMinutes(p.body) }));
  const outDir = path.join(i18n.outRoot(lang), 'blog');
  fs.mkdirSync(outDir, { recursive: true });
  if (lang === 'en') {
    // A compact post manifest — the ⌘K palette (scripts/palette.js) fetches
    // this to index posts; small + cacheable.
    fs.writeFileSync(path.join(outDir, 'posts.json'),
      JSON.stringify(posts.map((p) => ({ slug: p.slug, title: p.title, summary: p.summary, date: p.date, tags: p.tags })), null, 2) + '\n');
  }
  fs.writeFileSync(path.join(outDir, 'index.html'), shell.pageHtml({
    title: t('blog.title'),
    description: t('blog.description', { author: AUTHOR }),
    lang,
    path: '/blog/',
    ogType: 'website',
    ogImage: ogCard('blog/og.png'),
    active: 'writing',
    bodyClass: 'writing-page',
    main: indexMain(posts),
  }));

  // /blog/<slug>/ — one page per post: a centred reading column, then
  // comments. Both languages share one comment thread (data-page is the
  // English path).
  for (const p of posts) {
    const note = lang !== 'en' && !p.translated ? `<p class="post-lang-note">${e(t('blog.untranslated'))}</p>` : '';
    const main = `  <article class="post">
    <a class="back-link" href="${href('/blog/')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6"/></svg>${e(t('blog.title'))}</a>
    <header class="post-head">
      <p class="post-meta">${metaLine(p)}</p>
      <h1 class="post-page-title">${e(p.title)}</h1>
      ${p.summary ? `<p class="post-lead">${e(p.summary)}</p>` : ''}
      <div class="byline">
        <img src="/media/buddy/felt-still.webp" alt="" width="32" height="32" loading="lazy">
        <span>${e(AUTHOR)}</span>
      </div>
      ${tagList(p.tags)}
    </header>${note}
    <div class="prose">
${mdToHtml(p.body)}
    </div>
    ${discussEndpoint ? discussBlock(p.slug) : `<section class="post-comments" aria-label="${e(t('blog.comments'))}">
      ${giscusBlock}
    </section>`}
  </article>`;
    const dir = path.join(outDir, p.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), shell.pageHtml({
      title: p.title,
      description: p.summary,
      lang,
      path: `/blog/${p.slug}/`,
      ogType: 'article',
      ogImage: ogCard(`blog/${p.slug}/og.png`),
      active: 'writing',
      bodyClass: 'writing-page post-page',
      main,
      scripts: discussEndpoint ? ['scripts/comments.js'] : [],
    }));
    postPages++;
  }

  // Drop stale post directories — a post that was deleted or flipped to draft.
  const keep = new Set(posts.map((p) => p.slug));
  for (const ent of fs.readdirSync(outDir, { withFileTypes: true })) {
    if (ent.isDirectory() && !keep.has(ent.name)) fs.rmSync(path.join(outDir, ent.name), { recursive: true, force: true });
  }
}
L = 'en';
posts = loadPosts().map((p) => ({ ...p, readMin: readMinutes(p.body) }));

// /blog/feed.xml — RSS 2.0. Full post HTML in content:encoded (so readers and
// Medium's "import from RSS" get the whole post), with absolute URLs.
const feedItems = posts.map((p) => `    <item>
      <title>${e(p.title)}</title>
      <link>${SITE_URL}/blog/${e(p.slug)}/</link>
      <guid isPermaLink="true">${SITE_URL}/blog/${e(p.slug)}/</guid>${p.date ? `\n      <pubDate>${rfc822(p.date)}</pubDate>` : ''}
      <dc:creator>${e(AUTHOR)}</dc:creator>${p.summary ? `\n      <description>${e(p.summary)}</description>` : ''}${(p.tags || []).map((t) => `\n      <category>${e(t)}</category>`).join('')}
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

console.log(`✓ wrote blog/          (index + ${postPages} post pages in ${i18n.LANGS.length} languages + feed.xml + posts.json)`);
