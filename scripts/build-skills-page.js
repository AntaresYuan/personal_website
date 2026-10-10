#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   build-skills-page.js — "AI Skills" in the Work space.

     /skills/          the catalogue: the featured kit, search, category
                       filters, and every skill as a row (Codex-style)
     /skills/<slug>/   one page per skill: overview, evaluation, install

   Source of truth: content/skills.json — the same file Personal's /skills
   list renders from, so a skill is added once. Optional per-item fields the
   catalogue uses: tagline, install, installNote, download, repo, site,
   version, license, featured, cover (a banner for the featured card), hue,
   stats[], eval{status, note, metrics[],
   checks[]}.

   Evaluation is shown as it stands: a status, any published numbers, and
   the checks the skill runs on itself. Nothing is filled in that the skill's
   own README does not claim.
   ════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const { mdToHtml, escapeHtml: e } = require('./lib/blog');
const shell = require('./lib/work-shell');

const root = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const site = read('content/site.json');
const SITE_URL = (site.meta?.url ?? 'https://example.com').replace(/\/$/, '');

const skills = (() => { try { return read('content/skills.json'); } catch { return { items: [] }; } })();
const urlSlug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const items = (skills.items ?? []).slice()
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || String(a.name).localeCompare(String(b.name)))
  .map((s) => ({ ...s, url: `/skills/${urlSlug(s.slug)}/` }));

/* Categories, normalised for the filter row: "Claude Code skill" and
   "Claude Code Skill" are one category. */
const catKey = (c) => {
  const k = String(c || 'other').toLowerCase();
  if (k.includes('plugin')) return 'plugins';
  if (k.includes('infra')) return 'infra';
  if (k.includes('kit')) return 'kits';
  return 'skills';
};
const CAT_LABEL = { kits: 'Skill kits', skills: 'Skills', plugins: 'Plugins', infra: 'Agent infra' };

/* ── Pieces ───────────────────────────────────────────────────────────── */
const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/></svg>';
const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>';
const DL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v11M7 11.5l5 5 5-5M6 19.5h12"/></svg>';

// An app-icon tile: the skill's hue as a soft gradient, its initial in white.
const iconOf = (s, size) => {
  const glyph = String(s.name || '?').replace(/^[^A-Za-z0-9]+/, '').charAt(0).toUpperCase() || '?';
  return `<span class="skill-icon${size ? ` skill-icon-${size}` : ''}" style="--hue: ${s.hue ?? 222}" aria-hidden="true">${e(glyph)}</span>`;
};

const installBox = (s) => s.install
  ? `<div class="install">
        <code class="install-cmd">${e(s.install)}</code>
        <button class="copy-btn" type="button" data-copy="${e(s.install)}" aria-label="Copy install command">${COPY_ICON}<span>Copy</span></button>
      </div>`
  : '';

const statsRow = (s) => (s.stats && s.stats.length)
  ? `<dl class="skill-stats">${s.stats.map((x) => `<div><dt>${e(x.label)}</dt><dd>${e(x.value)}</dd></div>`).join('')}</dl>`
  : '';

const actions = (s) => {
  const out = [];
  if (s.download) out.push(`<a class="btn btn-primary" href="${e(s.download)}" target="_blank" rel="noopener">${DL_ICON}Download</a>`);
  if (s.site) out.push(`<a class="btn" href="${e(s.site)}" target="_blank" rel="noopener">Site${ARROW}</a>`);
  if (s.repo) out.push(`<a class="btn" href="${e(s.repo)}" target="_blank" rel="noopener">GitHub${ARROW}</a>`);
  return out.length ? `<div class="skill-actions">${out.join('')}</div>` : '';
};

const EVAL_STATUS = {
  published: ['Published', 'is-good'],
  running: ['Running', 'is-warm'],
  designed: ['Designed, not yet run', 'is-warm'],
  none: ['No benchmark yet', ''],
};

const searchText = (s) => [s.name, s.tagline, s.summary, s.category].filter(Boolean).join(' ').toLowerCase();

/* ── Catalogue ────────────────────────────────────────────────────────── */
const featured = items.find((s) => s.featured);
const rest = items.filter((s) => s !== featured);
const cats = [...new Set(items.map((s) => catKey(s.category)))];

/* The featured kit. With a `cover` (a banner, e.g. the kit's own site hero)
   the card stacks: the banner whole on top — its words are the point, so it
   is never cropped — and the body below it in two columns; the summary then
   stands in for the tagline, which the banner already says. Without one, the
   hue panel and icon sit beside the body. */
const featuredHtml = featured ? `
    <section class="featured${featured.cover ? ' has-cover' : ''}" aria-label="Featured">
      ${featured.cover
        ? `<a class="featured-cover" href="${featured.url}" tabindex="-1"><img src="${e(featured.cover)}" alt="${e(featured.name)}: ${e(featured.tagline || '')}" decoding="async"></a>`
        : `<div class="featured-art" style="--hue: ${featured.hue ?? 222}" aria-hidden="true">
        ${iconOf(featured, 'xl')}
      </div>`}
      <div class="featured-body">
        <div class="featured-main">
          <p class="featured-kicker">Featured · ${e(featured.category || '')}</p>
          <h2 class="featured-title"><a href="${featured.url}">${e(featured.name)}</a></h2>
          <p class="featured-tagline">${e((featured.cover ? featured.summary : featured.tagline) || featured.summary || '')}</p>
          ${statsRow(featured)}
        </div>
        <div class="featured-side">
          ${installBox(featured)}
          <div class="skill-actions">
            <a class="btn btn-primary" href="${featured.url}">Details</a>
            ${featured.site ? `<a class="btn" href="${e(featured.site)}" target="_blank" rel="noopener">Site${ARROW}</a>` : ''}
            ${featured.repo ? `<a class="btn" href="${e(featured.repo)}" target="_blank" rel="noopener">GitHub${ARROW}</a>` : ''}
          </div>
        </div>
      </div>
    </section>` : '';

