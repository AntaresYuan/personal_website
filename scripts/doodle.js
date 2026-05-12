/* ════════════════════════════════════════════════════════════════════════
   doodle.js — the brand mark shows tonight's moon phase (and the favicon too).

   The topnav "dot" is a crescent; this swaps it for the *actual* lunar phase
   on the visitor's local date, and re-points <link rel="icon"> at a matching
   "moon tile" data-URI. Deterministic from the date — like a Google Doodle,
   everyone sees the same moon today. (Homepage only for now; blog / 404 pages
   keep the static crescent + favicon.svg.)

   No deps; ~1 KB; loaded `defer` from index.html. Phase model: mean synodic
   period from a known new moon — accurate to well within a day, plenty for an
   icon. (A hook is left for date-driven "occasion" doodles later.)
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var SYNODIC = 29.530588853;                         // days, new moon → new moon
  var REF = Date.UTC(2000, 0, 6, 18, 14) / 86400000;  // a known new moon, in days
  var YELLOW = '#F5C518', DARK = '#14130D';

  function phaseOf(date) {
    var days = date.getTime() / 86400000 - REF;
    var frac = (((days % SYNODIC) + SYNODIC) % SYNODIC) / SYNODIC;   // 0 new · .25 1Q · .5 full · .75 LQ
    var illum = (1 - Math.cos(2 * Math.PI * frac)) / 2;             // lit fraction, 0..1
    return { frac: frac, illum: illum };
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
  // SVG path 'd' for the lit region of a moon: disc radius R, centred (cx,cy).
  // Built from two arcs — the bright limb (a semicircle) + the terminator (a
  // semi-ellipse whose x-radius is R·|cos(2π·frac)|). Clamped so the crescent
  // never quite vanishes (else the mark would be empty near new moon).
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

  var p = phaseOf(new Date());

  // — the topnav mark —
  var dot = document.querySelector('.brand .dot');
  if (dot) {
    var svg = dot.querySelector('svg');
    if (svg) {
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.innerHTML = '<path fill="currentColor" d="' + litPath(p.frac, 46, 50, 50) + '"></path>';
    }
    dot.setAttribute('title', phaseName(p.frac) + ' · ' + Math.round(p.illum * 100) + '% lit · ' + new Date().toISOString().slice(0, 10));
  }

  // — the favicon: a "moon tile" (dark rounded square + tonight's lit crescent
  //   + a faint full-disc ring so it still reads near new moon) —
  var fav = document.querySelector('link[rel="icon"]');
  if (fav) {
    var svgStr = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>"
      + "<rect width='32' height='32' rx='6' fill='" + DARK + "'/>"
      + "<circle cx='16' cy='16' r='11.5' fill='none' stroke='" + YELLOW + "' stroke-opacity='0.18' stroke-width='2'/>"
      + "<path fill='" + YELLOW + "' d='" + litPath(p.frac, 11, 16, 16) + "'/></svg>";
    fav.setAttribute('type', 'image/svg+xml');
    fav.setAttribute('href', 'data:image/svg+xml,' + encodeURIComponent(svgStr));
  }

  // TODO: occasion doodles (birthday, NYE, project ship-iversaries…) would
  // override the moon here, before the topnav/favicon writes above.
})();
