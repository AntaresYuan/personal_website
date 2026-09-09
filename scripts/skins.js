/* ════════════════════════════════════════════════════════════════════════
   skins.js — the skin registry: palettes, ambient effects and the three
   companion creatures.

   WHY A SEPARATE FILE
   Skins are additive: the site works with none of this loaded. Keeping the
   registry out of render.js means the skin feature can be deleted (or a
   fork can drop it) by removing one <script> tag and one CSS block.

   HOW A SKIN WORKS  (the same three-layer trick kaboo uses)
     1. Palette — a skin re-points the colour custom properties under
        `:root[data-skin="<id>"]`. Nothing else in the stylesheet knows a
        skin exists; every rule already reads the tokens.
     2. Ambient — pure-CSS decoration (drifting clouds, sparkles) behind
        the page, injected as one <div> and driven by @keyframes.
     3. Companion — an optional cursor creature: hand-drawn 24×24 SVG in
        `currentColor`, so it inherits the skin's accent for free. This is
        strictly better than shipping one bitmap per creature per state:
        four states cost four CSS classes, not four PNGs.

   The creatures are drawn here in the same idiom as the doodle glyphs in
   scripts/doodle.js — single-colour paths in a 0 0 24 24 box — so they
   read as part of the same hand, not as clip-art bolted on.

   Everything degrades: no JS → the default palette and no companion; a
   coarse pointer or `prefers-reduced-motion` → no companion at all.
   ════════════════════════════════════════════════════════════════════════ */
