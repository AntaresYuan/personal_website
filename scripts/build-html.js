#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   build-html.js — pre-render the Work home page (index.html).

   Why: agents that don't execute JS (Claude Code, search crawlers, plain
   curl) would otherwise get an empty shell. This bakes the content from
   content/work.json + profile.json + site.json into the static HTML.

   Strategy: walk known element IDs in the existing index.html and replace
   their innerHTML. Idempotent — re-running with unchanged content produces
   an identical file.

   Two languages from the one template (lib/i18n.js): English is written
   back over index.html, Chinese to zh/index.html. Words that are not
   content (labels, aria) carry data-i18n / data-i18n-attr in the template
   and come from content/strings.json.

   Work and Personal no longer share markup or styles. Work is this page,
   styled by styles/work.css and driven by scripts/work.js. Personal is built
   by build-spaces.js from templates/personal.html and keeps styles/main.css
   and scripts/render.js.

   Run:
     node scripts/build-html.js
   ════════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { escape, replaceInner, setAttr } = require('./lib/html-replace');
const shell = require('./lib/work-shell');
const i18n = require('./lib/i18n');
const { t } = i18n;

const root = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

// Set per language by render(); the helpers below read them.
let site, profile, work, LANG;

/* Rail, top controls, ask and footer come from scripts/lib/work-shell.js,
   shared with every other Work page. */

/* ── Hero ─────────────────────────────────────────────────────────────── */
const nameHtml = () => {
  const n = work.name ?? {};
  const first = escape(n.first ?? profile.name ?? '');
  const last  = escape(n.last ?? profile.nameAccent ?? '');
  const mid   = n.middle ? ` <span class="name-mid">(${escape(n.middle)})</span>` : '';
  return `${first}${mid} ${last}`;
};

const downloadIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v11M7 11.5l5 5 5-5M6 19.5h12"/></svg>';
const resumeLinksHtml = () => {
  const labels = work.resume ?? {};
  const links = [];
  if (profile.resumeEn) links.push(`<a class="dl" href="${escape(profile.resumeEn)}" target="_blank" rel="noopener">${escape(labels.en ?? 'Résumé')}${downloadIcon}</a>`);
  if (profile.resumeZh) links.push(`<a class="dl" lang="zh-CN" href="${escape(profile.resumeZh)}" target="_blank" rel="noopener">${escape(labels.zh ?? 'CV (Chinese)')}${downloadIcon}</a>`);
  return links.join('');
};

const tagsHtml = () => (profile.tagsWork ?? profile.tags ?? [])
  .map((t) => `<li class="tag">${escape(t)}</li>`).join('');

/* ── Update line ──────────────────────────────────────────────────────── */
const shortDate = (iso) => i18n.fmtDate(iso, LANG);

/* ── Projects ─────────────────────────────────────────────────────────────
   Cards from scripts/lib/projects.js, shared with /projects/; each links to
   its case study. */
const { projectList, projectCardHtml } = require('./lib/projects');
const projectsHtml = () => projectList(LANG).map(projectCardHtml).join('') + '\n      ';

/* Template words that aren't content: data-i18n="key" sets an element's
   text, data-i18n-attr="aria-label:key;title:key" sets attributes. */
const localizeStatic = (html, lang) => html
  .replace(/(<([a-z0-9]+)\b[^>]*\sdata-i18n="([\w.]+)"[^>]*>)[^<]*(<\/\2>)/g,
    (m, open, tag, key, close) => `${open}${escape(t(key, lang))}${close}`)
  .replace(/<[a-z0-9]+\b[^>]*\sdata-i18n-attr="([^"]+)"[^>]*>/g, (tag, spec) => spec.split(';').reduce((out, pair) => {
    const [name, key] = pair.split(':');
    return out.replace(new RegExp(`(\\s${name}=")[^"]*(")`), `$1${escape(t(key, lang))}$2`);
  }, tag));

/* ── Apply replacements ───────────────────────────────────────────────── */
const tplPath = path.join(root, 'index.html');
const TEMPLATE = fs.readFileSync(tplPath, 'utf8');

