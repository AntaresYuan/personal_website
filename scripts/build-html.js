#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   build-html.js — pre-render content/*.json into index.html.

   Why: the runtime renderer (scripts/render.js) populates the page from
   JSON in the browser. Agents that don't execute JS (Claude Code, search
   crawlers, plain curl) get an empty shell otherwise. This script bakes
   the same content into the static HTML so a no-JS reader sees the slogan,
   every card, lens entries, and contact info immediately.

   Strategy: walk known element IDs in the existing index.html and replace
   their innerHTML with the same markup render.js would emit. Idempotent —
   re-running with unchanged content produces an identical file.

   Run:
     node scripts/build-html.js
   ════════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

const site    = read('content/site.json');
const profile = read('content/profile.json');
const board   = read('content/board.json');
const lens    = read('content/lens.json');
const contact = read('content/contact.json');

/* ── Helpers ──────────────────────────────────────────────────────────── */
const escape = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

// Match the exact set of tags render.js's safeRich allows (em / strong / br)
const safeRich = (s) => escape(s).replace(/&lt;(\/?(em|strong|br)\s*\/?)&gt;/gi, '<$1>');

// Replace innerHTML of an element matched by `openRe`. The regex must
// capture the tag name as group 1. Walks the HTML balancing same-name
// opens/closes so nested same-tag elements (e.g. divs inside divs) are
// handled correctly — that matters on re-runs where the previous build
// already populated the container.
const replaceInnerOpenMatch = (html, openRe, content, label) => {
  const openMatch = openRe.exec(html);
  if (!openMatch) {
    console.warn(`[build-html] no element matched: ${label}`);
    return html;
  }
  const tagName = openMatch[1].toLowerCase();
  const contentStart = openMatch.index + openMatch[0].length;

  const openTagRe  = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  const closeTagRe = new RegExp(`</${tagName}\\s*>`, 'gi');

  let depth = 1;
  let pos = contentStart;
  while (depth > 0) {
    openTagRe.lastIndex  = pos;
    closeTagRe.lastIndex = pos;
    const nextOpen  = openTagRe.exec(html);
    const nextClose = closeTagRe.exec(html);
    if (!nextClose) {
      console.warn(`[build-html] unterminated <${tagName}> for ${label}`);
      return html;
    }
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      pos = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      if (depth === 0) {
        return html.slice(0, contentStart) + content + html.slice(nextClose.index);
      }
      pos = nextClose.index + nextClose[0].length;
    }
  }
  return html;
};

const replaceInner = (html, id, content) =>
  replaceInnerOpenMatch(
    html,
    new RegExp(`<([a-zA-Z][a-zA-Z0-9]*)([^>]*\\sid=["']${id}["'][^>]*)>`, 'i'),
    content,
    `id="${id}"`
  );

// Set or replace an attribute on the element with the given id.
const setAttr = (html, id, attr, value) => {
  const re = new RegExp(
    `<([a-zA-Z][a-zA-Z0-9]*)([^>]*\\sid=["']${id}["'][^>]*)>`,
    'i'
  );
  return html.replace(re, (m, tag, attrs) => {
    const attrRe = new RegExp(`\\s${attr}=["'][^"']*["']`);
    const newAttrs = attrRe.test(attrs)
      ? attrs.replace(attrRe, ` ${attr}="${value}"`)
      : attrs + ` ${attr}="${value}"`;
    return `<${tag}${newAttrs}>`;
  });
};

/* ── Card index (mirrors render.js) ───────────────────────────────────── */
const ID_PREFIX = { shipped: 'SHIP', now: 'NOW', next: 'NEXT', later: 'LATER' };
const pad2 = (n) => String(n).padStart(2, '0');

const allCards = () => {
  const cards = (board.cards ?? []).slice().sort((a, b) => {
    const ao = a.order ?? 99, bo = b.order ?? 99;
    if (ao !== bo) return ao - bo;
    return (b.updated ?? '').localeCompare(a.updated ?? '');
  });
  const cols = ['shipped', 'now', 'next', 'later'];
  const out = [];
  cols.forEach((col) => {
    cards.filter(c => c.status === col).forEach((c, i) => {
      out.push({ ...c, displayId: `${ID_PREFIX[col]}-${pad2(i + 1)}` });
    });
  });
  return out;
};

/* ── Per-region renderers ─────────────────────────────────────────────── */

// Hero name with optional accent
const heroNameHtml = () => {
  const accent = profile.nameAccent
    ? ` <em>${escape(profile.nameAccent)}</em>`
    : '';
  return escape(profile.name) + accent;
};