'use strict';
(function () {
  /* ── Companion creatures ────────────────────────────────────────────
     Drawn in a 0 0 24 24 box, same idiom as the doodle glyphs.

     Three rules learned the hard way, from zooming these up 7×:
     1. Ears / tufts / tails must have their BASE inside the body outline.
        Same-colour fills then union into one silhouette. A tuft floating
        above the head reads as a detached blob, not as a creature.
     2. Facial features need a contrasting fill (`--skin-eye`), not
        `currentColor` at low opacity — same-on-same is invisible at 26px.
     3. Cuteness is geometry, not detail: wide-set low eyes, a body wider
        than tall, and a blush mark. The blush is a translucent white
        overlay so it lightens whatever body colour the skin supplies,
        instead of needing a per-skin tint.

     `idle` and `moving` change the silhouette (ears lean, feet splay) —
     the eye spots a changed outline far more readily than a changed
     interior, so that's where the motion budget goes. */
  var CREATURES = {
    // A round chick: tuft rooted in the crown, stubby feet, light beak.
    chick: {
      label: 'chick',
      idle:
        '<path fill="currentColor" d="M11 7.8C10.4 5.1 11 2.6 12.3 2.1c.8 1.8 1 3.9.9 5.8Z"/>' +
        '<path fill="currentColor" d="M9.6 18.4 8.8 21.5h2l.4-3.1Zm4.8 0 .8 3.1h-2l-.4-3.1Z"/>' +
        '<circle fill="currentColor" cx="12" cy="13.1" r="6.9"/>' +
        '<ellipse fill="#fff" opacity=".24" cx="7.4" cy="14.9" rx="1.35" ry=".9"/>' +
        '<ellipse fill="#fff" opacity=".24" cx="16.6" cy="14.9" rx="1.35" ry=".9"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="9.7" cy="12.2" r="1.6"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="14.3" cy="12.2" r="1.6"/>' +
        '<circle fill="currentColor" cx="9.95" cy="12.45" r=".64"/>' +
        '<circle fill="currentColor" cx="14.55" cy="12.45" r=".64"/>' +
        '<path fill="var(--skin-eye,#fff)" d="M11.05 14.9h1.9L12 16.6Z"/>',
      moving:
        '<path fill="currentColor" d="M10.4 8C9.2 5.6 9.4 3.1 10.6 2.3c1.1 1.6 1.5 3.7 1.6 5.6Z"/>' +
        '<path fill="currentColor" d="M9.2 18.2 7.4 20.9l1.7 1 1.5-2.6Zm5.4.2 2.3 2.3-1.5 1.3-1.9-2.2Z"/>' +
        '<circle fill="currentColor" cx="12" cy="12.8" r="6.9"/>' +
        '<ellipse fill="#fff" opacity=".24" cx="7.4" cy="14.6" rx="1.35" ry=".9"/>' +
        '<ellipse fill="#fff" opacity=".24" cx="16.6" cy="14.6" rx="1.35" ry=".9"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="9.5" cy="11.8" r="1.6"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="14.1" cy="11.8" r="1.6"/>' +
        '<circle fill="currentColor" cx="9.15" cy="12.05" r=".64"/>' +
        '<circle fill="currentColor" cx="13.75" cy="12.05" r=".64"/>' +
        '<path fill="var(--skin-eye,#fff)" d="M10.6 14.6h1.9l-.95 1.7Z"/>',
    },
    // A cat-ish blob: triangular ears rooted in the skull, flicking tail.
    kit: {
      label: 'kit',
      idle:
        '<path fill="currentColor" d="M5.6 3.6 7 10.6 10.8 7.6Z"/>' +
        '<path fill="currentColor" d="M18.4 3.6 17 10.6 13.2 7.6Z"/>' +
        '<path stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none" d="M17.6 16.9c2.4.4 3.1-1.7 1.9-3"/>' +
        '<circle fill="currentColor" cx="12" cy="13.4" r="6.9"/>' +
        '<ellipse fill="#fff" opacity=".24" cx="7.3" cy="15.1" rx="1.35" ry=".9"/>' +
        '<ellipse fill="#fff" opacity=".24" cx="16.7" cy="15.1" rx="1.35" ry=".9"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="9.7" cy="12.7" r="1.6"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="14.3" cy="12.7" r="1.6"/>' +
        '<circle fill="currentColor" cx="9.95" cy="12.95" r=".64"/>' +
        '<circle fill="currentColor" cx="14.55" cy="12.95" r=".64"/>' +
        '<path fill="var(--skin-eye,#fff)" d="M12 15c.9 0 1.5.5 1.5 1 0 .6-.7 1-1.5 1s-1.5-.4-1.5-1c0-.5.6-1 1.5-1Z"/>',
      moving:
        '<path fill="currentColor" d="M4.9 4.2 6.8 11 10.4 7.6Z"/>' +
        '<path fill="currentColor" d="M17.9 3.2 17.1 10.4 13.1 7.7Z"/>' +
        '<path stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none" d="M17.8 15.4c2.5-.7 3.4 1.4 2.3 2.9"/>' +
        '<circle fill="currentColor" cx="12" cy="13.2" r="6.9"/>' +
        '<ellipse fill="#fff" opacity=".24" cx="7.3" cy="14.9" rx="1.35" ry=".9"/>' +
        '<ellipse fill="#fff" opacity=".24" cx="16.7" cy="14.9" rx="1.35" ry=".9"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="9.4" cy="12.4" r="1.6"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="14" cy="12.4" r="1.6"/>' +
        '<circle fill="currentColor" cx="9.05" cy="12.65" r=".64"/>' +
        '<circle fill="currentColor" cx="13.65" cy="12.65" r=".64"/>' +
        '<path fill="var(--skin-eye,#fff)" d="M11.6 14.7c.9 0 1.5.5 1.5 1.1 0 .6-.7 1.1-1.5 1.1s-1.5-.5-1.5-1.1c0-.6.6-1.1 1.5-1.1Z"/>',
    },
    // A long-eared bun: ears rooted low in the skull, puff tail.
    bun: {
      label: 'bun',
      idle:
        '<path fill="currentColor" d="M10.6 11.2C9.1 8.2 8.7 4.3 9.8 2.5c1.4 1.4 2 5.2 1.9 8.7Z"/>' +
        '<path fill="currentColor" d="M13.4 11.2c-.1-3.5.5-7.3 1.9-8.7 1.1 1.8.7 5.7-.8 8.7Z"/>' +
        '<circle fill="currentColor" cx="19" cy="17.4" r="1.9"/>' +
        '<circle fill="currentColor" cx="12" cy="14.2" r="6.7"/>' +
        '<ellipse fill="#fff" opacity=".24" cx="7.5" cy="15.8" rx="1.35" ry=".9"/>' +
        '<ellipse fill="#fff" opacity=".24" cx="16.5" cy="15.8" rx="1.35" ry=".9"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="9.8" cy="13.6" r="1.6"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="14.2" cy="13.6" r="1.6"/>' +
        '<circle fill="currentColor" cx="10.05" cy="13.85" r=".64"/>' +
        '<circle fill="currentColor" cx="14.45" cy="13.85" r=".64"/>' +
        '<path fill="var(--skin-eye,#fff)" d="M12 15.9c.85 0 1.4.45 1.4.95 0 .55-.65.95-1.4.95s-1.4-.4-1.4-.95c0-.5.55-.95 1.4-.95Z"/>',
      moving:
        '<path fill="currentColor" d="M10.2 11.4C8 9.1 7.1 5.4 8.2 4.2c1.6 1 2.7 4.3 3.1 7.5Z"/>' +
        '<path fill="currentColor" d="M13.6 11.2c.5-3.3 1.8-6.5 3.3-7.4 1 1.3-.2 5-2.5 7.3Z"/>' +
        '<circle fill="currentColor" cx="19.2" cy="16.4" r="1.9"/>' +
        '<circle fill="currentColor" cx="12" cy="14" r="6.7"/>' +
        '<ellipse fill="#fff" opacity=".24" cx="7.5" cy="15.6" rx="1.35" ry=".9"/>' +
        '<ellipse fill="#fff" opacity=".24" cx="16.5" cy="15.6" rx="1.35" ry=".9"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="9.5" cy="13.3" r="1.6"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="13.9" cy="13.3" r="1.6"/>' +
        '<circle fill="currentColor" cx="9.15" cy="13.55" r=".64"/>' +
        '<circle fill="currentColor" cx="13.55" cy="13.55" r=".64"/>' +
        '<path fill="var(--skin-eye,#fff)" d="M11.6 15.6c.85 0 1.4.45 1.4.95 0 .55-.65.95-1.4.95s-1.4-.4-1.4-.95c0-.5.55-.95 1.4-.95Z"/>',
    },
    /* ── IP mascots ────────────────────────────────────────────────────
       The two below belong to the IP skins rather than the generic ones.
       An IP's mascot has to be recognisably ITS OWN character, not a
       recoloured version of the same blob — so these break the round-body
       template on purpose: Comet is a head with a tail and no feet, Lantern
       is tall with a stalk. */
    // Comet — the mascot of Observatory. A star head trailing sparks.
    comet: {
      label: 'comet',
      idle:
        // tail: three tapering streaks rooted at the body's left edge
        '<path fill="currentColor" opacity=".55" d="M6.6 12.4 1.6 10.9l5-.1Z"/>' +
        '<path fill="currentColor" opacity=".38" d="M6.8 14.4 2.4 14.1l4.3-1.1Z"/>' +
        '<path fill="currentColor" opacity=".28" d="M7.4 16.2 3.9 17l3.2-2Z"/>' +
        // five-point star body, deliberately chunky so the face fits
        '<path fill="currentColor" d="M14 3.4l2.3 4.4 4.9.7-3.6 3.4.9 4.8-4.5-2.4-4.4 2.4.8-4.8L6.8 8.5l4.9-.7Z"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="12.4" cy="9.4" r="1.5"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="16" cy="9.4" r="1.5"/>' +
        '<circle fill="currentColor" cx="12.65" cy="9.65" r=".6"/>' +
        '<circle fill="currentColor" cx="16.25" cy="9.65" r=".6"/>' +
        '<path fill="var(--skin-eye,#fff)" d="M13.2 11.6h2.1l-1.05 1.5Z"/>',
      moving:
        // streaks stretch and the star leans into the direction of travel
        '<path fill="currentColor" opacity=".6" d="M6.2 12.1.6 10.4l5.6.2Z"/>' +
        '<path fill="currentColor" opacity=".42" d="M6.5 14.3 1.2 14.5l5.2-1.5Z"/>' +
        '<path fill="currentColor" opacity=".3" d="M7.2 16.4 2.8 17.9l3.9-2.7Z"/>' +
        '<path fill="currentColor" d="M14.4 2.8l2.4 4.5 4.9.6-3.6 3.5 1 4.9-4.6-2.5-4.4 2.3.8-4.8L7.2 8.1l4.9-.8Z"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="12.6" cy="8.9" r="1.5"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="16.2" cy="8.9" r="1.5"/>' +
        '<circle fill="currentColor" cx="12.25" cy="9.15" r=".6"/>' +
        '<circle fill="currentColor" cx="15.85" cy="9.15" r=".6"/>' +
        '<path fill="var(--skin-eye,#fff)" d="M13.3 11.1h2.1l-1.05 1.6Z"/>',
    },
    // Lantern — the mascot of Abyss. A deep-sea bell with a lure on a stalk.
    lantern: {
      label: 'lantern',
      idle:
        // lure: stalk rooted in the crown, glowing bulb at the tip
        '<path stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" d="M12 8.4c0-3 .6-4.6 2.6-5.3"/>' +
        '<circle fill="currentColor" cx="15.6" cy="2.6" r="1.9"/>' +
        '<circle fill="#fff" opacity=".5" cx="15.2" cy="2.2" r=".8"/>' +
        // bell body: taller than wide, flat crown, scalloped hem
        '<path fill="currentColor" d="M12 8.1c3.5 0 5.6 2.4 5.6 5.4 0 2.3-.7 4-1.6 5.6H8c-.9-1.6-1.6-3.3-1.6-5.6 0-3 2.1-5.4 5.6-5.4Z"/>' +
        // tentacles hanging from the hem, bases inside the body outline
        '<path fill="currentColor" d="M8.6 18.6h1.5l-.5 3.2H8.2Zm2.6 0h1.5l.2 3.6h-1.5Zm2.7 0h1.5l.9 3.1-1.4.3Z"/>' +
        '<ellipse fill="#fff" opacity=".2" cx="8.6" cy="14.4" rx="1.2" ry=".8"/>' +
        '<ellipse fill="#fff" opacity=".2" cx="15.4" cy="14.4" rx="1.2" ry=".8"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="10.2" cy="12.6" r="1.5"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="13.8" cy="12.6" r="1.5"/>' +
        '<circle fill="currentColor" cx="10.45" cy="12.85" r=".6"/>' +
        '<circle fill="currentColor" cx="14.05" cy="12.85" r=".6"/>' +
        '<path fill="var(--skin-eye,#fff)" d="M12 14.9c.8 0 1.3.4 1.3.9s-.6.9-1.3.9-1.3-.4-1.3-.9.5-.9 1.3-.9Z"/>',
      moving:
        // the lure swings back and the tentacles trail
        '<path stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" d="M11.8 8.4c-.4-3 0-4.8 1.7-5.9"/>' +
        '<circle fill="currentColor" cx="14.2" cy="1.9" r="1.9"/>' +
        '<circle fill="#fff" opacity=".5" cx="13.8" cy="1.5" r=".8"/>' +
        '<path fill="currentColor" d="M12 8.1c3.5 0 5.6 2.4 5.6 5.4 0 2.3-.7 4-1.6 5.6H8c-.9-1.6-1.6-3.3-1.6-5.6 0-3 2.1-5.4 5.6-5.4Z"/>' +
        '<path fill="currentColor" d="M8.6 18.6h1.5l-1.5 3-1.3-.6Zm2.6 0h1.5l-.7 3.5-1.4-.3Zm2.7 0h1.5l.2 3.4-1.5.1Z"/>' +
        '<ellipse fill="#fff" opacity=".2" cx="8.6" cy="14.2" rx="1.2" ry=".8"/>' +
        '<ellipse fill="#fff" opacity=".2" cx="15.4" cy="14.2" rx="1.2" ry=".8"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="9.9" cy="12.3" r="1.5"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="13.5" cy="12.3" r="1.5"/>' +
        '<circle fill="currentColor" cx="9.55" cy="12.55" r=".6"/>' +
        '<circle fill="currentColor" cx="13.15" cy="12.55" r=".6"/>' +
        '<path fill="var(--skin-eye,#fff)" d="M11.7 14.7c.8 0 1.3.4 1.3.9s-.6.9-1.3.9-1.3-.4-1.3-.9.5-.9 1.3-.9Z"/>',
    },

    /* ── Dumpling-skin mascots ─────────────────────────────────────────
       For the `dumpling` skin. The genre these belong to (kaboo's chiikawa
       mode, and the whole Japanese "tiny creatures doing odd jobs" lineage)
       has a very specific grammar, and copying the GRAMMAR is fair game
       even though copying the characters is not:

         · body wider than tall, no neck, almost no limbs
         · dot eyes set WIDE and LOW, tiny mouth, always a blush
         · every creature carries a tool — the joke is that they are
           labourers, so the prop is the character
         · outline in a soft dark ink rather than pure black

       These two are drawn from scratch to that grammar: Mochi is a rice
       dumpling holding a pull-weed, Nyan is a cat-eared one with a broom.
       Neither resembles a specific existing character — same idiom, own
       shapes, which is exactly the line I can stand behind on a public
       résumé site. */
    // Mochi — a round dumpling gripping a weed it just pulled.
    mochi: {
      label: 'mochi',
      idle:
        // the pulled weed, held out to one side (roots showing — that's the gag)
        '<path stroke="currentColor" stroke-width="1.1" fill="none" stroke-linecap="round" d="M19.4 9.6c.9-1.5 1.6-2 2.3-2.1M19.4 9.6c-.6-1.3-.4-2.2 0-2.9"/>' +
        '<path stroke="currentColor" stroke-width="1.1" fill="none" stroke-linecap="round" d="M19.4 9.8v3.4"/>' +
        '<path stroke="currentColor" stroke-width=".9" fill="none" stroke-linecap="round" d="M19.4 13.2l-1 1.5M19.4 13.2l1 1.4"/>' +
        // body: a wide, softly squared dumpling
        '<path fill="currentColor" d="M11 6.6c4.3 0 7 2.7 7 6.6 0 3.6-2.6 5.9-7 5.9s-7-2.3-7-5.9c0-3.9 2.7-6.6 7-6.6Z"/>' +
        // stubby feet, bases inside the silhouette
        '<path fill="currentColor" d="M7.6 18.2h2l-.5 3H7Zm4.8 0h2l.6 3h-2.1Z"/>' +
        // blush, then the wide-set low dot eyes
        '<ellipse fill="#fff" opacity=".26" cx="6.6" cy="14.6" rx="1.5" ry="1"/>' +
        '<ellipse fill="#fff" opacity=".26" cx="15.4" cy="14.6" rx="1.5" ry="1"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="8.4" cy="12.4" r="1.7"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="13.6" cy="12.4" r="1.7"/>' +
        '<circle fill="currentColor" cx="8.65" cy="12.7" r=".68"/>' +
        '<circle fill="currentColor" cx="13.85" cy="12.7" r=".68"/>' +
        // tiny open mouth
        '<path fill="var(--skin-eye,#fff)" d="M11 14.8c.7 0 1.1.4 1.1.8 0 .5-.5.8-1.1.8s-1.1-.3-1.1-.8c0-.4.4-.8 1.1-.8Z"/>',
      moving:
        // the weed swings back; feet splay into a waddle
        '<path stroke="currentColor" stroke-width="1.1" fill="none" stroke-linecap="round" d="M20.2 8.2c1-1.3 1.8-1.7 2.5-1.7M20.2 8.2c-.5-1.4-.2-2.2.3-2.8"/>' +
        '<path stroke="currentColor" stroke-width="1.1" fill="none" stroke-linecap="round" d="M20.1 8.4l-.6 3.3"/>' +
        '<path stroke="currentColor" stroke-width=".9" fill="none" stroke-linecap="round" d="M19.5 11.7l-1.2 1.3M19.5 11.7l.8 1.6"/>' +
        '<path fill="currentColor" d="M11 6.4c4.3 0 7 2.7 7 6.6 0 3.6-2.6 5.9-7 5.9s-7-2.3-7-5.9c0-3.9 2.7-6.6 7-6.6Z"/>' +
        '<path fill="currentColor" d="M7.4 18h2l-1.7 2.8-1.5-.7Zm5 .2h2l1.5 2.5-1.7.9Z"/>' +
        '<ellipse fill="#fff" opacity=".26" cx="6.6" cy="14.4" rx="1.5" ry="1"/>' +
        '<ellipse fill="#fff" opacity=".26" cx="15.4" cy="14.4" rx="1.5" ry="1"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="8.1" cy="12.1" r="1.7"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="13.3" cy="12.1" r="1.7"/>' +
        '<circle fill="currentColor" cx="7.75" cy="12.4" r=".68"/>' +
        '<circle fill="currentColor" cx="12.95" cy="12.4" r=".68"/>' +
        '<path fill="var(--skin-eye,#fff)" d="M10.6 14.5c.7 0 1.1.4 1.1.9s-.5.9-1.1.9-1.1-.4-1.1-.9.4-.9 1.1-.9Z"/>',
    },
    // Nyan — cat-eared, holding a broom. Ears rooted in the skull.
    nyan: {
      label: 'nyan',
      idle:
        // ears: bases well inside the head so they union into one shape
        '<path fill="currentColor" d="M5.8 5.2 7.4 11l3.3-2.6Z"/>' +
        '<path fill="currentColor" d="M16.2 5.2 14.6 11l-3.3-2.6Z"/>' +
        // broom: handle plus a splayed bristle head
        '<path stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round" d="M19.8 6.4v7.2"/>' +
        '<path fill="currentColor" d="M17.9 13.6h3.8l1 4.4h-5.8Z"/>' +
        '<path stroke="var(--skin-eye,#fff)" stroke-width=".7" fill="none" d="M18.7 14.6v2.6M19.8 14.6v2.6M20.9 14.6v2.6"/>' +
        '<path fill="currentColor" d="M11 7.4c4.1 0 6.7 2.6 6.7 6.3 0 3.4-2.5 5.6-6.7 5.6s-6.7-2.2-6.7-5.6c0-3.7 2.6-6.3 6.7-6.3Z"/>' +
        '<path fill="currentColor" d="M7.8 18.8h1.9l-.5 2.9H7.2Zm4.5 0h1.9l.6 2.9h-2Z"/>' +
        '<ellipse fill="#fff" opacity=".26" cx="6.8" cy="15.2" rx="1.45" ry="1"/>' +
        '<ellipse fill="#fff" opacity=".26" cx="15.2" cy="15.2" rx="1.45" ry="1"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="8.5" cy="13" r="1.65"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="13.5" cy="13" r="1.65"/>' +
        '<circle fill="currentColor" cx="8.75" cy="13.3" r=".66"/>' +
        '<circle fill="currentColor" cx="13.75" cy="13.3" r=".66"/>' +
        // cat mouth: two small arcs
        '<path stroke="var(--skin-eye,#fff)" stroke-width=".9" fill="none" stroke-linecap="round" d="M9.7 15.4c.5.6 1 .6 1.3 0M11 15.4c.3.6.8.6 1.3 0"/>',
      moving:
        '<path fill="currentColor" d="M5.2 5.8 7 11.4l3.2-2.9Z"/>' +
        '<path fill="currentColor" d="M15.8 4.8 14.4 10.7l-3.2-2.5Z"/>' +
        '<path stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round" d="M20.4 5.6l-1 7.1"/>' +
        '<path fill="currentColor" d="M17.4 12.8h3.8l.6 4.4h-5.8Z"/>' +
        '<path stroke="var(--skin-eye,#fff)" stroke-width=".7" fill="none" d="M18.2 13.8l-.2 2.6M19.3 13.8l-.1 2.6M20.4 13.8v2.6"/>' +
        '<path fill="currentColor" d="M11 7.2c4.1 0 6.7 2.6 6.7 6.3 0 3.4-2.5 5.6-6.7 5.6s-6.7-2.2-6.7-5.6c0-3.7 2.6-6.3 6.7-6.3Z"/>' +
        '<path fill="currentColor" d="M7.6 18.6h1.9l-1.6 2.7-1.4-.7Zm4.7.2h1.9l1.4 2.4-1.6.9Z"/>' +
        '<ellipse fill="#fff" opacity=".26" cx="6.8" cy="15" rx="1.45" ry="1"/>' +
        '<ellipse fill="#fff" opacity=".26" cx="15.2" cy="15" rx="1.45" ry="1"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="8.2" cy="12.7" r="1.65"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="13.2" cy="12.7" r="1.65"/>' +
        '<circle fill="currentColor" cx="7.85" cy="13" r=".66"/>' +
        '<circle fill="currentColor" cx="12.85" cy="13" r=".66"/>' +
        '<path stroke="var(--skin-eye,#fff)" stroke-width=".9" fill="none" stroke-linecap="round" d="M9.4 15.2c.5.6 1 .6 1.3 0M10.7 15.2c.3.6.8.6 1.3 0"/>',
    },

    /* ── Vocal-synth mascot ────────────────────────────────────────────
       For the `vocal` skin. NOT a character portrait — see the long note
       on that skin below. This is a MICROPHONE with a face: the prop is
       the mascot, same trick as Mochi's weed and Nyan's broom. A cardioid
       capsule on a stand, with the two teal pigtail-ish cables that read
       as "vocal synth" without depicting anyone. */
    /* ── Characters drawn for licensed IP skins ─────────────────────
       All four are my own drawings. That distinction matters per licence:

       · Diva (Vocal / Piapro Character Licence) — the PCL covers making
         your own derivative art of the character; what it does NOT cover
         is Crypton's official illustrations or other people's fan art.
         So this is drawn from scratch. At 30px the readable cue is the
         silhouette, and the silhouette cue here is the twin tails.

       · Ferris (Rustacean) — CC0, no obligation at all, but credited
         anyway. Deliberately drawn WITHOUT the shell spikes: Karen Rustad
         Tölva has said those came from the sprocket in the official Rust
         logo, and the logo is the trademarked part. A round crab with
         claws and eye-stalks is unmistakable without them.

       · Pepper and Carrot (Hereva) — CC BY 4.0, so the credit must name
         David Revoy, link the licence, and say it was changed. Drawn from
         scratch, which is the change.

       Every sprite paints in one colour (`currentColor`) plus
       `--skin-eye` for contrast, because that's all the companion layer
       supports — so each design has to survive as a two-tone silhouette.
       ─────────────────────────────────────────────────────────────── */

    // Diva — twin tails past the hips. That's the whole recognisability
    // budget at this size, so the tails are drawn first and the head is
    // laid over their roots.
    ferris: {
      label: 'ferris',
      idle:
        '<path stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none" d="M9.9 8.4V5.9M14.1 8.4V5.9"/>' +
        '<circle fill="currentColor" cx="4.1" cy="12.5" r="2.6"/>' +
        '<path fill="var(--skin-eye,#fff)" d="M4.1 12.5 1.6 11.2a2.75 2.75 0 0 0 0 2.6Z"/>' +
        '<circle fill="currentColor" cx="19.9" cy="12.5" r="2.6"/>' +
        '<path fill="var(--skin-eye,#fff)" d="M19.9 12.5l2.5-1.3a2.75 2.75 0 0 1 0 2.6Z"/>' +
        '<path stroke="currentColor" stroke-width="1.1" stroke-linecap="round" fill="none" d="M8.4 16.6 6.5 19M11 17.2l-.7 2.6M13 17.2l.7 2.6M15.6 16.6 17.5 19"/>' +
        '<path fill="currentColor" d="M12 7.5c4.1 0 7 2.4 7 5.4 0 2.6-2.9 4.2-7 4.2s-7-1.6-7-4.2c0-3 2.9-5.4 7-5.4Z"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="9.9" cy="5.4" r="1.5"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="14.1" cy="5.4" r="1.5"/>' +
        '<circle fill="currentColor" cx="10.05" cy="5.55" r=".62"/>' +
        '<circle fill="currentColor" cx="14.25" cy="5.55" r=".62"/>' +
        '<path stroke="var(--skin-eye,#fff)" stroke-width=".85" stroke-linecap="round" fill="none" d="M10.8 13.5c.7.6 1.7.6 2.4 0"/>',
      moving:
        // sidling, the way crabs actually travel: claws swing one way, legs
        // trail the other
        '<path stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none" d="M9.6 8.3 9.2 5.8M13.8 8.4l.2-2.5"/>' +
        '<circle fill="currentColor" cx="3.6" cy="11.4" r="2.6"/>' +
        '<path fill="var(--skin-eye,#fff)" d="M3.6 11.4 1.2 9.7a2.75 2.75 0 0 0-.3 2.6Z"/>' +
        '<circle fill="currentColor" cx="20.2" cy="13.4" r="2.6"/>' +
        '<path fill="var(--skin-eye,#fff)" d="M20.2 13.4l2.6-.9a2.75 2.75 0 0 1-.4 2.6Z"/>' +
        '<path stroke="currentColor" stroke-width="1.1" stroke-linecap="round" fill="none" d="M8.6 16.5 6.1 18.3M11.1 17.2l-1.4 2.4M13.1 17.1l.3 2.7M15.7 16.4l2.2 2.2"/>' +
        '<path fill="currentColor" d="M12 7.4c4.1 0 7 2.4 7 5.4 0 2.6-2.9 4.2-7 4.2s-7-1.6-7-4.2c0-3 2.9-5.4 7-5.4Z"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="9.5" cy="5.3" r="1.5"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="13.9" cy="5.2" r="1.5"/>' +
        '<circle fill="currentColor" cx="9.2" cy="5.45" r=".62"/>' +
        '<circle fill="currentColor" cx="13.6" cy="5.35" r=".62"/>' +
        '<path stroke="var(--skin-eye,#fff)" stroke-width=".85" stroke-linecap="round" fill="none" d="M10.6 13.4c.8.5 1.8.4 2.4-.2"/>',
    },

    // Pepper — the pointed hat carries the whole silhouette. Brim drawn
    // wider than the head so the shape still reads when scaled down.
    pepper: {
      label: 'pepper',
      idle:
        '<path fill="currentColor" d="M12 2.1 15.7 9.2H8.3Z"/>' +
        '<path fill="currentColor" d="M5.4 9.2h13.2c.45 0 .8.35.8.8s-.35.8-.8.8H5.4c-.45 0-.8-.35-.8-.8s.35-.8.8-.8Z"/>' +
        '<path fill="currentColor" d="M9.1 16.8h5.8l1.5 5.3H7.6Z"/>' +
        '<circle fill="currentColor" cx="12" cy="13.7" r="3.5"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="10.6" cy="13.5" r="1.2"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="13.4" cy="13.5" r="1.2"/>' +
        '<circle fill="currentColor" cx="10.75" cy="13.7" r=".5"/>' +
        '<circle fill="currentColor" cx="13.55" cy="13.7" r=".5"/>' +
        '<path stroke="var(--skin-eye,#fff)" stroke-width=".75" stroke-linecap="round" fill="none" d="M11.1 15.5c.55.45 1.25.45 1.8 0"/>',
      moving:
        // hat tip whips back, robe flares — the classic broom-run pose
        '<path fill="currentColor" d="M9.4 2.6 15.9 9.3 8.6 9.5Z"/>' +
        '<path fill="currentColor" d="M5.5 9.4h13.2c.45 0 .8.35.8.8s-.35.8-.8.8H5.5c-.45 0-.8-.35-.8-.8s.35-.8.8-.8Z"/>' +
        '<path fill="currentColor" d="M9.3 16.9h5.8l2 5.1H7.2Z"/>' +
        '<circle fill="currentColor" cx="12.2" cy="13.8" r="3.5"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="10.9" cy="13.6" r="1.2"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="13.7" cy="13.6" r="1.2"/>' +
        '<circle fill="currentColor" cx="10.6" cy="13.8" r=".5"/>' +
        '<circle fill="currentColor" cx="13.4" cy="13.8" r=".5"/>' +
        '<ellipse fill="var(--skin-eye,#fff)" cx="12.2" cy="15.7" rx=".9" ry=".7"/>',
    },

    // Carrot — a whole cat, sitting, tail curled up. Kept distinct from
    // Nyan (who is a cat-EARED person with a broom) by being an actual
    // animal on all fours.
    carrot: {
      label: 'carrot',
      idle:
        '<path stroke="currentColor" stroke-width="2.1" stroke-linecap="round" fill="none" d="M17.2 17.6c2.3-.5 3.3-2.4 2.5-4.5"/>' +
        '<path fill="currentColor" d="M11.2 10c3 0 5.1 2.5 5.5 5.8.2 1.9-.6 3.4-2.1 3.4H7.8c-1.5 0-2.3-1.5-2.1-3.4C6.1 12.5 8.2 10 11.2 10Z"/>' +
        '<path fill="currentColor" d="M8.1 9.7 7.2 5.9l3.2 2.1ZM14.3 9.7l.9-3.8-3.2 2.1Z"/>' +
        '<circle fill="currentColor" cx="11.2" cy="9.6" r="3.6"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="9.7" cy="9.4" r="1.25"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="12.7" cy="9.4" r="1.25"/>' +
        '<circle fill="currentColor" cx="9.85" cy="9.6" r=".52"/>' +
        '<circle fill="currentColor" cx="12.85" cy="9.6" r=".52"/>' +
        // whiskers, one stroke per side
        '<path stroke="var(--skin-eye,#fff)" stroke-width=".55" opacity=".7" stroke-linecap="round" fill="none" d="M8.4 11.4 6.6 11M14 11.4l1.8-.4"/>',
      moving:
        // mid-pounce: tail straight out, legs extended
        '<path stroke="currentColor" stroke-width="2.1" stroke-linecap="round" fill="none" d="M17.4 15.6c2.4.2 3.6-1 3.8-2.9"/>' +
        '<path fill="currentColor" d="M11 10.2c3.1 0 5.4 2.2 5.8 4.6.2 1.5-.7 2.6-2.2 2.6H7.4c-1.5 0-2.3-1.1-2.1-2.6.4-2.4 2.6-4.6 5.7-4.6Z"/>' +
        '<path stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none" d="M7.6 17.2 5.9 19.4M10.2 17.4 9.6 20M13 17.4l.7 2.6M15.4 17.1 17 19.3"/>' +
        '<path fill="currentColor" d="M7.9 9.9 6.8 6.2l3.3 1.9ZM14.1 9.6l1.1-3.7-3.3 2Z"/>' +
        '<circle fill="currentColor" cx="11" cy="9.5" r="3.6"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="9.5" cy="9.3" r="1.25"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="12.5" cy="9.3" r="1.25"/>' +
        '<circle fill="currentColor" cx="9.2" cy="9.5" r=".52"/>' +
        '<circle fill="currentColor" cx="12.2" cy="9.5" r=".52"/>' +
        '<ellipse fill="var(--skin-eye,#fff)" cx="11" cy="11.3" rx=".85" ry=".65"/>',
    },

    mic: {
      label: 'mic',
      idle:
        // two cables sweeping down from the capsule sides — the silhouette
        // cue that says "this is the vocal one" without drawing a person
        '<path stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" d="M6.4 10.6c-1.8 1.5-2.4 4-2 6.6"/>' +
        '<path stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" d="M17.6 10.6c1.8 1.5 2.4 4 2 6.6"/>' +
        // stand: base plus post, rooted under the capsule
        '<path fill="currentColor" d="M11.1 18.6h1.8v2.2h-1.8Z"/>' +
        '<path fill="currentColor" d="M8.6 20.6h6.8v1.5H8.6Z"/>' +
        // capsule: a rounded rect, taller than wide
        '<path fill="currentColor" d="M12 3.2c2.7 0 4.6 1.9 4.6 4.6v5.4c0 2.7-1.9 4.6-4.6 4.6s-4.6-1.9-4.6-4.6V7.8c0-2.7 1.9-4.6 4.6-4.6Z"/>' +
        // grille lines, in the contrast colour so they read at 26px
        '<path stroke="var(--skin-eye,#fff)" stroke-width=".55" opacity=".5" fill="none" d="M8.2 6.4h7.6M8.2 15.1h7.6"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="10.2" cy="9.8" r="1.5"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="13.8" cy="9.8" r="1.5"/>' +
        '<circle fill="currentColor" cx="10.45" cy="10.05" r=".6"/>' +
        '<circle fill="currentColor" cx="14.05" cy="10.05" r=".6"/>' +
        // open mouth — it's singing
        '<ellipse fill="var(--skin-eye,#fff)" cx="12" cy="12.6" rx="1.15" ry="1.4"/>',
      moving:
        // cables trail, capsule tilts into the direction of travel
        '<path stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" d="M6.1 10.2C3.9 11.3 2.6 13.4 2.2 16"/>' +
        '<path stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" d="M17.3 10.9c2.1 1.1 3 3.4 3 6"/>' +
        '<path fill="currentColor" d="M11.3 18.4h1.8l-.3 2.2h-1.8Z"/>' +
        '<path fill="currentColor" d="M8.4 20.4h6.8v1.5H8.4Z"/>' +
        '<path fill="currentColor" d="M12.3 2.9c2.7 0 4.6 1.9 4.4 4.6l-.4 5.4c-.2 2.7-1.9 4.6-4.6 4.6s-4.4-1.9-4.2-4.6l.4-5.4C8.1 4.8 9.6 2.9 12.3 2.9Z"/>' +
        '<path stroke="var(--skin-eye,#fff)" stroke-width=".55" opacity=".5" fill="none" d="M8.3 6.2h7.6M7.9 14.9h7.6"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="10.4" cy="9.6" r="1.5"/>' +
        '<circle fill="var(--skin-eye,#fff)" cx="14" cy="9.6" r="1.5"/>' +
        '<circle fill="currentColor" cx="10.05" cy="9.85" r=".6"/>' +
        '<circle fill="currentColor" cx="13.65" cy="9.85" r=".6"/>' +
        '<ellipse fill="var(--skin-eye,#fff)" cx="12.1" cy="12.4" rx="1.3" ry="1.15"/>',
    },
  };

  /* ── Data-rain glyphs ───────────────────────────────────────────────
     Columns of falling characters for the `rain` ambient. Glyphs are
     derived from the column index with a fixed LCG — never Math.random —
     so the rain is byte-identical across reloads and skin toggles. A
     random layout would visibly "reshuffle" every time you switched away
     and back, which reads as a bug.

     Hex + operators rather than katakana: this is a site about writing
     software, and borrowed Matrix iconography would be someone else's
     idea. */
  var RAIN_GLYPHS = '0123456789ABCDEF<>/\\=+*#{}[]();:$&|~^!?';
  var RAIN_COLUMNS = 24;

  function rainColumns() {
    var cols = [];
    for (var i = 0; i < RAIN_COLUMNS; i++) {
      var len = 14 + (i % 7) * 3;
      var seed = ((i + 1) * 2654435761) >>> 0;
      var text = '';
      for (var j = 0; j < len; j++) {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        text += RAIN_GLYPHS.charAt(seed % RAIN_GLYPHS.length);
      }
      cols.push({
        text: text,
        left: (i / RAIN_COLUMNS) * 100 + 0.5,
        dur: 7 + (i % 6) * 1.7,
        delay: -((i * 1.9) % 11),
        size: 11 + (i % 4) * 3,
        op: 0.22 + (i % 5) * 0.08,
        alt: i % 5 === 0,          // every fifth column takes the second hue
      });
    }
    return cols;
  }

  /* ── The registry ───────────────────────────────────────────────────
     `id` is what lands in localStorage and on <html data-skin>. The
     palette, texture and shape language all live in styles/main.css — a
     skin can restyle anything, which is a job for CSS, not a JS object.
     This table only carries what the runtime needs:

       ambient    background layer id  (behind the page, z-index 0)
       overlay    foreground layer id  (above the page, never clickable)
       glitch     opt into the random page-displacement scheduler
       boot       lines for the one-shot entry overlay
       companions creature ids that follow the cursor
       lex        vocabulary overrides — see LEXICON below
       tagline    a line shown under the picker's group heading

     GENRE SPREAD — the point of this table
     The first pass shipped four skins that were all the same *kind* of
     thing: soft palette, drifting particles, a cute companion. Recolouring
     is not a genre. What actually separates kaboo's 45 skins is that they
     change different layers of the design:

       palette   every skin (cheap, and the least interesting on its own)
       texture   layered gradients + repeating patterns  → CRT, print
       shape     radii, notched clip-paths, hard shadows → HUD, glitch
       type      swapping the display face               → Terminal
       motion    ambient drift vs. random displacement   → Neon
       chrome    corner brackets, tags, warning stripes  → HUD

     …and the IP skins add the layer none of the above touches:

       lexicon   the words the page uses for its own data → Observatory,
                 Abyss. kaboo's chiikawa skin renames token → 劳动点,
                 cost → 饭团, session → 打工; that renaming is most of
                 what makes it feel like a *world* rather than a palette.

     `default` deliberately has nothing: the base site must stay exactly as
     it was for anyone who never opens the picker. */
  var SKINS = [
    { id: 'default', label: 'Paper', group: 'Plain', hint: 'the original cream + cobalt' },
    {
      id: 'meadow',
      label: 'Meadow',
      group: 'Plain',
      hint: 'soft greens, drifting clouds, a companion',
      ambient: 'clouds',
      companions: ['chick', 'bun', 'kit'],
    },
    {
      id: 'solar',
      label: 'Solar',
      group: 'Plain',
      hint: 'warm noon light, dust in the air',
      ambient: 'motes',
      companions: ['chick'],
    },
    {
      id: 'press',
      label: 'Press',
      group: 'Print',
      hint: 'risograph inks, halftone, hard shadows',
      ambient: 'halftone',
    },
    {
      id: 'dossier',
      label: 'Dossier',
      group: 'Print',
      hint: 'declassified file, typewriter, redactions',
      ambient: 'fibres',
      overlay: 'stamp',
    },
    {
      id: 'blueprint',
      label: 'Blueprint',
      group: 'Print',
      hint: 'cyanotype drafting, grid, dimension ticks',
      ambient: 'draft',
      overlay: 'rule',
    },
    {
      id: 'terminal',
      label: 'Terminal',
      group: 'Machine',
      hint: 'CRT phosphor, scanlines, roll flicker',
      ambient: 'scan',
      overlay: 'crt',
      boot: ['> boot /dev/antares', '> mounting profile … ok', '> ready'],
    },
    {
      id: 'hud',
      label: 'Recon',
      group: 'Machine',
      hint: 'amber tactical HUD, notched panels',
      ambient: 'grid',
      overlay: 'hud',
    },
    {
      id: 'neon',
      label: 'Neon',
      group: 'Machine',
      hint: 'magenta glitch, data rain, hard edges',
      ambient: 'rain',
      overlay: 'glitch',
      glitch: true,
      boot: ['◇ link established', '◇ decrypting …', '◇ welcome'],
    },
    {
      id: 'dusk',
      label: 'Dusk',
      group: 'Night',
      hint: 'indigo night, slow sparkles',
      ambient: 'sparks',
      companions: ['kit'],
    },

    /* ── IP skins ──────────────────────────────────────────────────────
       These carry a whole premise, not a palette: a name for the place, a
       mascot of their own, and their own words for every number on the
       page. Observatory turns the usage panel into a night's observing
       log; Abyss turns it into a dive record.

       Why invented IPs rather than borrowed ones: kaboo can ship Chiikawa
       and Genshin skins because it's an internal tool. This site is a
       public résumé, so every asset here has to be original — which is
       also why the mascots are hand-drawn SVG in the same idiom as the
       rest of the site rather than sourced art. */
    {
      id: 'observatory',
      label: 'Observatory',
      group: 'Worlds',
      hint: 'a night at the telescope — logs, magnitudes, a comet',
      brand: 'Antares Observatory',
      ambient: 'starfield',
      overlay: 'scope',
      companions: ['comet'],
      boot: ['◦ opening the dome …', '◦ tracking Antares', '◦ seeing: good'],
      lex: {
        panelTitle: 'Antares\'s <em>Observing Log</em>',
        'tokens billed': 'catalogued',
        'tokens': 'catalogued',
        'tokens processed': 'light collected',
        'from cache': 'from the archive',
        'spend': 'telescope time',
        'sessions': 'nights out',
        'at keyboard': 'at the eyepiece',
        'active this week': 'clear nights',
        'top tool': 'main instrument',
        'tracking since': 'first light',
        'peak': 'best seeing',
        'after hours': 'after midnight',
        'weekend': 'weekend nights',
        'prompts': 'observations',
        'days': 'nights',
        'Less': 'dim',
        'More': 'bright',
        'all charts →': 'the whole sky →',
      },
    },
    {
      id: 'abyss',
      label: 'Abyss',
      group: 'Worlds',
      hint: 'a deep dive — depth, pressure, a lantern creature',
      brand: 'Antares Deep',
      ambient: 'bathy',
      overlay: 'sonar',
      companions: ['lantern'],
      boot: ['≈ flooding ballast …', '≈ descending', '≈ lights on'],
      lex: {
        panelTitle: 'Antares\'s <em>Dive Log</em>',
        'tokens billed': 'logged',
        'tokens': 'logged',
        'tokens processed': 'water moved',
        'from cache': 'from ballast',
        'spend': 'air used',
        'sessions': 'dives',
        'at keyboard': 'submerged',
        'active this week': 'days at sea',
        'top tool': 'primary rig',
        'tracking since': 'first descent',
        'peak': 'deepest',
        'after hours': 'night dives',
        'weekend': 'weekend dives',
        'prompts': 'soundings',
        'days': 'days',
        'Less': 'shallow',
        'More': 'deep',
        'all charts →': 'the full survey →',
      },
    },
    /* Dumpling — the cute-creature-labour genre.

       WHAT THIS IS AND ISN'T. The look comes from kaboo's chiikawa mode and
       the wider Japanese "tiny creatures working odd jobs" idiom. The
       characters and names in that franchise belong to their author, and
       kaboo can ship their art because it's an internal tool — this site is
       a public résumé, so it can't. What IS free to reuse is the design
       grammar, and that grammar is where nearly all of the charm lives:

         palette   cream + macaron pink/blue, nothing saturated
         ground    a sky→grass gradient over squared notebook paper, so the
                   page reads as a page from a scrapbook rather than a screen
         shape     SMALL radii (kaboo uses 8px, not pills) with soft, wide
                   shadows — crisp cards floating on paper
         type      rounded sans everywhere, no serif display face
         chrome    scrapbook furniture: tape, pins, memo cards, punched
                   tickets, a rubber stamp
         lexicon   the labour premise — work becomes "chores", tokens become
                   "chore points", money becomes "snacks"
         mascots   creatures that CARRY TOOLS; the prop is the character

       So this is the same genre executed with original assets, which is a
       thing I can put on a public site without borrowing anyone's IP. */
    {
      id: 'dumpling',
      label: 'Dumpling',
      group: 'Worlds',
      hint: 'tiny creatures doing chores for snacks — scrapbook, tape, pins',
      brand: 'Antares\'s Little Work Hut',
      ambient: 'meadowsky',
      overlay: 'scrapbook',
      companions: ['mochi', 'nyan'],
      boot: ['♪ opening the hut …', '♪ handing out brooms', '♪ ready to work!'],
      lex: {
        panelTitle: 'Antares\'s <em>Chore Diary</em>',
        'tokens billed': 'chore points',
        'tokens': 'chore points',
        'tokens processed': 'work done',
        'from cache': 'leftovers reused',
        'spend': 'snacks',
        'sessions': 'shifts',
        'at keyboard': 'time on the job',
        'active this week': 'busy days',
        'top tool': 'favourite tool',
        'top model': 'favourite helper',
        'tracking since': 'first day at work',
        'peak': 'busiest',
        'after hours': 'overtime',
        'weekend': 'weekend shifts',
        'prompts': 'little jobs',
        'days': 'days',
        'Less': 'a bit',
        'More': 'lots!',
        'all charts →': 'the whole diary →',
      },
    },
    /* Vocal — the one skin based on a REAL licensed IP.

       ── WHY THIS IP AND NO OTHER ──────────────────────────────────────
       Crypton Future Media publishes an actual licence for Hatsune Miku,
       Kagamine Rin/Len, Megurine Luka, MEIKO and KAITO: the Piapro
       Character Licence, plus CC BY-NC 3.0 for use outside Japan. Fan
       works are INVITED, and "publishing on a homepage, blog or SNS" is
       the first item on their list of permitted uses. That is a grant of
       rights, which is categorically different from "nobody has sued a
       small site yet" — the position you'd be in with any unlicensed
       franchise. So this is the only IP skin here based on someone
       else's characters.

       ── THREE CONSTRAINTS THAT COME FROM THE LICENCE ──────────────────
       1. Only Crypton's OWN original illustrations are covered. Other
          people's fan art is under those artists' copyrights. So nothing
          is copied from anywhere: the mascot is drawn here, from scratch,
          in this file's own idiom. (Making one's own derivative work is
          exactly what the licence permits.)
       2. Attribution is required: the licence notice, its URL, the
          character name, and the company name. Rendered as a real,
          visible, clickable line in the overlay — not buried in a code
          comment where no visitor would see it.
       3. Nothing derogatory: no violent or sexual context. A DAW-styled
          statistics panel is comfortably clear of that line.

       ── WHY IT LOOKS LIKE A SEQUENCER, NOT LIKE A CHARACTER ───────────
       kaboo's version of this skin taught me the good idea here. Its
       effects component doesn't lean on portraits — it rebuilds the
       VOCALOID EDITOR: piano-roll keys (C4..C5), note blocks, a moving
       playhead, and a parameter rail reading VOICE / TONE / BREATH /
       DYNAMICS / PITCH. That's a much stronger IP signal than a picture,
       because it evokes the *thing the character is for*: software you
       write songs in. It also keeps the whole skin inside assets I can
       legitimately draw.

       Palette is the official pair, in the same hues kaboo measured out:
       teal 175° and magenta 335° on near-black. */
    {
      id: 'vocal',
      label: 'Vocal',
      group: 'Worlds',
      hint: 'a vocal-synth editor — piano roll, playhead, teal and magenta',
      brand: 'Antares Vocal Studio',
      ambient: 'stage',
      overlay: 'sequencer',
      companions: ['mic'],
      boot: ['♪ loading voicebank …', '♪ tuning to 440 Hz', '♪ ready to sing'],
      /* PCL credit, shown in the overlay. Character name and company are
         mandatory; the licence URL is the summary page Crypton points at. */
      credit: {
        text: 'Inspired by Hatsune Miku © Crypton Future Media, INC. — Piapro Character Licence. Character art from Lorelei by Lisa Wischofsky (CC0).',
        url: 'https://piapro.jp/license/pcl/summary',
        label: 'PCL',
      },
      lex: {
        panelTitle: 'Antares\'s <em>Session Log</em>',
        'tokens billed': 'notes rendered',
        'tokens': 'notes rendered',
        'tokens processed': 'samples processed',
        'from cache': 'from the buffer',
        'spend': 'studio time',
        'sessions': 'takes',
        'at keyboard': 'on the roll',
        'active this week': 'recording days',
        'top tool': 'main instrument',
        'top model': 'lead voice',
        'tracking since': 'first take',
        'peak': 'loudest',
        'after hours': 'late sessions',
        'weekend': 'weekend sessions',
        'prompts': 'phrases',
        'days': 'days',
        'Less': 'pp',
        'More': 'ff',
        'all charts →': 'the full score →',
      },
    },

    /* ── Workshop (Ferris, CC0) ──────────────────────────────────────
       Ferris is public domain via CC0, so strictly there is NO attribution
       obligation here at all. The credit is shown anyway — a CC0 dedication
       is a gift, and naming the person who made it costs one line.

       The world is a machine shop rather than "the Rust website": warm
       rust-orange on graph paper, a workbench feel. Deliberately NOT the
       Rust brand colours or logo furniture, because the logo IS the
       trademarked part even though the crab isn't. */
    {
      id: 'workshop',
      label: 'Workshop',
      group: 'Worlds',
      hint: 'a machine shop — rust orange, graph paper, a crab on the bench',
      brand: 'Antares Machine Works',
      ambient: 'benchtop',
      overlay: 'bench',
      companions: ['ferris'],
      boot: ['⚙ warming the bench …', '⚙ checking tolerances', '⚙ ready to build'],
      credit: {
        text: 'Ferris the crab by Karen Rustad Tölva, dedicated to the public domain (CC0) — redrawn here. Character art from Notionists by Zoish (CC0).',
        url: 'https://creativecommons.org/publicdomain/zero/1.0/',
        label: 'CC0',
      },
      lex: {
        panelTitle: 'Antares\'s <em>Shop Log</em>',
        'tokens billed': 'parts machined',
        'tokens': 'parts machined',
        'tokens processed': 'stock consumed',
        'from cache': 'from offcuts',
        'spend': 'material cost',
        'sessions': 'work orders',
        'at keyboard': 'bench time',
        'active this week': 'shop days',
        'top tool': 'main machine',
        'top model': 'lead hand',
        'tracking since': 'shop opened',
        'peak': 'busiest',
        'after hours': 'night shift',
        'weekend': 'weekend shifts',
        'prompts': 'jobs',
        'Less': 'rough',
        'More': 'finished',
        'all charts →': 'the whole shop log →',
      },
    },

    /* ── Hereva (Pepper&Carrot, CC BY 4.0) ───────────────────────────
       CC BY 4.0 has three requirements and all three are load-bearing
       here: name the author (David Revoy), link the licence, and state
       that changes were made. The credit line does all three explicitly —
       "redrawn here" is the change statement, not a flourish.

       Visually: a witch's potion notebook. Deep violet ground, aged
       parchment cards, and a heat ramp in the green of a cauldron rather
       than in the accent colour, so the chart never competes with links. */
    {
      id: 'hereva',
      label: 'Hereva',
      group: 'Worlds',
      hint: 'a witch\'s potion notebook — violet, parchment, cauldron green',
      brand: 'Antares of Chaosah',
      ambient: 'spellmotes',
      overlay: 'grimoire',
      companions: ['pepper', 'carrot'],
      boot: ['✦ opening the grimoire …', '✦ measuring the reagents', '✦ ready to brew'],
      credit: {
        text: 'Pepper&Carrot characters by David Revoy (peppercarrot.com), CC BY 4.0 — redrawn here. Character art from Lorelei by Lisa Wischofsky (CC0).',
        url: 'https://creativecommons.org/licenses/by/4.0/',
        label: 'CC BY 4.0',
      },
      lex: {
        panelTitle: 'Antares\'s <em>Potion Book</em>',
        'tokens billed': 'potions brewed',
        'tokens': 'potions brewed',
        'tokens processed': 'reagents ground',
        'from cache': 'from the pantry',
        'spend': 'ingredient cost',
        'sessions': 'brews',
        'at keyboard': 'at the cauldron',
        'active this week': 'brewing days',
        'top tool': 'favourite cauldron',
        'top model': 'familiar',
        'tracking since': 'first spell',
        'peak': 'strongest',
        'after hours': 'midnight brews',
        'weekend': 'weekend brews',
        'prompts': 'incantations',
        'Less': 'a drop',
        'More': 'a flask',
        'all charts →': 'the whole potion book →',
      },
    },
  ];

  var STORAGE_KEY = 'skin';
  var ids = SKINS.map(function (s) { return s.id; });
  var byId = {};
  SKINS.forEach(function (s) { byId[s.id] = s; });

  /* Picker grouping. Deliberately by TREATMENT, not by colour — the whole
     point of the second pass was that "seven skins" meant nothing when they
     were all the same kind of thing. Naming the genre in the menu makes the
     spread legible before you click anything.

     kaboo groups its 45 by franchise (动漫 / 游戏 / 小说). A personal site
     has no franchises, so the axis that carries information here is what
     each skin does to the design. */
  var GROUP_ORDER = ['Plain', 'Print', 'Machine', 'Night', 'Worlds'];
  var GROUP_NOTE = {
    Plain: 'palette only',
    Print: 'paper, ink, hard edges',
    Machine: 'screens and instruments',
    Night: 'dark and quiet',
    // The one group where a skin brings its own premise, mascot and words.
    Worlds: 'a place, a mascot, its own words',
  };
  function grouped() {
    return GROUP_ORDER.map(function (title) {
      return {
        title: title,
        note: GROUP_NOTE[title] || '',
        skins: SKINS.filter(function (s) { return (s.group || 'Plain') === title; }),
      };
    }).filter(function (g) { return g.skins.length > 0; });
  }

  var STORAGE_KEY = 'skin';
  var ids = SKINS.map(function (s) { return s.id; });
  var byId = {};
  SKINS.forEach(function (s) { byId[s.id] = s; });

  /* ── Lexicon ────────────────────────────────────────────────────────
     Every label the usage panel prints goes through `word()`. A skin with
     no `lex` gets the string back unchanged, so the default site is
     untouched and adding a skin can never break the base copy.

     Only the usage panel is re-worded, never the résumé itself. The page
     has a job — telling a recruiter what I do — and an in-joke vocabulary
     over the actual work history would sabotage it. The usage numbers are
     already the playful part, so that's what the IP gets to rename. */
  function word(skinId, key) {
    var s = byId[skinId];
    if (s && s.lex && Object.prototype.hasOwnProperty.call(s.lex, key)) return s.lex[key];
    return key;
  }

  /* Read the stored skin, tolerating anything unexpected. An unknown id
     (a hand-edited localStorage, or a skin removed in a later build)
     degrades to `default` rather than leaving the page half-styled. */
  function stored() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      return ids.indexOf(v) >= 0 ? v : 'default';
    } catch (_) { return 'default'; }
  }

  function reducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (_) { return false; }
  }
  function finePointer() {
    try { return !!(window.matchMedia && window.matchMedia('(pointer: fine)').matches); }
    catch (_) { return false; }
  }

  window.SITE_SKINS = {
    list: SKINS,
    grouped: grouped,
    creatures: CREATURES,
    rainColumns: rainColumns,
    storageKey: STORAGE_KEY,
    get: function (id) { return byId[id] || byId.default; },
    stored: stored,
    word: word,
    reducedMotion: reducedMotion,
    finePointer: finePointer,
  };
})();
