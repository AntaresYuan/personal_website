#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   Generate /personal/ from its own template.

   This used to mirror index.html and splice extra sections in. That worked
   only while the two spaces showed the same thing. Once Work became a résumé,
   every edit to Work landed in Personal too: the page ended up carrying the
   résumé header, the proof strip and the trimmed project list on top of its
   own hero and board — 452 lines with the name appearing five times.

   Personal is now built from templates/personal.html, which is the page
   exactly as it stood before Work was split out (commit 67bda15). The two
   spaces share content/*.json, the stylesheet and the scripts, but not their
   markup, so Work can be reshaped freely without touching Personal.

   Content still comes from the same JSON at runtime via scripts/render.js —
   this file only assembles the shell and fixes up the paths.
   ───────────────────────────────────────────────────────────────────────── */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const site = JSON.parse(fs.readFileSync(path.join(root, 'content/site.json'), 'utf8'));

const spaces = (site.spaces && site.spaces.items) || [];
const personal = spaces.filter((s) => s.id === 'personal')[0];

if (!personal) {
  console.log('  (personal space skipped: not configured in site.json → spaces)');
  return;
}

const tplPath = path.join(root, 'templates/personal.html');
if (!fs.existsSync(tplPath)) {
  console.log('  (personal space skipped: templates/personal.html missing)');
  return;
}

let html = fs.readFileSync(tplPath, 'utf8');

/* Cache-bust the same assets build-html.js does. Without this the page would
   ship whatever hash was frozen into the template when it was captured, and a
   CSS change would not reach visitors who had the old file cached. */
const hashOf = (rel) => crypto.createHash('sha1')
  .update(fs.readFileSync(path.join(root, rel))).digest('hex').slice(0, 8);

[
  'scripts/beacon.js', 'scripts/qa-faq.js', 'scripts/render.js',
  'scripts/terminal.js', 'scripts/palette.js', 'scripts/doodle.js',
  'scripts/skins.js', 'scripts/skin-runtime.js', 'scripts/skin-diva.js',
  'scripts/skin-characters.js', 'scripts/giscus-lazy.js', 'scripts/spaces.js',
  'scripts/ask-selection.js',
].forEach((rel) => {
  if (!fs.existsSync(path.join(root, rel))) return;
  const v = hashOf(rel);
  html = html.replace(
    new RegExp(`src="/?${rel.replace(/\./g, '\\.')}(\\?v=[^"]*)?"`, 'g'),
    `src="/${rel}?v=${v}"`
  );
});
{
  const v = hashOf('styles/main.css');
  html = html.replace(/href="\/?styles\/main\.css(\?v=[^"]*)?"/g,
    `href="/styles/main.css?v=${v}"`);
}

/* Root-relative asset paths. The page answers to both /personal/ and
   /personal, and a relative path resolves differently between the two, so
   assets would 404 on whichever form the visitor did not use. */
html = html.replace(/(\s(?:src|href))="(?!https?:|\/\/|\/|#|mailto:|data:)([^"]+)"/g,
  (_m, attr, rel) => `${attr}="/${rel}"`);

const baseUrl = (site.meta && site.meta.url ? site.meta.url : '').replace(/\/+$/, '');
const canonical = `${baseUrl}${personal.href}`;
html = html.replace(/(<link\s+rel=["']canonical["'][^>]*\shref=")[^"]*(")/i, `$1${canonical}$2`);
html = html.replace(/(<meta\s+property="og:url"\s+content=")[^"]*(")/i, `$1${canonical}$2`);

/* noindex: Personal duplicates a lot of what the résumé states, and the
   résumé is the page that should rank. Replaced rather than appended — the
   template carries robots="index, follow" and two conflicting tags are
   undefined behaviour, with the permissive one winning. */
if (/name="robots"/i.test(html)) {
  html = html.replace(/(<meta\s+name="robots"\s+content=")[^"]*(")/i, '$1noindex,follow$2');
} else {
  html = html.replace(/<\/head>/i, '  <meta name="robots" content="noindex,follow">\n</head>');
}

/* The space switcher. The template predates it, so the plain brand block is
   swapped for the switcher markup — otherwise Personal would be a dead end
   with no way back to Work. */
const switcher = `<div class="brand" id="space-switcher">
      <button class="brand-btn" id="space-trigger" type="button"
              aria-haspopup="menu" aria-expanded="false" aria-controls="space-menu">
        <span class="dot" aria-hidden="true"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg></span>
        <span id="brand-name">Antares Yuan</span>
        <svg class="brand-caret" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"
             fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"
             stroke-linejoin="round"><path d="M3 4.6L6 7.6L9 4.6"/></svg>
      </button>
      <div class="space-menu" id="space-menu" role="menu" aria-labelledby="space-trigger" hidden></div>
    </div>`;
html = html.replace(/<div class="brand">[\s\S]*?<\/div>\n/, switcher + '\n');

/* spaces.js is what fills that menu; the template never referenced it. */
if (!/scripts\/spaces\.js/.test(html)) {
  const v = hashOf('scripts/spaces.js');
  html = html.replace(/<\/body>/i,
    `<script src="/scripts/spaces.js?v=${v}" defer></script>\n</body>`);
}

const outDir = path.join(root, personal.href.replace(/^\/+|\/+$/g, ''));
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'index.html');
fs.writeFileSync(outFile, html);
console.log(`✓ wrote ${personal.href}index.html (${fs.statSync(outFile).size} bytes, own template)`);
