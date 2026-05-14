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

// "updated <date>" in the topnav — auto (last-commit date) unless pinned in
// site.json. See scripts/last-updated.js. render.js leaves #last-updated alone
// unless footer.lastUpdated is set.
const lastUpdated = require('./last-updated');
const lens    = read('content/lens.json');
const contact = read('content/contact.json');
// /skills — the "dotfiles for AI" section (between #terminal and #lens).
// Optional file: if a fork drops content/skills.json, the section quietly
// stays empty; the source-of-truth for that fallback is here.
const skills = (() => {
  try { return read('content/skills.json'); }
  catch { return { head: {}, items: [] }; }
})();

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

/* ── /usage heatmap — empty SSR shell ─────────────────────────────────
   12 cols × 7 rows × 12px cells with 2px gaps. render.js builds the
   live version with the same viewBox + cell math, so there's no layout
   shift when data lands. Empty cells use a CSS class instead of a fill
   attribute, so theme tokens drive the color (dark mode just works).
   ────────────────────────────────────────────────────────────────── */
// GitHub-style year strip: 52 weeks × 7 days. Cells 10px with 2px gap →
// ~620px wide × 82px tall, plus a 12px top band for month labels. Same
// constants as scripts/render.js, in lockstep — must match or the SSR
// shell and the client-rendered version mismatch on first paint.
const HEATMAP_COLS = 52;
const HEATMAP_ROWS = 7;
const HEATMAP_CELL = 16;
const HEATMAP_GAP  = 3;
const HEATMAP_LABEL_BAND = 18;   // top: month-name strip
const HEATMAP_LEFT_LABEL = 30;   // left: Mon/Wed/Fri row labels
const DAY_LABELS = [null, 'Mon', null, 'Wed', null, 'Fri', null];
function emptyHeatmapSvg() {
  const gridW = HEATMAP_COLS * HEATMAP_CELL + (HEATMAP_COLS - 1) * HEATMAP_GAP;
  const gridH = HEATMAP_ROWS * HEATMAP_CELL + (HEATMAP_ROWS - 1) * HEATMAP_GAP;
  const w = HEATMAP_LEFT_LABEL + gridW;
  const h = HEATMAP_LABEL_BAND + gridH;
  const rects = [];
  for (let c = 0; c < HEATMAP_COLS; c++) {
    for (let r = 0; r < HEATMAP_ROWS; r++) {
      const x = HEATMAP_LEFT_LABEL + c * (HEATMAP_CELL + HEATMAP_GAP);
      const y = HEATMAP_LABEL_BAND + r * (HEATMAP_CELL + HEATMAP_GAP);
      rects.push(`<rect x="${x}" y="${y}" width="${HEATMAP_CELL}" height="${HEATMAP_CELL}" rx="2" class="usage-cell usage-cell-empty"/>`);
    }
  }
  const dayLabels = [];
  for (let r = 0; r < HEATMAP_ROWS; r++) {
    if (!DAY_LABELS[r]) continue;
    const yRow = HEATMAP_LABEL_BAND + r * (HEATMAP_CELL + HEATMAP_GAP) + HEATMAP_CELL / 2;
    dayLabels.push(`<text x="${HEATMAP_LEFT_LABEL - 6}" y="${yRow}" class="usage-day-label" text-anchor="end" dominant-baseline="middle">${DAY_LABELS[r]}</text>`);
  }
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="xMinYMin meet" aria-hidden="true">${dayLabels.join('')}${rects.join('')}</svg>`;
}

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

// Hero meta row: role · location · [résumé ↓] · [简历 ↓] · status · pills(tags).
// `profile.resumeEn` / `profile.resumeZh` (paths set via the CMS file widgets)
// — each empty ⇒ that link is omitted.
const resumeLink = (href, label, lang) =>
  `<span class="sep">·</span><a class="hero-resume"${lang ? ` lang="${lang}"` : ''} href="${escape(href)}" target="_blank" rel="noopener">${label}&nbsp;↓</a>`;
const heroMetaHtml = () => {
  const parts = [];
  if (profile.role)      parts.push(`<span>${escape(profile.role)}</span>`);
  if (profile.location)  parts.push(`<span class="sep">·</span><span>${escape(profile.location)}</span>`);
  if (profile.resumeEn)  parts.push(resumeLink(profile.resumeEn, 'résumé'));
  if (profile.resumeZh)  parts.push(resumeLink(profile.resumeZh, '简历', 'zh'));
  if (profile.status)    parts.push(`<span class="sep">·</span><span class="now-pill">${escape(profile.status)}</span>`);
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

// Skills — one alias-style row per item. Sort by `order` (then by name) so
// the SKILL-NN ids stay stable. Each row is a real <button> carrying the
// data-card-id render.js's modal click handler listens for. Empty state =
// nothing renders (the section header still shows, intentionally — it's a
// signal to a fork-er that this slot exists and where to fill it).
const skillsSorted = () => (skills.items ?? []).slice().sort((a, b) =>
  (a.order ?? 99) - (b.order ?? 99) || String(a.name ?? '').localeCompare(String(b.name ?? '')));
const skillDisplayId = (idx) => `SKILL-${pad2(idx + 1)}`;
const skillRowHtml = (s, idx) => {
  const id = skillDisplayId(idx);
  // External links live OUTSIDE the modal-opening button so they're real <a>
  // hit targets (an <a> inside a <button> is invalid HTML and would either
  // fail or steal the click). The arrow is a sibling of the links — it's a
  // pure visual cue that the row also opens a modal; the click goes via the
  // .skill-link button next to it.
  const linksHtml = (s.links ?? [])
    .filter((l) => l && l.href && l.href !== '#')
    .map((l) => `<a class="skill-extlink" href="${escape(l.href)}" target="_blank" rel="noopener">${escape(l.label ?? l.href)} ↗</a>`)
    .join('');
  return `
        <li class="skill-row">
          <button type="button" class="skill-link" data-card-id="${escape(id)}" aria-label="Open details for ${escape(s.name ?? '')}">
            <span class="skill-id">${escape(id)}</span>
            <span class="skill-name">${escape(s.name ?? '')}</span>
            ${s.category ? `<span class="skill-cat">${escape(s.category)}</span>` : ''}
            <span class="skill-summary">${escape(s.summary ?? '')}</span>
          </button>
          <div class="skill-row-side">
            ${linksHtml}
            <span class="skill-arrow" aria-hidden="true">→</span>
          </div>
        </li>`;
};
const skillsListHtml = () => skillsSorted().map(skillRowHtml).join('');

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

// Insert (or refresh), right after <!DOCTYPE>, two banners: an attribution
// note (so a fork that rebuilds keeps the lineage even if someone scrubs the
// committed index.html) + the GENERATED warning. Strip any prior copies first
// so the script stays idempotent.
html = html.replace(/<!--\s*Open-source template[\s\S]*?-->\s*\n?/i, '');
html = html.replace(/<!--\s*GENERATED — do not edit[\s\S]*?-->\s*\n?/i, '');
html = html.replace(
  /(<!doctype html>)/i,
  `$1\n<!--\n  Open-source template by Antares Yuan — https://github.com/AntaresYuan/personal_website (MIT).\n  Forked it? A visible link back is genuinely appreciated — it keeps the lineage clear\n  so the original doesn't get mistaken for the copy. See the repo's README.\n-->\n<!--\n  GENERATED — do not edit by hand.\n  Source of truth: content/*.json (and the structural template in this file).\n  Regenerate: \`node scripts/build.js\`\n-->`
);

