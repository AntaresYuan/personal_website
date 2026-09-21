#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   build-usage-page.js — render /usage/, the full AI-usage dashboard.

   The homepage section is deliberately a teaser: three lenses, one at a
   time, no chrome. This page is where every chart lives at once.

   Chrome (fonts, theme bootstrap, topnav, footer, theme toggle) is copied
   from build-blog.js's pageShell so the page can't drift from the rest of
   the site. Charts are drawn by scripts/usage-page.js — inline SVG, no
   charting library, same yellow ramp as the homepage heatmap.

   What it shows is driven ENTIRELY by what the Worker publishes. Private
   dimensions (byModel / byProject) simply don't appear unless USAGE_PUBLISH
   opts into them — and the page also accepts a bearer token at runtime
   (kept in sessionStorage, never persisted to disk) to unlock the private
   /detail view for the owner without making it public.

   Run:  node scripts/build-usage-page.js
   ════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { escapeHtml } = require('./lib/blog');

const root = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const site = read('content/site.json');

/* Feature beacon, same gate as the homepage (site.analytics.featureBeacon).
   This page has its OWN generator, so it did not inherit the tag that
   build-html.js injects — /usage/ would have been the one page whose
   visits went uncounted, which is precisely the page whose traffic
   decides whether to keep adding charts to it. Absolute src because this
   page lives one directory down. */
const BEACON_TAG = site.analytics && site.analytics.featureBeacon === true
  ? `<script defer src="/scripts/beacon.js?v=${crypto.createHash('sha1')
      .update(fs.readFileSync(path.join(root, 'scripts/beacon.js'))).digest('hex').slice(0, 8)}"></script>\n`
  : '';
const profile = read('content/profile.json');

const e = escapeHtml;
const SITE_NAME = site.meta?.siteName ?? site.meta?.title ?? 'Personal site';
const LANG = site.meta?.lang ?? 'en';
const SITE_URL = (site.meta?.url ?? 'https://example.com').replace(/\/$/, '');
const abs = (p) => (p ? `/${String(p).replace(/^\/+/, '')}` : '');
const AUTHOR = [profile.name, profile.nameAccent].filter(Boolean).join(' ') || SITE_NAME;
const OG_IMAGE = site.meta?.ogImage ? `${SITE_URL}${abs(site.meta.ogImage)}` : '';
const hashOf = (rel) =>
  crypto.createHash('sha1').update(fs.readFileSync(path.join(root, rel))).digest('hex').slice(0, 8);
const cssV = hashOf('styles/main.css');
const doodleV = hashOf('scripts/doodle.js');
const skinsV = hashOf('scripts/skins.js');
const skinRtV = hashOf('scripts/skin-runtime.js');
const skinDivaV = hashOf('scripts/skin-diva.js');
const skinCharsV = hashOf('scripts/skin-characters.js');

const FONTS =
  'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400;1,9..144,500&family=Inter:wght@400;500;600&display=swap';

const THEME_INIT = `<script>
  (function () {
    var d = document.documentElement, m = 'auto';
    try { var t = localStorage.getItem('theme'); if (t === 'light' || t === 'dark') m = t; } catch (e) {}
    var sysDark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    d.setAttribute('data-theme-mode', m);
    d.setAttribute('data-theme', m === 'auto' ? (sysDark ? 'dark' : 'light') : m);
    try {
      var s = localStorage.getItem('skin');
      if (s && ['meadow', 'solar', 'press', 'dossier', 'blueprint', 'terminal', 'hud', 'neon', 'dusk', 'observatory', 'abyss', 'dumpling', 'vocal', 'workshop', 'hereva'].indexOf(s) >= 0) d.setAttribute('data-skin', s);
    } catch (e) {}
  })();
</script>`;

// Theme toggle only — the charts live in scripts/usage-page.js.
const PAGE_JS = `<script>
(function () {
  var d = document.documentElement, btn = document.getElementById('theme-toggle');
  if (!btn) return;
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  var apply = function (mode) {
    d.setAttribute('data-theme-mode', mode);
    d.setAttribute('data-theme', mode === 'auto' ? (mq.matches ? 'dark' : 'light') : mode);
  };
  btn.addEventListener('click', function () {
    var cur = d.getAttribute('data-theme-mode') || 'auto';
    var next = cur === 'auto' ? 'light' : cur === 'light' ? 'dark' : 'auto';
    try { if (next === 'auto') localStorage.removeItem('theme'); else localStorage.setItem('theme', next); } catch (e) {}
    apply(next);
  });
  mq.addEventListener('change', function () { if ((d.getAttribute('data-theme-mode') || 'auto') === 'auto') apply('auto'); });
})();
</script>`;

