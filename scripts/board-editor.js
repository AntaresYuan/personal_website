/* ════════════════════════════════════════════════════════════════════════
   board-editor.js — the editor on /board-editor/ (not linked from the site).

   Opens content/boards/<id>.json (?id=…, default "sample") in an editable
   Board (scripts/board.js). Tools on the left, the selection's properties
   on the right, undo / redo, and three ways out:
     Save      writes the file straight into the repo when the page is served
               by `npm run board` (ops/board-dev.js); otherwise downloads it
     Download  the JSON as a file, to drop into content/boards/
     Copy      the JSON to the clipboard
   Every change is also kept as a local draft, so closing the tab loses
   nothing.

   Keys: V select · N note · R shape · T text · F frame · I image ·
         ⌫ delete · ⌘D duplicate · ⌘Z / ⇧⌘Z undo / redo · Esc deselect
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('be-board');
  if (!canvas || !window.Board) return;

  var params = new URLSearchParams(location.search);
  var boardId = (params.get('id') || 'sample').replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'sample';
  var DRAFT_KEY = 'board-draft:' + boardId;
  var tool = 'select';
  var history = [], future = [], histTimer = 0;
  var canSave = false;

  var status = function (t) { $('be-status').textContent = t; };
  var snapshot = function () { return JSON.stringify(board.data); };
  var commit = function () {
    clearTimeout(histTimer);
    var now = snapshot();
    if (history.length && history[history.length - 1] === now) return;
    history.push(now);
    future = [];
    try { localStorage.setItem(DRAFT_KEY, now); } catch (e) {}
    status('Unsaved changes');
  };

  var board = new window.Board(canvas, { nodes: [], edges: [] }, {
    editable: true,
    tool: function () { return tool; },
    create: function (t, x, y) { create(t, x, y); },
    onChange: function (coalesce) {
      // Discrete edits (add, move, connect, recolour…) are an undo step each,
      // committed at once. Typing is folded into one step, committed after a
      // pause — a timer would otherwise merge separate edits made in quick
      // succession, or in a background tab where timers are throttled.
      clearTimeout(histTimer);
      if (coalesce) histTimer = setTimeout(commit, 600);
      else commit();
    },
    onSelect: function (target) { inspect(target); },
  });

  /* ── Tools ──────────────────────────────────────────────────────────── */
  var DEFAULTS = {
    sticky:  { type: 'sticky', w: 200, h: 150, color: 'yellow', text: '**Note**\nSomething worth saying.' },
    shape:   { type: 'shape', shape: 'round', w: 180, h: 100, color: 'blue', text: 'Shape' },
    text:    { type: 'text', size: 'h2', w: 320, h: 44, text: 'Heading' },
    frame:   { type: 'frame', w: 640, h: 420, text: 'Frame' },
    image:   { type: 'image', w: 260, h: 180, src: '', caption: '' },
  };
  var create = function (t, x, y) {
    var d = JSON.parse(JSON.stringify(DEFAULTS[t] || DEFAULTS.sticky));
    d.x = x - Math.round(d.w / 2 / 8) * 8;
    d.y = y - Math.round(d.h / 2 / 8) * 8;
    board.add(d);
    setTool('select');
  };
  var setTool = function (t) {
    tool = t;
    document.querySelectorAll('[data-tool]').forEach(function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-tool') === t);
    });
    canvas.classList.toggle('is-placing', t !== 'select');
  };
  document.querySelector('.be-tools').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-tool]');
    if (b) setTool(b.getAttribute('data-tool'));
  });

  /* ── Inspector ──────────────────────────────────────────────────────── */
  var panel = $('be-inspector');
  var field = function (label, html) { return '<label class="be-field"><span>' + label + '</span>' + html + '</label>'; };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var inspect = function (t) {
    if (!t) { panel.hidden = true; panel.innerHTML = ''; return; }
    var isEdge = !!t.from;
    var html = '<p class="be-kind">' + (isEdge ? 'Arrow' : ({ sticky: 'Note', shape: 'Shape', text: 'Text', frame: 'Frame', image: 'Image' }[t.type] || t.type)) + '</p>';
    if (isEdge) {
      html += field('Label', '<input data-k="label" value="' + esc(t.label || '') + '">');
      html += '<label class="be-check"><input type="checkbox" data-k="dashed"' + (t.dashed ? ' checked' : '') + '> Dashed</label>';
    } else {
      if (t.type !== 'image') {
        html += field(t.type === 'frame' ? 'Title' : 'Text', t.type === 'frame'
          ? '<input data-k="text" value="' + esc(t.text || '') + '">'
          : '<textarea data-k="text" rows="5">' + esc(t.text || '') + '</textarea>');
        if (t.type !== 'frame') html += '<p class="be-hint">**bold** · start a line with "- " for a bullet</p>';
      }
      if (t.type === 'sticky' || t.type === 'shape') {
        html += '<div class="be-field"><span>Colour</span><div class="be-swatches">' + window.Board.COLORS.map(function (c) {
          return '<button type="button" class="be-swatch c-' + c + (t.color === c ? ' is-on' : '') + '" data-color="' + c + '" aria-label="' + c + '"></button>';
        }).join('') + '</div></div>';
      }
      if (t.type === 'shape') {
        html += field('Shape', '<select data-k="shape">' + ['rect', 'round', 'ellipse', 'diamond'].map(function (s) {
          return '<option' + ((t.shape || 'rect') === s ? ' selected' : '') + '>' + s + '</option>';
        }).join('') + '</select>');
      }
      if (t.type === 'text') {
        html += field('Size', '<select data-k="size">' + ['h1', 'h2', 'body', 'small'].map(function (s) {
          return '<option' + ((t.size || 'body') === s ? ' selected' : '') + '>' + s + '</option>';
        }).join('') + '</select>');
      }
      if (t.type === 'image') {
        html += field('Image URL', '<input data-k="src" placeholder="/media/…" value="' + esc(t.src || '') + '">');
        html += field('Caption', '<input data-k="caption" value="' + esc(t.caption || '') + '">');
      }
    }
    html += '<div class="be-row">' + (isEdge ? '' : '<button type="button" class="btn" data-do="dup">Duplicate</button>') +
      '<button type="button" class="btn" data-do="del">Delete</button></div>';
    panel.innerHTML = html;
    panel.hidden = false;
  };
  panel.addEventListener('input', function (ev) {
    var k = ev.target.getAttribute('data-k');
    if (!k || !board.sel) return;
    var patch = {};
    patch[k] = ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value;
    // Text fields are typed into; selects and checkboxes are single choices.
    var typed = ev.target.tagName === 'TEXTAREA' || (ev.target.tagName === 'INPUT' && ev.target.type !== 'checkbox');
    board.update(board.sel, patch, typed);
  });
  panel.addEventListener('click', function (ev) {
    var sw = ev.target.closest('[data-color]');
    if (sw && board.sel) {
      board.update(board.sel, { color: sw.getAttribute('data-color') });
      inspect(board.node(board.sel));
      return;
    }
    var act = ev.target.closest('[data-do]');
    if (!act || !board.sel) return;
    if (act.getAttribute('data-do') === 'del') board.remove(board.sel);
    if (act.getAttribute('data-do') === 'dup') duplicate();
  });
  var duplicate = function () {
    var n = board.node(board.sel);
    if (!n) return;
    var copy = JSON.parse(JSON.stringify(n));
    delete copy.id;
    copy.x += 24; copy.y += 24;
    board.add(copy);
  };

  /* ── History ────────────────────────────────────────────────────────── */
  var undo = function () {
    commit();                      // fold in any typing still pending first
    if (history.length < 2) return;
    future.push(history.pop());
    board.setData(JSON.parse(history[history.length - 1]), true);
    inspect(null);
    status('Undone');
  };
  var redo = function () {
    if (!future.length) return;
    var s = future.pop();
    history.push(s);
    board.setData(JSON.parse(s), true);
    inspect(null);
    status('Redone');
  };
  $('be-undo').addEventListener('click', undo);
  $('be-redo').addEventListener('click', redo);

  /* ── Out: save, download, copy ──────────────────────────────────────── */
  var pretty = function () { return JSON.stringify(board.data, null, 2) + '\n'; };
  var download = function () {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([pretty()], { type: 'application/json' }));
    a.download = boardId + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    status('Downloaded ' + boardId + '.json — put it in content/boards/');
  };
  $('be-save').addEventListener('click', function () {
    if (!canSave) { download(); return; }
    fetch('/__board/' + boardId, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: pretty() })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); })
      .then(function () {
        try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
        status('Saved to content/boards/' + boardId + '.json');
      })
      .catch(function (e) { status('Save failed (' + e.message + ') — use Download'); });
  });
  $('be-download').addEventListener('click', download);
  $('be-copy').addEventListener('click', function () {
    if (navigator.clipboard) navigator.clipboard.writeText(pretty()).then(function () { status('JSON copied'); });
  });

  /* ── Keys ───────────────────────────────────────────────────────────── */
  var KEYS = { v: 'select', n: 'sticky', r: 'shape', t: 'text', f: 'frame', i: 'image' };
  document.addEventListener('keydown', function (ev) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '');
    var mod = ev.metaKey || ev.ctrlKey;
    if (mod && ev.key.toLowerCase() === 'z') { if (typing) return; ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); return; }
    if (mod && ev.key.toLowerCase() === 'd') { ev.preventDefault(); duplicate(); return; }
    if (mod && ev.key.toLowerCase() === 's') { ev.preventDefault(); $('be-save').click(); return; }
    if (typing) return;
    if ((ev.key === 'Backspace' || ev.key === 'Delete') && board.sel) { ev.preventDefault(); board.remove(board.sel); return; }
    if (ev.key === 'Escape') { setTool('select'); board.select(null); return; }
    if (!mod && KEYS[ev.key.toLowerCase()]) setTool(KEYS[ev.key.toLowerCase()]);
  });

  /* ── Load ───────────────────────────────────────────────────────────── */
  $('be-id').textContent = boardId;
  fetch('/__board/ping').then(function (r) { canSave = r.ok; }).catch(function () {}).then(function () {
    $('be-save').title = canSave ? 'Save into content/boards/' + boardId + '.json' : 'Not served by `npm run board` — saves as a download';
  });
  fetch('/content/boards/' + boardId + '.json', { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : { nodes: [], edges: [] }; })
    .catch(function () { return { nodes: [], edges: [] }; })
    .then(function (data) {
      board.setData(data);
      history = [snapshot()];
      var draft = null;
      try { draft = localStorage.getItem(DRAFT_KEY); } catch (e) {}
      if (draft && draft !== history[0]) {
        var bar = $('be-draft');
        bar.hidden = false;
        bar.querySelector('[data-draft="restore"]').onclick = function () {
          board.setData(JSON.parse(draft));
          history.push(draft);
          bar.hidden = true;
          status('Draft restored — not saved yet');
        };
        bar.querySelector('[data-draft="discard"]').onclick = function () {
          try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
          bar.hidden = true;
        };
      }
      status(data.nodes && data.nodes.length ? 'Opened ' + boardId : 'New board');
    });
})();