// A machine-readable provenance marker in <head> — conventional, harmless,
// and it travels with a fork that rebuilds. Strip any prior one (idempotent).
html = html.replace(/[ \t]*<meta name="generator"[^>]*>\s*\n?/i, '');
html = html.replace(/(<head\b[^>]*>)/i, `$1\n<meta name="generator" content="personal_website by Antares Yuan — https://github.com/AntaresYuan/personal_website">`);

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
html = replaceInner(html, 'last-updated', `updated ${escape(lastUpdated)}`);

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

// Skills header + list (between #terminal and #lens). Header uses the same
// fallback strings the template ships with, so an empty file still renders
// a tasteful header pointing the reader at /admin/.
if (skills.head) {
  if (skills.head.cmd   != null) html = replaceInner(html, 'skills-cmd',   escape(skills.head.cmd));
  if (skills.head.title != null) html = replaceInner(html, 'skills-title', escape(skills.head.title));
  if (skills.head.meta  != null) html = replaceInner(html, 'skills-meta',  escape(skills.head.meta));
}
html = replaceInner(html, 'skills-list', skillsListHtml());

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

// /usage — live AI usage dashboard (#149/#152). SSR shell renders the
// header + empty heatmap grid so first paint has no FOUC and a no-JS
// reader sees the section's structure without a broken widget.
// render.js fills the live data on boot, then refetches every 60s. If
// site.usage.enabled is false (a fork without the Worker bound), hide
// the section entirely — the structure stays in the markup for grep but
// nothing renders.
if (site.usage?.enabled === false) {
  html = setAttr(html, 'usage', 'hidden', '');
} else {
  // Empty 12×7 SVG grid — render.js replaces this innerHTML with the
  // shaded version on first fetch success. Same viewBox + cell math so
  // there's no layout shift.
  html = replaceInner(html, 'usage-heatmap', emptyHeatmapSvg());
  // Skeleton stats — em-dashes that match the post-fetch layout so the
  // row doesn't jump when real numbers land.
  html = replaceInner(html, 'usage-stats',
    [
      `<span class="usage-stat"><strong>—</strong> tokens</span>`,
      `<span class="usage-stat-sep">·</span>`,
      `<span class="usage-stat"><strong>—</strong> sessions</span>`,
      `<span class="usage-stat-sep">·</span>`,
      `<span class="usage-stat"><strong>—</strong> days active</span>`,
      `<span class="usage-stat-sep">·</span>`,
      `<span class="usage-stat usage-stat-since">since —</span>`,
    ].join(''));
}

