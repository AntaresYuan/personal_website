#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────
   Generate the skin character art from DiceBear at BUILD TIME.
   ─────────────────────────────────────────────────────────────────────
   Why build-time and not runtime: the site ships with zero runtime
   dependencies and no third-party network calls, and I want to keep both
   properties. DiceBear is a devDependency; this script bakes its output
   into a plain JS file that the browser loads like any other asset. No
   API calls, no CDN, works offline, nothing to rate-limit.

   Why DiceBear at all: I tried drawing these characters by hand and the
   results were not good enough — a human face needs proportion and
   linework judgement that these styles already encode. Lorelei is by
   Lisa Wischofsky and released CC0, which is both better art than I can
   produce and free of attribution obligations.

   THE ID COLLISION, which is the one real trap here:
   DiceBear emits `<mask id="viewboxMask">` with a fixed, global id. Inline
   two avatars in one document and both `url(#viewboxMask)` references
   resolve to the FIRST mask — the second renders blank. Discovered while
   building a 48-cell contact sheet where 47 cells came out empty. Every
   id is therefore rewritten with a per-character prefix below.

   Run automatically as part of `node scripts/build.js`.
   ───────────────────────────────────────────────────────────────────── */
'use strict';

const fs = require('fs');
const path = require('path');

let createAvatar, collection;
try {
  createAvatar = require('@dicebear/core').createAvatar;
  collection = require('@dicebear/collection');
} catch (err) {
  // The generated file is committed, so a missing devDependency must not
  // break a plain `npm run build` for someone who only cloned the repo.
  console.log('[characters] @dicebear not installed — keeping existing generated art');
  process.exit(0);
}

const OUT = path.join(__dirname, 'skin-characters.js');

/* Each entry becomes one character available to the skin runtime.
   `style` and `options` are passed straight to DiceBear; `credit` records
   what that style's licence actually obliges us to say. Lorelei and
   Notionists are CC0 (no obligation); anything CC BY here would need
   author + licence + modification notice, so it is spelled out per style
   rather than assumed. */
const CHARACTERS = [
  {
    id: 'diva',
    skin: 'vocal',
    style: 'lorelei',
    hairHex: '9cf5ec',
    // variant21 chosen by rendering all 48 hair variants and looking at
    // them: it is the one with long hair falling past the shoulders on
    // both sides, which is the silhouette this skin wants.
    options: {
      hair: ['variant21'],
      // NOT the skin accent (#39d2c8): at the figure's opacity that
      // composites to within a hair of the near-black stage and the whole
      // hair mass — the largest shape in the art — vanished, leaving a
      // floating face. The hair has to be the brightest value here.
      hairColor: ['9cf5ec'],
      eyesColor: ['2fd3c9'],
      eyes: ['variant12'],
      mouth: ['happy05'],
      head: ['variant01'],
      earringsProbability: 100,
      earrings: ['variant01'],
      earringsColor: ['f2519b'],
      frecklesProbability: 0,
      glassesProbability: 0,
      beardProbability: 0,
      hairAccessoriesProbability: 0,
    },
  },
  {
    id: 'crabhand',
    skin: 'workshop',
    style: 'notionists',
    // Notionists reads as a sketched工作室 portrait, which suits a machine
    // shop far better than a polished vector face.
    options: {
      hair: ['variant31'],
      body: ['variant08'],
      brows: ['variant07'],
      eyes: ['variant04'],
      lips: ['variant08'],
      nose: ['variant05'],
      gestureProbability: 0,
      glassesProbability: 100,
      glasses: ['variant04'],
      beardProbability: 0,
    },
  },
  {
    id: 'witch',
    skin: 'hereva',
    style: 'lorelei',
    hairHex: 'f7e2a8',
    options: {
      hair: ['variant35'],
      // Same reasoning as diva: brighter than the skin's gold accent so the
      // hair mass survives compositing over the violet ground.
      hairColor: ['f7e2a8'],
      eyesColor: ['62c48a'],
      eyes: ['variant16'],
      mouth: ['happy02'],
      head: ['variant02'],
      hairAccessoriesProbability: 100,
      hairAccessories: ['flowers'],
      hairAccessoriesColor: ['62c48a'],
      frecklesProbability: 100,
      frecklesColor: ['e0806b'],
      glassesProbability: 0,
      beardProbability: 0,
      earringsProbability: 0,
    },
  },
];

/* Rewrite every id/reference in one avatar so several can coexist inline.
   Covers id="", url(#…), and the href forms, which is every way these
   documents reference each other. */
