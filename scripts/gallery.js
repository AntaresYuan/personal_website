/* ════════════════════════════════════════════════════════════════════════
   gallery.js — the lightbox on /gallery/.

   A tile opens its piece: the pictures one at a time with their captions, a
   thumbnail strip, the story, and a link to the write-up. ←/→ step through
   pictures; at either end they carry on into the neighbouring piece. Esc or
   the scrim closes it and focus returns to the tile it came from.
   Data: the #gallery-data JSON that scripts/build-gallery.js embeds.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // The page's words (work-shell embeds them as #ui-strings, per language).
  // English is the fallback written here; Chinese comes from content/zh/strings.json.
  var UI = (function () { try { return JSON.parse(document.getElementById('ui-strings').textContent) || {}; } catch (e) { return {}; } })();
  var T = function (key, fallback, vars) {
    var v = key.split('.').reduce(function (o, k) { return o && o[k]; }, UI);
    var s = typeof v === 'string' ? v : fallback;
    return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return k in vars ? String(vars[k]) : m; }) : s;
  };
  var doc = document;
  var $ = function (id) { return doc.getElementById(id); };
  var box = $('lightbox');
  var dataEl = $('gallery-data');
  if (!box || !dataEl) return;

  var items = [];
  try { items = JSON.parse(dataEl.textContent) || []; } catch (e) { return; }

  var img = $('lb-img'), cap = $('lb-cap'), meta = $('lb-meta'), title = $('lb-title');
  var summary = $('lb-summary'), thumbs = $('lb-thumbs'), link = $('lb-link');
  var piece = 0, pic = 0, opener = null, closeTimer = 0;

  var escape = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  var showPic = function (j) {
    var it = items[piece];
    var pics = it.images || [];
    if (!pics.length) return;
    pic = (j + pics.length) % pics.length;
    img.classList.add('is-swapping');
    var next = new Image();
    next.onload = next.onerror = function () {
      img.src = pics[pic].src;
      img.alt = pics[pic].caption || it.title || '';
      requestAnimationFrame(function () { img.classList.remove('is-swapping'); });
    };
    next.src = pics[pic].src;
    cap.textContent = pics[pic].caption || '';
    cap.hidden = !pics[pic].caption;
    thumbs.querySelectorAll('button').forEach(function (b, k) {
      b.classList.toggle('is-on', k === pic);
      b.setAttribute('aria-pressed', String(k === pic));
    });
  };

  var showPiece = function (i, j) {
    piece = (i + items.length) % items.length;
    var it = items[piece];
    meta.textContent = [it.year, it.medium].filter(Boolean).join(' · ');
    title.textContent = it.title || '';
    summary.textContent = it.summary || '';
    link.hidden = !it.link;
    if (it.link) link.href = it.link;
    thumbs.innerHTML = (it.images || []).map(function (p, k) {
      return '<button type="button" aria-label="' + escape(T('gallery.picture', 'Picture {n}', { n: k + 1 })) + '" aria-pressed="false"><img src="' +
        escape(p.thumb || p.src) + '" alt="" decoding="async"></button>';   // small; lazy would stall inside a just-opened dialog
    }).join('');
    thumbs.hidden = (it.images || []).length < 2;
    showPic(j == null ? (it.cover || 0) : j);
  };

  var step = function (d) {
    var pics = (items[piece].images || []).length;
    var j = pic + d;
    if (j < 0) { var p = (piece - 1 + items.length) % items.length; showPiece(p, (items[p].images || []).length - 1); }
    else if (j >= pics) showPiece(piece + 1, 0);
    else showPic(j);
  };

  var open = function (i, from) {
    clearTimeout(closeTimer);
    opener = from || null;
    showPiece(i);
    box.hidden = false;
    void box.offsetWidth;
    box.classList.add('is-open');
    doc.documentElement.classList.add('lb-lock');
    box.querySelector('.lb-close').focus({ preventScroll: true });
  };
  var close = function () {
    box.classList.remove('is-open');
    doc.documentElement.classList.remove('lb-lock');
    closeTimer = setTimeout(function () { box.hidden = true; img.removeAttribute('src'); }, 260);
    if (opener) opener.focus({ preventScroll: true });
  };

  doc.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-gallery]');
    if (t && !(ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button === 1)) {
      ev.preventDefault();
      open(+t.getAttribute('data-gallery'), t);
    }
  });
  box.addEventListener('click', function (ev) {
    if (ev.target.closest('[data-lb-close]')) { close(); return; }
    var th = ev.target.closest('.lb-thumbs button');
    if (th) showPic([].indexOf.call(thumbs.children, th));
  });
  $('lb-prev').addEventListener('click', function () { step(-1); });
  $('lb-next').addEventListener('click', function () { step(1); });
  doc.addEventListener('keydown', function (ev) {
    if (box.hidden) return;
    if (ev.key === 'Escape') { ev.preventDefault(); close(); }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); step(1); }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); step(-1); }
    else if (ev.key === 'Tab') {
      // Keep focus inside the dialog.
      var f = [].slice.call(box.querySelectorAll('button, a[href]')).filter(function (x) { return !x.hidden && x.offsetParent; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (ev.shiftKey && doc.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && doc.activeElement === last) { ev.preventDefault(); first.focus(); }
    }
  });
})();