// Footer
html = replaceInner(html, 'footer-copyright', footerHtml());

// Cache-bust the runtime assets: append a content hash as `?v=` to each
// <script src="scripts/*.js"> and to the <link rel="stylesheet" href="styles/main.css">.
// index.html is served must-revalidate (so it's always fresh) but the .js/.css
// files get a longer CDN TTL — without this, a fresh index.html can pair with a
// stale render.js *or* a stale main.css (which leaves new views, e.g. the
// timeline, rendering completely unstyled). Idempotent: an existing `?v=` is
// re-derived from the current file content each build.
const crypto = require('crypto');
const hashOf = (rel) => crypto.createHash('sha1')
  .update(fs.readFileSync(path.join(root, rel)))
  .digest('hex').slice(0, 8);
['scripts/qa-faq.js', 'scripts/render.js', 'scripts/terminal.js', 'scripts/palette.js', 'scripts/doodle.js'].forEach((rel) => {
  const v = hashOf(rel);
  html = html.replace(
    new RegExp(`src="${rel.replace(/\./g, '\\.')}(\\?v=[^"]*)?"`),
    `src="${rel}?v=${v}"`
  );
});
{
  const rel = 'styles/main.css';
  const v = hashOf(rel);
  html = html.replace(
    new RegExp(`href="${rel.replace(/\./g, '\\.')}(\\?v=[^"]*)?"`),
    `href="${rel}?v=${v}"`
  );
}

/* ── Write ────────────────────────────────────────────────────────────── */
fs.writeFileSync(tplPath, html);
console.log(`✓ wrote index.html     (${fs.statSync(tplPath).size} bytes, ${cards.length} cards inlined)`);
