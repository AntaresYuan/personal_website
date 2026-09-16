/* ─────────────────────────────────────────────────────────────────────────
   Space switcher — "Antares Work" ⇄ "Antares Personal".

   Modelled on how ChatGPT switches between ChatGPT and Codex: the product name
   in the top-left is itself the control, and clicking it drops a menu of the
   available spaces. That keeps the switch discoverable without adding a fifth
   control to a top bar that already holds blog, search, theme and skin.

   Spaces come from site.json → spaces, so adding a third one is a data edit.
   Standalone and dependency-free: blog and post pages get the same switcher
   but do not load render.js.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var root = document.getElementById('space-switcher');
  var trigger = document.getElementById('space-trigger');
  var menu = document.getElementById('space-menu');
  if (!root || !trigger || !menu) return;

  var LAST_KEY = 'antares.space';

  /* Which space is this page in? Derived from the URL rather than stored
     state: a link straight into /personal/ has to show "Personal" even though
     localStorage may still say "work" from a previous visit. Storage only
     remembers a preference; the URL is the truth for the current page. */
  var currentId = function (spaces) {
    var path = location.pathname;
    var best = null;
    spaces.forEach(function (s) {
      var href = s.href || '/';
      /* Longest matching prefix wins, so "/" does not beat "/personal/" on a
         personal page — "/" is a prefix of literally every path. */
      if (path.indexOf(href) === 0 && (!best || href.length > (best.href || '/').length)) best = s;
    });
    return (best || spaces[0]).id;
  };

  var open = false;

  var setOpen = function (next) {
    open = next;
    trigger.setAttribute('aria-expanded', String(next));
    if (next) {
      menu.hidden = false;
      void menu.offsetWidth;              // reflow so the transition runs
      menu.classList.add('is-open');
    } else {
      menu.classList.remove('is-open');
      setTimeout(function () { if (!open) menu.hidden = true; }, 160);
    }
  };

  fetch('/content/site.json', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (site) {
      var cfg = (site && site.spaces) || {};
      var spaces = cfg.items || [];
      /* One space is not a switch. Leave the plain brand alone rather than
         rendering a caret that opens a menu with a single obvious item. */
      if (spaces.length < 2) return;

      var active = currentId(spaces);
      try { localStorage.setItem(LAST_KEY, active); } catch (e) {}

      var nameEl = document.getElementById('brand-name');
      var activeSpace = spaces.filter(function (s) { return s.id === active; })[0];
      if (nameEl && activeSpace) nameEl.textContent = activeSpace.name;
      root.classList.add('has-spaces');

      menu.innerHTML = spaces.map(function (s) {
        var isActive = s.id === active;
        return '<a class="space-item' + (isActive ? ' is-active' : '') + '"' +
               ' href="' + s.href + '" role="menuitem"' +
               (isActive ? ' aria-current="true"' : '') + '>' +
               '<span class="space-item-body">' +
                 '<span class="space-item-name"></span>' +
                 '<span class="space-item-tag"></span>' +
               '</span>' +
               '<span class="space-item-check" aria-hidden="true">' +
                 (isActive ? '✓' : '') + '</span>' +
               '</a>';
      }).join('');

      /* Text set via textContent, not interpolated into the HTML above:
         site.json is author-controlled but a name containing < or & would
         otherwise break the markup. */
      var anchors = menu.querySelectorAll('.space-item');
      spaces.forEach(function (s, i) {
        var a = anchors[i];
        if (!a) return;
        a.querySelector('.space-item-name').textContent = s.name || s.id;
        a.querySelector('.space-item-tag').textContent = s.tagline || '';
      });

      trigger.addEventListener('click', function (ev) {
        ev.stopPropagation();
        setOpen(!open);
      });

      document.addEventListener('click', function (ev) {
        if (open && !root.contains(ev.target)) setOpen(false);
      });

      document.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Escape' || !open) return;
        setOpen(false);
        trigger.focus();
      });

      /* Arrow keys move through the menu once it is open. Without this the
         menu is mouse-only, which a role="menu" promises it is not. */
      menu.addEventListener('keydown', function (ev) {
        var items = [].slice.call(menu.querySelectorAll('.space-item'));
        var i = items.indexOf(document.activeElement);
        if (ev.key === 'ArrowDown') {
          ev.preventDefault();
          items[Math.min(items.length - 1, i + 1)].focus();
        } else if (ev.key === 'ArrowUp') {
          ev.preventDefault();
          if (i <= 0) trigger.focus(); else items[i - 1].focus();
        }
      });

      trigger.addEventListener('keydown', function (ev) {
        if (ev.key !== 'ArrowDown') return;
        ev.preventDefault();
        setOpen(true);
        setTimeout(function () {
          var first = menu.querySelector('.space-item');
          if (first) first.focus();
        }, 20);
      });
    })
    .catch(function () { /* no switcher rather than a broken one */ });
})();