function isolateIds(svg, prefix) {
  const ids = [];
  svg.replace(/\sid="([^"]+)"/g, function (_, id) { ids.push(id); return _; });
  let out = svg;
  ids.forEach(function (id) {
    const safe = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out
      .replace(new RegExp('\\sid="' + safe + '"', 'g'), ' id="' + prefix + '-' + id + '"')
      .replace(new RegExp('url\\(#' + safe + '\\)', 'g'), 'url(#' + prefix + '-' + id + ')')
      .replace(new RegExp('(\\sxlink:href|\\shref)="#' + safe + '"', 'g'), '$1="#' + prefix + '-' + id + '"');
  });
  return out;
}

const built = [];
for (const ch of CHARACTERS) {
  const style = collection[ch.style];
  if (!style) throw new Error('unknown DiceBear style: ' + ch.style);

  const svg = createAvatar(style, Object.assign({}, ch.options, {
    size: 512,
    // No background: the page's own colour must show through.
    backgroundColor: ['transparent'],
  })).toString();

  // Strip the <metadata> block — it carries the licence info, which we
  // surface as visible page text instead (a comment in the markup is not
  // an attribution). Keep the viewBox.
  const viewBox = (/viewBox="([^"]+)"/.exec(svg) || [])[1] || '0 0 980 980';
  let inner = svg
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<metadata[\s\S]*?<\/metadata>/g, '');

  inner = isolateIds(inner, 'c-' + ch.id);

  /* Recolour the flats so each skin can drive them.
     DiceBear bakes literal colours in: the face/skin is #fff and the
     linework is #000. Left alone on a near-black stage at 50% opacity
     that composites to grey mush — measured, and clearly visible as a
     grey face in the first render. So the two structural colours become
     CSS variables with the original as the fallback, and each skin sets
     them to something that belongs in its own world.

     Only #fff/#000 are remapped. The hair, eyes and trim colours were
     chosen per character in the options above and should stay exactly as
     generated. */
  inner = inner
    .replace(/fill="#(?:fff|ffffff)"/gi, 'fill="var(--ch-fill, #fff)"')
    .replace(/fill="#(?:000|000000)"/gi, 'fill="var(--ch-line, #000)"');

  /* The hair is the two largest paths in the art (measured: 473k and 431k
     units² of 1.8M total), so it drives the whole silhouette's weight and
     has to be skin-controllable too. Its generated colour becomes the
     fallback. */
  if (ch.hairHex) {
    inner = inner.replace(
      new RegExp('fill="#' + ch.hairHex + '"', 'gi'),
      'fill="var(--ch-hair, #' + ch.hairHex + ')"');
  }

  const meta = style.meta || {};
  const lic = meta.license || {};
  built.push({
    id: ch.id,
    skin: ch.skin,
    viewBox: viewBox,
    svg: inner,
    style: meta.title || ch.style,
    creator: meta.creator || '',
    licence: lic.name || '',
    licenceUrl: lic.url || '',
    source: meta.source || '',
  });
  console.log('[characters] ' + ch.id + ' <- ' + (meta.title || ch.style) +
    ' by ' + (meta.creator || '?') + ' (' + (lic.name || '?') + ') ' +
    (inner.length / 1024).toFixed(1) + 'kB');
}

const banner = built.map(function (b) {
  return '     ' + b.id + ': ' + b.style + ' by ' + b.creator + ' — ' + b.licence;
}).join('\n');

const out = '/* GENERATED FILE — do not edit by hand.\n' +
  '   Produced by scripts/gen-characters.js, which runs as part of\n' +
  '   `node scripts/build.js`. Edit the CHARACTERS table in that script\n' +
  '   and rebuild.\n\n' +
  '   Character art:\n' + banner + '\n\n' +
  '   Every id inside each avatar is prefixed (c-<id>-…) because DiceBear\n' +
  '   emits a fixed `viewboxMask` id and inlining more than one otherwise\n' +
  '   makes all but the first render blank. */\n' +
  '(function () {\n' +
  '  window.SITE_CHARACTERS = ' + JSON.stringify(built, null, 2)
    .split('\n').map(function (l, i) { return i === 0 ? l : '  ' + l; }).join('\n') + ';\n' +
  '}());\n';

fs.writeFileSync(OUT, out);
console.log('[characters] wrote ' + path.relative(process.cwd(), OUT) +
  ' (' + (out.length / 1024).toFixed(1) + 'kB, ' + built.length + ' characters)');
