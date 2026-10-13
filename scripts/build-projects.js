#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   build-projects.js — "Projects" in the Work space.

     /projects/          every project as a card
     /projects/<slug>/   one case study per project

   Source of truth: content/projects/<slug>.json (read through
   scripts/lib/projects.js, which the home carousel uses too); the page's
   heading and intro come from content/work.json → projects. A case study
   is laid out as: cover · title · facts (role, timeline, team, tools) ·
   overview · what I did · process · outcome · pictures · links · prev/next.
   Any part a project has not filled in yet renders as a labelled placeholder
   (.ph), so the template can be judged before the content exists.

   Optional fields per project: kind, logo (leads the kind chip), summary, cover (an .svg is inlined
   and follows the theme; a raster diagram takes coverFit: "contain" +
   coverBg — see coverBox in lib/projects.js), facts[{label, value, icon?}],
   story[{title, body}] (markdown sections that tell the case in its own
   shape; when present they replace overview, contribution[] and
   process[{title, body}]), live{url, poster?, width?, height?} (the real
   app, embedded — scripts/live.js), board (the id of a
   content/boards/<id>.json whiteboard), outcomes[{value, label}], images[{src, caption}],
   links[{label, href}].

   A placeholder project shows a labelled placeholder for every empty part;
   a real one (placeholder: false) just leaves the empty parts out.

   Also writes /board-editor/ — the whiteboard editor (scripts/board-editor.js),
   unlinked and not indexed; `npm run board` serves it with saving enabled.
   ════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const { escapeHtml: e, mdToHtml } = require('./lib/blog');
const shell = require('./lib/work-shell');
const { projectList, projectCardHtml, coverBox, chipHtml } = require('./lib/projects');
const i18n = require('./lib/i18n');

const root = path.join(__dirname, '..');

// Set per language in the write loop below; the renderers read them.
let LANG = 'en', work, projects;
const t = (key, vars) => i18n.t(key, LANG, vars);

/* Placeholder copy, shown wherever a project leaves a field empty. */
const PH = {
  facts: [{ label: 'Role' }, { label: 'Timeline' }, { label: 'Team' }, { label: 'Tools' }],
  overview: 'Placeholder — what this project set out to solve, for whom, and why it mattered. Two or three sentences.',
  contribution: [
    'Placeholder — the part I owned.',
    'Placeholder — a decision I made, and why.',
    'Placeholder — what I built or shipped myself.',
  ],
  process: [
    { title: 'Discover', body: 'Placeholder — research, interviews, and the insight that framed the work.' },
    { title: 'Design & build', body: 'Placeholder — prototypes, iterations, and what changed along the way.' },
    { title: 'Ship & measure', body: 'Placeholder — how it launched and how it was judged.' },
  ],
  outcomes: [
    { value: '—', label: 'Headline result' },
    { value: '—', label: 'Second result' },
    { value: '—', label: 'Third result' },
  ],
};
const ph = (real, fallback) => (real && (!Array.isArray(real) || real.length)) ? [real, false] : [fallback, true];
const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>';
const BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6"/></svg>';

const OPEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 5.5h5v5M18.5 5.5 11 13M16 13.5v4a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 5 17.5v-8A1.5 1.5 0 0 1 6.5 8h4"/></svg>';
const FULL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 9V4.5H9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15"/></svg>';

/* The project's real app, framed like a browser window. A poster until it is
   asked for (scripts/live.js loads it, scales the desktop layout to the
   column, and toggles full screen). */
