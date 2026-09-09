#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   characters.test.js — guards the generated skin character art.

   Why this exists: the skin system had no automated tests at all, and this
   task repeatedly shipped visual bugs that a two-line assertion would have
   caught (48 blank contact-sheet cells from a duplicated mask id; a figure
   whose face fill sat at 1.15:1 against its own background). These are the
   invariants that are cheap to check and expensive to get wrong.

   Run:  node scripts/characters.test.js   (also part of `npm test`)
   ════════════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0;
const fails = [];
function ok(cond, label) {
  if (cond) { pass++; } else { fails.push(label); }
}

const ROOT = path.join(__dirname, '..');

/* Load the generated art the way the browser does. */
const sandbox = { window: {} };
const src = fs.readFileSync(path.join(ROOT, 'scripts/skin-characters.js'), 'utf8');
new Function('window', src)(sandbox.window);
const chars = sandbox.window.SITE_CHARACTERS;

ok(Array.isArray(chars) && chars.length > 0, 'SITE_CHARACTERS is a non-empty array');

/* ── Structure ──────────────────────────────────────────────────────── */
chars.forEach((c) => {
  ok(typeof c.id === 'string' && c.id.length > 0, `${c.id}: has an id`);
  ok(typeof c.skin === 'string' && c.skin.length > 0, `${c.id}: names a skin`);
  ok(/^[\d\s.-]+$/.test(c.viewBox) && c.viewBox.split(/\s+/).length === 4,
    `${c.id}: viewBox is four numbers`);
  ok(c.svg.length > 500, `${c.id}: svg has real content`);
  ok(!/<script/i.test(c.svg), `${c.id}: no <script> in the art`);
  ok(!/<metadata/i.test(c.svg), `${c.id}: metadata stripped (licence is page text)`);
  ok(c.creator && c.licence, `${c.id}: records creator and licence`);
});

/* ── The id-collision bug ───────────────────────────────────────────────
   DiceBear emits `<mask id="viewboxMask">` with a fixed id. Inline two
   avatars and every url(#viewboxMask) resolves to the FIRST mask, so all
   but one render blank — this is exactly how 47 of 48 contact-sheet cells
   came out empty. Every id must therefore be namespaced per character, and
   every reference must point at a namespaced id. */
