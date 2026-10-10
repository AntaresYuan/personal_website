/* ════════════════════════════════════════════════════════════════════════
   comments.js — reactions and comments under a Writing post, backed by the
   antares-comments Worker (workers/comments/). Mounts every [data-discuss]
   section: data-endpoint (the Worker), data-page (/blog/<slug>/) and
   data-turnstile (the Turnstile site key).

   Anonymous: a nickname is enough. The browser keeps a random visitor id
   (to remember its own reactions), the name / email it last used, and any of
   its comments still waiting for review — all in localStorage, all optional.
   Turnstile only loads once someone starts writing. Comment text is escaped
   before anything is rendered; links come out as nofollow ugc.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var ICONS = {
    like: '<path d="M7.5 10.6v8.6M7.5 10.6l3.5-6.1a1.6 1.6 0 0 1 2.95 1.15l-.75 3.5h4.45a1.8 1.8 0 0 1 1.76 2.2l-1.3 6a2 2 0 0 1-1.96 1.55H7.5M7.5 10.6H5.2a1 1 0 0 0-1 1v6.6a1 1 0 0 0 1 1h2.3"/>',
    love: '<path d="M12 19.4s-7.1-4.2-7.1-9.3A3.9 3.9 0 0 1 12 7.9a3.9 3.9 0 0 1 7.1 2.2c0 5.1-7.1 9.3-7.1 9.3z"/>',
    insight: '<path d="M9.3 17.4h5.4M10.2 20.4h3.6M12 3.6a5.6 5.6 0 0 0-3.3 10.1c.6.45.95 1.15.95 1.9v.4h4.7v-.4c0-.75.35-1.45.95-1.9A5.6 5.6 0 0 0 12 3.6z"/>',
    fun: '<circle cx="12" cy="12" r="8.2"/><path d="M8.6 13.4a3.9 3.9 0 0 0 6.8 0M9.4 9.7v.1M14.6 9.7v.1"/>',
  };
  var LABELS = { like: 'Like', love: 'Love', insight: 'Insightful', fun: 'Fun' };
  var ERRORS = {
    'verification-failed': 'Couldn’t confirm you’re human — please try again.',
    'slow-down': 'That’s a lot in a row — try again in a few minutes.',
    'name-required': 'Add a name, so people know who’s talking.',
    'name-too-long': 'Keep the name under 40 characters.',
    'name-has-link': 'Names can’t contain links.',
    'bad-email': 'That email doesn’t look right.',
    'body-required': 'Write something first.',
    'body-too-long': 'Keep it under 2,000 characters.',
    'bad-parent': 'That comment can’t be replied to any more.',
  };
  var OWNER_AVATAR = '/media/buddy/felt-still.webp';
  var PENDING_DAYS = 14;

  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  var visitorId = function () {
    var v = store.get('discuss:visitor');
    if (typeof v === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(v)) return v;
    var a = new Uint8Array(18);
    crypto.getRandomValues(a);
    v = Array.prototype.map.call(a, function (b) { return 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'[b % 64]; }).join('');
    store.set('discuss:visitor', v);
    return v;
  };

  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  // Escaped text → paragraphs, line breaks and nofollow links.
  var renderBody = function (text) {
    return esc(text).split(/\n{2,}/).map(function (para) {
      var html = para.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, function (u) {
        return '<a href="' + u + '" rel="nofollow ugc noopener" target="_blank">' + u + '</a>';
      });
      return '<p>' + html.replace(/\n/g, '<br>') + '</p>';
    }).join('');
  };
  var hueOf = function (s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % 360;
  };
  var avatarHtml = function (c) {
    if (c.owner) return '<span class="discuss-avatar is-owner" aria-hidden="true"><img src="' + OWNER_AVATAR + '" alt="" loading="lazy"></span>';
    var first = Array.from(String(c.name || '?').trim())[0] || '?';
    return '<span class="discuss-avatar" style="--h:' + hueOf(c.name || '') + '" aria-hidden="true">' + esc(first.toUpperCase()) + '</span>';
  };
  var rtf = window.Intl && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' }) : null;
  var when = function (ms) {
    var s = (Date.now() - ms) / 1000;
    if (s < 60) return 'just now';
    var steps = [[60, 'minute'], [3600, 'hour'], [86400, 'day']];
    if (rtf && s < 86400 * 30) {
      for (var i = steps.length - 1; i >= 0; i--) if (s >= steps[i][0]) return rtf.format(-Math.floor(s / steps[i][0]), steps[i][1]);
    }
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  /* ── Turnstile, loaded on first use ───────────────────────────────────── */
  var tsReady = null;
  var loadTurnstile = function () {
    if (tsReady) return tsReady;
    tsReady = new Promise(function (resolve, reject) {
      if (window.turnstile) { resolve(window.turnstile); return; }
      window.__discussTurnstile = function () { resolve(window.turnstile); };
      var s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__discussTurnstile';
      s.async = true;
      s.onerror = function () { tsReady = null; reject(new Error('turnstile')); };
      document.head.appendChild(s);
    });
    return tsReady;
  };

  /* ── One discussion ───────────────────────────────────────────────────── */
  function Discuss(root) {
    this.root = root;
    this.endpoint = String(root.getAttribute('data-endpoint') || '').replace(/\/$/, '');
    this.page = root.getAttribute('data-page');
    this.siteKey = root.getAttribute('data-turnstile') || '';
    this.visitor = visitorId();
    this.pendingKey = 'discuss:pending:' + this.page;
    this.data = null;
    var self = this;
    // Delegated once: the section's content is re-rendered after each post.
    root.addEventListener('click', function (ev) {
      var r = ev.target.closest('[data-reply]');
      if (r && root.contains(r)) self.openReply(r);
    });
  }

  Discuss.prototype.api = function (path, body) {
    var opts = { headers: { 'X-Visitor': this.visitor } };
    if (body) { opts.method = 'POST'; opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(this.endpoint + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { d.__status = r.status; return d; });
    });
  };

  Discuss.prototype.load = function () {
    var self = this;
    this.root.setAttribute('aria-busy', 'true');
    this.api('/v1/thread?page=' + encodeURIComponent(this.page)).then(function (d) {
      if (d.__status !== 200) throw new Error(d.error || 'load');
      self.data = d;
      self.render();
    }).catch(function () {
      // A local preview against the live Worker: CORS only admits the site.
      var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && !/\/\/(localhost|127\.0\.0\.1)/.test(self.endpoint);
      self.root.innerHTML = '<h2 class="discuss-title">Comments</h2><p class="discuss-note">' + (local
        ? 'Local preview: the live comment service only answers antaresyuan.site. To try comments here, run the local Worker (workers/comments/README.md).'
        : 'Comments are unavailable right now — please check back later.') + '</p>';
    }).then(function () { self.root.removeAttribute('aria-busy'); });
  };

  // This browser's comments still waiting for review, minus any now public.
  Discuss.prototype.pending = function () {
    var published = {};
    (this.data.comments || []).forEach(function (c) { published[c.id] = true; });
    var cutoff = Date.now() - PENDING_DAYS * 86400000;
    var list = (store.get(this.pendingKey) || []).filter(function (c) { return c && c.id && !published[c.id] && c.at > cutoff; });
    store.set(this.pendingKey, list);
    return list.map(function (c) { c.pending = true; return c; });
  };

  Discuss.prototype.render = function () {
    var d = this.data;
    var kinds = (d.kinds || []).filter(function (k) { return ICONS[k]; });
    var mine = {};
    (d.mine || []).forEach(function (k) { mine[k] = true; });
    var react = kinds.map(function (k) {
      var n = (d.reactions || {})[k] || 0;
      return '<button type="button" class="react-btn" data-kind="' + k + '" aria-pressed="' + !!mine[k] + '" aria-label="' + LABELS[k] + ' (' + n + ')">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[k] + '</svg><span class="react-n">' + n + '</span></button>';
    }).join('');

    var all = (d.comments || []).concat(this.pending());
    var count = (d.comments || []).length;
    this.root.innerHTML =
      (react ? '<div class="react" role="group" aria-label="Reactions">' + react + '</div>' : '') +
      '<h2 class="discuss-title" id="discuss-title">Comments <span class="discuss-count">' + (count || '') + '</span></h2>' +
      this.composerHtml() +
      '<ol class="thread">' + this.threadHtml(all) + '</ol>' +
      (all.length ? '' : '<p class="discuss-empty">No comments yet — start the conversation.</p>');

    this.bind();
    var target = location.hash && /^#c-c_[a-z0-9]{12}$/.test(location.hash) && this.root.querySelector(location.hash);
    if (target) { target.classList.add('is-target'); target.scrollIntoView({ block: 'center' }); }
  };

  Discuss.prototype.threadHtml = function (all) {
    var tops = [], replies = {}, ids = {};
    all.forEach(function (c) { ids[c.id] = true; });
    all.forEach(function (c) {
      if (c.parent && ids[c.parent]) (replies[c.parent] = replies[c.parent] || []).push(c);
      else tops.push(c);
    });
    var self = this;
    return tops.map(function (c) {
      var kids = (replies[c.id] || []).map(function (r) { return '<li>' + self.commentHtml(r, c.id) + '</li>'; }).join('');
      return '<li>' + self.commentHtml(c, c.id) + '<ol class="cmt-replies" data-for="' + c.id + '">' + kids + '</ol></li>';
    }).join('');
  };

  Discuss.prototype.commentHtml = function (c, topId) {
    return '<article class="cmt' + (c.pending ? ' is-pending' : '') + '" id="c-' + esc(c.id) + '">' + avatarHtml(c) +
      '<div class="cmt-main">' +
        '<header class="cmt-head"><span class="cmt-name">' + esc(c.name) + '</span>' +
          (c.owner ? '<span class="cmt-badge">Author</span>' : '') +
          '<time class="cmt-time" datetime="' + new Date(c.at).toISOString() + '">' + when(c.at) + '</time></header>' +
        '<div class="cmt-body">' + renderBody(c.body) + '</div>' +
        (c.pending
          ? '<p class="cmt-pending-note">Waiting for a quick review — only you can see this for now.</p>'
          : '<div class="cmt-actions"><button type="button" class="cmt-reply" data-reply="' + esc(topId) + '" data-name="' + esc(c.name) + '"' + (c.id !== topId ? ' data-mention' : '') + '>Reply</button></div>') +
      '</div></article>';
  };

  Discuss.prototype.composerHtml = function (parent) {
    var me = store.get('discuss:me') || {};
    var notify = this.data && this.data.notify;
    return '<form class="composer' + (parent ? ' is-reply' : '') + '" novalidate' + (parent ? ' data-parent="' + esc(parent) + '"' : '') + '>' +
      '<div class="composer-row">' +
        '<textarea name="body" rows="1" maxlength="2000" placeholder="' + (parent ? 'Write a reply…' : 'Add a comment…') + '" aria-label="' + (parent ? 'Reply' : 'Comment') + '"></textarea>' +
      '</div>' +
      '<div class="composer-more"' + (parent ? '' : ' hidden') + '>' +
        '<div class="composer-fields">' +
          '<input name="name" maxlength="40" autocomplete="nickname" placeholder="Name" aria-label="Name" value="' + esc(me.name || '') + '">' +
          (notify ? '<input name="email" type="email" maxlength="254" autocomplete="email" placeholder="Email for reply notices (optional, never shown)" aria-label="Email (optional)" value="' + esc(me.email || '') + '">' : '') +
        '</div>' +
        '<div class="composer-ts"></div>' +
        '<div class="composer-foot">' +
          '<span class="composer-hint">Be kind. Comments with links wait for a quick review.</span>' +
          '<span class="composer-btns">' + (parent ? '<button type="button" class="btn" data-cancel>Cancel</button>' : '') +
          '<button type="submit" class="btn btn-primary">Post</button></span>' +
        '</div>' +
        '<p class="composer-status" role="status" aria-live="polite"></p>' +
      '</div>' +
    '</form>';
  };

  Discuss.prototype.bind = function () {
    var self = this;
    this.root.querySelectorAll('.react-btn').forEach(function (b) {
      b.addEventListener('click', function () { self.react(b); });
    });
    this.root.querySelectorAll('.composer').forEach(function (f) { self.wireComposer(f); });
  };

  Discuss.prototype.react = function (btn) {
    var self = this, kind = btn.getAttribute('data-kind');
    var on = btn.getAttribute('aria-pressed') !== 'true';
    var n = btn.querySelector('.react-n');
    var before = Number(n.textContent) || 0;
    var paint = function (state, count) {
      btn.setAttribute('aria-pressed', String(state));
      n.textContent = count;
      btn.setAttribute('aria-label', LABELS[kind] + ' (' + count + ')');
    };
    paint(on, Math.max(0, before + (on ? 1 : -1)));
    if (on) { btn.classList.remove('is-pop'); void btn.offsetWidth; btn.classList.add('is-pop'); }
    this.api('/v1/reactions', { page: this.page, kind: kind, on: on }).then(function (d) {
      if (d.__status !== 200) throw new Error(d.error);
      // Keep the model in step: a later re-render (after a post) draws from it.
      self.data.reactions = d.reactions || {};
      self.data.mine = d.mine || [];
      self.root.querySelectorAll('.react-btn').forEach(function (b) {
        var k = b.getAttribute('data-kind');
        var c = (d.reactions || {})[k] || 0;
        b.querySelector('.react-n').textContent = c;
        b.setAttribute('aria-pressed', String((d.mine || []).indexOf(k) >= 0));
        b.setAttribute('aria-label', LABELS[k] + ' (' + c + ')');
      });
    }).catch(function () { paint(!on, before); });
  };

  Discuss.prototype.openReply = function (btn) {
    var top = btn.getAttribute('data-reply');
    var list = this.root.querySelector('.cmt-replies[data-for="' + top + '"]');
    if (!list) return;
    var open = list.parentNode.querySelector(':scope > .composer');
    if (!open) {
      list.insertAdjacentHTML('afterend', this.composerHtml(top));
      open = list.parentNode.querySelector(':scope > .composer');
      this.wireComposer(open);
    }
    var ta = open.querySelector('textarea');
    if (btn.hasAttribute('data-mention') && !ta.value) ta.value = '@' + btn.getAttribute('data-name') + ' ';
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  };

  Discuss.prototype.wireComposer = function (form) {
    var self = this;
    var ta = form.querySelector('textarea');
    var more = form.querySelector('.composer-more');
    var status = form.querySelector('.composer-status');
    var submit = form.querySelector('[type="submit"]');
    var widget = null, token = '';

    var grow = function () { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 320) + 'px'; };
    var say = function (msg, isError) { status.textContent = msg || ''; status.classList.toggle('is-error', !!isError); };
    var expand = function () {
      more.hidden = false;
      if (widget !== null || !self.siteKey) return;
      widget = false;                                // rendering
      loadTurnstile().then(function (ts) {
        widget = ts.render(form.querySelector('.composer-ts'), {
          sitekey: self.siteKey,
          appearance: 'interaction-only',
          theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
          size: 'flexible',
          callback: function (t) { token = t; },
          'expired-callback': function () { token = ''; },
          'error-callback': function () { token = ''; },
        });
      }).catch(function () { widget = null; say('Couldn’t load the human check — is something blocking challenges.cloudflare.com?', true); });
    };

    ta.addEventListener('focus', expand);
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); form.requestSubmit(); }
    });
    var cancel = form.querySelector('[data-cancel]');
    if (cancel) cancel.addEventListener('click', function () { form.remove(); });

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var name = form.elements.name.value.trim();
      var email = form.elements.email ? form.elements.email.value.trim() : '';
      var body = ta.value.trim();
      if (!body) { say(ERRORS['body-required'], true); ta.focus(); return; }
      if (!name) { say(ERRORS['name-required'], true); form.elements.name.focus(); return; }
      if (!token) { say('Checking you’re human — one moment…'); expand(); setTimeout(function () { if (token) form.requestSubmit(); }, 1200); return; }

      submit.disabled = true;
      say('Posting…');
      store.set('discuss:me', { name: name, email: email });
      self.api('/v1/comments', { page: self.page, name: name, email: email, body: body, parent: form.getAttribute('data-parent') || null, token: token })
        .then(function (d) {
          if (d.__status !== 201) throw new Error(d.error || 'post');
          if (d.status === 'pending') {
            var list = store.get(self.pendingKey) || [];
            list.push(d.comment);
            store.set(self.pendingKey, list);
          } else {
            self.data.comments.push(d.comment);
          }
          self.render();
          var el = self.root.querySelector('#c-' + d.comment.id);
          if (el) { el.classList.add('is-target'); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
        })
        .catch(function (e) {
          say(ERRORS[e.message] || (e instanceof TypeError ? 'Couldn’t reach the comments server — check your connection.' : 'Couldn’t post that — please try again.'), true);
          submit.disabled = false;
          token = '';
          if (widget && window.turnstile) window.turnstile.reset(widget);
        });
    });
  };

  /* ── Mount, once each section nears the viewport ─────────────────────── */
  var mount = function (root) {
    if (root.__discuss) return;
    root.__discuss = new Discuss(root);
    root.__discuss.load();
  };
  var roots = document.querySelectorAll('[data-discuss]');
  if (!roots.length) return;
  if ('IntersectionObserver' in window && !/^#c-/.test(location.hash)) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { io.unobserve(en.target); mount(en.target); } });
    }, { rootMargin: '600px 0px' });
    roots.forEach(function (r) { io.observe(r); });
  } else {
    roots.forEach(mount);
  }
})();