const liveHtml = (p) => {
  const l = p.live;
  const w = Number(l.width) || 1440, h = Number(l.height) || 810;
  let host = l.url;
  try { host = new URL(l.url).host; } catch { /* keep the raw url */ }
  return `
        <figure class="live" data-live="${e(l.url)}" data-live-title="${e(p.title)}" style="--live-w: ${w}; --live-h: ${h}">
          <div class="live-bar">
            <span class="live-dots" aria-hidden="true"><i></i><i></i><i></i></span>
            <span class="live-url">${e(host)}</span>
            <span class="live-acts">
              <button type="button" class="live-act" data-live-act="full" aria-label="${e(t('project.live.full'))}" title="${e(t('project.live.full'))}" hidden>${FULL}</button>
              <a class="live-act" href="${e(l.url)}" target="_blank" rel="noopener" aria-label="${e(t('project.live.open'))}" title="${e(t('project.live.open'))}">${OPEN}</a>
            </span>
          </div>
          <div class="live-view">
            ${l.poster ? `<img class="live-poster" src="${e(l.poster)}" alt="${e(t('project.live.posterAlt', { title: p.title }))}" loading="lazy" decoding="async">` : ''}
            <button type="button" class="btn btn-primary live-start" data-live-act="start"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.6-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z"/></svg>${e(t('project.live.try'))}</button>
          </div>
        </figure>
        <p class="board-hint">${e(t('project.live.hint', { blocked: /\.vercel\.app$/.test(host) ? t('project.live.blocked') : '' }))}</p>`;
};

const section = (id, title, body, cls = '') => `
    <section class="case-section${cls}" aria-labelledby="${id}">
      <h2 class="case-section-title" id="${id}">${title}</h2>
      <div class="case-section-body">${body}
      </div>
    </section>`;

// A board's Chinese copy (content/boards/zh/<id>.json), when there is one.
const boardSrc = (id) => (LANG === 'zh' && fs.existsSync(path.join(root, 'content/boards/zh', `${id}.json`))
  ? `/content/boards/zh/${e(id)}.json` : `/content/boards/${e(id)}.json`);

