/* ════════════════════════════════════════════════════════════════════════
   doodle.js — the brand mark is a "doodle": tonight's moon phase by default,
   or a small crafted glyph on holidays / your birthday / a project ship-iversary.

   • Every day → the topnav "dot" shows the *actual* lunar phase for the
     visitor's local date, and <link rel="icon"> is re-pointed at a matching
     "moon tile". Deterministic from the date — like a Google Doodle, everyone
     sees the same moon today.
   • Special days → it shows a hand-drawn glyph (in the brand yellow, like the
     moon) + a hover caption instead. The list lives in content/doodles.json
     (editable in /admin/ → Doodles): each entry has an `icon` (a glyph name —
     see GLYPHS below; an emoji works as a fallback) + a `caption`. Plus any
     shipped card whose anniversary is today (from content/board.json) gets the `rocket` glyph.

   Runs on every page (home, blog, 404) so the mark + favicon are consistent.
   No deps; loaded `defer`. Falls back gracefully (the static crescent / the
   stock favicon.svg) if it can't run or fetch.
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
  // — hand-crafted single-colour glyphs, drawn in a 0 0 24 24 box; rendered in
  //   the brand yellow with the same glow as the moon. A doodle's `icon` is one
  //   of these names; anything else (e.g. an emoji) is rendered as plain text.
  var GLYPHS = {
    heart:       '<path fill="currentColor" d="M12 21C6 16.5 2 12.8 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.4 22 8.5c0 4.3-4 8-10 12.5Z"/>',
    star:        '<path fill="currentColor" d="M12 2 14.85 8.5 22 9.27 16.5 13.97 18 21 12 17.27 6 21 7.5 13.97 2 9.27 9.15 8.5Z"/>',
    tree:        '<circle fill="currentColor" cx="12" cy="2.8" r="1.7"/><path fill="currentColor" d="M12 4 3.4 19.2h17.2L12 4Z"/><rect fill="currentColor" x="10.3" y="18.5" width="3.4" height="3.5"/>',
    firework:    '<circle fill="currentColor" cx="12" cy="12" r="2.3"/><path stroke="currentColor" stroke-width="2.3" stroke-linecap="round" fill="none" d="M12 3.4v3.6M12 17v3.6M3.4 12h3.6M17 12h3.6M5.8 5.8 8.4 8.4M15.6 15.6 18.2 18.2M18.2 5.8 15.6 8.4M8.4 15.6 5.8 18.2"/>',
    candle:      '<path fill="currentColor" d="M12 1c2 1.9 3.3 3.6 3.3 5.4a3.3 3.3 0 0 1-6.6 0C8.7 4.6 10 2.9 12 1Z"/><rect fill="currentColor" x="8.4" y="8" width="7.2" height="14" rx="1.3"/>',
    egg:         '<path fill="currentColor" d="M12 2c4 0 7.6 5.6 7.6 11.1A7.6 7.6 0 0 1 4.4 13.1C4.4 7.6 8 2 12 2Z"/>',
    pumpkin:     '<rect fill="currentColor" x="11" y="2.4" width="2.2" height="3.2" rx="0.9"/><path fill="currentColor" fill-rule="evenodd" d="M12 4.8C7.6 4.8 4 8.7 4 13.5 4 18.3 7.6 22 12 22s8-3.7 8-8.5C20 8.7 16.4 4.8 12 4.8ZM8.8 11 6.9 13.1 8.8 15.2 10.7 13.1 8.8 11Zm6.4 0-1.9 2.1 1.9 2.1 1.9-2.1L15.2 11ZM8.4 17.2c2.4 1.5 4.8 1.5 7.2 0V15c-2.4 1.4-4.8 1.4-7.2 0v2.2Z"/>',
    mortarboard: '<path fill="currentColor" d="M12 3 23 8.5 12 14 1 8.5 12 3Z"/><path fill="currentColor" d="M5.5 10.6v3.6c0 1.5 2.9 2.8 6.5 2.8s6.5-1.3 6.5-2.8v-3.6L12 14 5.5 10.6Z"/><path fill="currentColor" d="M20 9.5v5l1.4.8v-6L20 9.5Z"/>',
    rocket:      '<path fill="currentColor" d="M12 1.5c2.9 2.5 4.4 5.9 4.4 9.8v3.7H7.6v-3.7c0-3.9 1.5-7.3 4.4-9.8Z"/><path fill="currentColor" d="M7.5 12.5 3.8 16.3l3.7 1V12.5Z"/><path fill="currentColor" d="M16.5 12.5 20.2 16.3l-3.7 1V12.5Z"/><path fill="currentColor" d="M9.6 16.9h4.8L12 22.1 9.6 16.9Z"/>',
    sprout:      '<path stroke="currentColor" stroke-width="2.3" stroke-linecap="round" fill="none" d="M12 22V10"/><path fill="currentColor" d="M12 12C12 7 9 4 4 4c0 5 3 8 8 8Z"/><path fill="currentColor" d="M12 14C12 10 14.5 7 19.5 7c0 4-2.5 7-7.5 7Z"/>',
    lantern:     '<rect fill="currentColor" x="9.3" y="2.3" width="5.4" height="2" rx="1"/><path fill="currentColor" d="M12 4.3c-4.1 0-7.2 3.4-7.2 7.9s3.1 7.9 7.2 7.9 7.2-3.4 7.2-7.9S16.1 4.3 12 4.3Z"/><rect fill="currentColor" x="9.3" y="19.6" width="5.4" height="2" rx="1"/><rect fill="currentColor" x="11.2" y="21.4" width="1.6" height="2.3" rx="0.8"/>',
    redenvelope: '<path fill="currentColor" fill-rule="evenodd" d="M4.5 3h15v18h-15V3Zm7.5 9.2L4.5 7V3l7.5 5.2L19.5 3v4l-7.5 5.2Z"/>',
    zongzi:      '<path fill="currentColor" d="M12 2.5 21.5 21H2.5L12 2.5Z"/>',
    leaf:        '<path fill="currentColor" d="M4 20C2 14 4 6 13 3c8 3 8 14-1 18-3 1.4-6 .5-8-1Z"/>',
    mooncake:    '<circle fill="currentColor" cx="12" cy="12" r="9.2"/>',
    flag:        '<rect fill="currentColor" x="4.5" y="2" width="2.1" height="20" rx="1"/><path fill="currentColor" d="M6.6 3H18.5q-2.4 2.6 0 5.2T6.6 13.4V3Z"/>',
    wrench:      '<path fill="currentColor" d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8Z"/>',
    kite:        '<path fill="currentColor" d="M12 1.5 19 8.5 12 15.5 5 8.5 12 1.5Z"/><path stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none" d="M12 15.5c-.6 1.6-2.2 2.2-2.7 4M12 15.5c.6 1.4 2.1 1.9 2.6 3.4"/>',
  };

  function applyOccasion(occ) {
    if (!dot) return;
    var glyph = GLYPHS[occ.icon];
    if (glyph) {
      // a crafted glyph — same yellow + glow as the moon
      var svg = dot.querySelector('svg');
      if (!svg) { dot.innerHTML = '<svg></svg>'; svg = dot.querySelector('svg'); }
      dot.classList.remove('doodle-on');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.innerHTML = glyph;
    } else {
      // fallback — render the literal value (an emoji) as text, no yellow glow
      dot.classList.add('doodle-on');
      dot.textContent = occ.icon || '';
    }
    dot.setAttribute('title', occ.caption || '');
  }

  /* ── go ────────────────────────────────────────────────────────────── */
  renderMoon();   // default — happens immediately; overridden below if today's special

  Promise.all([
    fetch('/content/doodles.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    fetch('/content/board.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
  ]).then(function (res) {
    var cfg = res[0], board = res[1], occ = null;
    // 1) a curated doodle — first match in the list wins (so order it how you like)
    var list = (cfg && Array.isArray(cfg.doodles)) ? cfg.doodles : [];
    for (var i = 0; i < list.length; i++) {
      var e = list[i], icon = e && (e.icon || e.emoji);   // `emoji` kept for back-compat
      if (e && icon && matchesOn(e.on, now)) { occ = { icon: icon, caption: e.caption || e.name || '' }; break; }
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
      if (best) occ = { icon: 'rocket', caption: best.yrs + ' year' + (best.yrs === 1 ? '' : 's') + ' since I shipped ' + best.title };
    }
    if (occ) applyOccasion(occ);
  });
})();
