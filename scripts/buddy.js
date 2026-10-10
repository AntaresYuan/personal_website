/* ════════════════════════════════════════════════════════════════════════
   buddy.js — the felt avatar in the Work home's ask capsule.

   scripts/work.js owns mood semantics; this file only listens to the public
   interface on #ask-avatar (data-mood, `avatar:mood`, `avatar:nod`) and
   decides what the face does.

   The face is six pixel-aligned frames in one sprite (media/buddy/felt.webp,
   built by tools/buddy/felt-frames.sh): only eyes and mouth differ between
   them, so swapping frames reads as an expression change, not a cut. Body
   motion — breathing, tilt, hop, nod — is CSS on the layers holding the
   frames (styles/work.css, "Felt avatar").

     idle       looking at you; blinks, and now and then glances or beams
     hello      beams and hops (pointer over the resting capsule)
     listening  glances toward what you are typing, head tilted; nods per key
     thinking   eyes closed, swaying while the answer is fetched
     talking    mouth flaps between open and closed
     happy      beams after answering
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var avatar = document.getElementById('ask-avatar');
  if (!avatar) return;

  var SPRITE = '/media/buddy/felt.webp';   // root-relative: Work sub-pages load this too
  var FRAMES = ['neutral', 'look', 'blink', 'happy', 'talk', 'closed'];
  var BASE = { idle: 'neutral', hello: 'happy', listening: 'look', thinking: 'closed', talking: 'talk', happy: 'happy' };
  var TILT = { idle: 0, hello: -3, listening: 5, thinking: -5, talking: 0, happy: -3 };

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var rand = function (a, b) { return a + Math.random() * (b - a); };

  /* ── Layers ─────────────────────────────────────────────────────────────
     .buddy (clip) > .buddy-hop (one-shot hops and nods, Web Animations) >
     .buddy-body (breathing loop + tilt) > one .buddy-f per frame. Separate
     layers so the loop, the tilt and a hop never fight over one transform. */
  var root = document.createElement('span');
  root.className = 'buddy';
  root.setAttribute('aria-hidden', 'true');
  var hop = document.createElement('span');
  hop.className = 'buddy-hop';
  var body = document.createElement('span');
  body.className = 'buddy-body';
  var layers = {};
  FRAMES.forEach(function (name, i) {
    var f = document.createElement('span');
    f.className = 'buddy-f';
    f.style.backgroundImage = 'url(' + SPRITE + ')';
    f.style.backgroundPosition = (i * 100 / (FRAMES.length - 1)) + '% 0';
    body.appendChild(f);
    layers[name] = f;
  });
  hop.appendChild(body);
  root.appendChild(hop);

  /* ── Face ───────────────────────────────────────────────────────────── */
  /* The incoming frame fades in ON TOP of the outgoing one, which stays
     opaque until it is covered. Fading one out while the other fades in
     would leave both half-transparent mid-way, and the whole face would
     dim for a beat on every blink. */
  var shown = '';
  var z = 0;
  var show = function (name, quick) {
    if (name === shown || !layers[name]) return;
    root.classList.toggle('is-quick', !!quick);     // blinks and mouth flaps snap; moods fade
    var next = layers[name];
    var prev = shown ? layers[shown] : null;
    next.style.zIndex = String(++z);
    next.classList.add('is-on');
    shown = name;
    if (prev) setTimeout(function () { if (prev !== layers[shown]) prev.classList.remove('is-on'); }, quick ? 70 : 220);
  };

  var mood = 'idle';
  var base = function () { return BASE[mood] || 'neutral'; };
  var timers = [];
  var later = function (fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; };
  var clearTimers = function () { timers.forEach(clearTimeout); timers = []; };
  var active = function () { return !document.hidden && !reduceMotion.matches; };

  var bounce = function (frames, ms) {
    if (!active() || !hop.animate) return;
    hop.animate(frames, { duration: ms, easing: 'cubic-bezier(.3,.7,.4,1.35)' });
  };

  /* ── Loops ──────────────────────────────────────────────────────────────
     Each mood restarts its own loops; changing mood clears the old ones, so
     there is never a stray blink landing in the middle of a sentence. */
  var blinkLoop = function () {
    later(function () {
      if (active() && (mood === 'idle' || mood === 'listening') && shown === base()) {
        show('blink', true);
        later(function () {
          show(base(), true);
          // The odd double blink, the way people actually blink.
          if (Math.random() < 0.2) later(function () {
            show('blink', true);
            later(function () { show(base(), true); }, 110);
          }, 160);
        }, 120);
      }
      blinkLoop();
    }, rand(2400, 5600));
  };

  var fidgetLoop = function () {
    later(function () {
      if (active() && mood === 'idle') {
        var pick = Math.random();
        if (pick < 0.45) {                           // a glance aside, then back
          show('look');
          root.style.setProperty('--tilt', '3deg');
          later(function () { if (mood === 'idle') { show('neutral'); root.style.setProperty('--tilt', '0deg'); } }, rand(1100, 1700));
        } else if (pick < 0.75) {                    // a little beam
          show('happy');
          later(function () { if (mood === 'idle') show('neutral'); }, 1200);
        } else {                                     // a lazy sway
          root.style.setProperty('--tilt', (Math.random() < 0.5 ? -4 : 4) + 'deg');
          later(function () { if (mood === 'idle') root.style.setProperty('--tilt', '0deg'); }, 1400);
        }
      }
      fidgetLoop();
    }, rand(5500, 9500));
  };

  var talkLoop = function () {
    var open = true;
    var step = function () {
      if (mood !== 'talking') return;
      show(open ? 'talk' : 'neutral', true);
      open = !open;
      // Irregular beats read as speech; a metronome reads as a machine.
      later(step, open ? rand(70, 150) : rand(90, 190));
    };
    step();
  };

  var setMood = function (next) {
    if (!BASE[next]) next = 'idle';
    clearTimers();
    mood = next;
    root.setAttribute('data-mood', mood);
    root.style.setProperty('--tilt', (TILT[mood] || 0) + 'deg');
    show(base());
    if (!active()) return;
    // Lifts stay within the sprite's 8% overscan (see .buddy-f in work.css).
    if (mood === 'hello') bounce([{ translate: '0 0', scale: '1 1' }, { translate: '0 -6%', scale: '0.98 1.02' }, { translate: '0 0', scale: '1 1' }], 460);
    if (mood === 'happy') bounce([{ translate: '0 0' }, { translate: '0 -5%' }, { translate: '0 0' }], 380);
    if (mood === 'talking') talkLoop();
    blinkLoop();
    if (mood === 'idle') fidgetLoop();
  };

  avatar.addEventListener('avatar:mood', function (ev) {
    setMood((ev && ev.detail && ev.detail.mood) || avatar.getAttribute('data-mood'));
  });
  avatar.addEventListener('avatar:nod', function () {
    if (mood !== 'listening') return;
    bounce([{ translate: '0 0' }, { translate: '0 4%' }, { translate: '0 0' }], 220);
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) setMood(mood);             // restart loops; timers were skipped while hidden
  });
  var onPref = function () { setMood(mood); };
  if (reduceMotion.addEventListener) reduceMotion.addEventListener('change', onPref);

  /* ── Mount ──────────────────────────────────────────────────────────────
     The <img> already in the button is the neutral frame as a still, so the
     swap to the live layers is invisible. Mount only once the sprite has
     decoded; a failed load just leaves the still in place. */
  /* onload rather than decode(): a page opened in a background tab can
     leave decode() pending or rejected, and the avatar never came alive. */
  var mounted = false;
  var mount = function () {
    if (mounted) return;
    mounted = true;
    avatar.appendChild(root);
    setMood(avatar.getAttribute('data-mood') || 'idle');
  };
  var probe = new Image();
  probe.onload = mount;
  probe.src = SPRITE;
  if (probe.complete && probe.naturalWidth) mount();
})();
