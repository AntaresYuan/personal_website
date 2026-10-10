#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   build-sitemap.js — emit /sitemap.xml referencing every public surface
   the site exposes (home + every card via #card/<ID> deep link + every
   agent endpoint).

   Re-runs on every build, so when cards are added/removed/renamed the
   sitemap stays in sync.

   Run:  node scripts/build-sitemap.js
   ════════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const { loadPosts } = require('./lib/blog');

const root = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

const site  = read('content/site.json');
const board = read('content/board.json');

const SITE_URL = (site.meta?.url ?? 'https://antaresyuan.site').replace(/\/$/, '');
const lastmod  = require('./last-updated');   // pinned (site.json) or auto (last-commit date)

/* ── Build URLs ───────────────────────────────────────────────────────── */
const ID_PREFIX = { shipped: 'SHIP', now: 'NOW', next: 'NEXT', later: 'LATER' };
const pad2 = (n) => String(n).padStart(2, '0');

const cards = (board.cards ?? []).slice().sort((a, b) => {
  const ao = a.order ?? 99, bo = b.order ?? 99;
  if (ao !== bo) return ao - bo;
  return (b.updated ?? '').localeCompare(a.updated ?? '');
});

const cardLinks = [];
['shipped', 'now', 'next', 'later'].forEach((col) => {
  cards.filter(c => c.status === col).forEach((c, i) => {
    const id = `${ID_PREFIX[col]}-${pad2(i + 1)}`;
    cardLinks.push({
      loc: `${SITE_URL}/#card/${id}`,
      lastmod: c.updated ?? lastmod,
      priority: '0.6',
    });
  });
});

// Blog: the index + one URL per published post.
const posts = loadPosts();
const blogLinks = [
  ...(posts.length ? [{ loc: `${SITE_URL}/blog/`, lastmod: posts[0].date || lastmod, priority: '0.7' }] : []),
  ...posts.map((p) => ({ loc: `${SITE_URL}/blog/${p.slug}/`, lastmod: p.date || lastmod, priority: '0.7' })),
];

const urls = [
  { loc: `${SITE_URL}/`,             lastmod, priority: '1.0' },
  { loc: `${SITE_URL}/llms.txt`,     lastmod, priority: '0.5' },
  { loc: `${SITE_URL}/llms-full.txt`,lastmod, priority: '0.5' },
  // /usage/ — the full dashboard. Only listed when the page was actually
  // built and usage tracking is on, so a fork without the Worker doesn't
  // advertise a page that renders empty.
  ...(site.usage?.enabled !== false && fs.existsSync(path.join(root, 'usage', 'index.html'))
    ? [{ loc: `${SITE_URL}/usage/`, lastmod, priority: '0.6' }]
    : []),
  ...blogLinks,
  ...cardLinks,
  // Work-space pages (build-gallery.js, build-skills-page.js): listed when built.
  ...['projects', 'gallery', 'skills'].filter((d) => fs.existsSync(path.join(root, d, 'index.html')))
    .map((d) => ({ loc: `${SITE_URL}/${d}/`, lastmod, priority: '0.7' })),
  ...['projects', 'skills'].flatMap((d) => fs.existsSync(path.join(root, d))
    ? fs.readdirSync(path.join(root, d), { withFileTypes: true })
        .filter((ent) => ent.isDirectory() && fs.existsSync(path.join(root, d, ent.name, 'index.html')))
        .map((ent) => ({ loc: `${SITE_URL}/${d}/${ent.name}/`, lastmod, priority: '0.6' }))
    : []),
];

/* ── Emit ─────────────────────────────────────────────────────────────── */
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;

fs.writeFileSync(path.join(root, 'sitemap.xml'), xml);
console.log(`✓ wrote sitemap.xml    (${fs.statSync(path.join(root, 'sitemap.xml')).size} bytes, ${urls.length} URLs)`);