function render(lang) {
LANG = lang;
site    = i18n.content('content/site.json', lang);
profile = i18n.content('content/profile.json', lang);
work    = i18n.content('content/work.json', lang);
let html = TEMPLATE;

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

// ── Cloudflare Web Analytics ──────────────────────────────────────────
/* LEAVE THE TOKEN EMPTY while the zone is proxied through Cloudflare: Web
   Analytics is enabled on this zone and Cloudflare injects beacon.min.js AT
   THE EDGE, so setting the token here would count every pageview twice. Set
   it only if the site ever moves off Cloudflare's proxy. */
html = html.replace(/[ \t]*<!--\s*cf-analytics\s*-->[\s\S]*?<!--\s*\/cf-analytics\s*-->\n?/g, '');
const cfToken = site.analytics?.cfAnalyticsToken?.trim();
if (cfToken) {
  const block = `  <!-- cf-analytics -->\n  <script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${escape(cfToken)}"}'></script>\n  <!-- /cf-analytics -->\n`;
  html = html.replace('</head>', `${block}</head>`);
}

// ── Feature beacon (own counters) ─────────────────────────────────────
/* Counts which site features get touched. Gated on
   site.analytics.featureBeacon and stripped + re-injected each build so
   turning it off actually removes the tag. */
html = html.replace(/[ \t]*<!--\s*feature-beacon\s*-->[\s\S]*?<!--\s*\/feature-beacon\s*-->\n?/g, '');
if (site.analytics?.featureBeacon === true) {
  const bBlock = `  <!-- feature-beacon -->\n  <script defer src="scripts/beacon.js"></script>\n  <!-- /feature-beacon -->\n`;
  html = html.replace('</head>', `${bBlock}</head>`);
}

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
  setMetaContent('property="og:title"',  site.meta.title);
  setMetaContent('name="twitter:title"', site.meta.title);
}
if (site.meta?.description) {
  setMetaContent('name="description"',         site.meta.description);
  setMetaContent('property="og:description"',  site.meta.description);
  setMetaContent('name="twitter:description"', site.meta.description);
}
if (site.meta?.author)   setMetaContent('name="author"', site.meta.author);
const home = `${(site.meta?.url ?? '').replace(/\/+$/, '')}${i18n.localPath('/', lang)}`;
if (site.meta?.url) {
  setMetaContent('property="og:url"', home);
  setLinkHref('canonical',            home);
}
// <html lang> and the hreflang pair (stripped and re-added: idempotent).
html = html.replace(/(<html\b[^>]*\slang=")[^"]*(")/i, `$1${i18n.HTML_LANG[lang]}$2`);
html = html.replace(/[ \t]*<link rel="alternate" hreflang="[^"]*" href="[^"]*">\n?/g, '');
html = html.replace(/(<link\s+rel=["']canonical["'][^>]*>\n?)/i, (m) => m + i18n.LANGS
  .map((l) => `<link rel="alternate" hreflang="${i18n.HTML_LANG[l]}" href="${escape((site.meta?.url ?? '').replace(/\/+$/, '') + i18n.localPath('/', l))}">\n`).join('')
  + `<link rel="alternate" hreflang="x-default" href="${escape((site.meta?.url ?? '').replace(/\/+$/, '') + '/')}">\n`);
if (site.meta?.siteName) setMetaContent('property="og:site_name"', site.meta.siteName);
setMetaContent('property="og:locale"', i18n.OG_LOCALE[lang]);
if (site.meta?.ogImage) {
  const ogUrl = absoluteUrl(site.meta.ogImage);
  setMetaContent('property="og:image"',  ogUrl);
  setMetaContent('name="twitter:image"', ogUrl);
  setLinkHref('apple-touch-icon',        site.meta.ogImage);
}
if (site.meta?.ogImageWidth)  setMetaContent('property="og:image:width"',  site.meta.ogImageWidth);
if (site.meta?.ogImageHeight) setMetaContent('property="og:image:height"', site.meta.ogImageHeight);

// JSON-LD Person schema — rebuilt from profile + contact + site
const contact = (() => { try { return read('content/contact.json'); } catch { return { items: [] }; } })();
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
  description: work.message?.body ?? profile.slogan,
  image: absoluteUrl(site.meta?.ogImage ?? profile.avatar?.calm),
  knowsAbout: profile.tags ?? [],
  ...(sameAs.length ? { sameAs } : {}),
};
html = replaceInner(html, 'ld-person', JSON.stringify(personLd, null, 2));

// Rail + hero
html = replaceInner(html, 'topbar',      shell.topbarInner(lang, '/'));
html = replaceInner(html, 'rail-list',   shell.railItemsHtml('home', lang));
html = replaceInner(html, 'hero-name',   nameHtml());
html = replaceInner(html, 'hero-native', escape(work.name?.native ?? ''));
html = replaceInner(html, 'hero-links',  resumeLinksHtml());
html = replaceInner(html, 'hero-tags',   tagsHtml());

// Message column
html = replaceInner(html, 'message-title', escape(work.message?.title ?? ''));
html = replaceInner(html, 'message-body',  escape(work.message?.body ?? ''));

// Update line — hidden outright when there is nothing to say, rather than
// shipping an empty pill with a dot in it.
const upd = work.update ?? {};
if (upd.text) {
  html = replaceInner(html, 'update-text', escape(upd.text));
  html = replaceInner(html, 'update-date', escape(shortDate(upd.date)));
  html = setAttr(html, 'update-date', 'datetime', escape(upd.date ?? ''));
  html = html.replace(/(<div class="update" id="update")\s+hidden(="")?/, '$1');
} else {
  html = setAttr(html, 'update', 'hidden', '');
}

// Projects
html = replaceInner(html, 'projects-title', escape(work.projects?.title ?? 'Projects'));
html = replaceInner(html, 'project-track',  projectsHtml());

// Live usage: the endpoint rides on the element so work.js needs no extra
// fetch of site.json before it can start. Off entirely when disabled.
if (site.usage?.enabled === false || !site.usage?.endpoint) {
  html = setAttr(html, 'usage', 'hidden', '');
} else {
  html = setAttr(html, 'usage', 'data-endpoint', escape(site.usage.endpoint));
}
html = setAttr(html, 'ask', 'data-qa', escape(site.qa?.workerUrl ?? ''));

html = replaceInner(html, 'ask', shell.askInner(lang));
html = replaceInner(html, 'ask-panel', shell.askPanelInner(lang));
html = replaceInner(html, 'footer', shell.footerInner(lang));
html = replaceInner(html, 'ui-strings', shell.uiStringsJson(lang));
// The chart's "all charts" link goes to the same language's /usage/.
html = html.replace(/(<a class="col-link" href=")[^"]*(")/, `$1${i18n.localPath('/usage/', lang)}$2`);
html = localizeStatic(html, lang);

// Work home predates the shared shell's script array, so ensure newly shared
// runtimes are inserted as well as merely cache-busted. The history module
// must execute before work.js restores the conversation.
if (!/scripts\/ask-history\.js/.test(html)) {
  html = html.replace(
    /(<script src="scripts\/work\.js(?:\?v=[^"]*)?" defer><\/script>)/,
    '<script src="scripts/ask-history.js" defer></script>\n$1'
  );
}

// Cache-bust the runtime assets: append a content hash as `?v=`. index.html is
// served must-revalidate but .js/.css get a longer CDN TTL — without this a
// fresh page can pair with a stale stylesheet. Idempotent.
const hashOf = (rel) => crypto.createHash('sha1')
  .update(fs.readFileSync(path.join(root, rel)))
  .digest('hex').slice(0, 8);
['scripts/beacon.js', 'scripts/qa-faq-data.js', 'scripts/qa-faq.js', 'scripts/ask-history.js', 'scripts/work.js', 'scripts/buddy.js'].forEach((rel) => {
  const v = hashOf(rel);
  html = html.replace(
    new RegExp(`src="${rel.replace(/\./g, '\\.')}(\\?v=[^"]*)?"`),
    `src="${rel}?v=${v}"`
  );
});
{
  const rel = 'styles/work.css';
  const v = hashOf(rel);
  html = html.replace(
    new RegExp(`href="${rel.replace(/\./g, '\\.')}(\\?v=[^"]*)?"`),
    `href="${rel}?v=${v}"`
  );
}

// zh/index.html sits one level down: relative asset paths must start at /.
if (lang !== 'en') html = html.replace(/\s(href|src)="(?!\/|https?:|#|mailto:|data:)([^"]+)"/g, ' $1="/$2"');
return html;
}

/* ── Write ────────────────────────────────────────────────────────────── */
fs.writeFileSync(tplPath, render('en'));
const zhDir = i18n.outRoot('zh');
fs.mkdirSync(zhDir, { recursive: true });
fs.writeFileSync(path.join(zhDir, 'index.html'), render('zh'));
console.log(`✓ wrote index.html     (${fs.statSync(tplPath).size} bytes, Work home) + zh/index.html`);
