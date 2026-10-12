#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   build-skills-page.js — "AI Skills" in the Work space.

     /skills/          the catalogue: the featured kit, search, category
                       filters, and every skill as a row (Codex-style).
                       Each entry links straight to its official site or,
                       when it has no site, its GitHub repository.

   Source of truth: content/skills.json — the same file Personal's /skills
   list renders from, so a skill is added once. Optional per-item fields the
   catalogue uses: tagline, install, repo, site, featured, cover (a banner
   for the featured card), hue, and stats[].
   ════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const { escapeHtml: e } = require('./lib/blog');
const shell = require('./lib/work-shell');
const i18n = require('./lib/i18n');

const root = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const sorted = (list) => (list ?? []).slice()
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || String(a.name).localeCompare(String(b.name)));
// The filter category comes from the English category, whatever the page's
// language shows.
const EN_CAT = new Map(sorted((() => { try { return read('content/skills.json'); } catch { return { items: [] }; } })().items)
  .map((s) => [s.slug, s.category]));
// Per language; set in the write loop below.
let L = 'en', items = [];
const t = (key) => i18n.t(key, L);

/* Categories, normalised for the filter row: "Claude Code skill" and
   "Claude Code Skill" are one category. */
const catKey = (c) => {
  const k = String(c || 'other').toLowerCase();
  if (k.includes('plugin')) return 'plugins';
  if (k.includes('infra')) return 'infra';
  if (k.includes('kit')) return 'kits';
  return 'skills';
};
const catOf = (s) => catKey(EN_CAT.get(s.slug) ?? s.category);

/* ── Pieces ───────────────────────────────────────────────────────────── */
const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/></svg>';
const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>';

// An app-icon tile: the skill's hue as a soft gradient, its initial in white.
const iconOf = (s, size) => {
  const glyph = String(s.name || '?').replace(/^[^A-Za-z0-9]+/, '').charAt(0).toUpperCase() || '?';
  return `<span class="skill-icon${size ? ` skill-icon-${size}` : ''}" style="--hue: ${s.hue ?? 222}" aria-hidden="true">${e(glyph)}</span>`;
};

const installBox = (s) => s.install
  ? `<div class="install">
        <code class="install-cmd">${e(s.install)}</code>
        <button class="copy-btn" type="button" data-copy="${e(s.install)}" aria-label="${e(t('skills.copyAria'))}">${COPY_ICON}<span>${e(t('skills.copy'))}</span></button>
      </div>`
  : '';

const statsRow = (s) => (s.stats && s.stats.length)
  ? `<dl class="skill-stats">${s.stats.map((x) => `<div><dt>${e(x.label)}</dt><dd>${e(x.value)}</dd></div>`).join('')}</dl>`
  : '';

const searchText = (s) => [s.name, s.tagline, s.summary, s.category].filter(Boolean).join(' ').toLowerCase();
const destinationOf = (s) => s.site || s.repo;

