/* ════════════════════════════════════════════════════════════════════════
   live.js — a project's real app inside its case study (the .live figure
   that build-projects.js writes from a project's `live` field).

   A poster until "Try it live": loading a whole app on scroll would slow the
   page and let it swallow the wheel. Once started, the iframe renders at the
   desktop size the figure declares (--live-w × --live-h) and is scaled down
   to the column, so it reads like the screenshot it replaced; full screen
   drops the scaling and gives it the window. On a narrow screen, where the
   scaled desktop would be unreadable, "Try it live" opens a new tab instead.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var NARROW = 600;

  function mount(fig) {
    var url = fig.getAttribute('data-live');
    var view = fig.querySelector('.live-view');
    var start = fig.querySelector('[data-live-act="start"]');
    var fullBtn = fig.querySelector('[data-live-act="full"]');
    var cs = getComputedStyle(fig);
    var W = parseFloat(cs.getPropertyValue('--live-w')) || 1440;
    var H = parseFloat(cs.getPropertyValue('--live-h')) || 810;
    var frame = null;

    var fit = function () {
      if (!frame || fig.classList.contains('is-full')) return;
      var k = view.clientWidth / W;
      frame.style.width = W + 'px';
      frame.style.height = H + 'px';
      frame.style.transform = 'scale(' + k + ')';
    };

    var go = function () {
      if (view.clientWidth < NARROW) { window.open(url, '_blank', 'noopener'); return; }
      frame = document.createElement('iframe');
      frame.src = url;
      frame.title = (fig.getAttribute('data-live-title') || 'Live app') + ' — live';
      frame.setAttribute('allow', 'clipboard-write; fullscreen');
      frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      frame.addEventListener('load', function () { fig.classList.add('is-loaded'); });
      view.appendChild(frame);
      fig.classList.add('is-live');
      start.remove();
      fullBtn.hidden = false;
      fit();
      if ('ResizeObserver' in window) new ResizeObserver(fit).observe(view);
      else window.addEventListener('resize', fit);
    };

    var setFull = function (on) {
      fig.classList.toggle('is-full', on);
      document.documentElement.classList.toggle('board-lock', on);
      fullBtn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
      fullBtn.title = fullBtn.getAttribute('aria-label');
      if (frame) {
        if (on) { frame.style.width = '100%'; frame.style.height = '100%'; frame.style.transform = 'none'; }
        else fit();
      }
    };

    start.addEventListener('click', go);
    fullBtn.addEventListener('click', function () { setFull(!fig.classList.contains('is-full')); });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && fig.classList.contains('is-full')) setFull(false);
    });
  }

  document.querySelectorAll('.live[data-live]').forEach(mount);
})();
