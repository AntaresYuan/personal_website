#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   Build the Work page: a one-screen résumé.

   The previous version reused the site's section layout and ran 4,105px —
   5.5 screens, with the skills block alone taller than experience and
   projects combined. "On-page" has to mean one page, so this is written from
   scratch rather than trimmed out of the old markup.

   The whole thing is a CSS grid sized to 100vh: identity and contact on the
   left rail, the numbers that matter across the top, then experience and
   selected work side by side. Everything deeper — full write-ups, the board,
   the terminal — lives one click away at /work/<slug>/ or in the Personal
   space.

   Written to index.html. Personal has its own template and is unaffected.
   ───────────────────────────────────────────────────────────────────────── */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

const site = read('content/site.json');
const profile = read('content/profile.json');
const board = read('content/board.json');
const skills = read('content/skills.json');

const e = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const hashOf = (rel) => crypto.createHash('sha1')
  .update(fs.readFileSync(path.join(root, rel))).digest('hex').slice(0, 8);

const SITE_NAME = site.meta?.siteName ?? 'Antares Yuan';
const BASE = (site.meta?.url ?? '').replace(/\/+$/, '');

/* ── Data ──────────────────────────────────────────────────────────────── */
const jobs = profile.experience ?? [];
const projects = (board.cards ?? [])
  .filter((c) => c.resume && c.slug)
  .sort((a, b) => {
    const rank = { shipped: 0, now: 1, next: 2, later: 3 };
    return ((rank[a.status] ?? 9) - (rank[b.status] ?? 9)) || ((a.order ?? 99) - (b.order ?? 99));
  });

/* The four headline numbers. Pulled from the same records rendered below, so
   they cannot contradict the detail. Before/after pairs first — movement is a
   stronger claim than a standalone figure. */
const allMetrics = [
  ...jobs.flatMap((j) => (j.highlights ?? []).flatMap((h) =>
    (h.metrics ?? []).map((m) => ({ ...m, src: j.org })))),
  ...projects.flatMap((c) => (c.metrics ?? []).map((m) => ({ ...m, src: c.title }))),
];
const headline = [
  ...allMetrics.filter((m) => m.from),
  ...allMetrics.filter((m) => !m.from),
].slice(0, 4);

const metricPair = (m, cls = 'm') => m.from
  ? `<span class="${cls}-from">${e(m.from)}</span><span class="${cls}-arr" aria-hidden="true">→</span><span class="${cls}-to">${e(m.to)}</span>`
  : `<span class="${cls}-to">${e(m.to)}</span>`;

/* ── Blocks ────────────────────────────────────────────────────────────── */
const headlineHtml = headline.map((m) => `
          <li class="hl">
            <span class="hl-val">${metricPair(m, 'hl')}</span>
            <span class="hl-label">${e(m.label)}</span>
          </li>`).join('');

const expHtml = jobs.map((j) => `
        <article class="cv-job">
          <div class="cv-job-head">
            <h3>${e(j.org)}</h3>
            <span class="cv-when">${e(j.period ?? '')}</span>
          </div>
          <p class="cv-job-role">${e(j.role)}${j.team ? ` · ${e(j.team)}` : ''}</p>
          <ul class="cv-krs">
            ${(j.highlights ?? []).map((h) => {
              const top = (h.metrics ?? [])[0];
              return `<li>
              <span class="cv-kr-t">${e(h.title)}</span>
              ${top ? `<span class="cv-kr-m">${metricPair(top)}</span>` : ''}
            </li>`;
            }).join('')}
          </ul>
        </article>`).join('');

/* Category, derived from the tags already on the card rather than a second
   field to keep in sync. Order matters: INTERN wins over the others because a
   shipped internal project is the stronger claim. */
const categoryOf = (c) => {
  const t = (c.tags ?? []).map((x) => String(x).toUpperCase());
  if (t.some((x) => x.includes('INTERN'))) return 'intern proj';
  if (t.some((x) => x.includes('RESEARCH') || x.includes('BENCHMARK'))) return 'benchmark';
  if (t.some((x) => x.includes('HACKATHON'))) return 'hackathon';
  if (t.some((x) => x.includes('SIDE'))) return 'side proj';
  return 'project';
};

/* Cards are deliberately not all one width. Equal tiles give every project the
   same weight and make the reader scan all of them to find the two that carry
   the résumé; size is the ranking. Widest first, so the ranking reads as
   ranking rather than as an alternating pattern. */
const SIZE_RANK = { lg: 0, md: 1, sm: 2 };
const ranked = [...projects].sort((a, b) =>
  (SIZE_RANK[a.size] ?? 1) - (SIZE_RANK[b.size] ?? 1));

