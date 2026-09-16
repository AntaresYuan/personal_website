#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   Generate /personal/ — the second space behind the top-left switcher.

   Right now it is a mirror of the home page: the switcher and the routing are
   the thing being built, and the two spaces are meant to stay identical until
   the personal side gets its own content. Deriving it from the built
   index.html rather than keeping a second copy means the two cannot drift
   apart while that is still true — every home-page change lands here on the
   next build, and there is no second file to remember to update.

   This runs AFTER build-html.js, which rewrites index.html in place (it is
   both the template and the artifact), so this reads the finished file.

   Three things have to be rewritten rather than copied verbatim:
     1. relative asset paths — /personal/ is one level down
     2. the canonical URL and og:url, or the copy claims to be the original
     3. noindex, so search engines do not see two URLs with identical content
   ───────────────────────────────────────────────────────────────────────── */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const site = JSON.parse(fs.readFileSync(path.join(root, 'content/site.json'), 'utf8'));

const spaces = (site.spaces && site.spaces.items) || [];
const personal = spaces.filter((s) => s.id === 'personal')[0];

/* No personal space configured → nothing to build. Not an error: a fork of
   this template with a single space should still build cleanly. */
if (!personal) {
  console.log('  (personal space skipped: not configured in site.json → spaces)');
  return;
}

const outDir = path.join(root, personal.href.replace(/^\/+|\/+$/g, ''));
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

/* Personal gets the sections Work does not carry (terminal, contact, agents,
   comments), spliced back in before </main>.

   They are kept in templates/ rather than stripped out of index.html at build
   time: index.html is both template and artifact for build-html.js, so a strip
   there removes them from the repo on the first build and there is nothing
   left to strip on the second. This direction — Work minimal on disk, Personal
   assembled — cannot lose content. */
const fragPath = path.join(root, 'templates/personal-sections.html');
if (fs.existsSync(fragPath)) {
  const frag = fs.readFileSync(fragPath, 'utf8')
    /* Drop the file's own explanatory header; it documents the build, not the
       page, and would ship to every visitor as dead weight in the HTML. */
    .replace(/^<!--[\s\S]*?-->\n*/, '');
  const closeMain = html.lastIndexOf('</main>');
  if (closeMain !== -1) {
    html = html.slice(0, closeMain) + frag + '\n  ' + html.slice(closeMain);
  }
}



/* Root-relative, not "../". The page can be reached as /personal/ and as
   /personal, and a relative path resolves differently between the two —
   assets would 404 on whichever form the visitor did not use. */
html = html.replace(/(\s(?:src|href))="(?!https?:|\/\/|\/|#|mailto:|data:)([^"]+)"/g,
  (_m, attr, rel) => `${attr}="/${rel}"`);

const baseUrl = (site.meta && site.meta.url ? site.meta.url : '').replace(/\/+$/, '');
const canonical = `${baseUrl}${personal.href}`;

html = html.replace(/(<link\s+rel=["']canonical["'][^>]*\shref=")[^"]*(")/i, `$1${canonical}$2`);
html = html.replace(/(<meta\s+property="og:url"\s+content=")[^"]*(")/i, `$1${canonical}$2`);

/* Identical content on two URLs is a duplicate-content problem, and the home
   page is the one that should rank. Dropped as soon as this space has content
   of its own. */
/* The page already carries robots="index, follow" inherited from the home
   page, so appending a second tag is not enough — REPLACE it. Two conflicting
   robots tags is undefined behaviour, and the permissive one was winning. */
if (/name="robots"/i.test(html)) {
  html = html.replace(/(<meta\s+name="robots"\s+content=")[^"]*(")/i, '$1noindex,follow$2');
} else {
  html = html.replace(/<\/head>/i, '  <meta name="robots" content="noindex,follow">\n</head>');
}

fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'index.html');
fs.writeFileSync(outFile, html);
console.log(`✓ wrote ${personal.href}index.html (${fs.statSync(outFile).size} bytes, mirrors home)`);