/* ── page shell — mirrors build-blog.js ─────────────────────────────── */
function pageShell({ title, description, canonical, bodyClass, main, extraHead, extraBody }) {
  const desc = (description || site.meta?.description || '').replace(/\s+/g, ' ').trim();
  const imgTags = OG_IMAGE ? `\n<meta property="og:image" content="${e(OG_IMAGE)}">` : '';
  return `<!DOCTYPE html>
<!--
  Open-source template by Antares Yuan — https://github.com/AntaresYuan/personal_website (MIT).
  GENERATED — do not edit by hand. Source: scripts/build-usage-page.js
-->
<html lang="${e(LANG)}">
<head>
<meta name="generator" content="personal_website by Antares Yuan — https://github.com/AntaresYuan/personal_website">
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${e(title)} · ${e(SITE_NAME)}</title>
<meta name="description" content="${e(desc)}">
<meta name="author" content="${e(site.meta?.author ?? SITE_NAME)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${e(canonical)}">
<meta name="theme-color" content="#FAF7F0" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#14130D" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta property="og:type" content="website">
<meta property="og:url" content="${e(canonical)}">
<meta property="og:site_name" content="${e(SITE_NAME)}">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(desc)}">${imgTags}
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${e(title)}">
<meta name="twitter:description" content="${e(desc)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="${FONTS}"></noscript>
${THEME_INIT}
<link rel="stylesheet" href="/styles/main.css?v=${cssV}">${extraHead || ''}
${BEACON_TAG}</head>
<body class="${e(bodyClass)}">
<a class="skip-link" href="#main-content">Skip to content</a>
<main class="page" id="main-content">
  <nav class="topnav">
    <div class="brand"><a class="brand-link" href="/"><span class="dot" aria-hidden="true"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg></span><span>${e(SITE_NAME)}</span></a></div>
    <div class="topnav-end">
      <a class="topnav-link" href="/blog/">blog</a>
      <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Theme" title="Theme">
        <span class="tt-icon tt-auto"  aria-hidden="true">◐</span>
        <span class="tt-icon tt-light" aria-hidden="true">☀</span>
        <span class="tt-icon tt-dark"  aria-hidden="true">☾</span>
      </button>
      <details class="skin-picker" id="skin-picker">
        <summary aria-label="Skin" title="Skin"><span class="skin-trigger-sw" data-sw="default" aria-hidden="true"></span><span class="skin-trigger-name">Skin</span><span class="skin-trigger-chev" aria-hidden="true">⌄</span></summary>
        <div class="skin-menu" role="menu" aria-label="Skin"></div>
      </details>
    </div>
  </nav>
${main}
  <footer class="site-footer">
    <span>${e(site.footer?.copyright ?? '')}${site.footer?.tagline ? ` · <em>${e(site.footer.tagline)}</em>` : ''}</span>
    <span><a href="/">home</a> · <a href="/blog/">blog</a> · <a href="/blog/feed.xml">rss</a> · <a href="https://github.com/AntaresYuan/personal_website" title="Open-source template — fork it freely; a link back is appreciated">source</a></span>
  </footer>
</main>
${PAGE_JS}${extraBody || ''}
<script src="/scripts/doodle.js?v=${doodleV}" defer></script>
<script src="/scripts/skins.js?v=${skinsV}" defer></script>
<script src="/scripts/skin-characters.js?v=${skinCharsV}" defer></script>
<script src="/scripts/skin-diva.js?v=${skinDivaV}" defer></script>
<script src="/scripts/skin-runtime.js?v=${skinRtV}" defer></script>
</body>
</html>
`;
}

/* ── the page body ──────────────────────────────────────────────────── */
// One <section> per chart. Each carries a stable id that usage-page.js fills
// and, when the data it needs isn't published, hides. Server-rendered as
// empty shells so there's no layout jump and a no-JS reader still sees the
// page's structure.
const card = (id, title, note) => `      <section class="ucard" id="ucard-${id}" hidden>
        <header class="ucard-head">
          <h2 class="ucard-title">${e(title)}</h2>
          ${note ? `<p class="ucard-note">${e(note)}</p>` : ''}
        </header>
        <div class="ucard-body" id="uchart-${id}"></div>
        <p class="ucard-caption" id="ucap-${id}" hidden></p>
      </section>`;

/* ── "add a device" / CLI section ────────────────────────────────────────
   Ported in spirit from kaboo's onboarding stepper: numbered steps, each
   with one copyable command. Differences that matter here:

   - kaboo ships a published npm package and an OAuth `login`; this agent is
     a script in a public repo authorised by ONE shared bearer. So step 1 is
     a clone, and the bearer is never printed on this page — it's read off a
     machine that already works. A token in the HTML would be a token handed
     to every visitor, and the endpoint accepts writes with nothing else.
   - The commands are shown, not executed by a piped one-liner. `curl | bash`
     from a personal site is exactly the habit that makes supply-chain
     attacks easy, and it hides what's about to run.

   Safe to publish: POST without the bearer is 401 (verified), so the
   endpoint and repo URL are not secrets. Only the bearer is. */
const REPO_URL = 'https://github.com/AntaresYuan/personal_website';
const cmd = (c, label) => `        <button class="ucli-cmd" type="button" data-copy="${e(c)}"${label ? ` aria-label="${e(label)}"` : ''}><code><span class="ucli-dollar">$</span> ${e(c)}</code><span class="ucli-copy" aria-hidden="true">copy</span></button>`;

