/* ─────────────────────────────────────────────────────────────────────────
   Lazy-load the giscus comments widget.

   Why this exists: giscus was loaded on every page view even though the
   comments sit far below the fold. `async` stops it blocking the parser but
   the request still goes out immediately, and on production it was reliably
   the LAST thing to finish — loadEventEnd landed within 1ms of giscus's final
   response on three consecutive runs (1366/1366, 1282/1281, 1982/1982). On a
   flaky cross-border connection the same requests surface as ERR_TIMED_OUT.

   The build emits a <div class="giscus-lazy"> carrying the configuration as
   data-* attributes. This file turns that div into the real <script> tag the
   first time the section comes within a screen of the viewport.

   Standalone and dependency-free on purpose: blog pages do not load render.js,
   so a shared helper had to be its own file.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var placeholder = document.querySelector('.giscus-lazy');
  if (!placeholder) return;

  var loaded = false;

  var load = function () {
    if (loaded) return;
    loaded = true;

    var s = document.createElement('script');
    s.src = 'https://giscus.app/client.js';
    s.async = true;
    s.crossOrigin = 'anonymous';

    /* Copy every data-* across verbatim. Reading them off the element rather
       than hard-coding them here keeps site.json the single source of truth:
       change the category in site.json, rebuild, and this picks it up with no
       edit to this file. */
    Object.keys(placeholder.dataset).forEach(function (key) {
      s.dataset[key] = placeholder.dataset[key];
    });

    /* giscus injects its iframe as a sibling of its own <script>, so the
       script has to be inside the container the comments should appear in. */
    placeholder.parentNode.insertBefore(s, placeholder);
  };

  /* One viewport of lead time: start fetching while the section is still
       approaching, so by the time it is actually on screen the widget is
       usually already there. Without the margin the visitor watches it load. */
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          load();
          io.disconnect();
          return;
        }
      }
    }, { rootMargin: '100% 0px' });
    io.observe(placeholder);
  } else {
    /* No IntersectionObserver: load it straight away rather than leaving the
       comments permanently missing. Slower, but never broken. */
    load();
  }
})();
