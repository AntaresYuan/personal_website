#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   build-html.js — pre-render the Work home page (index.html).

   Why: agents that don't execute JS (Claude Code, search crawlers, plain
   curl) would otherwise get an empty shell. This bakes the content from
   content/work.json + profile.json + site.json into the static HTML.

   Strategy: walk known element IDs in the existing index.html and replace
   their innerHTML. Idempotent — re-running with unchanged content produces
   an identical file.

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

const root = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

const site    = read('content/site.json');
const profile = read('content/profile.json');
const work    = read('content/work.json');

/* ── Rail icons ───────────────────────────────────────────────────────────
   Hand-drawn 24px strokes (CLAUDE.md: UI icons are SVG, never emoji). Stroke
   colour and width come from work.css, so one set serves both themes. */
const ICONS = {
  home:   '<path d="M4.5 10.4 12 4.3l7.5 6.1v8.1a1.5 1.5 0 0 1-1.5 1.5h-3.6v-5.6H9.6V20H6a1.5 1.5 0 0 1-1.5-1.5z"/>',
  folder: '<path d="M3.8 7.6A1.6 1.6 0 0 1 5.4 6h3.9l2.1 2.1h7.2a1.6 1.6 0 0 1 1.6 1.6v7.7a1.6 1.6 0 0 1-1.6 1.6H5.4a1.6 1.6 0 0 1-1.6-1.6z"/>',
  spark:  '<rect x="3.8" y="3.8" width="16.4" height="16.4" rx="4.5"/><path d="M12 7.4c.38 2.62 1.38 3.62 4 4-2.62.38-3.62 1.38-4 4-.38-2.62-1.38-3.62-4-4 2.62-.38 3.62-1.38 4-4z"/>',
  image:  '<rect x="3.8" y="5.2" width="16.4" height="13.6" rx="2.6"/><circle cx="9" cy="10" r="1.5"/><path d="m4.4 17 4.4-4.3 3.3 3.2 2.4-2.3 5.3 4.8"/>',
  doc:    '<path d="M7.2 3.8h6.6l4.6 4.6v10.2a1.6 1.6 0 0 1-1.6 1.6H7.2a1.6 1.6 0 0 1-1.6-1.6V5.4a1.6 1.6 0 0 1 1.6-1.6z"/><path d="M13.6 3.9v4.7h4.7M8.8 12.6h6.4M8.8 15.9h4.4"/>',
};

const railHtml = () => (work.nav ?? []).map((item) => {
  const isHome = item.href === '/';
  const label = escape(item.label ?? item.id);
  const glyph = item.icon === 'avatar'
    ? `<img class="rail-avatar" src="${escape(profile.avatar?.calm ?? '')}" alt="" width="32" height="32" decoding="async">`
    : `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[item.icon] ?? ICONS.doc}</svg>`;
  /* No href yet = the page has not been built. It stays in the rail so the
     shape of the site is visible, but as a disabled item rather than a link
     to a 404. */
  if (!item.href) {
    return `
    <li><span class="rail-item is-soon" role="link" aria-disabled="true" tabindex="0" data-id="${escape(item.id)}" data-label="${label} · soon" aria-label="${label} (coming soon)">${glyph}</span></li>`;
  }
  return `
    <li><a class="rail-item${isHome ? ' is-active' : ''}" href="${escape(item.href)}"${isHome ? ' aria-current="page"' : ''} data-id="${escape(item.id)}" data-label="${label}" aria-label="${label}">${glyph}</a></li>`;
}).join('') + '\n  ';

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
const shortDate = (iso) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso ?? '')) return '';
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};

/* ── Projects ─────────────────────────────────────────────────────────────
   Real cards once work.json → projects.items is filled; until then a row of
   labelled placeholders so the layout can be judged with the content missing. */
const PLACEHOLDER_HUES = [222, 262, 28, 162, 336, 196];
const projectCardHtml = (p, i) => {
  const hue = PLACEHOLDER_HUES[i % PLACEHOLDER_HUES.length];
  const num = String(i + 1).padStart(2, '0');
  if (!p) {
    return `
        <li class="project-card is-placeholder" style="--hue: ${hue}">
          <div class="project-cover" aria-hidden="true"><span class="project-num">${num}</span></div>
          <div class="project-body">
            <span class="project-chip">Placeholder</span>
            <h3 class="project-title">Project title</h3>
            <p class="project-summary">A featured project goes here — a cover, a title and one line on what it does.</p>
          </div>
        </li>`;
  }
  const cover = p.cover
    ? `<img src="${escape(p.cover)}" alt="" loading="lazy" decoding="async">`
    : `<span class="project-num">${num}</span>`;
  const chip = p.kind ? `<span class="project-chip">${escape(p.kind)}</span>` : '';
  return `
        <li class="project-card" style="--hue: ${hue}">
          <a class="project-link" href="${escape(p.href ?? '#')}">
            <div class="project-cover" aria-hidden="true">${cover}</div>
            <div class="project-body">
              ${chip}
              <h3 class="project-title">${escape(p.title ?? '')}</h3>
              ${p.summary ? `<p class="project-summary">${escape(p.summary)}</p>` : ''}
            </div>
          </a>
        </li>`;
};
const projectsHtml = () => {
  const items = work.projects?.items ?? [];
  const list = items.length
    ? items.map(projectCardHtml)
    : Array.from({ length: work.projects?.placeholders ?? 4 }, (_, i) => projectCardHtml(null, i));
  return list.join('') + '\n      ';
};

const footerHtml = () => {
  const parts = [];
  if (site.footer?.copyright) parts.push(escape(site.footer.copyright));
  parts.push(`<a href="/llms.txt">llms.txt</a>`);
  parts.push(`<a href="https://github.com/AntaresYuan/personal_website" target="_blank" rel="noopener">Source</a>`);
  return parts.join('<span aria-hidden="true"> · </span>');
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
html = replaceInner(html, 'rail-list',   railHtml());
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

html = replaceInner(html, 'footer', footerHtml());

// Cache-bust the runtime assets: append a content hash as `?v=`. index.html is
// served must-revalidate but .js/.css get a longer CDN TTL — without this a
// fresh page can pair with a stale stylesheet. Idempotent.
const hashOf = (rel) => crypto.createHash('sha1')
  .update(fs.readFileSync(path.join(root, rel)))
  .digest('hex').slice(0, 8);
['scripts/beacon.js', 'scripts/qa-faq.js', 'scripts/work.js'].forEach((rel) => {
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

/* ── Write ────────────────────────────────────────────────────────────── */
fs.writeFileSync(tplPath, html);
console.log(`✓ wrote index.html     (${fs.statSync(tplPath).size} bytes, Work home)`);
