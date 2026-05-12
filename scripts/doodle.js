/* ════════════════════════════════════════════════════════════════════════
   doodle.js — the brand mark is a "doodle": tonight's moon phase by default,
   or a special-day emoji on holidays / your birthday / a project ship-iversary.

   • Every day → the topnav "dot" shows the *actual* lunar phase for the
     visitor's local date, and <link rel="icon"> is re-pointed at a matching
     "moon tile". Deterministic from the date — like a Google Doodle, everyone
     sees the same moon today.
   • Special days → it shows an emoji + a hover caption instead. The list lives
     in content/doodles.json (editable in /admin/ → Doodles); plus any shipped
     card whose anniversary is today (from content/board.json) gets a 🚀.

   Homepage only for now; blog / 404 pages keep the static crescent + favicon.svg.
   No deps; loaded `defer` from index.html.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var SYNODIC = 29.530588853;                         // days, new moon → new moon
  var REF = Date.UTC(2000, 0, 6, 18, 14) / 86400000;  // a known new moon, in days
  var YELLOW = '#F5C518', DARK = '#14130D';
  var dot = document.querySelector('.brand .dot');
  var fav = document.querySelector('link[rel="icon"]');
  var now = new Date();

  /* ── moon phase ────────────────────────────────────────────────────── */
  function phaseOf(date) {
    var days = date.getTime() / 86400000 - REF;
    var frac = (((days % SYNODIC) + SYNODIC) % SYNODIC) / SYNODIC;   // 0 new · .25 1Q · .5 full · .75 LQ
    return { frac: frac, illum: (1 - Math.cos(2 * Math.PI * frac)) / 2 };
  }
  function phaseName(frac) {
    if (frac < 0.02 || frac >= 0.98) return 'New moon';
    if (frac < 0.23) return 'Waxing crescent';
    if (frac < 0.27) return 'First quarter';
    if (frac < 0.48) return 'Waxing gibbous';
    if (frac < 0.52) return 'Full moon';
    if (frac < 0.73) return 'Waning gibbous';
    if (frac < 0.77) return 'Last quarter';
    return 'Waning crescent';
  }
  // SVG path 'd' for the lit region: disc radius R, centred (cx,cy). Two arcs —
  // the bright limb (a semicircle) + the terminator (a semi-ellipse, x-radius
  // R·|cos 2πfrac|). Clamped so the crescent never quite vanishes near new moon.
  function litPath(frac, R, cx, cy) {
    var f = frac < 0.03 ? 0.03 : frac > 0.97 ? 0.97 : frac;
    var cos = Math.cos(2 * Math.PI * f);
    var rx = Math.round(Math.abs(cos) * R * 100) / 100;
    var waxing = f < 0.5;                              // lit on the right
    var limbSweep = waxing ? 1 : 0;
    var termSweep = waxing ? (cos > 0 ? 0 : 1) : (cos > 0 ? 1 : 0);
    var top = cx + ' ' + (cy - R), bot = cx + ' ' + (cy + R);
    return 'M' + top + ' A' + R + ' ' + R + ' 0 0 ' + limbSweep + ' ' + bot +
           ' A' + rx + ' ' + R + ' 0 0 ' + termSweep + ' ' + top + ' Z';
  }
  function renderMoon() {
    var p = phaseOf(now);
    if (dot) {
      var svg = dot.querySelector('svg');
      if (svg) { svg.setAttribute('viewBox', '0 0 100 100'); svg.innerHTML = '<path fill="currentColor" d="' + litPath(p.frac, 46, 50, 50) + '"></path>'; }
      dot.classList.remove('doodle-on');
      dot.setAttribute('title', phaseName(p.frac) + ' · ' + Math.round(p.illum * 100) + '% lit · ' + now.toISOString().slice(0, 10));
    }
    if (fav) {
      var s = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>"
        + "<rect width='32' height='32' rx='6' fill='" + DARK + "'/>"
        + "<circle cx='16' cy='16' r='11.5' fill='none' stroke='" + YELLOW + "' stroke-opacity='0.18' stroke-width='2'/>"
        + "<path fill='" + YELLOW + "' d='" + litPath(p.frac, 11, 16, 16) + "'/></svg>";
      fav.setAttribute('type', 'image/svg+xml');
      fav.setAttribute('href', 'data:image/svg+xml,' + encodeURIComponent(s));
    }
  }

  /* ── occasion dates ────────────────────────────────────────────────── */
  function nthWeekday(n, w, m, year) {   // n: 1..5 or -1 (last); w: 0=Sun..6=Sat; m: 1..12
    if (n === -1) { var last = new Date(year, m, 0); return new Date(year, m - 1, last.getDate() - ((last.getDay() - w + 7) % 7)); }
    var first = new Date(year, m - 1, 1);
    return new Date(year, m - 1, 1 + ((w - first.getDay() + 7) % 7) + (n - 1) * 7);
  }
  function easter(year) {                 // Western Easter Sunday (Anonymous Gregorian computus)
    var a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4,
        f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
        i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, mm = Math.floor((a + 11 * h + 22 * l) / 451),
        month = Math.floor((h + l - 7 * mm + 114) / 31), day = ((h + l - 7 * mm + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function matchesOn(spec, today) {
    spec = String(spec || '').trim();
    var m;
    if ((m = /^(\d{1,2})-(\d{1,2})$/.exec(spec))) return (today.getMonth() + 1) === +m[1] && today.getDate() === +m[2];                       // MM-DD, every year
    if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(spec))) return today.getFullYear() === +m[1] && (today.getMonth() + 1) === +m[2] && today.getDate() === +m[3];  // YYYY-MM-DD
    if ((m = /^nth:(-?\d+)-(\d)-(\d{1,2})$/.exec(spec))) return sameDay(nthWeekday(+m[1], +m[2], +m[3], today.getFullYear()), today);          // nth:N-W-M
    if (spec === 'easter') return sameDay(easter(today.getFullYear()), today);
    return false;
  }
  function applyOccasion(occ) {
    if (!dot) return;
    dot.classList.add('doodle-on');
    dot.textContent = occ.emoji;          // replaces the moon <svg> with the emoji
    dot.setAttribute('title', occ.caption || '');
  }

  /* ── go ────────────────────────────────────────────────────────────── */
  renderMoon();   // default — happens immediately; overridden below if today's special

  Promise.all([
    fetch('content/doodles.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    fetch('content/board.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
  ]).then(function (res) {
    var cfg = res[0], board = res[1], occ = null;
    // 1) a curated doodle — first match in the list wins (so order it how you like)
    var list = (cfg && Array.isArray(cfg.doodles)) ? cfg.doodles : [];
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e && e.emoji && matchesOn(e.on, now)) { occ = { emoji: e.emoji, caption: e.caption || e.name || '' }; break; }
    }
    // 2) else — a shipped project's anniversary
    if (!occ && board && Array.isArray(board.cards)) {
      var best = null;
      board.cards.forEach(function (c) {
        if (!c || c.status !== 'shipped') return;
        var ds = c.started || c.updated, mm = ds && /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ds));
        if (mm && +mm[2] === now.getMonth() + 1 && +mm[3] === now.getDate() && now.getFullYear() > +mm[1]) {
          var yrs = now.getFullYear() - +mm[1];
          if (!best || yrs > best.yrs) best = { yrs: yrs, title: c.title || 'a project' };
        }
      });
      if (best) occ = { emoji: '🚀', caption: best.yrs + ' year' + (best.yrs === 1 ? '' : 's') + ' since I shipped ' + best.title };
    }
    if (occ) applyOccasion(occ);
  });
})();
