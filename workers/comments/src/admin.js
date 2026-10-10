/* The owner's moderation page, served by the Worker at /admin (+ /admin.js,
   so the CSP can forbid inline script). The page itself is public; every
   call it makes needs the ADMIN_TOKEN, which it keeps in localStorage on the
   owner's device. Comment text is only ever set with textContent. */

export const ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Comments · admin</title>
<style>
  :root { color-scheme: light dark; --bg: #f5f5f7; --card: #fff; --text: #1d1d1f; --muted: #6e6e73; --line: rgba(0,0,0,.08); --accent: #2347d9; --warn: #b25000; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0a0a0c; --card: #1c1c1e; --text: #f5f5f7; --muted: #8e8e93; --line: rgba(255,255,255,.1); --accent: #7b93ff; --warn: #ffb15c; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", sans-serif; }
  main { max-width: 820px; margin: 0 auto; padding: 32px 16px 80px; }
  h1 { font-size: 26px; letter-spacing: -.02em; margin: 0 0 18px; }
  .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 18px; }
  button, input, textarea { font: inherit; color: inherit; }
  button { border: 1px solid var(--line); background: var(--card); border-radius: 999px; padding: 6px 14px; cursor: pointer; }
  button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.danger { color: #d70015; }
  input, textarea { width: 100%; border: 1px solid var(--line); background: var(--card); border-radius: 12px; padding: 8px 12px; }
  textarea { min-height: 72px; resize: vertical; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 16px 18px; margin-bottom: 12px; }
  .meta { color: var(--muted); font-size: 13px; display: flex; flex-wrap: wrap; gap: 4px 12px; }
  .meta a { color: var(--accent); }
  .who { font-weight: 650; color: var(--text); }
  .held { color: var(--warn); }
  .body { white-space: pre-wrap; overflow-wrap: anywhere; margin: 8px 0 12px; }
  .acts { display: flex; flex-wrap: wrap; gap: 8px; }
  .reply { margin-top: 10px; display: grid; gap: 8px; }
  .empty, .note { color: var(--muted); }
  #login { display: grid; gap: 10px; max-width: 420px; }
</style>
</head>
<body>
<main>
  <h1>Comments</h1>
  <form id="login" hidden>
    <label for="token">Admin token</label>
    <input id="token" type="password" autocomplete="current-password" required>
    <button type="submit">Open</button>
    <p class="note">The ADMIN_TOKEN secret of the Worker. It stays in this browser.</p>
  </form>
  <div id="app" hidden>
    <div class="bar" role="group" aria-label="Show">
      <button type="button" data-status="pending" aria-pressed="true">Held</button>
      <button type="button" data-status="published" aria-pressed="false">Published</button>
      <button type="button" data-status="all" aria-pressed="false">All</button>
      <span style="flex:1"></span>
      <button type="button" id="logout">Sign out</button>
    </div>
    <div id="list" aria-live="polite"></div>
  </div>
</main>
<script src="/admin.js" defer></script>
</body>
</html>`;

export const ADMIN_JS = `(function () {
  'use strict';
  var KEY = 'comments-admin-token';
  var token = '';
  try { token = localStorage.getItem(KEY) || ''; } catch (e) {}
  var status = 'pending';
  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  var api = function (path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, opts.headers || {});
    return fetch(path, opts).then(function (r) {
      if (r.status === 401) { signOut(); throw new Error('unauthorized'); }
      return r.json();
    });
  };

  var show = function () {
    $('login').hidden = !!token;
    $('app').hidden = !token;
    if (token) load();
  };
  var signOut = function () { token = ''; try { localStorage.removeItem(KEY); } catch (e) {} show(); };

  var load = function () {
    var list = $('list');
    list.textContent = 'Loading…';
    api('/v1/admin/comments?status=' + status).then(function (d) {
      list.textContent = '';
      if (!d.comments || !d.comments.length) { list.appendChild(el('p', 'empty', status === 'pending' ? 'Nothing held for review.' : 'No comments.')); return; }
      d.comments.forEach(function (c) { list.appendChild(card(c)); });
    }).catch(function (e) { if (e.message !== 'unauthorized') list.textContent = 'Could not load: ' + e.message; });
  };

  var act = function (id, action) {
    if (action === 'delete' && !confirm('Delete this comment and its replies?')) return;
    api('/v1/admin/comments/' + id, { method: 'POST', body: JSON.stringify({ action: action }) }).then(load);
  };

  var card = function (c) {
    var box = el('article', 'card');
    var meta = el('div', 'meta');
    meta.appendChild(el('span', 'who', c.name + (c.owner ? ' (you)' : '')));
    var link = el('a', '', c.page); link.href = 'https://antaresyuan.site' + c.page + '#c-' + c.id; link.target = '_blank'; link.rel = 'noopener';
    meta.appendChild(link);
    meta.appendChild(el('span', '', new Date(c.created_at).toLocaleString()));
    if (c.email) meta.appendChild(el('span', '', c.email));
    if (c.parent) meta.appendChild(el('span', '', 'reply'));
    if (c.status === 'pending') meta.appendChild(el('span', 'held', 'held' + (c.moderation ? ': ' + c.moderation : '')));
    box.appendChild(meta);
    box.appendChild(el('div', 'body', c.body));

    var acts = el('div', 'acts');
    var btn = function (label, fn, cls) { var b = el('button', cls || '', label); b.type = 'button'; b.addEventListener('click', fn); acts.appendChild(b); };
    if (c.status === 'pending') btn('Approve', function () { act(c.id, 'approve'); });
    else btn('Unpublish', function () { act(c.id, 'hide'); });
    btn('Reply', function () { toggleReply(box, c); });
    btn('Delete', function () { act(c.id, 'delete'); }, 'danger');
    box.appendChild(acts);
    return box;
  };

  var toggleReply = function (box, c) {
    var open = box.querySelector('.reply');
    if (open) { open.remove(); return; }
    var form = el('form', 'reply');
    var ta = el('textarea'); ta.required = true; ta.placeholder = 'Reply as the author…';
    var send = el('button', '', 'Post reply'); send.type = 'submit';
    form.appendChild(ta); form.appendChild(send);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      send.disabled = true;
      api('/v1/admin/reply', { method: 'POST', body: JSON.stringify({ parent: c.id, body: ta.value }) })
        .then(function () { if (c.status === 'pending') return act(c.id, 'approve'); load(); })
        .catch(function () { send.disabled = false; });
    });
    box.appendChild(form);
    ta.focus();
  };

  $('login').addEventListener('submit', function (ev) {
    ev.preventDefault();
    token = $('token').value.trim();
    try { localStorage.setItem(KEY, token); } catch (e) {}
    show();
  });
  $('logout').addEventListener('click', signOut);
  document.querySelectorAll('[data-status]').forEach(function (b) {
    b.addEventListener('click', function () {
      status = b.getAttribute('data-status');
      document.querySelectorAll('[data-status]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      load();
    });
  });
  show();
})();
`;