// Hero meta row: role · location · status · pills(tags)
const heroMetaHtml = () => {
  const parts = [];
  if (profile.role)     parts.push(`<span>${escape(profile.role)}</span>`);
  if (profile.location) parts.push(`<span class="sep">·</span><span>${escape(profile.location)}</span>`);
  if (profile.status)   parts.push(`<span class="sep">·</span><span class="now-pill"><span class="pulse"></span>${escape(profile.status)}</span>`);
  (profile.tags ?? []).forEach((t) => parts.push(`<span class="pill">${escape(t)}</span>`));
  return parts.join('');
};

// Hero CTAs
const heroCtasHtml = () =>
  (profile.ctas ?? []).map((c) => `
        <a class="cta" href="${escape(c.anchor || '#')}">
          <div>
            <div class="cta-label">${escape(c.audience ?? '')}</div>
            <div class="cta-text">${escape(c.label ?? '')}</div>
          </div>
          <span class="cta-arrow">→</span>
        </a>`).join('');

// One card -> button HTML (matches render.js exactly, including data-attrs)
const cardHtml = (c) => {
  const tags = (c.tags ?? []).map((t, i) =>
    `<span class="tag${i % 2 ? ' tag-blue' : ''}">${escape(t)}</span>`
  ).join('');

  const links = (c.links ?? [])
    .filter(l => l.href && l.href !== '#')
    .map((l) => `<a href="${escape(l.href)}" target="_blank" rel="noopener">${escape(l.label)} ↗</a>`)
    .join('');

  const tagSlugs = (c.tags ?? []).map((t) => t.toLowerCase()).join('|');

  return `
            <button type="button" class="card" data-id="${escape(c.id)}" data-card-id="${c.displayId}" data-tags="${escape(tagSlugs)}" aria-label="Open details for ${escape(c.title)}">
              <div class="card-meta-top">
                <span class="card-id">${c.displayId}</span>
                <span class="card-handle" aria-hidden="true">⋮⋮</span>
              </div>
              <div class="card-title">${escape(c.title)}</div>
              ${c.summary ? `<div class="card-summary">${safeRich(c.summary)}</div>` : ''}
              ${tags ? `<div class="card-tags">${tags}</div>` : ''}
              <div class="card-footer">
                <span class="card-footer-left">
                  <span>${escape(c.updated ?? '')}</span>
                  <span class="card-comments">0</span>
                </span>
                ${c.impact ? `<span class="card-impact">${escape(c.impact)}</span>` : ''}
              </div>
              ${links ? `<div class="card-links">${links}</div>` : ''}
            </button>`;
};

// Filter chips (top 6 tags by frequency, plus the "All" pre-baked in HTML)
const filterChipsHtml = () => {
  const cards = allCards();
  const counts = new Map();
  cards.forEach((c) => (c.tags ?? []).forEach((t) => {
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }));
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t);
  const allChip = `<button class="filter-chip is-active" type="button" data-filter="all" aria-pressed="true">All</button>`;
  const tagChips = top.map((tag) =>
    `<button class="filter-chip" type="button" data-filter="${escape(tag.toLowerCase())}" aria-pressed="false">${escape(tag)}</button>`
  ).join('');
  return allChip + tagChips;
};

// Lens items
const lensListHtml = () =>
  (lens.items ?? []).map((it) => {
    const aside = it.aside ? `<em>${escape(it.aside)}</em>` : '';
    return `
        <div class="lens-card">
          <div class="lens-num">${escape(it.num ?? '')}</div>
          <div class="lens-text">${escape(it.main ?? '')}${aside}</div>
        </div>`;
  }).join('');

// Contact list
const contactListHtml = () =>
  (contact.items ?? []).map((it) => {
    const tgt = it.href?.startsWith('http') ? ` target="_blank" rel="noopener"` : '';
    return `<a href="${escape(it.href ?? '#')}"${tgt}><span class="key">${escape(it.key ?? '')}</span><span>${escape(it.label ?? '')}</span></a>`;
  }).join('');

// Footer copyright (mirrors render.js)
const footerHtml = () => {
  const parts = [];
  if (site.footer?.copyright) parts.push(escape(site.footer.copyright));
  if (site.footer?.tagline)   parts.push(`<em>${escape(site.footer.tagline)}</em>`);
  return parts.join(' · ');
};

/* ── Apply replacements ───────────────────────────────────────────────── */
const tplPath = path.join(root, 'index.html');
let html = fs.readFileSync(tplPath, 'utf8');

// Insert (or refresh) a GENERATED banner right after <!DOCTYPE> so anyone
// opening the file sees it's a build artifact. Strip any prior banner first
// so the script stays idempotent.
html = html.replace(/<!--\s*GENERATED — do not edit[\s\S]*?-->\s*\n?/i, '');
html = html.replace(
  /(<!doctype html>)/i,
  `$1\n<!--\n  GENERATED — do not edit by hand.\n  Source of truth: content/*.json (and the structural template in this file).\n  Regenerate: \`node scripts/build.js\`\n-->`
);