function cliSection() {
  return `  <section class="section usage-cli" id="usage-cli">
    <h2 class="usage-cli-title">Add a device</h2>
    <p class="usage-cli-lead">These numbers come from a small agent that reads local
      Claude Code and Codex transcripts and posts daily totals here. It's multi-device:
      each machine owns its own slot, so several Macs merge instead of overwriting.
      One command installs it.</p>

    <div class="ucli-oneline">
${cmd('curl -fsSL https://antaresyuan.site/install.sh | sh', 'install command')}
        <p class="ucli-note">Downloads just the agent (not the whole site) into
          <code>~/.local/share/antares-usage</code>, drops an <code>antares-usage</code>
          command in <code>~/.local/bin</code>, then walks you through setup: it detects
          which tools are installed, pins this machine's device slot, and asks for the
          shared bearer — checked against the Worker before it's stored, so a mistyped
          key fails right there instead of silently 401-ing on every later run. Local
          scan and dry-run come before anything uploads. Re-runnable.</p>
    </div>

    <p class="usage-cli-after">Then, any time:</p>
    <ul class="ucli-cmds">
      <li>${cmd('antares-usage stats')}<span class="ucli-inline-note">local breakdown, no network</span></li>
      <li>${cmd('antares-usage doctor')}<span class="ucli-inline-note">check config, secret and endpoint</span></li>
      <li>${cmd('antares-usage sync')}<span class="ucli-inline-note">upload the latest totals now</span></li>
    </ul>

    <p class="usage-cli-foot">Needs macOS (keychain + launchd) and Node. The bearer isn't
      on this page by design — read it off a machine that's already syncing:
      <code>security find-generic-password -a "$USER" -s antares-sync-usage -w</code>.
      Only token counts, timings and cost leave the machine; prompt and code content
      never do. <a href="${REPO_URL}/blob/main/docs/usage-sync.md">Full setup notes →</a></p>
  </section>`;
}

const main = `  <section class="section usage-page-head">
    <p class="usage-page-back"><a href="/#usage">← back to home</a></p>
    <h1 class="usage-page-title">AI usage, in full</h1>
    <p class="usage-page-lead">Every chart behind the strip on the homepage. Collected
      automatically from local Claude Code and Codex transcripts by a sync agent
      on ${e(AUTHOR)}'s machines — token counts and timings only, never prompt or
      code content. What's public here is set by one config value on the Worker.</p>
    <div class="usage-page-summary" id="usage-page-summary"></div>
    <p class="usage-page-state" id="usage-page-state">Loading…</p>
  </section>

  <div class="usage-page-grid">
${card('calendar', 'Daily activity', 'One cell per day. Darker = more tokens.')}
${card('mix', 'Token mix', 'Fresh input vs cache reads vs output vs reasoning.')}
${card('rhythm', 'Working rhythm', 'Prompts by local weekday and hour — when the work actually happens.')}
${card('trend', 'Weekly trend', 'Total tokens per week, with a 4-week average.')}
${card('hours', 'Hour of day', 'Prompts per local hour, all days combined.')}
${card('weekday', 'Day of week', 'Prompt share by weekday.')}
${card('sessions', 'Session shape', 'Active minutes and message counts per day.')}
${card('tools', 'Tool mix', 'What the work consisted of — reading, editing, shelling out. Categories only; no tool or server names are collected.')}
${card('source', 'By tool', 'Which coding agent produced the tokens.')}
${card('model', 'By model', 'Private unless published — unlock below to view.')}
${card('project', 'By project', 'Private unless published — unlock below to view.')}
  </div>

  <section class="section usage-unlock">
    <details class="usage-unlock-box">
      <summary class="usage-unlock-summary">Owner view</summary>
      <p class="usage-unlock-note">Paste the sync bearer token to load the private
        <code>/detail</code> feed (per-model and per-project breakdowns). It's kept in
        this tab's <code>sessionStorage</code> only — never written to disk, never sent
        anywhere except the usage Worker.</p>
      <form class="usage-unlock-form" id="usage-unlock-form" autocomplete="off">
        <input class="usage-unlock-input" id="usage-unlock-input" type="password"
               placeholder="bearer token" aria-label="Bearer token" spellcheck="false">
        <button class="usage-unlock-btn" type="submit">unlock</button>
        <button class="usage-unlock-btn usage-unlock-clear" type="button" id="usage-unlock-clear">clear</button>
      </form>
      <p class="usage-unlock-state" id="usage-unlock-state" hidden></p>
    </details>
  </section>

${cliSection()}`;

const usagePageV = hashOf('scripts/usage-page.js');
const html = pageShell({
  title: 'AI usage',
  description: `Full AI-coding usage dashboard for ${AUTHOR} — tokens, cost, working rhythm and per-tool breakdowns, updated automatically.`,
  canonical: `${SITE_URL}/usage/`,
  bodyClass: 'usage-page-body',
  main,
  extraBody: `\n<script src="/scripts/usage-page.js?v=${usagePageV}" defer></script>`,
});

const outDir = path.join(root, 'usage');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), html);
console.log(`✓ wrote usage/         (full dashboard, ${html.length} bytes)`);