const rowHtml = (s) => `
        <li class="skill-row" data-tags="${catKey(s.category)}" data-search="${e(searchText(s))}">
          <a class="skill-row-link" href="${s.url}">
            ${iconOf(s)}
            <span class="skill-row-text">
              <span class="skill-row-name">${e(s.name)}</span>
              <span class="skill-row-sub">${e(s.tagline || s.summary || '')}</span>
            </span>
            <span class="skill-get">${s.install ? 'Get' : s.download ? 'Download' : 'View'}</span>
          </a>
        </li>`;

const catalogueMain = `  <section class="skills" aria-labelledby="skills-title">
    <header class="page-head">
      <div>
        <h1 class="page-title" id="skills-title">AI Skills</h1>
        <p class="page-sub">Skills and plugins I built for Claude Code and other agents. Each one installs in a line — the details page shows what it does and how it checks itself.</p>
      </div>
      <label class="search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
        <input type="search" placeholder="Search skills" aria-label="Search skills" data-search-for="skill-list">
      </label>
    </header>
${featuredHtml}
    <div class="filters" role="group" aria-label="Filter by type" data-filter-for="skill-list">
      <button class="filter is-on" type="button" data-filter="all" aria-pressed="true">All</button>${cats.map((c) =>
        `<button class="filter" type="button" data-filter="${c}" aria-pressed="false">${CAT_LABEL[c] || c}</button>`).join('')}
    </div>
    <ul class="skill-list" id="skill-list">${items.map(rowHtml).join('')}
    </ul>
    <p class="empty" id="skill-list-empty" hidden>No skill matches that.</p>
  </section>`;

/* ── Detail ───────────────────────────────────────────────────────────── */
const detailMain = (s) => {
  const ev = s.eval || {};
  const [statusLabel, statusClass] = EVAL_STATUS[ev.status] || EVAL_STATUS.none;
  const metrics = (ev.metrics && ev.metrics.length)
    ? `<dl class="skill-stats">${ev.metrics.map((m) => `<div><dt>${e(m.label)}</dt><dd>${e(m.value)}</dd></div>`).join('')}</dl>` : '';
  const checks = (ev.checks && ev.checks.length)
    ? `<ul class="checks">${ev.checks.map((c) => `<li>${e(c)}</li>`).join('')}</ul>` : '';
  const meta = [s.category, s.version, s.license].filter(Boolean).map(e).join('<span aria-hidden="true"> · </span>');
  return `  <article class="skill-page">
    <a class="back-link" href="/skills/"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6"/></svg>AI Skills</a>
    <header class="skill-head">
      ${iconOf(s, 'lg')}
      <div class="skill-head-text">
        <h1 class="skill-name">${e(s.name)}</h1>
        <p class="skill-meta">${meta}</p>
        <p class="skill-tagline">${e(s.tagline || s.summary || '')}</p>
      </div>
    </header>
${actions(s)}
${statsRow(s)}

    <section class="skill-section" aria-labelledby="sec-install">
      <h2 class="skill-section-title" id="sec-install">Install</h2>
      ${s.install ? installBox(s) : s.download
        ? `<p class="skill-note">A desktop app — <a href="${e(s.download)}" target="_blank" rel="noopener">download it here</a>.</p>`
        : '<p class="skill-note">Not published as an installable package yet.</p>'}
${s.installNote ? `<p class="skill-note">${e(s.installNote)}</p>` : ''}
    </section>

    <section class="skill-section" aria-labelledby="sec-eval">
      <h2 class="skill-section-title" id="sec-eval">Evaluation</h2>
      <p class="eval-status"><span class="badge ${statusClass}">${e(statusLabel)}</span>${ev.note ? `<span>${e(ev.note)}</span>` : ''}</p>
${metrics}
${checks ? `<h3 class="skill-sub">How it checks itself</h3>${checks}` : ''}
    </section>

${s.details ? `<section class="skill-section" aria-labelledby="sec-about">
      <h2 class="skill-section-title" id="sec-about">About</h2>
      <div class="prose">
${mdToHtml(s.details)}
      </div>
    </section>` : ''}
  </article>`;
};

/* ── Write ────────────────────────────────────────────────────────────── */
const outDir = path.join(root, 'skills');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), shell.pageHtml({
  title: 'AI Skills',
  description: 'Skills and plugins for Claude Code and other agents, by Antares Yuan — install in one line.',
  canonical: `${SITE_URL}/skills/`,
  active: 'skills',
  bodyClass: 'skills-page',
  main: catalogueMain,
}));
for (const s of items) {
  const dir = path.join(outDir, urlSlug(s.slug));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), shell.pageHtml({
    title: `${s.name} — AI Skills`,
    description: s.tagline || s.summary,
    canonical: `${SITE_URL}${s.url}`,
    active: 'skills',
    bodyClass: 'skills-page skill-detail',
    main: detailMain(s),
  }));
}
// Drop pages for skills that were removed.
const keep = new Set(items.map((s) => urlSlug(s.slug)));
for (const ent of fs.readdirSync(outDir, { withFileTypes: true })) {
  if (ent.isDirectory() && !keep.has(ent.name)) fs.rmSync(path.join(outDir, ent.name), { recursive: true, force: true });
}
console.log(`✓ wrote skills/        (catalogue + ${items.length} skill pages)`);