/* ── Catalogue ────────────────────────────────────────────────────────── */
const catalogueMain = () => {
const featured = items.find((s) => s.featured);
const cats = [...new Set(items.map(catOf))];

/* The featured kit. With a `cover` (a banner, e.g. the kit's own site hero)
   the card stacks: a compact, intentionally cropped banner on top and the
   body below it in two columns; the summary then stands in for the tagline,
   which the banner already says. Without one, the hue panel and icon sit
   beside the body. A featured item with its own site points there directly. */
const featuredHref = featured ? destinationOf(featured) : '';
const featuredLinkAttrs = featuredHref ? ' target="_blank" rel="noopener"' : '';
const featuredHtml = featured ? `
    <section class="featured${featured.cover ? ' has-cover' : ''}" aria-label="${e(t('skills.featured'))}">
      ${featured.cover
        ? `<a class="featured-cover" href="${e(featuredHref)}"${featuredLinkAttrs} tabindex="-1"><img src="${e(featured.cover)}" alt="${e(featured.name)}: ${e(featured.tagline || '')}" decoding="async"></a>`
        : `<div class="featured-art" style="--hue: ${featured.hue ?? 222}" aria-hidden="true">
        ${iconOf(featured, 'xl')}
      </div>`}
      <div class="featured-body">
        <div class="featured-main">
          <p class="featured-kicker">${e(t('skills.featured'))} · ${e(featured.category || '')}</p>
          <h2 class="featured-title"><a href="${e(featuredHref)}"${featuredLinkAttrs}>${e(featured.name)}</a></h2>
          <p class="featured-tagline">${e((featured.cover ? featured.summary : featured.tagline) || featured.summary || '')}</p>
          ${statsRow(featured)}
        </div>
        <div class="featured-side">
          ${installBox(featured)}
          <div class="skill-actions">
            <a class="btn btn-primary" href="${e(featuredHref)}"${featuredLinkAttrs}>${featured.site ? e(t('skills.visit')) : 'GitHub'}${ARROW}</a>
            ${featured.site && featured.repo ? `<a class="btn" href="${e(featured.repo)}" target="_blank" rel="noopener">GitHub${ARROW}</a>` : ''}
          </div>
        </div>
      </div>
    </section>` : '';

const rowHtml = (s) => {
  const destination = destinationOf(s);
  return `
        <li class="skill-row" data-tags="${catOf(s)}" data-search="${e(searchText(s))}">
          <a class="skill-row-link" href="${e(destination)}" target="_blank" rel="noopener">
            ${iconOf(s)}
            <span class="skill-row-text">
              <span class="skill-row-name">${e(s.name)}</span>
              <span class="skill-row-sub">${e(s.tagline || s.summary || '')}</span>
            </span>
            <span class="skill-get">${s.site ? e(t('skills.visit')) : 'GitHub'}${ARROW}</span>
          </a>
        </li>`;
};

return `  <section class="skills" aria-labelledby="skills-title">
    <header class="page-head">
      <div>
        <h1 class="page-title" id="skills-title">${e(t('skills.title'))}</h1>
        <p class="page-sub">${e(t('skills.sub'))}</p>
      </div>
      <label class="search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
        <input type="search" placeholder="${e(t('skills.search'))}" aria-label="${e(t('skills.search'))}" data-search-for="skill-list">
      </label>
    </header>
${featuredHtml}
    <div class="filters" role="group" aria-label="${e(t('skills.filterAria'))}" data-filter-for="skill-list">
      <button class="filter is-on" type="button" data-filter="all" aria-pressed="true">${e(t('skills.all'))}</button>${cats.map((c) =>
        `<button class="filter" type="button" data-filter="${c}" aria-pressed="false">${e(t(`skills.cat.${c}`))}</button>`).join('')}
    </div>
    <ul class="skill-list" id="skill-list">${items.map(rowHtml).join('')}
    </ul>
    <p class="empty" id="skill-list-empty" hidden>${e(t('skills.empty'))}</p>
  </section>`;
};

/* ── Write ────────────────────────────────────────────────────────────── */
for (const lang of i18n.LANGS) {
  L = lang;
  items = sorted((() => { try { return i18n.content('content/skills.json', lang); } catch { return { items: [] }; } })().items);
  const outDir = path.join(i18n.outRoot(lang), 'skills');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), shell.pageHtml({
    title: t('skills.title'),
    description: t('skills.description'),
    lang,
    path: '/skills/',
    active: 'skills',
    bodyClass: 'skills-page',
    main: catalogueMain(),
  }));
  // This catalogue deliberately has no internal detail pages. Every skill row
  // links to the project's official site or GitHub repository instead.
  for (const ent of fs.readdirSync(outDir, { withFileTypes: true })) {
    if (ent.isDirectory()) fs.rmSync(path.join(outDir, ent.name), { recursive: true, force: true });
  }
}
console.log(`✓ wrote skills/        (catalogue, ${items.length} direct links, ${i18n.LANGS.length} languages)`);