const caseMain = (p, i) => {
  const prev = projects[(i - 1 + projects.length) % projects.length];
  const next = projects[(i + 1) % projects.length];

  const draft = p.placeholder !== false;   // show placeholders for the gaps
  const has = (v) => Array.isArray(v) ? v.length > 0 : !!v;
  const facts = (has(p.facts) ? p.facts : draft ? PH.facts : [])
    .map((f) => `<div><dt>${e(f.label)}</dt><dd${f.value ? '' : ' class="ph"'}>${f.icon ? `<img class="case-fact-icon" src="${e(f.icon)}" alt="" width="18" height="18">` : ''}${e(f.value || '—')}</dd></div>`).join('');

  const [overview, ovPh] = ph(p.overview, PH.overview);
  const [contrib, coPh] = ph(p.contribution, PH.contribution);
  const [steps, stPh] = ph(p.process, PH.process);
  const [outs, ouPh] = ph(p.outcomes, PH.outcomes);
  const story = (p.story ?? []).filter((st) => st && st.title);
  const imgs = (p.images ?? []).length
    ? p.images.map((im) => `
          <figure class="case-shot"><img src="${e(im.src)}" alt="${e(im.caption || '')}" loading="lazy" decoding="async">${im.caption ? `<figcaption>${e(im.caption)}</figcaption>` : ''}</figure>`).join('')
    : [1, 2, 3].map((n) => `
          <figure class="case-shot is-empty"><span>Placeholder · image ${n}</span></figure>`).join('');
  const links = (p.links ?? []).length
    ? p.links.map((l) => `<a class="btn" href="${e(l.href)}" target="_blank" rel="noopener">${e(l.label)}${ARROW}</a>`).join('')
    : '<span class="btn is-ph" aria-disabled="true">Placeholder · link</span><span class="btn is-ph" aria-disabled="true">Placeholder · demo</span>';

  return `  <article class="case">
    <a class="back-link" href="${i18n.localPath('/projects/', LANG)}">${BACK}${e(t('project.back'))}</a>

    ${coverBox(p, 'case-cover', { lazy: false, hidden: false })}

    <header class="case-head">
      ${chipHtml(p)}
      <h1 class="case-title">${e(p.title)}</h1>
      ${p.summary ? `<p class="case-summary">${e(p.summary)}</p>` : ''}
      ${facts ? `<dl class="case-facts">${facts}</dl>` : ''}
    </header>
${story.length ? story.map((st, k) => section(`st-${p.slug}-${k + 1}`, e(st.title), `
        <div class="prose case-prose">${mdToHtml(st.body || '')}</div>`)).join('') : [
  (draft || has(p.overview)) && section('ov-' + p.slug, e(t('project.overview')), `
        <p class="case-lead${ovPh ? ' ph' : ''}">${e(overview)}</p>`),
  (draft || has(p.contribution)) && section('do-' + p.slug, e(t('project.did')), `
        <ul class="case-list${coPh ? ' ph' : ''}">${contrib.map((c) => `<li>${e(c)}</li>`).join('')}</ul>`),
  (draft || has(p.process)) && section('pr-' + p.slug, e(t('project.process')), `
        <ol class="case-steps${stPh ? ' ph' : ''}">${steps.map((st, k) => `
          <li><span class="case-step-n">${String(k + 1).padStart(2, '0')}</span><strong>${e(st.title)}</strong><p>${e(st.body)}</p></li>`).join('')}
        </ol>`),
].filter(Boolean).join('')}
${p.live && p.live.url ? section('lv-' + p.slug, e(t('project.live.title')), liveHtml(p), ' is-wide') : ''}
${p.board ? section('bd-' + p.slug, e(t('project.board')), `
        <div class="board-embed" data-board-src="${boardSrc(p.board)}" role="img" aria-label="${e(t('project.boardAria', { title: p.title }))}"></div>
        <p class="board-hint">${e(t('project.boardHint'))}</p>`, ' is-wide') : ''}
${draft || has(p.outcomes) ? section('oc-' + p.slug, e(t('project.outcome')), `
        <dl class="case-outcomes${ouPh ? ' ph' : ''}">${outs.map((o) => `<div><dd>${e(o.value)}</dd><dt>${e(o.label)}</dt></div>`).join('')}</dl>`) : ''}
${draft || has(p.images) ? section('im-' + p.slug, e(t('project.pictures')), `
        <div class="case-gallery">${imgs}
        </div>`) : ''}
${draft || has(p.links) ? section('ln-' + p.slug, e(t('project.links')), `
        <div class="skill-actions">${links}</div>`) : ''}

    <nav class="case-nav" aria-label="${e(t('project.moreAria'))}">
      <a class="case-nav-link" href="${e(prev.url)}"><span>${e(t('project.prev'))}</span><strong>${e(prev.title)}</strong></a>
      <a class="case-nav-link is-next" href="${e(next.url)}"><span>${e(t('project.next'))}</span><strong>${e(next.title)}</strong></a>
    </nav>
  </article>`;
};

const indexMain = () => `  <section class="projects-page" aria-labelledby="projects-page-title">
    <header class="page-head">
      <div>
        <h1 class="page-title" id="projects-page-title">${e(work.projects?.title || 'Projects')}</h1>
        ${work.projects?.sub ? `<p class="page-sub">${e(work.projects.sub)}</p>` : ''}
      </div>
    </header>
    <ul class="project-grid">${projects.map(projectCardHtml).join('')}
    </ul>
  </section>`;