const seen = new Map();
chars.forEach((c) => {
  const ids = [...c.svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  ids.forEach((id) => {
    ok(id.startsWith('c-' + c.id + '-'),
      `${c.id}: id "${id}" is namespaced`);
    ok(!seen.has(id), `id "${id}" is unique across characters`);
    seen.set(id, c.id);
  });
  // Every internal reference must resolve to an id declared in the SAME
  // character — a dangling url(#…) renders as nothing at all.
  const refs = [...c.svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
  refs.forEach((r) => {
    ok(ids.indexOf(r) >= 0, `${c.id}: url(#${r}) resolves within this character`);
  });
});

/* ── Recolouring hooks ──────────────────────────────────────────────────
   The art's flats must be CSS-driven, otherwise a skin cannot seat the
   figure against its own background — which produced both the grey face
   and the brown-grey hair earlier in this work. */
chars.forEach((c) => {
  ok(/var\(--ch-fill,/.test(c.svg), `${c.id}: face flat is CSS-driven`);
  ok(/var\(--ch-line,/.test(c.svg), `${c.id}: linework is CSS-driven`);
  // No literal black or white may survive: those are precisely the values
  // that composite to mush on a coloured ground.
  ok(!/fill="#(?:fff|ffffff|000|000000)"/i.test(c.svg),
    `${c.id}: no bare #fff/#000 left in the art`);
});

/* ── Every character's skin exists, and declares the ambient layer that
      hosts it ─────────────────────────────────────────────────────────── */
const skinsSrc = fs.readFileSync(path.join(ROOT, 'scripts/skins.js'), 'utf8');
chars.forEach((c) => {
  ok(new RegExp("id: '" + c.skin + "'").test(skinsSrc),
    `${c.id}: its skin "${c.skin}" is a registered skin`);
});

/* ── Contrast: the figure must be visible against its own ground ────────
   A face at 1.15:1 is invisible; that shipped once and had to be solved
   backwards. Assert the floor so it cannot happen silently again. */
const css = fs.readFileSync(path.join(ROOT, 'styles/main.css'), 'utf8');
function lum(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/* Pull each skin's background and its character colours straight out of
   the stylesheet, so the test tracks the real values rather than a copy. */
chars.forEach((c) => {
  const blockRe = new RegExp('\\[data-skin="' + c.skin + '"\\] \\.skin-diva \\{([\\s\\S]*?)\\}');
  const block = blockRe.exec(css);
  ok(!!block, `${c.skin}: has a .skin-diva colour block`);
  if (!block) return;
  const bgRe = new RegExp('\\[data-skin="' + c.skin + '"\\][\\s\\S]{0,4000}?--color-bg:\\s*(#[0-9a-fA-F]{6})');
  const bg = bgRe.exec(css);
  ok(!!bg, `${c.skin}: background colour found`);
  if (!bg) return;
  ['fill', 'hair', 'line'].forEach((role) => {
    const m = new RegExp('--ch-' + role + ':\\s*(#[0-9a-fA-F]{6})').exec(block[1]);
    ok(!!m, `${c.skin}: --ch-${role} is set`);
    if (!m) return;
    const r = ratio(m[1], bg[1]);
    // 1.08 is the floor for "you can see that something is there at all".
    // The face is deliberately the lowest of the three.
    ok(r >= 1.08,
      `${c.skin}: --ch-${role} ${m[1]} vs bg ${bg[1]} = ${r.toFixed(2)}:1 (needs ≥1.08)`);
  });
});

/* ── The art must be loaded before the module that consumes it ────────── */
['index.html', 'usage/index.html', 'blog/index.html'].forEach((rel) => {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return;
  const html = fs.readFileSync(p, 'utf8');
  const iChars = html.indexOf('skin-characters.js');
  const iDiva = html.indexOf('skin-diva.js');
  ok(iChars > -1, `${rel}: loads skin-characters.js`);
  ok(iDiva > -1, `${rel}: loads skin-diva.js`);
  // Both are `defer`, so document order is execution order — the art has
  // to come first or SITE_CHARACTERS is undefined when the module runs.
  ok(iChars > -1 && iDiva > -1 && iChars < iDiva,
    `${rel}: art loads before the module that reads it`);
});

/* ── Faint text stays legible ON A CARD, not just on the page ───────────
   `--color-text-faint` is used for the percentage in every bar list. It was
   originally tuned against each skin's --color-bg and passed. But .ucard
   paints a lighter --color-surface on top, which raises the base luminance
   and drops the ratio: hud landed at 4.33:1 and hereva at 4.17:1 once the
   Tool mix card started using it. Assert against the HARDER of the two
   grounds so a future palette edit can't reintroduce that gap. */
const SKIN_IDS = [...skinsSrc.matchAll(/id: '([a-z]+)'/g)].map((m) => m[1]);
SKIN_IDS.forEach((skin) => {
  // default has no [data-skin] block; its values live on :root.
  const scope = new RegExp(
    '\\[data-skin="' + skin + '"\\][^{]*\\{([\\s\\S]*?)\\n\\}'
  );
  const block = scope.exec(css);
  if (!block) return; // skins that only differ in fonts/effects
  const faint = /--color-text-faint:\s*(#[0-9a-fA-F]{6})/.exec(block[1]);
  const surface = /--color-surface:\s*(#[0-9a-fA-F]{6})/.exec(block[1]);
  const bg = /--color-bg:\s*(#[0-9a-fA-F]{6})/.exec(block[1]);
  if (!faint || !(surface || bg)) return;
  // The card sits on --color-surface where defined, else on --color-bg.
  const ground = (surface || bg)[1];
  const r = ratio(faint[1], ground);
  ok(r >= 4.5,
    `${skin}: --color-text-faint ${faint[1]} on card ${ground} = ${r.toFixed(2)}:1 (needs ≥4.5)`);
});

/* ── The Tool mix card is wired end to end ──────────────────────────────
   Three separate files have to agree or the card silently never appears:
   the page markup declares it, the renderer draws into it, and the Worker
   must be publishing the dimension it reads. */
{
  const pageJs = fs.readFileSync(path.join(ROOT, 'scripts/usage-page.js'), 'utf8');
  const buildJs = fs.readFileSync(path.join(ROOT, 'scripts/build-usage-page.js'), 'utf8');
  ok(/card\('tools'/.test(buildJs), 'usage page declares the tools card');
  ok(/function drawTools/.test(pageJs), 'renderer defines drawTools');
  ok(/drawTools\(days\)/.test(pageJs), 'render() calls drawTools');
  ok(/toolCounts/.test(pageJs), 'drawTools reads the toolCounts dimension');
  // Counts must not be formatted with fmtCompact: "186" abutting a dim "1%"
  // reads as one number. They get a thousands separator instead.
  ok(/barList\(rows, total, \(n\) => n\.toLocaleString\(\)\)/.test(pageJs),
    'tool counts use a thousands separator, not compact notation');
  const wrangler = fs.readFileSync(path.join(ROOT, 'workers/usage/wrangler.toml'), 'utf8');
  ok(/toolCounts/.test(wrangler), 'Worker config publishes toolCounts');
  // The category list the page renders must match the collector's, or a
  // category would be collected and then dropped on the floor.
  const sources = fs.readFileSync(path.join(ROOT, 'scripts/lib/usage-sources.js'), 'utf8');
  const declared = /TOOL_CATEGORIES\s*=\s*\[([^\]]+)\]/.exec(sources);
  ok(!!declared, 'collector declares TOOL_CATEGORIES');
  if (declared) {
    const cats = [...declared[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();
    const inPage = /const CATS = \[([^\]]+)\]/.exec(pageJs);
    ok(!!inPage, 'page declares its category list');
    if (inPage) {
      const pageCats = [...inPage[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();
      ok(cats.join(',') === pageCats.join(','),
        `page categories match collector (${pageCats.join('/')} vs ${cats.join('/')})`);
    }
  }
}

console.log(`characters: ${pass} passed, ${fails.length} failed`);
if (fails.length) {
  fails.forEach((f) => console.log('  ✗ ' + f));
  process.exitCode = 1;
}
