/* ─────────────────────────────────────────────────────────────────────────
   The Work shell: the chrome every Work page shares — top controls, the
   site rail, the ask composer and its side panel, the footer, and the
   <head> boilerplate. One source, so the home page (build-html.js), Writing
   (build-blog.js), Gallery (build-gallery.js) and AI Skills
   (build-skills-page.js) cannot drift apart.

   Paths are root-relative throughout: these pages live at /, /blog/…,
   /gallery/ and /skills/…, and a relative asset path would break on all but
   the first.

   Every piece takes a `lang` ('en' | 'zh', lib/i18n.js): its words come
   from content/strings.json (+ content/zh/), its links point into the same
   language's pages, and the top bar carries the EN / zh switch.
   ───────────────────────────────────────────────────────────────────────── */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { escape } = require('./html-replace');
const i18n = require('./i18n');
const { t } = i18n;

const root = path.join(__dirname, '..', '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const hashOf = (rel) => crypto.createHash('sha1')
  .update(fs.readFileSync(path.join(root, rel))).digest('hex').slice(0, 8);

/* ── Rail ─────────────────────────────────────────────────────────────────
   Hand-drawn 24px strokes (CLAUDE.md: UI icons are SVG, never emoji). Stroke
   colour and width come from work.css, so one set serves both themes. */
const ICONS = {
  home:   '<path d="M4.5 10.4 12 4.3l7.5 6.1v8.1a1.5 1.5 0 0 1-1.5 1.5h-3.6v-5.6H9.6V20H6a1.5 1.5 0 0 1-1.5-1.5z"/>',
  folder: '<path d="M3.8 7.6A1.6 1.6 0 0 1 5.4 6h3.9l2.1 2.1h7.2a1.6 1.6 0 0 1 1.6 1.6v7.7a1.6 1.6 0 0 1-1.6 1.6H5.4a1.6 1.6 0 0 1-1.6-1.6z"/>',
  spark:  '<rect x="3.8" y="3.8" width="16.4" height="16.4" rx="4.5"/><path d="M12 7.4c.38 2.62 1.38 3.62 4 4-2.62.38-3.62 1.38-4 4-.38-2.62-1.38-3.62-4-4 2.62-.38 3.62-1.38 4-4z"/>',
  image:  '<rect x="3.8" y="5.2" width="16.4" height="13.6" rx="2.6"/><circle cx="9" cy="10" r="1.5"/><path d="m4.4 17 4.4-4.3 3.3 3.2 2.4-2.3 5.3 4.8"/>',
  doc:    '<path d="M7.2 3.8h6.6l4.6 4.6v10.2a1.6 1.6 0 0 1-1.6 1.6H7.2a1.6 1.6 0 0 1-1.6-1.6V5.4a1.6 1.6 0 0 1 1.6-1.6z"/><path d="M13.6 3.9v4.7h4.7M8.8 12.6h6.4M8.8 15.9h4.4"/>',
};

/* `active` is the nav id of the current page; an item with no href is a page
   that does not exist yet and renders as a disabled "soon" item. */
const railItemsHtml = (active, lang = 'en') => {
  const work = i18n.content('content/work.json', lang);
  const site = read('content/site.json');
  const items = (work.nav ?? []).filter((item) =>
    item.id !== 'about' || site.features?.about !== false);
  return items.map((item) => {
    const label = escape(item.label ?? item.id);
    const glyph = item.icon === 'avatar'
      ? '<img class="rail-avatar" src="/media/buddy/felt-still.webp" alt="" width="48" height="48" decoding="async">'
      : `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[item.icon] ?? ICONS.doc}</svg>`;
    if (!item.href) {
      return `
    <li><span class="rail-item is-soon" role="link" aria-disabled="true" tabindex="0" data-id="${escape(item.id)}" data-label="${label} · ${escape(t('shell.rail.soon', lang))}" aria-label="${label} (${escape(t('shell.rail.soon', lang))})">${glyph}</span></li>`;
    }
    const on = item.id === active;
    return `
    <li><a class="rail-item${on ? ' is-active' : ''}" href="${escape(i18n.localPath(item.href, lang))}"${on ? ' aria-current="page"' : ''} data-id="${escape(item.id)}" data-label="${label}" aria-label="${label}">${glyph}</a></li>`;
  }).join('') + '\n  ';
};

/* ── Top controls ─────────────────────────────────────────────────────── */
const ICON_AUTO  = '<circle cx="12" cy="12" r="7.5"/><path d="M12 4.5a7.5 7.5 0 0 1 0 15z" fill="currentColor" stroke="none"/>';
const ICON_LIGHT = '<circle cx="12" cy="12" r="3.6"/><path d="M12 3.2v2M12 18.8v2M3.2 12h2M18.8 12h2M5.8 5.8l1.4 1.4M16.8 16.8l1.4 1.4M5.8 18.2l1.4-1.4M16.8 7.2l1.4-1.4"/>';
const ICON_DARK  = '<path d="M19.2 14.6A7.6 7.6 0 0 1 9.4 4.8a7.6 7.6 0 1 0 9.8 9.8z"/>';

/* The language switch links to this page in the other language. The
   ?lang= query is for the edge middleware (functions/_middleware.js): it
   remembers the choice in a cookie, so a visitor who picks English is not
   sent back to Chinese by their location. On a page that has only an
   English build (/usage/), scripts/i18n.js translates in the browser and
   marks the active option itself (data-language-toggle). */
const langSwitchHtml = (lang, pagePath) => {
  const opt = (l) => `<a class="lang-opt${l === lang ? ' is-active' : ''}" href="${escape(i18n.localPath(pagePath, l))}?lang=${l}" hreflang="${i18n.HTML_LANG[l]}" lang="${i18n.HTML_LANG[l]}" data-lang="${l}"${l === lang ? ' aria-current="true"' : ''} title="${escape(t(`shell.lang.${l}Title`, l))}">${escape(t(`shell.lang.${l}`, l))}</a>`;
  return `<nav class="lang-switch glass" id="lang-switch" aria-label="${escape(t('shell.lang.aria', lang))}" data-language-toggle data-no-translate data-lens>${i18n.LANGS.map(opt).join('')}</nav>`;
};

const topbarInner = (lang = 'en', pagePath = '/') => `
  <nav class="space-switch glass" id="space-switch" aria-label="${escape(t('shell.space.aria', lang))}" data-lens>
    <span class="space-thumb" aria-hidden="true"></span>
    <a class="space-opt is-active" href="${escape(i18n.localPath('/', lang))}" data-space="work">${escape(t('shell.space.work', lang))}</a>
    <a class="space-opt" href="/personal/" data-space="personal">${escape(t('shell.space.personal', lang))}</a>
  </nav>

  <div class="top-right">
  ${langSwitchHtml(lang, pagePath)}
  <div class="theme-switch glass" id="theme-switch" data-lens>
    <button class="theme-btn theme-current" id="theme-current" type="button"
            aria-label="${escape(t('shell.theme.aria', lang))}" aria-expanded="false" aria-controls="theme-options">
      <svg class="ti ti-auto" viewBox="0 0 24 24" aria-hidden="true">${ICON_AUTO}</svg>
      <svg class="ti ti-light" viewBox="0 0 24 24" aria-hidden="true">${ICON_LIGHT}</svg>
      <svg class="ti ti-dark" viewBox="0 0 24 24" aria-hidden="true">${ICON_DARK}</svg>
    </button>
    <div class="theme-options" id="theme-options" role="radiogroup" aria-label="${escape(t('shell.theme.aria', lang))}">
      <button class="theme-btn" type="button" role="radio" data-mode="auto" aria-label="${escape(t('shell.theme.auto', lang))}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON_AUTO}</svg></button>
      <button class="theme-btn" type="button" role="radio" data-mode="light" aria-label="${escape(t('shell.theme.light', lang))}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON_LIGHT}</svg></button>
      <button class="theme-btn" type="button" role="radio" data-mode="dark" aria-label="${escape(t('shell.theme.dark', lang))}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON_DARK}</svg></button>
    </div>
  </div>
  </div>
`;

/* ── Ask: the composer docked at the bottom ───────────────────────────────
   Questions float above it as chips; answers open in the side panel, so the
   page being read is pushed aside rather than covered. */
const SEND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 18.5v-13M6.5 11 12 5.5l5.5 5.5"/></svg>';
const askInner = (lang = 'en') => `
  <div class="ask-suggest" id="ask-suggest" hidden></div>
  <div class="ask-shell glass" id="ask-shell" data-lens>
    <form class="ask-bar" id="ask-form" role="search" autocomplete="off">
      <button class="ask-avatar" id="ask-avatar" type="button" tabindex="-1" aria-hidden="true" data-mood="idle">
        <img src="/media/buddy/felt-still.webp" alt="" width="48" height="48" decoding="async">
      </button>
      <input class="ask-input" id="ask-input" type="text" maxlength="500"
             placeholder="${escape(t('shell.ask.placeholder', lang))}" aria-label="${escape(t('shell.ask.aria', lang))}">
      <button class="ask-send" id="ask-send" type="submit" aria-label="${escape(t('shell.ask.send', lang))}">${SEND_ICON}</button>
    </form>
  </div>
`;

const askPanelInner = (lang = 'en') => `
  <header class="ask-panel-head">
    <span class="ask-panel-avatar" id="ask-panel-avatar"></span>
    <span class="ask-panel-title"><strong>${escape(t('shell.ask.title', lang))}</strong><span class="ask-model-source" id="ask-model-source" data-source="idle" role="status" aria-live="polite">
      <svg class="ask-source-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="8" r="1.5"/><circle cx="13" cy="8" r="1.5"/><path d="M4.5 8h7"/></svg>
      <span>${escape(t('shell.ask.source', lang))}</span>
    </span></span>
    <button class="ask-icon" id="ask-new" type="button" aria-label="${escape(t('shell.ask.new', lang))}" title="${escape(t('shell.ask.new', lang))}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5v13M5.5 12h13"/></svg>
    </button>
    <button class="ask-icon" id="ask-close" type="button" aria-label="${escape(t('shell.ask.close', lang))}" title="${escape(t('shell.ask.close', lang))}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>
    </button>
  </header>
  <div class="ask-log" id="ask-log" aria-live="polite"></div>
  <form class="ask-panel-form" id="ask-panel-form" autocomplete="off">
    <input class="ask-panel-input" id="ask-panel-input" type="text" maxlength="500"
           placeholder="${escape(t('shell.ask.followUp', lang))}" aria-label="${escape(t('shell.ask.followUpAria', lang))}">
    <button class="ask-send ask-panel-send" id="ask-panel-send" type="submit" aria-label="${escape(t('shell.ask.send', lang))}">${SEND_ICON}</button>
  </form>
`;

/* ── Footer ───────────────────────────────────────────────────────────── */
const footerInner = (lang = 'en') => {
  const site = read('content/site.json');
  const parts = [];
  if (site.footer?.copyright) parts.push(escape(site.footer.copyright));
  parts.push(`<a href="/admin/">${escape(t('shell.footer.edit', lang))}</a>`);
  parts.push('<a href="/blog/feed.xml">RSS</a>');
  parts.push('<a href="/llms.txt">llms.txt</a>');
  parts.push(`<a href="https://github.com/AntaresYuan/personal_website" target="_blank" rel="noopener">${escape(t('shell.footer.source', lang))}</a>`);
  return parts.join('<span aria-hidden="true"> · </span>');
};

/* ── Assets ───────────────────────────────────────────────────────────── */
const THEME_INIT = `<script>
  (function () {
    var d = document.documentElement, m = 'dark';
    try { var t = localStorage.getItem('theme'); if (t === 'light' || t === 'dark' || t === 'auto') m = t; } catch (e) {}
    var sysDark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    d.setAttribute('data-theme-mode', m);
    d.setAttribute('data-theme', m === 'auto' ? (sysDark ? 'dark' : 'light') : m);
  })();
</script>`;
const FONTS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
// Work pages are rendered per language, so they don't load scripts/i18n.js
// (the runtime translator Personal still uses) — except a page built in
// English only, which asks for it with `runtimeI18n`.
const SCRIPTS = ['scripts/qa-faq-data.js', 'scripts/qa-faq.js', 'scripts/ask-history.js', 'scripts/work.js', 'scripts/buddy.js'];

/* ── Whole page, for the generated Work pages ─────────────────────────────
   The home page is a template filled in place by build-html.js instead, but
   it takes its rail, top controls, ask and footer from this same module. */
/* `path` is the page's English path ('/projects/kaboo/'); with it the
   canonical URL, the hreflang pair and the language switch follow `lang`.
   (A bare `canonical` is still accepted for a page with one language.) */
const uiStringsJson = (lang) => JSON.stringify(i18n.clientStrings(lang)).replace(/</g, '\\u' + '003c');
const pageHtml = ({ title, description, canonical, ogType, ogImage, active, bodyClass, main, scripts, styles, lang = 'en', path: pagePath, runtimeI18n = false }) => {
  const site = read('content/site.json');
  const base = (site.meta?.url ?? '').replace(/\/+$/, '');
  const canon = pagePath ? `${base}${i18n.localPath(pagePath, lang)}` : canonical;
  const alternates = pagePath
    ? i18n.LANGS.map((l) => `<link rel="alternate" hreflang="${i18n.HTML_LANG[l]}" href="${escape(base + i18n.localPath(pagePath, l))}">`).join('\n')
      + `\n<link rel="alternate" hreflang="x-default" href="${escape(base + pagePath)}">`
    : '';
  const siteName = site.meta?.siteName ?? site.meta?.title ?? '';
  const desc = String(description || site.meta?.description || '').replace(/\s+/g, ' ').trim();
  const img = ogImage || (site.meta?.url && site.meta?.ogImage
    ? `${site.meta.url.replace(/\/+$/, '')}/${site.meta.ogImage.replace(/^\/+/, '')}` : '');
  const extra = [...(scripts ?? []), ...(runtimeI18n ? ['scripts/i18n.js'] : [])].map((rel) => `<script src="/${rel}?v=${hashOf(rel)}" defer></script>`).join('\n');
  const extraStyles = (styles ?? []).map((rel) => `<link rel="stylesheet" href="/${rel}?v=${hashOf(rel)}">`).join('\n');
  return `<!DOCTYPE html>
<!--
  Open-source template by Antares Yuan — https://github.com/AntaresYuan/personal_website (MIT).
  GENERATED — do not edit by hand. Regenerate: \`node scripts/build.js\`
-->
<html lang="${i18n.HTML_LANG[lang]}">
<head>
<meta name="generator" content="personal_website by Antares Yuan — https://github.com/AntaresYuan/personal_website">
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${escape(title)} · ${escape(siteName)}</title>
<meta name="description" content="${escape(desc)}">
<meta name="author" content="${escape(site.meta?.author ?? siteName)}">
<link rel="canonical" href="${escape(canon)}">${alternates ? '\n' + alternates : ''}
<meta name="theme-color" content="#F5F5F7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0A0A0C" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${escape(t('shell.feedTitle', lang, { site: siteName }))}" href="/blog/feed.xml">
<meta property="og:type" content="${escape(ogType || 'website')}">
<meta property="og:url" content="${escape(canon)}">
<meta property="og:locale" content="${i18n.OG_LOCALE[lang]}">
<meta property="og:site_name" content="${escape(siteName)}">
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(desc)}">${img ? `\n<meta property="og:image" content="${escape(img)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escape(title)}">
<meta name="twitter:description" content="${escape(desc)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="${FONTS}"></noscript>
${THEME_INIT}
<link rel="stylesheet" href="/styles/work.css?v=${hashOf('styles/work.css')}">${extraStyles ? '\n' + extraStyles : ''}
</head>
<body class="work-home ${escape(bodyClass || '')}">
<a class="skip-link" href="#main-content">${escape(t('shell.skip', lang))}</a>
<div class="ambient" aria-hidden="true"></div>
<div class="scroll-edge" aria-hidden="true"></div>

<header class="topbar" id="topbar">${topbarInner(lang, pagePath || '/')}</header>

<nav class="rail glass" id="rail" aria-label="${escape(t('shell.rail.aria', lang))}" data-lens>
  <span class="rail-blob" aria-hidden="true"></span>
  <ul class="rail-list" id="rail-list">${railItemsHtml(active, lang)}</ul>
</nav>

<main class="page" id="main-content">
${main}
  <footer class="foot" id="footer">${footerInner(lang)}</footer>
</main>

<div class="ask" id="ask" data-qa="${escape(site.qa?.workerUrl ?? '')}">${askInner(lang)}</div>
<aside class="ask-panel glass" id="ask-panel" aria-label="${escape(t('shell.ask.title', lang))}" hidden>${askPanelInner(lang)}</aside>
<script type="application/json" id="ui-strings">${uiStringsJson(lang)}</script>

<svg class="glass-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs id="glass-defs"></defs></svg>

${SCRIPTS.map((rel) => `<script src="/${rel}?v=${hashOf(rel)}" defer></script>`).join('\n')}${extra ? '\n' + extra : ''}
</body>
</html>
`;
};

module.exports = {
  ICONS, railItemsHtml, topbarInner, askInner, askPanelInner, footerInner,
  pageHtml, hashOf, SCRIPTS, uiStringsJson,
};