/* ── Write ────────────────────────────────────────────────────────────── */
for (const lang of i18n.LANGS) {
  LANG = lang;
  work = i18n.content('content/work.json', lang);
  projects = projectList(lang);
  const outDir = path.join(i18n.outRoot(lang), 'projects');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), shell.pageHtml({
    title: work.projects?.title || 'Projects',
    description: work.projects?.sub,
    lang,
    path: '/projects/',
    active: 'projects',
    bodyClass: 'projects-page-body',
    main: indexMain(),
  }));
  projects.forEach((p, i) => {
    if (p.href) return;                    // lives elsewhere; no page of its own
    const dir = path.join(outDir, p.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), shell.pageHtml({
      title: p.title,
      description: p.summary,
      lang,
      path: `/projects/${p.slug}/`,
      active: 'projects',
      bodyClass: 'case-page',
      main: caseMain(p, i),
      scripts: [p.board && 'scripts/board.js', p.live && p.live.url && 'scripts/live.js'].filter(Boolean),
    }));
  });
  const keep = new Set(projects.map((p) => p.slug));
  for (const ent of fs.readdirSync(outDir, { withFileTypes: true })) {
    if (ent.isDirectory() && !keep.has(ent.name)) fs.rmSync(path.join(outDir, ent.name), { recursive: true, force: true });
  }
}
LANG = 'en';
/* ── /board-editor/ ───────────────────────────────────────────────────── */
const TOOL = (id, label, key, icon) => `<button type="button" data-tool="${id}" title="${label} (${key})" aria-label="${label}"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg></button>`;
const editorHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Board editor</title>
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<script>
  (function () {
    var d = document.documentElement, m = 'auto';
    try { var t = localStorage.getItem('theme'); if (t === 'light' || t === 'dark' || t === 'auto') m = t; } catch (e) {}
    var dark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    d.setAttribute('data-theme-mode', m);
    d.setAttribute('data-theme', m === 'auto' ? (dark ? 'dark' : 'light') : m);
  })();
</script>
<link rel="stylesheet" href="/styles/work.css?v=${shell.hashOf('styles/work.css')}">
</head>
<body class="work-home board-editor-page">
<div class="be-app">
  <header class="be-top glass">
    <a class="be-back" href="/projects/"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6"/></svg>Projects</a>
    <span class="be-name">Board · <strong id="be-id"></strong></span>
    <span class="be-status" id="be-status">Loading…</span>
    <span class="be-spacer"></span>
    <button type="button" class="btn" id="be-undo" title="Undo (⌘Z)">Undo</button>
    <button type="button" class="btn" id="be-redo" title="Redo (⇧⌘Z)">Redo</button>
    <button type="button" class="btn" id="be-copy">Copy JSON</button>
    <button type="button" class="btn" id="be-download">Download</button>
    <button type="button" class="btn btn-primary" id="be-save">Save</button>
  </header>
  <nav class="be-tools glass" aria-label="Tools">
    ${TOOL('select', 'Select', 'V', '<path d="M6 4.5l12 7-5.2 1.3L10.5 18z"/>')}
    ${TOOL('sticky', 'Note', 'N', '<path d="M5 4.5h14v9.5l-5 5H5z"/><path d="M14 19v-5h5"/>')}
    ${TOOL('shape', 'Shape', 'R', '<rect x="4.5" y="6" width="15" height="12" rx="3.5"/>')}
    ${TOOL('text', 'Text', 'T', '<path d="M6 6h12M12 6v13"/>')}
    ${TOOL('frame', 'Frame', 'F', '<path d="M8 4v16M16 4v16M4 8h16M4 16h16"/>')}
    ${TOOL('image', 'Image', 'I', '<rect x="4" y="5.5" width="16" height="13" rx="2.5"/><circle cx="9" cy="10" r="1.5"/><path d="m4.5 17 4.5-4.5 3.5 3.5 2.5-2.5 4.5 4"/>')}
  </nav>
  <div class="be-draft glass" id="be-draft" hidden>An unsaved draft of this board was found.
    <button type="button" class="btn" data-draft="restore">Restore</button>
    <button type="button" class="btn" data-draft="discard">Discard</button>
  </div>
  <div class="be-canvas" id="be-board"></div>
  <aside class="be-inspector glass" id="be-inspector" aria-label="Properties" hidden></aside>
</div>
<script src="/scripts/board.js?v=${shell.hashOf('scripts/board.js')}" defer></script>
<script src="/scripts/board-editor.js?v=${shell.hashOf('scripts/board-editor.js')}" defer></script>
</body>
</html>
`;
fs.mkdirSync(path.join(root, 'board-editor'), { recursive: true });
fs.writeFileSync(path.join(root, 'board-editor', 'index.html'), editorHtml);

console.log(`✓ wrote projects/      (index + ${projects.filter((p) => !p.href).length} case studies, board editor)`);
