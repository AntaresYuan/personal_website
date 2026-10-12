/* ─────────────────────────────────────────────────────────────────────────
   The Work space's projects, as one list for every place that shows them:
   the home carousel (build-html.js), the /projects/ index and each
   /projects/<slug>/ case study (build-projects.js).

   Source: content/projects/<slug>.json, one file per project (a folder
   collection in the CMS), shown in `order` and then by file name. The slug
   defaults to the file name. Every field past title is optional; a case
   study with a gap shows a labelled placeholder in its place, so the page
   can be judged before the content exists. A project with
   `placeholder: true` is marked as one on its card; one with `draft: true`
   is left off the site (like a Writing draft). The section's heading
   and intro stay in content/work.json → projects.

   In Chinese (lang 'zh'), content/zh/projects/<slug>.json is laid over each
   project (lib/i18n.js → merge), links go to /zh/projects/<slug>/, and a
   cover.zh.svg next to the cover replaces it.
   ───────────────────────────────────────────────────────────────────────── */
const fs = require('fs');
const path = require('path');
const { escape } = require('./html-replace');
const i18n = require('./i18n');

const root = path.join(__dirname, '..', '..');
const HUES = [262, 305, 200, 285, 170, 235];   // OKLCH hue angles, a cool family

const DIR = path.join(root, 'content/projects');
const ZH_DIR = path.join(root, 'content/zh/projects');
const load = (f, lang) => {
  const base = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const zh = lang === 'zh' && fs.existsSync(path.join(ZH_DIR, f)) ? JSON.parse(fs.readFileSync(path.join(ZH_DIR, f), 'utf8')) : null;
  const p = zh ? i18n.merge(base, zh) : base;
  if (lang === 'zh' && p.cover && /\.svg$/i.test(p.cover)) {
    const zhCover = p.cover.replace(/\.svg$/i, '.zh.svg');
    if (fs.existsSync(path.join(root, zhCover.replace(/^\//, '')))) p.cover = zhCover;
  }
  return p;
};
const projectList = (lang = 'en') => {
  const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.json')) : [];
  return files
    .map((f) => ({ file: f, ...load(f, lang) }))
    .filter((p) => !p.draft)
    .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.file.localeCompare(b.file))
    .map(({ file, ...p }, i) => {
      const slug = p.slug || file.replace(/\.json$/, '');
      return {
        ...p,
        slug,
        num: String(i + 1).padStart(2, '0'),
        hue: p.hue ?? HUES[i % HUES.length],
        url: p.href || i18n.localPath(`/projects/${slug}/`, lang),
        lang,
      };
    });
};

/* A project's cover box — the card's and the case study's share it.
   - No cover: the project number on the hue backdrop.
   - An .svg cover is inlined, not linked: an <img> can't see the page's
     data-theme or fonts, an inline one takes --text, --accent… and swaps
     with light/dark. Draw it on a transparent ground; the hue backdrop shows
     through. Its classes and <style> must be namespaced, and it must not use
     ids (the same cover can sit in a card and a case page).
   - `coverFit: "contain"` shows a raster cover whole (a diagram, a screenshot
     with text) instead of cropping it; `coverBg` fills the margin, so it
     reads as one piece when it matches the image's own background. */
const coverBox = (p, cls, { lazy = true, hidden = true } = {}) => {
  const svg = /\.svg$/i.test(p.cover || '');
  const contain = !svg && p.cover && p.coverFit === 'contain';
  let inner = `<span class="project-num">${p.num}</span>`;
  if (svg) {
    inner = fs.readFileSync(path.join(root, p.cover.replace(/^\//, '')), 'utf8')
      .replace(/<\?xml[^>]*>/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\n\s*\n/g, '\n').trim();
  } else if (p.cover) {
    inner = `<img src="${escape(p.cover)}" alt=""${lazy ? ' loading="lazy"' : ''} decoding="async">`;
  }
  const style = `--hue: ${p.hue}${contain && p.coverBg ? `; --cover-bg: ${escape(p.coverBg)}` : ''}`;
  return `<div class="${cls}${svg ? ' is-svg' : contain ? ' is-contain' : ''}" style="${style}"${hidden || !svg ? ' aria-hidden="true"' : ''}>${inner}</div>`;
};

// The kind chip, led by the project's logo when it has one (a company mark).
// A long kind ("ByteDance · AI Agent · 2K+ DAU") wraps on a phone between its
// " · " parts (each an inline-block, the dot kept at the end of a line); only
// a part wider than the whole line breaks inside.
const chipText = (kind) => {
  const parts = String(kind).split(' · ');
  return parts.map((part, i) => `<span class="chip-part"><span class="chip-copy">${escape(part)}</span>${i < parts.length - 1 ? '&nbsp;·' : ''}</span>`).join(' ');
};
const chipHtml = (p) => p.kind
  ? `<span class="project-chip">${p.logo ? `<img class="project-chip-logo" src="${escape(p.logo)}" alt="" width="14" height="14">` : ''}<span>${chipText(p.kind)}</span></span>`
  : '';

// One card — the home carousel and the /projects/ grid share it.
const projectCardHtml = (p) => {
  const chip = chipHtml(p);
  return `
        <li class="project-card${p.placeholder ? ' is-placeholder' : ''}" style="--hue: ${p.hue}">
          <a class="project-link" href="${escape(p.url)}">
            ${coverBox(p, 'project-cover')}
            <div class="project-body">
              ${chip}
              <h3 class="project-title">${escape(p.title ?? '')}</h3>
              ${p.summary ? `<p class="project-summary">${escape(p.summary)}</p>` : ''}
            </div>
          </a>
        </li>`;
};

module.exports = { projectList, projectCardHtml, coverBox, chipHtml };