/* Each card shows its own leading metric — including one the headline strip
   also shows.

   De-duplicating against the headline was right when the two sat side by side
   in one screen, where the repeat read as a layout bug. In this layout they are
   a section apart, and suppressing the overlap had a worse effect: Lark Loom
   and Coze, the two widest cards, had every metric taken by the headline and so
   rendered with an empty footer, while the smallest card kept its number. The
   size ranking inverted — the cards claiming the most attention showed the
   least. A summary strip repeating a figure from the item below it is ordinary;
   an empty headline slot on your strongest project is not. */
const projHtml = ranked.map((c) => {
  const top = (c.metrics ?? [])[0];
  const cat = categoryOf(c);
  const applied = (c.applied ?? []).map((s) =>
    `<span class="wcard-sk">${e(s)}</span>`).join('');
  return `
          <li><a class="wcard wcard-${e(c.size ?? 'md')}" href="/work/${e(c.slug)}/">
            <span class="wcard-top">
              <span class="wcard-tag wcard-tag-${cat.replace(/\s+/g, '-')}">${e(cat)}</span>
              ${c.status === 'shipped' ? '<span class="wcard-badge">shipped</span>' : ''}
            </span>
            <span class="wcard-t">${e(c.title)}</span>
            <span class="wcard-d">${e(c.oneLine ?? c.summary ?? '')}</span>
            ${applied ? `<span class="wcard-sks">${applied}</span>` : ''}
            <span class="wcard-foot">
              ${top ? `<span class="wcard-m">${metricPair(top, 'wcard')}</span>
              <span class="wcard-ml" title="${e(top.label)}">${e(top.label)}</span>` : ''}
            </span>
          </a></li>`;
}).join('');

/* Skills means the AI skills I authored and run — packaged Claude Code skills,
   plugins, agent infra — not a list of techniques I claim to know. Techniques
   live per-project on the cards above, where they can be checked against an
   outcome. */
const skillHtml = (skills.items ?? [])
  .slice()
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
  .map((s) => {
    const href = (s.links ?? []).find((l) => /github/i.test(l.label ?? ''))?.href;
    const tag = e(s.category ?? 'skill').toLowerCase();
    const open = href
      ? `<a class="wcard wcard-skill" href="${e(href)}" target="_blank" rel="noopener">`
      : '<span class="wcard wcard-skill">';
    return `
          <li>${open}
            <span class="wcard-top">
              <span class="wcard-tag wcard-tag-skill">${tag}</span>
              ${href ? '<span class="wcard-badge">github ↗</span>' : ''}
            </span>
            <span class="wcard-t wcard-t-mono">${e(s.name ?? s.title ?? '')}</span>
            <span class="wcard-d">${e(s.summary ?? '')}</span>
          ${href ? '</a>' : '</span>'}</li>`;
  }).join('');

const v = {
  css: hashOf('styles/main.css'),
  render: hashOf('scripts/render.js'),
  skins: hashOf('scripts/skins.js'),
  skinrt: hashOf('scripts/skin-runtime.js'),
  chars: hashOf('scripts/skin-characters.js'),
  diva: hashOf('scripts/skin-diva.js'),
  spaces: hashOf('scripts/spaces.js'),
  sel: hashOf('scripts/ask-selection.js'),
  beacon: hashOf('scripts/beacon.js'),
  qa: hashOf('scripts/qa-faq.js'),
  palette: hashOf('scripts/palette.js'),
};

