/* ════════════════════════════════════════════════════════════════════════
   beacon.js — counts which parts of this site people actually touch.

   WHY THIS EXISTS
   The site has 16 skins, a terminal with 15 commands, a Q&A box, a doodle
   layer and a usage sub-page. All of it was expensive to build and none of
   it reported whether anyone ever used it. That is the only question this
   file answers: which features get touched. It is not page analytics —
   Cloudflare Web Analytics already does pageviews, referrers, countries
   and Core Web Vitals for free, without a script this file could improve
   on.

   WHAT IS NOT COLLECTED
   No cookie, no localStorage entry, no visitor id, no session id, no
   fingerprint, no IP (the Worker never reads it), no user agent, no
   referrer, no URL, no query string, no text the visitor typed, no
   timestamp finer than the calendar day. Each request is one increment of
   one allowlisted counter, and nothing ties two requests together.

   The cost of that is worth naming: "sixteen people each picked one skin"
   and "one person cycled all sixteen" produce identical data. That is
   accepted deliberately — the questions this is meant to answer ("is the
   terminal worth keeping?") survive the ambiguity, and the ones that
   would need identity ("what is my retention?") are not questions a
   personal site needs answered.

   FAILURE POSTURE
   Telemetry must never be able to break the page. Every call is wrapped,
   the endpoint is fire-and-forget, nothing awaits a response, and a total
   outage of the Worker is indistinguishable from success to the visitor.
   If this file throws, the site keeps working; if it is deleted, the site
   keeps working.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var ENDPOINT = 'https://usage.antaresyuan.site/beacon';

  /* Honour Do Not Track and Global Privacy Control. Both are advisory and
     widely ignored; this is counting skin clicks, so there is no argument
     for overriding someone who has explicitly asked not to be measured. */
  function optedOut() {
    try {
      var n = window.navigator || {};
      if (n.globalPrivacyControl === true) return true;
      var dnt = n.doNotTrack || window.doNotTrack || n.msDoNotTrack;
      return dnt === '1' || dnt === 'yes';
    } catch (_) {
      return true;   // cannot tell → do not send
    }
  }

  /* Local development would otherwise pollute production counters with
     the developer's own clicking. The Worker also accepts localhost (so
     the path is testable), which makes suppressing it here the only thing
     keeping "most popular skin" from meaning "the one I was debugging". */
  function isLocal() {
    try {
      var h = location.hostname;
      return h === 'localhost' || h === '127.0.0.1' || h === '' || location.protocol === 'file:';
    } catch (_) {
      return true;
    }
  }

  var DISABLED = optedOut() || isLocal();

  /* Per-event-and-value cap for one page life. Without it, a stuck
     re-render loop or someone leaning on a key turns one visitor into
     thousands of counts, and the number silently stops meaning "people
     who did this". 20 is well above real human repetition. */
  var CAP = 20;
  var seen = Object.create(null);

  function send(event, value) {
    if (DISABLED) return;
    try {
      var field = value ? event + ':' + value : event;
      var n = seen[field] || 0;
      if (n >= CAP) return;
      seen[field] = n + 1;

      var body = value ? { event: event, value: value } : { event: event };
      var json = JSON.stringify(body);

      /* sendBeacon survives page unload, which fetch() does not — a click
         that navigates away would otherwise lose its own event. Fall back
         to keepalive fetch where sendBeacon is missing. */
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([json], { type: 'application/json' }));
        return;
      }
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json,
        keepalive: true,
        mode: 'cors',
      }).catch(function () { /* telemetry must not surface errors */ });
    } catch (_) {
      /* never let counting break anything */
    }
  }

  // Public surface, deliberately tiny. Other scripts call window.SITE_BEACON
  // if it exists; none of them depend on it existing.
  window.SITE_BEACON = send;

  /* ── page_view ─────────────────────────────────────────────────────
     Not a pageview counter (Cloudflare has that). This distinguishes
     WHICH of the three page kinds gets opened, which is the part
     Cloudflare's per-path list makes tedious to read. */
  function pageKind() {
    try {
      var p = location.pathname;
      if (/^\/usage\/?$/.test(p)) return 'usage';
      if (/^\/blog/.test(p)) return 'blog';
      if (p === '/' || /index\.html$/.test(p)) return 'home';
      return null;      // 404 and one-offs are not worth a counter
    } catch (_) {
      return null;
    }
  }

  function start() {
    var kind = pageKind();
    if (kind) send('page_view', kind);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
