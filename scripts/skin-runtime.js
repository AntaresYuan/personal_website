/* ════════════════════════════════════════════════════════════════════════
   skin-runtime.js — applies a skin, mounts its ambient layer, drives the
   companion creature, and wires the picker in the topnav.

   Depends on scripts/skins.js (window.SITE_SKINS). Loaded after it and
   after render.js; entirely additive — if this file 404s the site still
   works on the default palette.

   DESIGN NOTES
   • The palette is applied by the inline <head> script, not here, so there
     is no flash of the wrong colours. This file only handles the parts
     that can safely arrive late: decoration, the creature, the picker.
   • The companion is one element that follows `pointermove`, not a
     `cursor:` image, because a CSS cursor cannot animate or hold state.
     The native cursor is hidden only while the companion is actually
     visible and tracking, so a failed mount never leaves the user without
     a pointer.
   • Every listener is passive: this runs on every mouse move, and blocking
     scroll for decoration would be indefensible.
   ════════════════════════════════════════════════════════════════════════ */
'use strict';
(function () {
  var S = window.SITE_SKINS;
  if (!S) return;                       // registry missing — stay on default

  var docEl = document.documentElement;

  /* ── Ambient layer ─────────────────────────────────────────────────
     One fixed, non-interactive div BEHIND everything. Rebuilt on skin
     change; removed entirely for skins with no ambient so we're not
     leaving an empty painted layer around. `pointer-events: none` is set
     in CSS — decoration must never eat a click.

     Note this mounts even under prefers-reduced-motion. An earlier version
     bailed out early, which threw away the *static* texture (halftone
     dots, scanlines, the grid) along with the motion — reduced-motion
     users got a flat colour field and none of the skin's character. The
     CSS gates only the @keyframes, which is the part they actually asked
     to be spared. */
  var ambientEl = null;
  function mountAmbient(skin) {
    // The character is owned by a separate module but mounts into this
    // layer, so it has to be released here too — otherwise switching away
    // from Vocal leaves her rAF loop and pointermove listener alive.
    try {
      if (window.SITE_DIVA) window.SITE_DIVA.unmount();
    } catch (_) {}
    if (ambientEl) { ambientEl.remove(); ambientEl = null; }
    if (!skin.ambient) return;
    var el = document.createElement('div');
    el.className = 'skin-ambient skin-ambient--' + skin.ambient;
    el.setAttribute('aria-hidden', 'true');
    if (skin.ambient === 'clouds') {
      el.innerHTML = '<i class="sa-cloud sa-cloud-a"></i><i class="sa-cloud sa-cloud-b"></i><i class="sa-cloud sa-cloud-c"></i>';
    } else if (skin.ambient === 'sparks') {
      var out = '';
      for (var i = 0; i < 22; i++) {
        // Deterministic scatter: a hash-ish spread beats Math.random()
        // because the layout is then stable across reloads (no flicker of
        // "the stars moved" when the user toggles a skin back and forth).
        var x = (i * 37) % 100, y = (i * 61) % 100;
        out += '<i style="--sx:' + x + '%;--sy:' + y + '%;--si:' + i + '"></i>';
      }
      el.innerHTML = out;
    } else if (skin.ambient === 'motes') {
      // Dust in a sunbeam: larger, slower, warmer than Dusk's sparkles, and
      // drifting upward rather than twinkling in place.
      for (var m = 0; m < 16; m++) {
        var mx = (m * 53) % 100, my = (m * 29) % 100;
        var mote = document.createElement('i');
        mote.style.setProperty('--sx', mx + '%');
        mote.style.setProperty('--sy', my + '%');
        mote.style.setProperty('--si', String(m));
        el.appendChild(mote);
      }
    } else if (skin.ambient === 'rain' && !S.reducedMotion()) {
      // Falling glyph columns. Skipped under reduced-motion because unlike
      // a texture there is no meaningful static version of rain — a frozen
      // column of hex is just clutter.
      //
      // Built with createElement + textContent, NOT an innerHTML string.
      // The glyph set contains `<`, `>` and `&`; concatenating those into
      // innerHTML made the parser eat them as markup and 24 columns
      // arrived as 6 surviving nodes. textContent also means the glyph set
      // can be extended later without re-introducing an injection path.
      S.rainColumns().forEach(function (c) {
        var col = document.createElement('i');
        col.className = 'sa-rain' + (c.alt ? ' is-alt' : '');
        col.style.left = c.left.toFixed(2) + '%';
        col.style.setProperty('--rd', c.dur.toFixed(2) + 's');
        col.style.setProperty('--rdelay', c.delay.toFixed(2) + 's');
        col.style.setProperty('--rsz', c.size + 'px');
        col.style.setProperty('--rop', c.op.toFixed(2));
        col.textContent = c.text;
        el.appendChild(col);
      });
    } else if (skin.ambient === 'starfield') {
      // The stars themselves are a CSS gradient tile — 200 DOM nodes for
      // fixed points would be pure waste. Only the shooting streaks need
      // elements, since each carries its own delay and start position.
      if (!S.reducedMotion()) {
        [{ x: -8, y: 14, d: 0 }, { x: 4, y: 46, d: -7.5 }].forEach(function (s) {
          var sh = document.createElement('i');
          sh.className = 'sa-shoot';
          sh.style.setProperty('--sx', s.x + '%');
          sh.style.setProperty('--sy', s.y + '%');
          sh.style.setProperty('--sd', s.d + 's');
          el.appendChild(sh);
        });
      }
    } else if (skin.ambient === 'bathy' && !S.reducedMotion()) {
      // Rising bubbles. Deterministic spread like the other particle
      // layers, so switching away and back doesn't reshuffle them.
      for (var b = 0; b < 14; b++) {
        var bub = document.createElement('i');
        bub.className = 'sa-bub';
        bub.style.setProperty('--sx', ((b * 47) % 96 + 2) + '%');
        bub.style.setProperty('--sz', (4 + (b % 4) * 2) + 'px');
        bub.style.setProperty('--bx', ((b % 5) * 9 - 18) + 'px');
        bub.style.setProperty('--bd', (13 + (b % 6) * 2.4).toFixed(1) + 's');
        bub.style.setProperty('--si', String(b));
        el.appendChild(bub);
      }
    } else if (skin.ambient === 'meadowsky') {
      // Fat clouds crossing the sky. Four is enough to feel populated
      // without turning the hero into weather. Deterministic like every
      // other particle layer so toggling the skin doesn't reshuffle them.
      if (!S.reducedMotion()) {
        // Clouds stay in the top ~20% — that's the sky band of the
        // gradient. Anything lower drifts through the grass and, worse,
        // parks itself behind the panel heading.
        // Clouds travel the full width, so there is NO horizontal position
        // that avoids anything — only vertical bands are safe. And the safe
        // band is narrower than it looks: the top bar ("Antares Yuan", the
        // nav) sits at y≈61 and spans edge to edge, so the sky above the
        // hero is NOT free. Phase-sampling found 100% overlap on the brand
        // at y=3%, which no single screenshot showed.
        //
        // The band between the top bar (~90px) and the hero name (~180px)
        // is only ~90px tall, and a cloud is ~40px. That fits, but barely,
        // and it breaks the moment the header wraps. So: pin the clouds to
        // a px offset measured from the real header, and let the CSS clamp
        // handle the case where there's no room.
        var navBottom = 92;
        try {
          var nav = document.querySelector('.topnav');
          if (nav) navBottom = Math.ceil(nav.getBoundingClientRect().bottom) + 8;
        } catch (_) {}
        [{ t: navBottom, w: 118, d: 54 }, { t: navBottom + 14, w: 88, d: 72 },
         { t: navBottom + 4, w: 104, d: 46 }].forEach(function (c, i) {
          var puff = document.createElement('i');
          puff.className = 'sa-puff';
          puff.style.setProperty('--sx', '0%');
          puff.style.setProperty('--sy', c.t + 'px');
          puff.style.setProperty('--sw', c.w + 'px');
          puff.style.setProperty('--sd', c.d + 's');
          puff.style.setProperty('--si', String(i));
          el.appendChild(puff);
        });
        // Sparkles, spread over the full page but kept off the centre
        // column where the text lives. Two coprime steps (13/17 and 11/19)
        // so the eye can't find a lattice.
        for (var k = 0; k < 22; k++) {
          var st = document.createElement('i');
          st.className = 'sa-star';
          var xp = (k * 13 + 7) % 19 / 19;           // 0..1
          // Position sparkles in the GUTTER, in px, not in viewport
          // percentages. Percentages look fine at 1440 and then drift onto
          // the text as the window narrows — measured hits on "Yuan" at
          // 1280 and on the tagline at 900. `--gutter` is the real free
          // margin and collapses to 0 at 1280, where CSS hides them.
          var side = xp < 0.5 ? 'left' : 'right';
          var frac = (xp < 0.5 ? xp * 2 : (xp - 0.5) * 2);   // 0..1 within the gutter
          st.style.setProperty(
            '--sx',
            side === 'left'
              ? 'calc(var(--gutter) * ' + (0.08 + frac * 0.78).toFixed(3) + ')'
              : 'calc(100% - var(--gutter) * ' + (0.08 + frac * 0.78).toFixed(3) + ')'
          );
          st.style.setProperty('--sy', (((k * 11 + 5) % 17) / 17 * 96 + 2).toFixed(1) + '%');
          st.style.setProperty('--ss', (k % 3 === 0 ? 11 : k % 3 === 1 ? 8 : 6) + 'px');
          st.style.setProperty('--sc', k % 2 ? '#EE9BA6' : '#7FC4DE');
          st.style.setProperty('--si', String(k));
          el.appendChild(st);
        }
      }
    } else if (skin.ambient === 'stage') {
      // The character rides in the ambient layer (z-index 0, under .page)
      // so she is genuinely BEHIND the content and cannot intercept a
      // click or cover a word. Mounted before the notes so the notes
      // render over her.
      //
      // She is not in the gutter: measurement showed Vocal's own overlay
      // already fills both gutters (piano roll left, params + meter right)
      // and that the gutter collapses to 0 below 1280px. A margin figure
      // would either collide or vanish. Behind the column, anchored to the
      // bottom-right, is the only placement that survives every width.
      // Note glyphs rising off the stage. Same gutter discipline as the
      // Dumpling sparkles: px offsets from the measured margin, never
      // viewport percentages, so they can't drift onto the text.
      if (!S.reducedMotion()) {
        var GL = ['\u266a', '\u266b', '\u2669', '\u266c'];
        for (var g = 0; g < 14; g++) {
          var nt = document.createElement('i');
          nt.className = 'sa-note';
          // textContent, not innerHTML: these are literal glyphs and the
          // rain-column bug (24 columns silently becoming 6) came from
          // exactly this shortcut.
          nt.textContent = GL[g % GL.length];
          var f = ((g * 7 + 3) % 13) / 13;
          nt.style.setProperty(
            '--sx',
            g % 2
              ? 'calc(100% - var(--gutter, 40px) * ' + (0.1 + f * 0.72).toFixed(3) + ')'
              : 'calc(var(--gutter, 40px) * ' + (0.1 + f * 0.72).toFixed(3) + ')'
          );
          nt.style.setProperty('--sy', (((g * 11 + 4) % 17) / 17 * 92 + 4).toFixed(1) + '%');
          nt.style.setProperty('--ss', (g % 3 === 0 ? 17 : g % 3 === 1 ? 13 : 11) + 'px');
          nt.style.setProperty('--sc', g % 3 === 1 ? '#F2519B' : '#39D2C8');
          nt.style.setProperty('--st', ((g % 5) * 7 - 14) + 'deg');
          nt.style.setProperty('--sdx', ((g % 4) * 8 - 12) + 'px');
          nt.style.setProperty('--sd', (4.4 + (g % 5) * 0.5).toFixed(1) + 's');
          nt.style.setProperty('--si', String(g));
          el.appendChild(nt);
        }
      }
    } else if (skin.ambient === 'benchtop') {
      // Swarf curls on the bench. Static (no animation), so they're mounted
      // regardless of reduced-motion — a still mark is not motion.
      for (var w = 0; w < 12; w++) {
        var cu = document.createElement('i');
        cu.className = 'sa-curl';
        var wf = ((w * 5 + 2) % 11) / 11;
        cu.style.setProperty(
          '--sx',
          w % 2
            ? 'calc(100% - var(--gutter, 40px) * ' + (0.12 + wf * 0.7).toFixed(3) + ')'
            : 'calc(var(--gutter, 40px) * ' + (0.12 + wf * 0.7).toFixed(3) + ')'
        );
        cu.style.setProperty('--sy', (((w * 13 + 6) % 19) / 19 * 88 + 6).toFixed(1) + '%');
        cu.style.setProperty('--ss', (7 + (w % 3) * 3) + 'px');
        cu.style.setProperty('--st', ((w * 47) % 360) + 'deg');
        el.appendChild(cu);
      }
    } else if (skin.ambient === 'spellmotes') {
      if (!S.reducedMotion()) {
        for (var sm = 0; sm < 16; sm++) {
          var mo = document.createElement('i');
          mo.className = 'sa-mote';
          var mf = ((sm * 7 + 3) % 13) / 13;
          mo.style.setProperty(
            '--sx',
            sm % 2
              ? 'calc(100% - var(--gutter, 40px) * ' + (0.1 + mf * 0.74).toFixed(3) + ')'
              : 'calc(var(--gutter, 40px) * ' + (0.1 + mf * 0.74).toFixed(3) + ')'
          );
          mo.style.setProperty('--sy', (((sm * 11 + 5) % 17) / 17 * 90 + 5).toFixed(1) + '%');
          mo.style.setProperty('--ss', (4 + (sm % 3) * 2) + 'px');
          mo.style.setProperty('--sc', sm % 3 === 0 ? '#62C48A' : '#E8C463');
          mo.style.setProperty('--sdx', ((sm % 4) * 7 - 10) + 'px');
          mo.style.setProperty('--sd', (5.6 + (sm % 5) * 0.7).toFixed(1) + 's');
          mo.style.setProperty('--si', String(sm));
          el.appendChild(mo);
        }
      }
    }
    // 'scan', 'grid', 'halftone', 'fibres' and 'draft' need no children —
    // they're pure repeating-gradients painted on the layer itself.

    // The background character, for whichever skins declare one. She rides
    // in the ambient layer (z-index 0, under .page) so she is genuinely
    // BEHIND the content and cannot intercept a click or cover a word;
    // inserted FIRST so this skin's particles render over her.
    //
    // She is not in the gutter: measurement showed each skin's own overlay
    // already fills both gutters, and that the gutter collapses to 0 below
    // 1280px. A margin figure would either collide or vanish. Behind the
    // column, anchored bottom-right, is the only placement that survives
    // every width.
    try {
      if (window.SITE_DIVA) {
        window.SITE_DIVA.mount(el, skin.id || 'default');
        var fig = el.querySelector('.skin-diva');
        if (fig && el.firstChild !== fig) el.insertBefore(fig, el.firstChild);
      }
    } catch (_) { /* character art is decorative; never block the skin */ }

    document.body.appendChild(el);
    ambientEl = el;
  }

  /* ── Foreground overlay ────────────────────────────────────────────
     Some genres need decoration ABOVE the content, not behind it: a CRT's
     vignette and roll-line, a HUD's corner brackets, the glitch plane.
     Same hard rule as ambient — `pointer-events: none`, always. Kept as a
     separate element from ambient so z-order is explicit rather than
     depending on paint order within one node. */
  /* ── Licence credit ───────────────────────────────────────────────
     Some skins are derived from a third party's IP under a licence that
     requires attribution. That notice is an OBLIGATION, which changes
     where it can live:

     My first attempt put it in the overlay next to the decoration. That
     was wrong on structure, not just on pixels — the overlay is
     `position: fixed`, so a bottom-centre badge sits on whatever content
     happens to be scrolled under it. Measured: 22% of a stat label at
     1440px, and 100% of four separate values at 900 and 390. And unlike
     decoration I can't fix that by hiding it at narrow widths, because
     the notice has to stay visible.

     So it belongs in the FOOTER, as normal flow content. Then it can't
     collide with anything by construction, it survives every viewport,
     it's reachable by keyboard in document order, and it reads as a real
     credit rather than as a UI sticker. */
  var creditEl = null;
  function paintCredit(skin) {
    if (creditEl) { creditEl.remove(); creditEl = null; }
    if (!skin || !skin.credit) return;
    var foot = document.querySelector('.site-footer');
    if (!foot) return;
    var p = document.createElement('p');
    p.className = 'skin-credit';
    // textContent for the prose so '©' and the em dash survive; one real
    // anchor for the licence URL.
    p.appendChild(document.createTextNode(skin.credit.text + ' \u00b7 '));
    var a = document.createElement('a');
    a.href = skin.credit.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = skin.credit.label || 'licence';
    p.appendChild(a);
    foot.appendChild(p);
    creditEl = p;
  }

  var overlayEl = null;
  function mountOverlay(skin) {
    if (overlayEl) { overlayEl.remove(); overlayEl = null; }
    if (!skin.overlay) return;
    var el = document.createElement('div');
    el.className = 'skin-overlay skin-overlay--' + skin.overlay;
    el.setAttribute('aria-hidden', 'true');
    if (skin.overlay === 'crt') {
      // skin-fx-pass marks a full-width light sweep rather than chrome: it's
      // *meant* to travel across content, at ~5% opacity. The collision
      // checker skips these; anything without the class must clear content.
      el.innerHTML = '<i class="so-roll skin-fx-pass"></i><i class="so-flicker skin-fx-pass"></i>';
    } else if (skin.overlay === 'hud') {
      el.innerHTML =
        '<i class="so-corner tl"></i><i class="so-corner tr"></i>' +
        '<i class="so-corner bl"></i><i class="so-corner br"></i>' +
        '<i class="so-tag">◈ REC · ANTARES / LIVE</i>' +
        '<i class="so-ticks"></i>';
    } else if (skin.overlay === 'stamp') {
      // A declassified-file stamp, rotated and sitting in the corner. The
      // text is deliberately about the page's own premise (a résumé that
      // was, in fact, released) rather than fake secrecy theatre.
      var st = document.createElement('i');
      st.className = 'so-stamp';
      st.textContent = 'DECLASSIFIED';
      el.appendChild(st);
      var ref = document.createElement('i');
      ref.className = 'so-ref';
      ref.textContent = 'FILE 2026-AY · CLEARED FOR PUBLIC RELEASE';
      el.appendChild(ref);
    } else if (skin.overlay === 'rule') {
      // Drafting furniture: a dimension rule down the left with tick marks,
      // and a title-block corner. Reads as a technical drawing sheet.
      var rule = document.createElement('i');
      rule.className = 'so-rule';
      el.appendChild(rule);
      var block = document.createElement('i');
      block.className = 'so-block';
      block.textContent = 'SHEET 1/1 · SCALE 1:1 · A. YUAN';
      el.appendChild(block);
    } else if (skin.overlay === 'scope') {
      // Observatory furniture. The coordinates are Antares's real RA/Dec —
      // a detail that costs nothing and rewards anyone who looks it up.
      var coord = document.createElement('i');
      coord.className = 'so-coord';
      coord.textContent = 'α SCO · RA 16h29m · DEC −26°25′';
      el.appendChild(coord);
      var seeing = document.createElement('i');
      seeing.className = 'so-seeing';
      seeing.textContent = 'SEEING 1.2″ · TRANSP. 7/10 · NO MOON';
      el.appendChild(seeing);
    } else if (skin.overlay === 'sonar') {
      // Abyss furniture: a depth ladder, a gauge readout and one slow ping.
      var depth = document.createElement('i');
      depth.className = 'so-depth';
      el.appendChild(depth);
      var gauge = document.createElement('i');
      gauge.className = 'so-gauge';
      gauge.textContent = 'DEPTH 1,240 m · 124 bar · 3.8 °C';
      el.appendChild(gauge);
      if (!S.reducedMotion()) {
        var ping = document.createElement('i');
        // The ping expands across the page by design — same exemption as
        // the CRT sweep, and for the same reason.
        ping.className = 'so-ping skin-fx-pass';
        el.appendChild(ping);
      }
    } else if (skin.overlay === 'scrapbook') {
      // Handmade furniture: tape and a pin holding the page down, a chore
      // coupon, and a "good work" stamp. Text nodes via textContent — the
      // ticket contains no markup but the habit is cheap and the glyph set
      // includes characters that would be eaten by innerHTML.
      ['so-tape', 'so-pin'].forEach(function (cls) {
        var n = document.createElement('i');
        n.className = cls;
        el.appendChild(n);
      });
      var tk = document.createElement('i');
      tk.className = 'so-ticket';
      tk.textContent = 'CHORE TICKET · No. 0042 · GOOD FOR 1 SNACK';
      el.appendChild(tk);
      var gd = document.createElement('i');
      gd.className = 'so-good';
      gd.textContent = 'GOOD WORK!';
      el.appendChild(gd);
    } else if (skin.overlay === 'sequencer') {
      // A miniature vocal-synth editor: piano roll, note blocks, the five
      // parameter names, a level meter — and the licence credit.
      var roll = document.createElement('i');
      roll.className = 'so-roll';
      // C5 down to C4, with the sharps marked so it reads as a keyboard
      // rather than as a list.
      [['C5',0],['B4',0],['A#4',1],['A4',0],['G4',0],['F#4',1],['E4',0],['C4',0]]
        .forEach(function (k) {
          var key = document.createElement('i');
          key.className = 'so-key';
          key.setAttribute('data-sharp', String(k[1]));
          key.textContent = k[0];
          roll.appendChild(key);
        });
      el.appendChild(roll);
      // Note blocks, aligned to the key rows above (15px pitch from 150px).
      [[0,12],[1,9],[3,14],[4,8],[6,11]].forEach(function (b) {
        var blk = document.createElement('i');
        blk.className = 'so-blk';
        blk.style.setProperty('--by', (153 + b[0] * 15) + 'px');
        blk.style.setProperty('--bw2', b[1] + 'px');
        el.appendChild(blk);
      });
      var pr = document.createElement('i');
      pr.className = 'so-params';
      ['VOICE', 'TONE', 'BREATH', 'DYNAMICS', 'PITCH'].forEach(function (name) {
        var q = document.createElement('i');
        q.className = 'so-param';
        q.textContent = name;
        pr.appendChild(q);
      });
      el.appendChild(pr);
      var mt = document.createElement('i');
      mt.className = 'so-meter';
      for (var m = 0; m < 7; m++) {
        var sg = document.createElement('i');
        sg.className = 'so-seg';
        // top two segments in magenta, like a meter near clipping
        sg.setAttribute('data-hot', m >= 5 ? '1' : '0');
        mt.appendChild(sg);
      }
      el.appendChild(mt);
    } else if (skin.overlay === 'bench') {
      // Bench furniture: a steel rule, a job card, a caliper reading.
      var r2 = document.createElement('i');
      r2.className = 'so-rule2';
      el.appendChild(r2);
      var job = document.createElement('i');
      job.className = 'so-job';
      job.textContent = 'JOB No. 0042 · QTY 1 · MATL 6061-T6';
      el.appendChild(job);
      var cal = document.createElement('i');
      cal.className = 'so-cal';
      cal.textContent = '⌀ 12.70 mm · ±0.02';
      el.appendChild(cal);
    } else if (skin.overlay === 'grimoire') {
      // Grimoire furniture: ribbon bookmark, wax seal, a recipe note.
      var rb = document.createElement('i');
      rb.className = 'so-ribbon';
      el.appendChild(rb);
      var sl = document.createElement('i');
      sl.className = 'so-seal';
      // textContent: this is a glyph, and glyphs never take the innerHTML
      // path in this file.
      sl.textContent = '\u2735';
      el.appendChild(sl);
      var rc = document.createElement('i');
      rc.className = 'so-recipe';
      rc.textContent = 'iij. drops of moonwater — stir widdershins';
      el.appendChild(rc);
    }
    // 'glitch' is an empty plane; the scheduler below drives it via classes.
    document.body.appendChild(el);
    overlayEl = el;
  }

  /* ── Glitch scheduler ──────────────────────────────────────────────
     Fires one of a few displacement flavours at randomised intervals by
     tagging <html> with `skin-fx-<key>` for that flavour's duration. The
     look lives entirely in CSS; this only decides when.

     Randomised (not fixed-period) on purpose: a glitch on a metronome
     stops reading as a fault and starts reading as a carousel. Intervals
     are long — a page that convulses every second is unusable, and this
     sits under someone's actual résumé. */
  var GLITCH_VARIANTS = [
    { key: 'rgb', dur: 320 },
    { key: 'slice', dur: 260 },
    { key: 'shake', dur: 240 },
    { key: 'tear', dur: 300 },
  ];
  var glitchTimers = [];
  function stopGlitch() {
    glitchTimers.forEach(clearTimeout);
    glitchTimers = [];
    GLITCH_VARIANTS.forEach(function (v) { docEl.classList.remove('skin-fx-' + v.key); });
  }
  function startGlitch(skin) {
    stopGlitch();
    if (!skin.glitch || S.reducedMotion()) return;
    var fire = function () {
      var v = GLITCH_VARIANTS[Math.floor(Math.random() * GLITCH_VARIANTS.length)];
      var cls = 'skin-fx-' + v.key;
      docEl.classList.add(cls);
      glitchTimers.push(setTimeout(function () { docEl.classList.remove(cls); }, v.dur));
      glitchTimers.push(setTimeout(fire, 5200 + Math.random() * 7000));
    };
    glitchTimers.push(setTimeout(fire, 2600 + Math.random() * 3200));
  }

  /* ── Boot overlay ──────────────────────────────────────────────────
     A one-shot full-screen "entry" animation for the machine-flavoured
     skins. Plays only when the skin actually CHANGES, never on a plain
     page load: making someone sit through a boot sequence on every
     navigation would be hostile, and it would also delay first paint of
     the content they came for.

     Removed on any pointer/key input as well as on its own timer, so it
     can never trap the page. */
  function playBoot(skin) {
    if (!skin.boot || !skin.boot.length || S.reducedMotion()) return;
    var old = document.querySelector('.skin-boot');
    if (old) old.remove();
    var el = document.createElement('div');
    el.className = 'skin-boot';
    el.setAttribute('aria-hidden', 'true');
    // textContent per line, same reasoning as the rain columns: boot text is
    // authored data, and authored data should never take an innerHTML path.
    skin.boot.forEach(function (line, i) {
      var s = document.createElement('span');
      s.style.setProperty('--bi', String(i));
      s.textContent = line;
      el.appendChild(s);
    });
    document.body.appendChild(el);
    var kill = function () {
      el.classList.add('is-out');
      setTimeout(function () { el.remove(); }, 320);
      window.removeEventListener('pointerdown', kill);
      window.removeEventListener('keydown', kill);
    };
    window.addEventListener('pointerdown', kill, { once: true, passive: true });
    window.addEventListener('keydown', kill, { once: true });
    setTimeout(kill, 1500);
  }

  /* ── Companion creature ────────────────────────────────────────────
     Four states, mirroring what the creature is "doing":
       idle    — pointer at rest: a slow breathing bob
       moving  — pointer in motion: alternate art + a short trail
       pressed — mouse down: a quick ring pop
       loading — just activated something: three hopping dots
     `loading` is a deliberate lie-free flourish: it fires on activating a
     link/button, which is exactly when something *is* about to happen.

     Not mounted at all on coarse pointers (there is no cursor to follow)
     or under prefers-reduced-motion (the whole thing is motion). */
  var comp = null;                 // { el, sprite, roles, idx, timers… }

  function unmountCompanion() {
    if (!comp) return;
    window.removeEventListener('pointermove', comp.onMove);
    window.removeEventListener('pointerdown', comp.onDown);
    window.removeEventListener('pointerup', comp.onUp);
    window.removeEventListener('pointercancel', comp.onUp);
    window.removeEventListener('pointerout', comp.onOut);
    window.removeEventListener('blur', comp.onBlur);
    clearTimeout(comp.idleT);
    clearTimeout(comp.loadT);
    clearInterval(comp.rotateT);
    comp.el.remove();
    document.body.classList.remove('skin-companion-on');
    comp = null;
  }

  var COMPANION_IDLE_MS = 320;     // rest this long ⇒ switch to idle art
  var COMPANION_LOAD_MS = 900;     // how long the "working" hop plays
  var COMPANION_SWAP_MS = 30000;   // rotate creatures, if a skin has several

  function mountCompanion(skin) {
    unmountCompanion();
    var roles = skin.companions || [];
    if (!roles.length) return;
    if (!S.finePointer() || S.reducedMotion()) return;

    var el = document.createElement('div');
    el.className = 'skin-companion is-idle';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML =
      '<span class="sc-trail"><i></i><i></i><i></i></span>' +
      '<span class="sc-sprite"><svg viewBox="0 0 24 24"></svg></span>' +
      '<span class="sc-busy"><i></i><i></i><i></i></span>' +
      '<span class="sc-pop"></span>';
    document.body.appendChild(el);

    comp = {
      el: el,
      svg: el.querySelector('.sc-sprite svg'),
      roles: roles,
      idx: 0,
      state: 'idle',
      idleT: 0,
      loadT: 0,
      rotateT: 0,
    };

    function art(state) {
      var c = S.creatures[comp.roles[comp.idx % comp.roles.length]];
      if (!c) return '';
      return (state === 'moving' && c.moving) ? c.moving : c.idle;
    }
    function setState(next) {
      if (comp.state === next) return;
      comp.state = next;
      el.className = 'skin-companion is-' + next + (el.classList.contains('is-visible') ? ' is-visible' : '');
      comp.svg.innerHTML = art(next);
    }
    comp.svg.innerHTML = art('idle');

    // Only hide the native cursor once ours is actually on screen and
    // tracking — otherwise a mount that never receives a pointermove
    // would leave the page with no pointer at all.
    function show() {
      if (el.classList.contains('is-visible')) return;
      el.classList.add('is-visible');
      document.body.classList.add('skin-companion-on');
    }
    function hide() {
      el.classList.remove('is-visible');
      document.body.classList.remove('skin-companion-on');
      setState('idle');
    }

    comp.onMove = function (ev) {
      el.style.setProperty('--cx', ev.clientX + 'px');
      el.style.setProperty('--cy', ev.clientY + 'px');
      show();
      if (comp.state !== 'loading') setState('moving');
      clearTimeout(comp.idleT);
      comp.idleT = setTimeout(function () {
        if (comp && comp.state !== 'loading') setState('idle');
      }, COMPANION_IDLE_MS);
    };
    comp.onDown = function (ev) {
      el.style.setProperty('--cx', ev.clientX + 'px');
      el.style.setProperty('--cy', ev.clientY + 'px');
      show();
      setState('pressed');
    };
    comp.onUp = function (ev) {
      var hit = ev && ev.target && ev.target.closest
        ? ev.target.closest('a[href], button, [role="button"], [role="tab"], input, select, textarea, summary')
        : null;
      if (hit) {
        setState('loading');
        clearTimeout(comp.loadT);
        comp.loadT = setTimeout(function () { if (comp) setState('idle'); }, COMPANION_LOAD_MS);
      } else {
        setState('idle');
      }
    };
    // relatedTarget === null means the pointer left the window, not just
    // moved between elements inside it.
    comp.onOut = function (ev) { if (ev.relatedTarget === null) hide(); };
    comp.onBlur = hide;

    window.addEventListener('pointermove', comp.onMove, { passive: true });
    window.addEventListener('pointerdown', comp.onDown, { passive: true });
    window.addEventListener('pointerup', comp.onUp, { passive: true });
    window.addEventListener('pointercancel', comp.onUp, { passive: true });
    window.addEventListener('pointerout', comp.onOut, { passive: true });
    window.addEventListener('blur', comp.onBlur);

    if (comp.roles.length > 1) {
      comp.rotateT = setInterval(function () {
        if (!comp) return;
        comp.idx = (comp.idx + 1) % comp.roles.length;
        comp.svg.innerHTML = art(comp.state);
      }, COMPANION_SWAP_MS);
    }
  }

  /* ── Lexicon ───────────────────────────────────────────────────────
     An IP skin renames the words the usage panel uses for its own data.
     Most of those labels are rendered by render.js on every refetch, so
     they pick the new vocabulary up on their own. These four are STATIC
     markup in index.html, so they have to be repainted here.

     Each element keeps its English original in `data-lex` the first time
     it's touched, and every later repaint reads from that — otherwise
     switching Observatory → Abyss would look up 'nights out' in Abyss's
     table, miss, and leave the previous skin's word on screen. The
     original is the only stable key.

     The heading holds `<em>` markup, so it's the one entry that goes
     through innerHTML — and the only strings that can reach it are the
     hard-coded `panelTitle` values in the registry, never user input. */
  function paintLexicon(skin) {
    if (typeof S.word !== 'function') return;
    var id = skin && skin.id ? skin.id : 'default';

    var title = document.querySelector('.usage-title');
    if (title) {
      if (!title.hasAttribute('data-lex')) title.setAttribute('data-lex', title.innerHTML);
      var base = title.getAttribute('data-lex');
      var next = S.word(id, 'panelTitle');
      title.innerHTML = next === 'panelTitle' ? base : next;
    }

    // The legend's two end labels and the "all charts" link: plain text, so
    // textContent. The legend is `.usage-legend > span` with the five colour
    // swatches in between, so the ends are first-child / last-child — there
    // is no wrapper class around just the words.
    var swaps = [
      ['.usage-legend > span:first-child', 'Less'],
      ['.usage-legend > span:last-child', 'More'],
      ['.usage-more-link', 'all charts →'],
    ];
    swaps.forEach(function (pair) {
      var el = document.querySelector(pair[0]);
      if (!el) return;
      if (!el.hasAttribute('data-lex')) el.setAttribute('data-lex', el.textContent);
      var orig = el.getAttribute('data-lex') || pair[1];
      el.textContent = S.word(id, orig);
    });
  }

  /* ── Apply ─────────────────────────────────────────────────────────
     `default` clears the attribute rather than setting data-skin="default"
     so the base palette is the plain `:root` block — one less selector to
     reason about, and CSS-wise the untouched site is truly untouched.

     `opts.boot` is opt-in per call, not a property of the skin: the boot
     sequence belongs to the *act of switching*, so it plays on a picker
     click and stays out of the way on page load and on reduced-motion
     re-applies. */
  function apply(id, opts) {
    var skin = S.get(id);
    if (skin.id === 'default') docEl.removeAttribute('data-skin');
    else docEl.setAttribute('data-skin', skin.id);
    mountAmbient(skin);
    mountOverlay(skin);
    mountCompanion(skin);
    startGlitch(skin);
    paintLexicon(skin);
    paintCredit(skin);
    // The stats grid and caption are render.js's, and it re-reads the
    // lexicon on each paint — ask it to repaint so an IP skin's words land
    // without waiting for the next hourly refetch.
    try {
      if (typeof window.SITE_REPAINT_USAGE === 'function') window.SITE_REPAINT_USAGE();
    } catch (_) { /* usage panel absent or not yet wired */ }
    if (opts && opts.boot) playBoot(skin);
  }

  /* ── Picker ────────────────────────────────────────────────────────
     A <details> disclosure in the topnav: no focus trap, no backdrop, no
     JS needed to open it, and Esc closes it for free.

     DISCOVERABILITY
     The first version used a bare ◈ glyph as the trigger. That failed the
     only test that matters: nothing about a lone symbol says "this changes
     how the site looks", so there's no reason for a visitor to click it.
     kaboo's trigger is a swatch + the CURRENT skin's name + a chevron, and
     that's the fix — the control states what it controls and what it's set
     to. The label doubles as the affordance.

     The menu is a grouped grid rather than one long list, again following
     kaboo (which fits 45 skins that way). Grouping by treatment — Plain /
     Print / Machine / Night — makes the range visible at a glance, which a
     flat list of ten names does not. */
  function wirePicker() {
    var host = document.getElementById('skin-picker');
    if (!host) return;
    var menu = host.querySelector('.skin-menu');
    if (!menu) return;
    var summary = host.querySelector('summary');

    var current = S.stored();

    // ── trigger: swatch + name + chevron ──────────────────────────────
    function paintSummary(id) {
      if (!summary) return;
      var skin = S.get(id);
      summary.innerHTML = '';
      var sw = document.createElement('span');
      sw.className = 'skin-trigger-sw';
      sw.setAttribute('data-sw', skin.id);
      sw.setAttribute('aria-hidden', 'true');
      var name = document.createElement('span');
      name.className = 'skin-trigger-name';
      name.textContent = skin.label;
      var chev = document.createElement('span');
      chev.className = 'skin-trigger-chev';
      chev.setAttribute('aria-hidden', 'true');
      chev.textContent = '⌄';
      summary.appendChild(sw);
      summary.appendChild(name);
      summary.appendChild(chev);
      // Both the tooltip and the a11y name say what it is AND what it's set
      // to, so the control is self-describing however you reach it.
      summary.setAttribute('title', 'Skin — currently ' + skin.label);
      summary.setAttribute('aria-label', 'Skin — currently ' + skin.label);
    }

    // ── menu: grouped grid ────────────────────────────────────────────
    var groups = S.grouped ? S.grouped() : [{ title: '', note: '', skins: S.list }];
    menu.innerHTML = '';
    var head = document.createElement('p');
    head.className = 'skin-menu-head';
    head.textContent = 'Pick a skin';
    menu.appendChild(head);

    groups.forEach(function (g) {
      var sec = document.createElement('div');
      sec.className = 'skin-group';
      if (g.title) {
        var t = document.createElement('p');
        t.className = 'skin-group-title';
        t.innerHTML = '';
        var tn = document.createElement('span');
        tn.textContent = g.title;
        t.appendChild(tn);
        if (g.note) {
          var nn = document.createElement('em');
          nn.textContent = g.note;
          t.appendChild(nn);
        }
        sec.appendChild(t);
      }
      var grid = document.createElement('div');
      grid.className = 'skin-grid';
      g.skins.forEach(function (s) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'skin-opt';
        b.setAttribute('role', 'menuitemradio');
        b.setAttribute('data-skin-id', s.id);
        b.setAttribute('aria-checked', s.id === current ? 'true' : 'false');
        b.setAttribute('title', s.hint);
        var sw = document.createElement('span');
        sw.className = 'skin-opt-sw';
        sw.setAttribute('data-sw', s.id);
        sw.setAttribute('aria-hidden', 'true');
        var nm = document.createElement('span');
        nm.className = 'skin-opt-name';
        nm.textContent = s.label;
        b.appendChild(sw);
        b.appendChild(nm);
        grid.appendChild(b);
      });
      sec.appendChild(grid);
      menu.appendChild(sec);
    });

    paintSummary(current);

    function mark(id) {
      menu.querySelectorAll('.skin-opt').forEach(function (b) {
        b.setAttribute('aria-checked', b.getAttribute('data-skin-id') === id ? 'true' : 'false');
      });
      paintSummary(id);
    }

    menu.addEventListener('click', function (ev) {
      var btn = ev.target.closest('.skin-opt');
      if (!btn) return;
      var id = btn.getAttribute('data-skin-id');
      var changed = id !== S.stored();
      try {
        if (id === 'default') localStorage.removeItem(S.storageKey);
        else localStorage.setItem(S.storageKey, id);
      } catch (_) { /* private mode — the skin still applies for this page */ }
      apply(id, { boot: changed });
      /* Count the pick, not the apply(): apply() also runs on page load
         and on a reduced-motion change, so counting inside it would
         report every visit as a deliberate skin choice. */
      try {
        if (typeof window.SITE_BEACON === 'function') {
          window.SITE_BEACON('skin_pick', id);
          window.SITE_BEACON('skin_source', 'picker');
        }
      } catch (_) { /* counting must never break the picker */ }
      mark(id);
      host.open = false;                 // a choice was made; get out of the way
    });

    // Hovering an option previews nothing (too janky), but it does surface
    // the hint, so the row explains itself without a second click.
    // Reduced-motion can change mid-session (macOS honours it live). Re-run
    // apply so the companion/ambient appear or disappear accordingly rather
    // than being stuck at whatever the setting was on load.
    try {
      var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      var onChange = function () { apply(S.stored()); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    } catch (_) { /* noop */ }
  }

  function boot() {
    apply(S.stored());                   // idempotent: <head> already set the attribute
    /* A restore tells us which skin people LIVE with, as opposed to which
       they clicked once out of curiosity — the two together are what say
       whether a skin is actually liked. */
    try {
      if (typeof window.SITE_BEACON === 'function') {
        window.SITE_BEACON('skin_source', 'restore');
        var kept = S.stored();
        if (kept && kept !== 'default') window.SITE_BEACON('skin_pick', kept);
      }
    } catch (_) { /* noop */ }
    wirePicker();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