const html = `<!DOCTYPE html>
<!--
  GENERATED — do not edit by hand. Source: scripts/build-work-page.js
  A one-screen résumé. Depth lives at /work/<slug>/ and in /personal/.
-->
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${e(SITE_NAME)} · ${e(profile.role ?? 'AI Product Manager')}</title>
<meta name="description" content="${e(site.meta?.description ?? '')}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${e(BASE)}/">
<meta property="og:type" content="website">
<meta property="og:title" content="${e(SITE_NAME)}">
<meta property="og:description" content="${e(site.meta?.description ?? '')}">
<meta property="og:url" content="${e(BASE)}/">
<meta name="theme-color" content="#FAF7F0" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#14130D" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/styles/main.css?v=${v.css}">
<script>
  /* Inline and first — applying the stored theme after paint flashes the
     wrong palette on every load. */
  (function () {
    try {
      var t = localStorage.getItem('theme');
      if (t && t !== 'auto') document.documentElement.setAttribute('data-theme', t);
      var s = localStorage.getItem('skin');
      if (s) document.documentElement.setAttribute('data-skin', s);
    } catch (e) {}
  })();
</script>
</head>
<body class="cv-page">

<nav class="topnav">
  <div class="brand" id="space-switcher">
    <button class="brand-btn" id="space-trigger" type="button"
            aria-haspopup="menu" aria-expanded="false" aria-controls="space-menu">
      <span class="dot" aria-hidden="true"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg></span>
      <span id="brand-name">${e(SITE_NAME)}</span>
      <svg class="brand-caret" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"
           fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"
           stroke-linejoin="round"><path d="M3 4.6L6 7.6L9 4.6"/></svg>
    </button>
    <div class="space-menu" id="space-menu" role="menu" aria-labelledby="space-trigger" hidden></div>
  </div>
  <div class="topnav-end">
    <a class="topnav-link" href="/blog/">blog</a>
    <button class="topnav-search" id="palette-fab" type="button"
            title="Search (⌘K)" aria-label="Search">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none"
           stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <circle cx="7.2" cy="7.2" r="4.3"/><path d="M10.6 10.6L13.4 13.4"/>
      </svg>
    </button>
    <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Theme" title="Theme">
      <span class="tt-icon tt-auto" aria-hidden="true">◐</span>
      <span class="tt-icon tt-light" aria-hidden="true">☀</span>
      <span class="tt-icon tt-dark" aria-hidden="true">☾</span>
    </button>
    <!-- Skin picker. skin-runtime.js fills the list; without the container the
         16 skins are unreachable from this page. -->
    <details class="skin-picker" id="skin-picker">
      <summary aria-label="Skin"><span id="skin-current">Paper</span> <span class="skin-caret" aria-hidden="true">⌄</span></summary>
      <div class="skin-menu" id="skin-menu"></div>
    </details>
  </div>
</nav>

<main class="cv">
  <!-- Identity and the live number, side by side. -->
  <header class="cv-top">
    <div class="cv-id">
      <h1 class="cv-name">Antares <em>Yuan</em></h1>
      <p class="cv-claim">Every AI product I build, I can tell you<br>
        <b>exactly what moved, and by how much.</b></p>
      <p class="cv-role">${e(profile.role ?? '')}</p>
      <p class="cv-meta">
        <span>${e(profile.location ?? '')}</span>
        <a href="/media/Antares_PM_resume__4_3.pdf" target="_blank" rel="noopener">résumé&nbsp;↓</a>
        <a lang="zh" href="/media/袁晨杰产品简历(MultiAgent 6.19).pdf" target="_blank" rel="noopener">简历&nbsp;↓</a>
        <span>${e(profile.status ?? '')}</span>
      </p>
    </div>
    <!-- Live usage: the one thing here that is still running as you read it. -->
    <a class="cv-usage" href="/usage/">
      <span class="cv-usage-n" id="cv-usage-total">—</span>
      <span class="cv-usage-l" id="cv-usage-sub">tokens</span>
      <span class="cv-spark" id="cv-usage-spark" aria-hidden="true"></span>
      <span class="cv-usage-go">all charts →</span>
    </a>
  </header>

  <!-- Headline numbers: the first thing read, and all checkable. -->
  <section class="cv-headline" aria-label="Highlights">
    <ul class="hl-list">${headlineHtml}</ul>
  </section>

  <section class="cv-block" aria-label="Experience">
    <h2 class="cv-h">experience</h2>
    ${expHtml}
  </section>

  <section class="cv-block" aria-label="Selected work">
    <h2 class="cv-h">projects<span class="cv-lead">${ranked.length}, each with a number attached — scroll for more →</span></h2>
    <div class="wrail-wrap"><ol class="wrail">${projHtml}</ol></div>
  </section>

  <section class="cv-block" aria-label="Skills">
    <h2 class="cv-h">skills<span class="cv-lead">AI skills I wrote and use daily</span></h2>
    <div class="wrail-wrap"><ul class="wrail">${skillHtml}</ul></div>
  </section>

  <footer class="cv-coda">
    <span>Hand-written — no framework, no build step beyond a script.</span>
    <span>The token counter is a CLI on every machine I work from, reporting to a Worker.</span>
    <span>The rest of me — skins, terminal, what I read — is over in <a href="/personal/">Antares Personal →</a></span>
  </footer>
</main>

<!-- The assistant. Docked bottom-right; asking promotes it to a side panel. -->
<div class="hero-ask is-docked" id="hero-ask">
  <form class="hero-ask-form" id="hero-ask-form" autocomplete="off">
    <svg class="ask-mark" viewBox="0 0 32 32" width="24" height="24" aria-hidden="true">
      <path d="M16 0 L18.4 13.6 L32 16 L18.4 18.4 L16 32 L13.6 18.4 L0 16 L13.6 13.6 Z"
            transform="translate(7.2 6.65) scale(0.92)"/>
      <path d="M16 0 L18.4 13.6 L32 16 L18.4 18.4 L16 32 L13.6 18.4 L0 16 L13.6 13.6 Z"
            class="ask-spark ask-spark-1" transform="translate(2.2 2.65) scale(0.34)"/>
      <path d="M16 0 L18.4 13.6 L32 16 L18.4 18.4 L16 32 L13.6 18.4 L0 16 L13.6 13.6 Z"
            class="ask-spark ask-spark-2" transform="translate(23.2 3.65) scale(0.27)"/>
      <path d="M16 0 L18.4 13.6 L32 16 L18.4 18.4 L16 32 L13.6 18.4 L0 16 L13.6 13.6 Z"
            class="ask-spark ask-spark-3" transform="translate(3.2 21.65) scale(0.25)"/>
    </svg>
    <input class="hero-ask-input" id="hero-ask-input" type="text"
           placeholder="Ask anything…" aria-label="Ask a question">
    <button class="hero-ask-go" type="submit" aria-label="Send">
      <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor"
           stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 13V3M4 6.5L8 2.7l4 3.8"/></svg>
    </button>
  </form>
</div>

<div class="ask-panel" id="ask-panel" role="complementary" aria-label="Ask Antares" hidden>
  <div class="ask-panel-head">
    <span class="ask-panel-title">
      <svg class="ask-mark" viewBox="0 0 32 32" width="21" height="21" aria-hidden="true">
        <path d="M16 0 L18.4 13.6 L32 16 L18.4 18.4 L16 32 L13.6 18.4 L0 16 L13.6 13.6 Z"
              transform="translate(7.2 6.65) scale(0.92)"/>
      </svg>
      ask Antares
    </span>
    <span class="ask-panel-actions">
      <button class="ask-panel-btn" id="ask-panel-clear" type="button" title="New conversation" aria-label="New conversation">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor"
             stroke-width="1.5" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>
      </button>
      <button class="ask-panel-btn" id="ask-panel-close" type="button" title="Close" aria-label="Close">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor"
             stroke-width="1.5" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
      </button>
    </span>
  </div>
  <div class="ask-panel-log" id="ask-panel-log" role="log" aria-live="polite"></div>
  <div class="ask-quote-chip" id="ask-quote-chip" hidden></div>
  <form class="ask-panel-form" id="ask-panel-form" autocomplete="off">
    <div class="ask-panel-field">
      <input class="ask-panel-input" id="ask-panel-input" type="text"
             placeholder="Ask a follow-up…" aria-label="Ask a question">
      <button class="ask-panel-send" type="submit" aria-label="Send">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor"
             stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8 13V3M4 6.5L8 2.7l4 3.8"/></svg>
      </button>
    </div>
    <p class="ask-panel-foot">AI answers from this site's content — it can be wrong.</p>
  </form>
</div>

<div class="palette-backdrop" id="palette-backdrop" hidden></div>
<div class="palette" id="palette" role="dialog" aria-modal="true" aria-label="Command palette" hidden>
  <div class="palette-input-wrap">
    <span class="palette-prompt" aria-hidden="true">⌘</span>
    <input class="palette-input" id="palette-input" type="text" placeholder="Search · or just ask…" autocomplete="off">
    <kbd class="palette-esc">ESC</kbd>
  </div>
  <ul class="palette-results" id="palette-results" role="listbox"></ul>
  <div class="palette-foot">
    <span><kbd>↑↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span>
  </div>
</div>

<script src="/scripts/beacon.js?v=${v.beacon}" defer></script>
<script src="/scripts/qa-faq.js?v=${v.qa}" defer></script>
<script src="/scripts/render.js?v=${v.render}" defer></script>
<script src="/scripts/palette.js?v=${v.palette}" defer></script>
<script src="/scripts/skins.js?v=${v.skins}" defer></script>
<!-- Art before runtime: skin-runtime.js reads what these two define, and
     deferred scripts execute in document order. -->
<script src="/scripts/skin-characters.js?v=${v.chars}" defer></script>
<script src="/scripts/skin-diva.js?v=${v.diva}" defer></script>
<script src="/scripts/skin-runtime.js?v=${v.skinrt}" defer></script>
<script src="/scripts/spaces.js?v=${v.spaces}" defer></script>
<script src="/scripts/ask-selection.js?v=${v.sel}" defer></script>
</body>
</html>
`;

fs.writeFileSync(path.join(root, 'index.html'), html);
console.log(`✓ wrote index.html     (${html.length} bytes, one-screen CV — ` +
            `${jobs.length} role, ${projects.length} projects, ${headline.length} headline metrics)`);
