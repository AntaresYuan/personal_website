/* ─────────────────────────────────────────────────────────────────────
   Background character for skins that have one.
   ─────────────────────────────────────────────────────────────────────
   The art is NOT drawn here. It comes from scripts/skin-characters.js,
   which is generated at build time from DiceBear (see
   scripts/gen-characters.js). I first hand-drew this figure and it wasn't
   good enough: faces need proportion and linework judgement that a
   professional illustration set already encodes. Lorelei (Lisa
   Wischofsky) and Notionists (Zoish) are both CC0.

   Because the art is external, this module cannot animate individual
   features — there is no reliable "iris" node to translate, and reaching
   into someone else's path data would break the moment the art is
   regenerated. So the interaction is whole-figure instead: she leans and
   drifts toward the pointer, breathes on an idle cycle, and perks up when
   the pointer comes near. That is honest motion over art we don't own,
   and it survives swapping the art out.

   Placement is measured, not guessed. The side gutters are already taken
   by each skin's own overlay, and gutter width hits zero at 1280px, so
   there is no margin to live in. She sits in the ambient layer (z-index 0,
   below .page), fixed to the bottom-right, pointer-events: none — so she
   cannot cover text or swallow clicks, and stays in view while scrolling,
   which is what makes interacting with her possible at all.
   ───────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var HOST_CLASS = 'skin-diva';

  var host = null;
  var state = null;
  var raf = 0;

  /* Look up the character defined for a given skin id. */
  function forSkin(skinId) {
    var all = window.SITE_CHARACTERS || [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].skin === skinId) return all[i];
    }
    return null;
  }

  function mount(layer, skinId) {
    unmount();
    var ch = forSkin(skinId);
    if (!ch) return;

    host = document.createElement('div');
    host.className = HOST_CLASS;
    host.setAttribute('aria-hidden', 'true');
    host.setAttribute('data-character', ch.id);
    // The art is a trusted build-time artefact, not user input.
    host.innerHTML =
      '<svg class="dv-svg" viewBox="' + ch.viewBox + '" fill="none" ' +
      'xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax meet">' +
      '<g class="dv-fig">' + ch.svg + '</g></svg>';
    layer.appendChild(host);

    state = {
      fig: host.querySelector('.dv-fig'),
      vb: (ch.viewBox || '0 0 980 980').split(/\s+/).map(Number),
      lean: 0, leanT: 0,
      dx: 0, dxT: 0,
      dy: 0, dyT: 0,
      perk: 0, perkT: 0,
      t0: performance.now(),
    };
    if (!state.fig) return;

    var reduced = !window.SITE_SKINS || window.SITE_SKINS.reducedMotion();
    var fine = window.SITE_SKINS && window.SITE_SKINS.finePointer();
    if (reduced || !fine) return;   // static pose; no loop, no listener

    window.addEventListener('pointermove', onMove, { passive: true });
    raf = requestAnimationFrame(tick);
  }

  function onMove(e) {
    if (!state || !host) return;
    var b = host.getBoundingClientRect();
    if (!b.width) return;

    // Where is the pointer relative to her, in -1..1? Normalise by the room
    // actually available on each side: dividing by a fixed width made the
    // response lopsided (measured -5.00 left but only +2.26 right) because
    // she sits near the right edge and there is less page over there.
    var fx = b.left + b.width * 0.5;
    var fy = b.top + b.height * 0.3;
    var rawX = e.clientX - fx;
    var rawY = e.clientY - fy;
    var dx = rawX < 0 ? rawX / Math.max(120, fx)
                      : rawX / Math.max(120, window.innerWidth - fx);
    var dy = rawY < 0 ? rawY / Math.max(120, fy)
                      : rawY / Math.max(120, window.innerHeight - fy);
    var cl = function (v) { return v < -1 ? -1 : v > 1 ? 1 : v; };

    state.leanT = cl(dx) * 3.2;    // degrees; more reads as toppling
    state.dxT = cl(dx) * 14;       // drift, in viewBox units
    state.dyT = cl(dy) * 9;

    // Perk up when the pointer is close — the one moment she should feel
    // like she noticed you rather than merely tracked you.
    var near = Math.hypot(rawX, rawY) < Math.max(b.width, 260) * 0.85;
    state.perkT = near ? 1 : 0;
  }

  function tick(now) {
    if (!state || !state.fig) return;

    // Damped easing: responsive, but reads as attention rather than a
    // cursor readout.
    state.lean += (state.leanT - state.lean) * 0.055;
    state.dx += (state.dxT - state.dx) * 0.075;
    state.dy += (state.dyT - state.dy) * 0.075;
    state.perk += (state.perkT - state.perk) * 0.05;

    // Idle breathing, so she is never completely inert.
    var t = (now - state.t0) / 1000;
    var breathe = Math.sin(t * 1.05) * 0.006;
    var bob = Math.sin(t * 1.05) * 3.5;

    var vb = state.vb;
    var cx = vb[0] + vb[2] * 0.5;
    var cy = vb[1] + vb[3];          // pivot at her feet, so she sways
    var scale = 1 + breathe + state.perk * 0.022;

    state.fig.setAttribute('transform',
      'translate(' + (state.dx).toFixed(2) + ' ' + (state.dy + bob).toFixed(2) + ') ' +
      'rotate(' + state.lean.toFixed(2) + ' ' + cx.toFixed(0) + ' ' + cy.toFixed(0) + ') ' +
      'translate(' + cx.toFixed(0) + ' ' + cy.toFixed(0) + ') ' +
      'scale(' + scale.toFixed(4) + ') ' +
      'translate(' + (-cx).toFixed(0) + ' ' + (-cy).toFixed(0) + ')');

    raf = requestAnimationFrame(tick);
  }

  function unmount() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    window.removeEventListener('pointermove', onMove);
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null;
    state = null;
  }

  window.SITE_DIVA = { mount: mount, unmount: unmount, forSkin: forSkin };
})();
