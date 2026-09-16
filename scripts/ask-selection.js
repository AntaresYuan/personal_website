/* ─────────────────────────────────────────────────────────────────────────
   Select text → "Ask about this".

   A small button follows a selection. Clicking it opens the assistant with
   that passage attached as context, so a question as short as "why?" resolves
   to what the visitor was looking at.

   This matters more the leaner the page gets: trimming the copy does not
   remove the reader's questions, it just moves them off the page. Letting them
   point at a line is more direct than making them describe it.

   Standalone and dependency-free — home, /personal/ and every /work/<slug>/
   page needs it, and only the home page loads render.js.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var MIN_CHARS = 12;      // below this a "selection" is usually a stray drag
  var MAX_CHARS = 1200;    // the panel truncates anyway; keep the payload sane

  var btn = null;
  var lastText = '';

  var remove = function () {
    if (btn) { btn.remove(); btn = null; }
    lastText = '';
  };

  var place = function (rect, text) {
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ask-selection-btn';
      btn.innerHTML =
        '<svg viewBox="0 0 32 32" width="13" height="13" aria-hidden="true">' +
        '<path fill="currentColor" d="M16 0 L18.4 13.6 L32 16 L18.4 18.4 L16 32 ' +
        'L13.6 18.4 L0 16 L13.6 13.6 Z"/></svg><span>Ask about this</span>';
      /* mousedown, not click: the browser clears the selection as soon as the
         pointer goes down elsewhere, so by click time there is nothing left to
         send. Preventing the default here also keeps the highlight visible. */
      btn.addEventListener('mousedown', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        ask(lastText);
      });
      document.body.appendChild(btn);
    }
    lastText = text;

    /* Position above the selection, clamped into the viewport — a selection at
       the very top or hard against an edge would otherwise put the button
       off-screen. position:fixed, so these are viewport coordinates and no
       scroll offset is involved. */
    var w = 132, h = 30, gap = 8;
    var left = rect.left + rect.width / 2 - w / 2;
    var top = rect.top - h - gap;
    if (top < gap) top = rect.bottom + gap;          // flip below
    left = Math.max(gap, Math.min(left, window.innerWidth - w - gap));
    btn.style.left = Math.round(left) + 'px';
    btn.style.top = Math.round(top) + 'px';
  };

  var ask = function (text) {
    var panel = window.ASK_PANEL;
    remove();
    if (!panel || typeof panel.open !== 'function') return;
    /* Open with no question: the visitor picks what to ask. The passage is
       already attached, so the composer is pre-armed rather than pre-filled. */
    panel.open(undefined, { quote: text });
  };

  document.addEventListener('selectionchange', function () {
    var sel = document.getSelection();
    if (!sel || sel.isCollapsed) { remove(); return; }

    var text = sel.toString().trim();
    if (text.length < MIN_CHARS) { remove(); return; }
    if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);

    var node = sel.anchorNode;
    var el = node && (node.nodeType === 1 ? node : node.parentElement);
    /* Selecting inside the panel is for copying an answer, not for asking
       about it — offering the button there would loop the assistant onto its
       own output. Same for the composer. */
    if (el && el.closest('#ask-panel, .hero-ask, .palette, input, textarea')) {
      remove();
      return;
    }

    var range = sel.getRangeAt(0);
    var rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) { remove(); return; }
    place(rect, text);
  });

  /* Keep it glued to the text while the page moves under it. Cheap because it
     only runs while a button exists. */
  var reposition = function () {
    if (!btn) return;
    var sel = document.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) { remove(); return; }
    place(sel.getRangeAt(0).getBoundingClientRect(), lastText);
  };
  window.addEventListener('scroll', reposition, { passive: true });
  window.addEventListener('resize', reposition);

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') remove();
  });
})();