// Mark as prerendered so render.js can short-circuit DOM population
html = html.replace(/<html\b[^>]*>/, (m) => {
  if (/data-prerendered=/.test(m)) return m.replace(/data-prerendered="[^"]*"/, 'data-prerendered="true"');
  return m.replace(/<html/, '<html data-prerendered="true"');
});

// ── Cloudflare Web Analytics ──────────────────────────────────────────
// Strip any prior beacon (idempotent), then inject before </head> if
// site.analytics.cfAnalyticsToken is set. No script when empty — the
// page loads without any tracking until the token is configured.
html = html.replace(/[ \t]*<!--\s*cf-analytics\s*-->[\s\S]*?<!--\s*\/cf-analytics\s*-->\n?/g, '');
const cfToken = site.analytics?.cfAnalyticsToken?.trim();
if (cfToken) {
  const block = `  <!-- cf-analytics -->\n  <script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${escape(cfToken)}"}'></script>\n  <!-- /cf-analytics -->\n`;
  html = html.replace('</head>', `${block}</head>`);
}

// ── Giscus (GitHub Discussions comments) ──────────────────────────────
// Replace the @giscus marker (or any prior injected block) inside the
// #giscus-container with either the live script or the placeholder.
const giscus = site.giscus ?? {};
const giscusReady = giscus.repo && giscus.repoId && giscus.category && giscus.categoryId;
const giscusInner = giscusReady
  ? `<script src="https://giscus.app/client.js"
        data-repo="${escape(giscus.repo)}"
        data-repo-id="${escape(giscus.repoId)}"
        data-category="${escape(giscus.category)}"
        data-category-id="${escape(giscus.categoryId)}"
        data-mapping="${escape(giscus.mapping ?? 'pathname')}"
        data-strict="0"
        data-reactions-enabled="1"
        data-emit-metadata="0"
        data-input-position="${escape(giscus.inputPosition ?? 'top')}"
        data-theme="${escape(giscus.theme ?? 'light')}"
        data-lang="en"
        crossorigin="anonymous"
        async></script>`
  : `<p class="comments-placeholder">Comments will appear here once Giscus is wired up — see <a href="https://github.com/AntaresYuan/personal_website/issues/49">#49</a>.</p>`;
html = replaceInner(html, 'giscus-container', `\n      ${giscusInner}\n    `);

