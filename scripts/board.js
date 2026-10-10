/* ════════════════════════════════════════════════════════════════════════
   board.js — a small whiteboard, in the manner of a Feishu board: an
   infinite dotted canvas of sticky notes, shapes, text, pictures and frames,
   joined by arrows.

   Read-only on project pages; scripts/board-editor.js turns the same board
   editable on /board-editor/. Any [data-board-src] element on a page is
   mounted automatically from the JSON at that URL (content/boards/*.json).

   Data:
     { version: 1,
       nodes: [ { id, type: 'sticky'|'shape'|'text'|'image'|'frame',
                  x, y, w, h, text?, color?, shape?: 'rect'|'round'|'ellipse'|'diamond',
                  size?: 'h1'|'h2'|'body'|'small', src?, caption? } ],
       edges: [ { id, from, to, label?, dashed?,
                  fromSide?, toSide?: 't'|'r'|'b'|'l' } ] }

   An arrow leaves each node from the side facing the other, unless its
   fromSide / toSide pins one (for a fan-out that should read sideways).

   Viewing: drag to pan; ⌘/Ctrl + scroll or a pinch to zoom. Plain scroll
   is left to the page, so a board never traps someone reading past it —
   except in full screen, where scroll pans.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var MIN_K = 0.2, MAX_K = 3;
  var COLORS = ['yellow', 'blue', 'green', 'pink', 'purple', 'gray'];

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  // Just enough markup for notes: **bold**, "- " bullets, line breaks.
  var rich = function (t) {
    var out = [], list = [];
    var flush = function () { if (list.length) { out.push('<ul>' + list.join('') + '</ul>'); list = []; } };
    String(t || '').split('\n').forEach(function (line) {
      var h = esc(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      if (/^\s*[-•]\s+/.test(line)) list.push('<li>' + h.replace(/^\s*[-•]\s+/, '') + '</li>');
      else { flush(); out.push(h ? '<p>' + h + '</p>' : '<p class="gap"></p>'); }
    });
    flush();
    return out.join('');
  };
  var uid = function (p) { return (p || 'n') + Math.random().toString(36).slice(2, 8); };

  var normalize = function (d) {
    d = d && typeof d === 'object' ? d : {};
    return {
      version: 1,
      nodes: (Array.isArray(d.nodes) ? d.nodes : []).filter(function (n) { return n && n.id; }),
      edges: (Array.isArray(d.edges) ? d.edges : []).filter(function (e) { return e && e.from && e.to; }),
    };
  };

  /* ── Geometry ─────────────────────────────────────────────────────────── */
  var center = function (n) { return { x: n.x + n.w / 2, y: n.y + n.h / 2 }; };
  var SIDES = { t: [0, -1], r: [1, 0], b: [0, 1], l: [-1, 0] };
  // Leave each node from the side facing the other, so arrows read cleanly.
  var anchor = function (n, toward, side) {
    var c = center(n), dx = toward.x - c.x, dy = toward.y - c.y;
    var s = SIDES[side];
    if (s) return { x: c.x + s[0] * n.w / 2, y: c.y + s[1] * n.h / 2, nx: s[0], ny: s[1] };
    if (Math.abs(dx) * n.h > Math.abs(dy) * n.w) {
      return { x: dx > 0 ? n.x + n.w : n.x, y: c.y, nx: dx > 0 ? 1 : -1, ny: 0 };
    }
    return { x: c.x, y: dy > 0 ? n.y + n.h : n.y, nx: 0, ny: dy > 0 ? 1 : -1 };
  };
  var edgeGeom = function (a, b, e) {
    var p = anchor(a, center(b), e && e.fromSide), q = anchor(b, center(a), e && e.toSide);
    var d = Math.max(40, Math.hypot(q.x - p.x, q.y - p.y) / 2.4);
    var c1 = { x: p.x + p.nx * d, y: p.y + p.ny * d }, c2 = { x: q.x + q.nx * d, y: q.y + q.ny * d };
    // Midpoint of the cubic, for the label.
    var mx = (p.x + 3 * c1.x + 3 * c2.x + q.x) / 8, my = (p.y + 3 * c1.y + 3 * c2.y + q.y) / 8;
    return { d: 'M' + p.x + ' ' + p.y + ' C' + c1.x + ' ' + c1.y + ' ' + c2.x + ' ' + c2.y + ' ' + q.x + ' ' + q.y, mx: mx, my: my };
  };
  var bounds = function (nodes) {
    if (!nodes.length) return { x: 0, y: 0, w: 800, h: 500 };
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    nodes.forEach(function (n) {
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h);
    });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };

  /* ── Board ────────────────────────────────────────────────────────────── */
  function Board(root, data, opts) {
    this.root = root;
    this.opts = opts || {};
    this.data = normalize(data);
    this.view = { x: 0, y: 0, k: 1 };
    this.sel = null;                       // selected node or edge id (editor)
    this.onChange = this.opts.onChange || function () {};
    this.onSelect = this.opts.onSelect || function () {};

    root.classList.add('board');
    if (this.opts.editable) root.classList.add('is-editable');
    root.innerHTML =
      '<div class="board-world">' +
        '<div class="board-frames"></div>' +
        '<svg class="board-edges" width="1" height="1" aria-hidden="true">' +
          '<defs><marker id="' + (this.mk = uid('mk')) + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
          '<path d="M0 0 L10 5 L0 10 z"/></marker></defs><g></g></svg>' +
        '<div class="board-nodes"></div>' +
        '<div class="board-sel"></div>' +
      '</div>' +
      '<div class="board-controls glass" role="toolbar" aria-label="Board view">' +
        '<button type="button" data-act="out" aria-label="Zoom out"><svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg></button>' +
        '<button type="button" data-act="fit" class="board-zoom" aria-label="Fit to board">100%</button>' +
        '<button type="button" data-act="in" aria-label="Zoom in"><svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg></button>' +
        '<button type="button" data-act="full" aria-label="Full screen"><svg viewBox="0 0 24 24"><path d="M4.5 9V4.5H9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15"/></svg></button>' +
      '</div>';
    this.world = root.querySelector('.board-world');
    this.framesEl = root.querySelector('.board-frames');
    this.edgesG = root.querySelector('.board-edges g');
    this.nodesEl = root.querySelector('.board-nodes');
    this.selEl = root.querySelector('.board-sel');
    this.zoomLabel = root.querySelector('.board-zoom');

    this.render();
    this.bind();
    var self = this;
    requestAnimationFrame(function () { self.fit(); });
  }

  Board.prototype.node = function (id) {
    for (var i = 0; i < this.data.nodes.length; i++) if (this.data.nodes[i].id === id) return this.data.nodes[i];
    return null;
  };

  Board.prototype.render = function () {
    var frames = [], nodes = [];
    this.data.nodes.forEach(function (n) {
      var style = 'left:' + n.x + 'px;top:' + n.y + 'px;width:' + n.w + 'px;height:' + n.h + 'px';
      var color = COLORS.indexOf(n.color) >= 0 ? ' c-' + n.color : '';
      if (n.type === 'frame') {
        frames.push('<div class="bn bn-frame" data-id="' + esc(n.id) + '" style="' + style + '"><span class="bn-frame-title">' + esc(n.text || 'Frame') + '</span></div>');
        return;
      }
      var inner;
      if (n.type === 'image') {
        inner = n.src
          ? '<img src="' + esc(n.src) + '" alt="' + esc(n.caption || '') + '" draggable="false" decoding="async">' +
            (n.caption ? '<span class="bn-caption">' + esc(n.caption) + '</span>' : '')
          : '<span class="bn-empty">Image</span>';
      } else {
        inner = '<div class="bn-body">' + rich(n.text) + '</div>';
      }
      var cls = 'bn bn-' + n.type + color +
        (n.type === 'shape' ? ' s-' + (n.shape || 'rect') : '') +
        (n.type === 'text' ? ' t-' + (n.size || 'body') : '');
      nodes.push('<div class="' + cls + '" data-id="' + esc(n.id) + '" style="' + style + '">' +
        (n.type === 'shape' && n.shape === 'diamond' ? '<svg class="bn-diamond" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M50 1 99 50 50 99 1 50z"/></svg>' : '') +
        inner + '</div>');
    });
    this.framesEl.innerHTML = frames.join('');
    this.nodesEl.innerHTML = nodes.join('');

    var self = this, g = [];
    this.data.edges.forEach(function (e) {
      var a = self.node(e.from), b = self.node(e.to);
      if (!a || !b) return;
      var geo = edgeGeom(a, b, e);
      var on = self.sel === e.id ? ' is-sel' : '';
      g.push('<g class="be' + (e.dashed ? ' is-dashed' : '') + on + '" data-id="' + esc(e.id) + '">' +
        '<path class="be-hit" d="' + geo.d + '"/>' +
        '<path class="be-line" d="' + geo.d + '" marker-end="url(#' + self.mk + ')"/>' +
        (e.label ? '<text x="' + geo.mx + '" y="' + geo.my + '" text-anchor="middle" dominant-baseline="middle">' + esc(e.label) + '</text>' : '') +
        '</g>');
    });
    this.edgesG.innerHTML = g.join('');
    this.renderSel();
  };

  // Selection outline, resize handle and connection ports (editor only).
  Board.prototype.renderSel = function () {
    var n = this.sel && this.node(this.sel);
    if (!this.opts.editable || !n) { this.selEl.innerHTML = ''; return; }
    this.selEl.innerHTML =
      '<div class="bs-box" style="left:' + n.x + 'px;top:' + n.y + 'px;width:' + n.w + 'px;height:' + n.h + 'px">' +
        '<span class="bs-resize" data-handle="resize"></span>' +
        (n.type === 'frame' ? '' :
          ['t', 'r', 'b', 'l'].map(function (s) { return '<span class="bs-port p-' + s + '" data-handle="port"></span>'; }).join('')) +
      '</div>';
  };

  /* ── View ─────────────────────────────────────────────────────────────── */
  Board.prototype.applyView = function () {
    var v = this.view;
    this.world.style.transform = 'translate(' + v.x + 'px,' + v.y + 'px) scale(' + v.k + ')';
    this.root.style.setProperty('--k', v.k);
    this.zoomLabel.textContent = Math.round(v.k * 100) + '%';
  };
  Board.prototype.zoomAt = function (px, py, factor) {
    var v = this.view;
    var k = Math.min(MAX_K, Math.max(MIN_K, v.k * factor));
    v.x = px - (px - v.x) * (k / v.k);
    v.y = py - (py - v.y) * (k / v.k);
    v.k = k;
    this.applyView();
  };
  Board.prototype.fit = function () {
    var r = this.root.getBoundingClientRect();
    if (!r.width) return;
    var b = bounds(this.data.nodes), pad = 40;
    var k = Math.min(1, (r.width - pad * 2) / b.w, (r.height - pad * 2) / b.h);
    k = Math.max(MIN_K, k);
    this.view = { k: k, x: (r.width - b.w * k) / 2 - b.x * k, y: (r.height - b.h * k) / 2 - b.y * k };
    this.applyView();
  };
  Board.prototype.toWorld = function (cx, cy) {
    var r = this.root.getBoundingClientRect(), v = this.view;
    return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k };
  };
  Board.prototype.toggleFull = function (on) {
    var full = on == null ? !this.root.classList.contains('is-full') : on;
    this.root.classList.toggle('is-full', full);
    document.documentElement.classList.toggle('board-lock', full);
    var self = this;
    requestAnimationFrame(function () { self.fit(); });
  };

  /* ── Editing (used by board-editor.js) ────────────────────────────────── */
  Board.prototype.select = function (id) {
    this.sel = id;
    this.render();
    this.onSelect(id ? (this.node(id) || this.edgeById(id)) : null);
  };
  Board.prototype.edgeById = function (id) {
    for (var i = 0; i < this.data.edges.length; i++) if (this.data.edges[i].id === id) return this.data.edges[i];
    return null;
  };
  Board.prototype.add = function (n) {
    n.id = n.id || uid('n');
    // Frames sit behind everything; keep them first so they paint first.
    if (n.type === 'frame') this.data.nodes.unshift(n); else this.data.nodes.push(n);
    this.select(n.id);
    this.onChange();
    return n;
  };
  Board.prototype.remove = function (id) {
    var d = this.data;
    d.nodes = d.nodes.filter(function (n) { return n.id !== id; });
    d.edges = d.edges.filter(function (e) { return e.id !== id && e.from !== id && e.to !== id; });
    this.select(null);
    this.onChange();
  };
  // `coalesce`: a continuous edit (typing) that the editor folds into one
  // undo step; everything else is a step of its own.
  Board.prototype.update = function (id, patch, coalesce) {
    var t = this.node(id) || this.edgeById(id);
    if (!t) return;
    Object.keys(patch).forEach(function (k) { t[k] = patch[k]; });
    this.render();
    this.onChange(!!coalesce);
  };
  Board.prototype.setData = function (data, keepView) {
    this.data = normalize(data);
    this.sel = null;
    this.render();
    if (!keepView) this.fit();
  };

  /* ── Pointer + wheel ──────────────────────────────────────────────────── */
  Board.prototype.bind = function () {
    var self = this, root = this.root, pointers = {}, drag = null, pinch = null;
    var SNAP = 8;
    var snap = function (v) { return Math.round(v / SNAP) * SNAP; };

    root.querySelector('.board-controls').addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      var r = root.getBoundingClientRect();
      var act = b.getAttribute('data-act');
      if (act === 'in') self.zoomAt(r.width / 2, r.height / 2, 1.25);
      if (act === 'out') self.zoomAt(r.width / 2, r.height / 2, 0.8);
      if (act === 'fit') self.fit();
      if (act === 'full') self.toggleFull();
    });
    root.querySelector('.board-controls').addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });

    root.addEventListener('wheel', function (ev) {
      var full = root.classList.contains('is-full') || self.opts.editable;
      var r = root.getBoundingClientRect();
      if (ev.ctrlKey || ev.metaKey) {
        ev.preventDefault();
        self.zoomAt(ev.clientX - r.left, ev.clientY - r.top, Math.exp(-ev.deltaY * 0.01));
      } else if (full) {
        ev.preventDefault();
        self.view.x -= ev.deltaX;
        self.view.y -= ev.deltaY;
        self.applyView();
      }
    }, { passive: false });

    root.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0 && ev.pointerType === 'mouse') return;
      pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: self.view.k };
        drag = null;
        return;
      }
      var tool = self.opts.editable && self.opts.tool ? self.opts.tool() : 'select';
      var w = self.toWorld(ev.clientX, ev.clientY);
      var handle = ev.target.closest('[data-handle]');
      var hit = ev.target.closest('.bn');
      var edgeHit = ev.target.closest('.be');

      if (self.opts.editable && tool !== 'select' && self.opts.create) {
        self.opts.create(tool, snap(w.x), snap(w.y));
        ev.preventDefault();
        return;
      }
      if (self.opts.editable && handle && self.sel) {
        var n = self.node(self.sel);
        drag = handle.getAttribute('data-handle') === 'resize'
          ? { mode: 'resize', n: n, w0: n.w, h0: n.h, sx: w.x, sy: w.y }
          : { mode: 'connect', from: n, line: null };
      } else if (self.opts.editable && hit) {
        var id = hit.getAttribute('data-id');
        var node = self.node(id);
        if (self.sel !== id) self.select(id);
        // Moving a frame carries everything sitting inside it.
        var riders = node.type === 'frame' ? self.data.nodes.filter(function (m) {
          return m !== node && m.x >= node.x && m.y >= node.y && m.x + m.w <= node.x + node.w && m.y + m.h <= node.y + node.h;
        }).map(function (m) { return { m: m, x: m.x, y: m.y }; }) : [];
        drag = { mode: 'move', n: node, x0: node.x, y0: node.y, sx: w.x, sy: w.y, riders: riders, moved: false };
      } else if (self.opts.editable && edgeHit) {
        self.select(edgeHit.getAttribute('data-id'));
        return;
      } else {
        if (self.opts.editable && self.sel) self.select(null);
        drag = { mode: 'pan', sx: ev.clientX, sy: ev.clientY, x0: self.view.x, y0: self.view.y };
        // On a page (not full screen), leave touch drags to page scrolling.
        if (ev.pointerType === 'touch' && !root.classList.contains('is-full') && !self.opts.editable) { drag = null; return; }
      }
      root.setPointerCapture(ev.pointerId);
      root.classList.add('is-dragging');
      ev.preventDefault();
    });

    root.addEventListener('pointermove', function (ev) {
      if (pointers[ev.pointerId]) pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      if (pinch) {
        var ids = Object.keys(pointers);
        if (ids.length < 2) return;
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var r = root.getBoundingClientRect();
        var k = pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d;
        self.zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, k / self.view.k);
        return;
      }
      if (!drag) return;
      var w = self.toWorld(ev.clientX, ev.clientY);
      if (drag.mode === 'pan') {
        self.view.x = drag.x0 + (ev.clientX - drag.sx);
        self.view.y = drag.y0 + (ev.clientY - drag.sy);
        self.applyView();
      } else if (drag.mode === 'move') {
        var dx = snap(w.x - drag.sx), dy = snap(w.y - drag.sy);
        drag.n.x = drag.x0 + dx; drag.n.y = drag.y0 + dy;
        drag.riders.forEach(function (r) { r.m.x = r.x + dx; r.m.y = r.y + dy; });
        drag.moved = drag.moved || dx || dy;
        self.render();
      } else if (drag.mode === 'resize') {
        drag.n.w = Math.max(40, snap(drag.w0 + w.x - drag.sx));
        drag.n.h = Math.max(32, snap(drag.h0 + w.y - drag.sy));
        self.render();
      } else if (drag.mode === 'connect') {
        var c = center(drag.from);
        self.render();
        self.edgesG.insertAdjacentHTML('beforeend',
          '<g class="be is-draft"><path class="be-line" d="M' + c.x + ' ' + c.y + ' L' + w.x + ' ' + w.y + '" marker-end="url(#' + self.mk + ')"/></g>');
      }
    });

    var end = function (ev) {
      delete pointers[ev.pointerId];
      if (pinch && Object.keys(pointers).length < 2) pinch = null;
      if (!drag) return;
      root.classList.remove('is-dragging');
      if (drag.mode === 'connect') {
        var el = document.elementFromPoint(ev.clientX, ev.clientY);
        var target = el && el.closest && el.closest('.bn');
        var to = target && target.getAttribute('data-id');
        if (to && to !== drag.from.id && self.node(to).type !== 'frame') {
          self.data.edges.push({ id: uid('e'), from: drag.from.id, to: to });
          self.onChange();
        }
        self.render();
      } else if ((drag.mode === 'move' && drag.moved) || drag.mode === 'resize') {
        self.onChange();
      }
      drag = null;
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && root.classList.contains('is-full') && !self.opts.editable) self.toggleFull(false);
    });
    if (window.ResizeObserver) {
      var lastW = 0;
      new ResizeObserver(function () {
        var w = root.clientWidth;
        if (Math.abs(w - lastW) > 1) { lastW = w; self.fit(); }
      }).observe(root);
    }
  };

  window.Board = Board;
  Board.COLORS = COLORS;
  Board.uid = uid;

  /* ── Auto-mount ───────────────────────────────────────────────────────── */
  document.querySelectorAll('[data-board-src]').forEach(function (el) {
    fetch(el.getAttribute('data-board-src'), { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (data) { el.board = new Board(el, data, {}); })
      .catch(function () { el.classList.add('is-missing'); el.textContent = 'This board could not be loaded.'; });
  });
})();