// <title> + description / OG / Twitter meta from site.json
const setMetaContent = (selector, content) => {
  const re = new RegExp(`(<meta\\s+${selector}\\s+content=")[^"]*(")`, 'i');
  html = html.replace(re, `$1${escape(content)}$2`);
};
const setLinkHref = (rel, value) => {
  const re = new RegExp(`(<link\\s+rel=["']${rel}["'][^>]*\\shref=")[^"']*("[^>]*>)`, 'i');
  html = html.replace(re, `$1${escape(value)}$2`);
};
const absoluteUrl = (relPath) => {
  if (!relPath) return '';
  if (/^https?:\/\//i.test(relPath)) return relPath;
  const base = (site.meta?.url ?? '').replace(/\/+$/, '');
  return base ? `${base}/${relPath.replace(/^\/+/, '')}` : relPath;
};

if (site.meta?.title) {
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escape(site.meta.title)}</title>`);
  setMetaContent('property="og:title"',      site.meta.title);
  setMetaContent('name="twitter:title"',     site.meta.title);
}
if (site.meta?.description) {
  setMetaContent('name="description"',          site.meta.description);
  setMetaContent('property="og:description"',   site.meta.description);
  setMetaContent('name="twitter:description"',  site.meta.description);
}
if (site.meta?.author)   setMetaContent('name="author"',          site.meta.author);
if (site.meta?.url) {
  setMetaContent('property="og:url"', site.meta.url);
  setLinkHref('canonical',            site.meta.url);
}
if (site.meta?.siteName) setMetaContent('property="og:site_name"', site.meta.siteName);
if (site.meta?.locale)   setMetaContent('property="og:locale"',    site.meta.locale);
if (site.meta?.ogImage) {
  const ogUrl = absoluteUrl(site.meta.ogImage);
  setMetaContent('property="og:image"',  ogUrl);
  setMetaContent('name="twitter:image"', ogUrl);
  setLinkHref('apple-touch-icon',        site.meta.ogImage);
}
if (site.meta?.ogImageWidth)  setMetaContent('property="og:image:width"',  site.meta.ogImageWidth);
if (site.meta?.ogImageHeight) setMetaContent('property="og:image:height"', site.meta.ogImageHeight);

// JSON-LD Person schema — rebuilt from profile + contact + site
const sameAs = (contact.items ?? [])
  .map((i) => i.href)
  .filter((h) => h && /^https?:\/\//i.test(h));
const personLd = {
  '@context': 'https://schema.org',
  '@type': 'Person',
  name: [profile.name, profile.nameAccent].filter(Boolean).join(' '),
  alternateName: site.meta?.author,
  url: site.meta?.url,
  jobTitle: profile.role,
  description: profile.slogan,
  image: absoluteUrl(site.meta?.ogImage ?? profile.avatar?.calm),
  knowsAbout: profile.tags ?? [],
  ...(sameAs.length ? { sameAs } : {}),
};
html = replaceInner(html, 'ld-person', JSON.stringify(personLd, null, 2));

// Topnav brand + last-updated
html = replaceInner(html, 'brand-name', escape(site.meta?.title?.split('—')[0]?.trim() ?? ''));
html = replaceInner(html, 'last-updated',
  site.footer?.lastUpdated ? `updated ${escape(site.footer.lastUpdated)}` : ''
);

// Hero
html = replaceInner(html, 'hero-name',   heroNameHtml());
html = replaceInner(html, 'hero-slogan', escape(profile.slogan ?? ''));
html = replaceInner(html, 'hero-meta',   heroMetaHtml());
html = replaceInner(html, 'hero-ctas',   heroCtasHtml());

// Avatar src — set image attributes + alt
if (profile.avatar?.calm) {
  html = setAttr(html, 'avatar-calm',    'src', profile.avatar.calm);
  if (profile.avatar.alt) html = setAttr(html, 'avatar-calm', 'alt', profile.avatar.alt);
}
if (profile.avatar?.talking) {
  html = setAttr(html, 'avatar-talking', 'src', profile.avatar.talking);
}

// Board cards by status + counts + total + filter chips
const cards = allCards();
['shipped', 'now', 'next', 'later'].forEach((col) => {
  const filtered = cards.filter(c => c.status === col);
  const inner = filtered.length === 0
    ? `<div class="col-empty">no cards yet</div>`
    : filtered.map(cardHtml).join('');

  // .col-cards container is identified by data-cards="X" attribute.
  html = replaceInnerOpenMatch(
    html,
    new RegExp(`<(div)([^>]*\\sdata-cards="${col}"[^>]*)>`, 'i'),
    inner,
    `data-cards="${col}"`
  );

  // Count badge — span with data-count="X"
  html = replaceInnerOpenMatch(
    html,
    new RegExp(`<(span)([^>]*\\sdata-count="${col}"[^>]*)>`, 'i'),
    String(filtered.length),
    `data-count="${col}"`
  );
});
html = replaceInner(html, 'board-total-count', String(cards.length));
html = replaceInner(html, 'board-shipped-count',
  `${cards.filter(c => c.status === 'shipped').length} shipped`
);

// Filter chips: replace the children inside #board-filters
html = replaceInner(html, 'board-filters', filterChipsHtml());

// Lens header + list
if (lens.head) {
  html = replaceInner(html, 'lens-cmd',   escape(lens.head.cmd ?? ''));
  html = replaceInner(html, 'lens-title', escape(lens.head.title ?? ''));
  html = replaceInner(html, 'lens-meta',  escape(lens.head.meta ?? ''));
}
html = replaceInner(html, 'lens-list', lensListHtml());

// Contact header + intro + list
if (contact.head) {
  html = replaceInner(html, 'contact-cmd',   escape(contact.head.cmd ?? ''));
  html = replaceInner(html, 'contact-title', escape(contact.head.title ?? ''));
}
html = replaceInner(html, 'contact-intro', safeRich(contact.intro ?? ''));
html = replaceInner(html, 'contact-list',  contactListHtml());

// Footer
html = replaceInner(html, 'footer-copyright', footerHtml());

// Cache-bust the runtime scripts: append a content hash as `?v=` to each
// <script src="scripts/*.js">. index.html is served must-revalidate (so it's
// always fresh) but the .js files get a longer CDN TTL — without this, a fresh
// index.html can pair with a stale render.js. Idempotent: an existing `?v=` is
// re-derived from the current file content each build.
const crypto = require('crypto');
['render.js', 'terminal.js', 'palette.js'].forEach((f) => {
  const v = crypto.createHash('sha1')
    .update(fs.readFileSync(path.join(root, 'scripts', f)))
    .digest('hex').slice(0, 8);
  html = html.replace(
    new RegExp(`src="scripts/${f.replace('.', '\\.')}(\\?v=[^"]*)?"`),
    `src="scripts/${f}?v=${v}"`
  );
});

/* ── Write ────────────────────────────────────────────────────────────── */
fs.writeFileSync(tplPath, html);
console.log(`✓ wrote index.html     (${fs.statSync(tplPath).size} bytes, ${cards.length} cards inlined)`);
