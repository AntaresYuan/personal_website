/* ════════════════════════════════════════════════════════════════════════
   work.js — behaviour for the Work home page (index.html).

   Standalone and dependency-free. Personal keeps scripts/render.js; nothing
   here runs there. Sections, in page order:

     scroll edge · glass glare · space switch · appearance · rail ·
     usage chart · projects carousel · ask · glass refraction
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var $ = function (id) { return doc.getElementById(id); };
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var phone = window.matchMedia('(max-width: 760px)');

  var escape = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var timeout = function (ms) {
    return (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(ms) : undefined;
  };

  /* ── Scroll edge ──────────────────────────────────────────────────────
     The fade under the top controls only appears once something is actually
     passing beneath them. */
  var scrollTick = false;
  var onScroll = function () {
    if (scrollTick) return;
    scrollTick = true;
    requestAnimationFrame(function () {
      scrollTick = false;
      root.classList.toggle('is-scrolled', window.scrollY > 4);
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ── Glass glare ──────────────────────────────────────────────────────
     A highlight that follows the pointer across any glass surface, so the
     material reads as lit rather than painted. */
  doc.addEventListener('pointermove', function (ev) {
    var g = ev.target.closest && ev.target.closest('.glass');
    if (!g) return;
    var r = g.getBoundingClientRect();
    g.style.setProperty('--mx', (ev.clientX - r.left) + 'px');
    g.style.setProperty('--my', (ev.clientY - r.top) + 'px');
  }, { passive: true });

  /* ── Space switch ─────────────────────────────────────────────────────
     A segmented control whose knob slides to the chosen space before the
     page changes, so the switch is felt rather than just clicked. */
  var spaceSwitch = $('space-switch');
  if (spaceSwitch) {
    var thumb = spaceSwitch.querySelector('.space-thumb');
    var opts = [].slice.call(spaceSwitch.querySelectorAll('.space-opt'));
    var placeThumb = function (el) {
      if (!thumb || !el) return;
      spaceSwitch.style.setProperty('--thumb-x', el.offsetLeft + 'px');
      spaceSwitch.style.setProperty('--thumb-w', el.offsetWidth + 'px');
    };
    var activeOpt = function () { return spaceSwitch.querySelector('.space-opt.is-active') || opts[0]; };
    placeThumb(activeOpt());
    // Webfonts can change the label widths after first measure.
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { placeThumb(activeOpt()); });
    requestAnimationFrame(function () { spaceSwitch.classList.add('is-ready'); });
    try { localStorage.setItem('antares.space', 'work'); } catch (e) {}

    opts.forEach(function (opt) {
      opt.addEventListener('click', function (ev) {
        if (opt.classList.contains('is-active')) { ev.preventDefault(); return; }
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button === 1) return;   // new tab: let it go
        ev.preventDefault();
        opts.forEach(function (o) { o.classList.toggle('is-active', o === opt); });
        placeThumb(opt);
        var href = opt.getAttribute('href');
        setTimeout(function () { location.href = href; }, reduceMotion.matches ? 0 : 260);
      });
    });
    window.addEventListener('resize', function () { placeThumb(activeOpt()); });
  }

  /* ── Appearance ───────────────────────────────────────────────────────
     Auto / light / dark, stored under the same key Personal uses so the
     choice follows the visitor between spaces. The button morphs into the
     three options and back. */
  var themeSwitch = $('theme-switch');
  var sysDark = window.matchMedia('(prefers-color-scheme: dark)');
  var storedMode = function () {
    try { var t = localStorage.getItem('theme'); return (t === 'light' || t === 'dark') ? t : 'auto'; }
    catch (e) { return 'auto'; }
  };
  var applyMode = function (m) {
    root.setAttribute('data-theme-mode', m);
    root.setAttribute('data-theme', (m === 'dark' || (m === 'auto' && sysDark.matches)) ? 'dark' : 'light');
    if (themeSwitch) {
      themeSwitch.querySelectorAll('[data-mode]').forEach(function (b) {
        b.setAttribute('aria-checked', String(b.getAttribute('data-mode') === m));
      });
    }
  };
  applyMode(storedMode());
  var onSys = function () { if (storedMode() === 'auto') applyMode('auto'); };
  if (sysDark.addEventListener) sysDark.addEventListener('change', onSys);

  if (themeSwitch) {
    var current = $('theme-current');
    var setThemeOpen = function (open) {
      themeSwitch.classList.toggle('is-open', open);
      current.setAttribute('aria-expanded', String(open));
      if (open) {
        var checked = themeSwitch.querySelector('[data-mode][aria-checked="true"]');
        setTimeout(function () { (checked || current).focus({ preventScroll: true }); }, 60);
      }
    };
    current.addEventListener('click', function (ev) { ev.stopPropagation(); setThemeOpen(true); });
    themeSwitch.querySelectorAll('[data-mode]').forEach(function (b) {
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var m = b.getAttribute('data-mode');
        try { if (m === 'auto') localStorage.removeItem('theme'); else localStorage.setItem('theme', m); } catch (e) {}
        applyMode(m);
        setThemeOpen(false);
        current.focus({ preventScroll: true });
      });
    });
    doc.addEventListener('click', function (ev) {
      if (themeSwitch.classList.contains('is-open') && !themeSwitch.contains(ev.target)) setThemeOpen(false);
    });
    themeSwitch.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && themeSwitch.classList.contains('is-open')) { setThemeOpen(false); current.focus(); }
    });
  }

  /* ── Rail ─────────────────────────────────────────────────────────────
     The selection lozenge rests on the current page and glides to whatever
     the pointer or keyboard is on. Items without a page yet ("soon") give a
     small shake instead of navigating. */
  var rail = $('rail');
  if (rail) {
    var items = [].slice.call(rail.querySelectorAll('.rail-item'));
    var active = rail.querySelector('.rail-item.is-active');
    var moveBlob = function (el) {
      if (!el) return;
      rail.style.setProperty('--blob-x', el.offsetLeft + 'px');
      rail.style.setProperty('--blob-y', el.offsetTop + 'px');
    };
    var rest = function () { moveBlob(active); };
    if (active) {
      rest();
      requestAnimationFrame(function () { rail.classList.add('is-ready'); });
    }
    items.forEach(function (el) {
      el.addEventListener('pointerenter', function () { moveBlob(el); });
      el.addEventListener('focus', function () { moveBlob(el); });
      el.addEventListener('blur', rest);
      if (el.classList.contains('is-soon')) {
        var nudge = function () {
          if (reduceMotion.matches || !el.animate) return;
          el.animate([
            { transform: 'translateX(0)' }, { transform: 'translateX(-3px)' },
            { transform: 'translateX(3px)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(0)' },
          ], { duration: 320, easing: 'ease-out' });
        };
        el.addEventListener('click', nudge);
        el.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); nudge(); } });
      }
    });
    rail.addEventListener('pointerleave', rest);
    var relayout = function () { requestAnimationFrame(rest); };
    window.addEventListener('resize', relayout);
    if (phone.addEventListener) phone.addEventListener('change', relayout);
  }

  /* ── Usage chart ──────────────────────────────────────────────────────
     Two numbers and four weeks of daily bars, drawn from the usage Worker.
     The Worker's GET is the public daily total (see workers/usage/README.md);
     a failed fetch hides the column rather than showing a broken widget. */
  var usage = $('usage');
  var chartEl = $('usage-chart');
  var BARS = 28;
  var CHART_H = 118;

  var fmtCompact = function (n) {
    if (!isFinite(n) || n <= 0) return '0';
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(Math.round(n));
  };
  /* Headline basis, same as Personal's dashboard: totalTokens (all five
     categories, cache included) where the row has it, else the older
     input+output figure — rows from the v1 sync agent carry only that. */
  var dayTokens = function (d) {
    var t = Number(d && d.totalTokens);
    if (isFinite(t) && t > 0) return t;
    var b = Number(d && d.tokens);
    return isFinite(b) ? b : 0;
  };
  var AGENT_NAMES = { claude: 'Claude Code', 'claude-code': 'Claude Code', codex: 'Codex', cursor: 'Cursor', gemini: 'Gemini CLI', opencode: 'OpenCode' };
  var agentName = function (k) {
    var key = String(k || '').toLowerCase();
    return AGENT_NAMES[key] || (key.charAt(0).toUpperCase() + key.slice(1));
  };
  var dayLabel = function (iso, opts) {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', Object.assign({ timeZone: 'UTC' }, opts));
  };
  var ago = function (iso) {
    var t = Date.parse(iso || '');
    if (!isFinite(t)) return '';
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return 'updated just now';
    if (s < 3600) return 'updated ' + Math.round(s / 60) + 'm ago';
    if (s < 86400) return 'updated ' + Math.round(s / 3600) + 'h ago';
    return 'updated ' + Math.round(s / 86400) + 'd ago';
  };

  var series = null;      // [{date, v}] — the last BARS days
  var drawChart = function () {
    if (!chartEl) return;
    var W = Math.max(200, Math.round(chartEl.clientWidth || 320));
    var top = 16, bottom = 18, H = CHART_H;
    var plotH = H - top - bottom;
    var slot = W / BARS;
    var barW = Math.max(3, Math.min(14, slot * 0.6));
    var data = series || Array.from({ length: BARS }, function (_, i) { return { date: '', v: 0.25 + 0.5 * Math.abs(Math.sin(i * 1.7)) }; });
    var max = Math.max.apply(null, data.map(function (d) { return d.v; })) || 1;
    var nonzero = data.filter(function (d) { return d.v > 0; });
    var avg = nonzero.length ? nonzero.reduce(function (a, d) { return a + d.v; }, 0) / nonzero.length : 0;

    var out = [];
    out.push('<line class="grid" x1="0" x2="' + W + '" y1="' + (top + plotH + 0.5) + '" y2="' + (top + plotH + 0.5) + '"/>');
    data.forEach(function (d, i) {
      var h = d.v > 0 ? Math.max(3, (d.v / max) * plotH) : 3;
      var x = i * slot + (slot - barW) / 2;
      var y = top + plotH - h;
      var cls = 'bar' + (d.v <= 0 ? ' is-empty' : '') + (series && i === data.length - 1 ? ' is-today' : '');
      out.push('<rect class="' + cls + '" data-i="' + i + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) +
        '" width="' + barW.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="' + Math.min(3, barW / 2).toFixed(1) + '"/>');
    });
    if (series && avg > 0) {
      var ay = top + plotH - (avg / max) * plotH;
      out.push('<line class="avg" x1="0" x2="' + W + '" y1="' + ay.toFixed(1) + '" y2="' + ay.toFixed(1) + '"/>');
      out.push('<text class="avg-label" x="' + W + '" y="' + (ay - 5).toFixed(1) + '" text-anchor="end">avg ' + fmtCompact(avg) + '</text>');
    }
    if (series) {
      [0, 7, 14, 21].forEach(function (i) {
        if (!data[i] || !data[i].date) return;
        out.push('<text class="axis" x="' + (i * slot + slot / 2 - barW / 2).toFixed(1) + '" y="' + (H - 3) + '">' +
          escape(dayLabel(data[i].date, { month: 'short', day: 'numeric' })) + '</text>');
      });
      out.push('<text class="axis" x="' + W + '" y="' + (H - 3) + '" text-anchor="end">Today</text>');
    }
    chartEl.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" aria-hidden="true">' + out.join('') + '</svg>';
    chartEl.classList.toggle('is-skeleton', !series);
  };

  if (usage && !usage.hidden && chartEl) {
    drawChart();
    var tip = null;
    var hideTip = function () {
      if (tip) { tip.remove(); tip = null; }
      chartEl.querySelectorAll('.bar.is-hover').forEach(function (b) { b.classList.remove('is-hover'); });
    };
    chartEl.addEventListener('pointermove', function (ev) {
      if (!series) return;
      var r = chartEl.getBoundingClientRect();
      var i = Math.min(BARS - 1, Math.max(0, Math.floor(((ev.clientX - r.left) / r.width) * BARS)));
      var d = series[i];
      var bar = chartEl.querySelector('.bar[data-i="' + i + '"]');
      if (!d || !bar) return;
      chartEl.querySelectorAll('.bar.is-hover').forEach(function (b) { if (b !== bar) b.classList.remove('is-hover'); });
      bar.classList.add('is-hover');
      if (!tip) { tip = doc.createElement('div'); tip.className = 'chart-tip'; chartEl.appendChild(tip); }
      tip.innerHTML = escape(d.v > 0 ? fmtCompact(d.v) + ' tokens' : 'No activity') +
        '<span>' + escape(dayLabel(d.date, { weekday: 'short', month: 'short', day: 'numeric' })) + '</span>';
      var br = bar.getBoundingClientRect();
      tip.style.left = Math.min(r.width - 40, Math.max(40, br.left - r.left + br.width / 2)) + 'px';
      tip.style.top = (br.top - r.top) + 'px';
    });
    chartEl.addEventListener('pointerleave', hideTip);

    if (window.ResizeObserver) {
      var lastW = 0;
      new ResizeObserver(function () {
        var w = chartEl.clientWidth;
        if (Math.abs(w - lastW) < 1) return;
        lastW = w;
        hideTip();
        drawChart();
      }).observe(chartEl);
    }

    var fetchedAt = 0;
    /* The endpoint is baked into the page, but site.json wins when it can be
       read: ops/preview.js rewrites it on the fly to point at a local Worker,
       and a baked-only value would send `npm run preview` to production. */
    var endpoint = function () {
      var baked = usage.getAttribute('data-endpoint') || '';
      return fetch('/content/site.json', { signal: timeout(4000) })
        .then(function (r) { return r.json(); })
        .then(function (site) { return (site && site.usage && site.usage.endpoint) || baked; })
        .catch(function () { return baked; });
    };
    var loadUsage = function () {
      fetchedAt = Date.now();
      endpoint().then(function (raw) {
        var ep = String(raw || '').replace(/\/+$/, '');
        if (!ep) throw new Error('no endpoint');
        return fetch(ep + '/', { cache: 'no-store', signal: timeout(8000) });
      })
        .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
        .then(function (data) {
          var days = (data && Array.isArray(data.days) ? data.days : []).filter(function (d) { return d && d.date; })
            .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
          if (!days.length) throw new Error('no days');

          var total = days.reduce(function (a, d) { return a + dayTokens(d); }, 0);
          /* First day with activity, not data.since: the Worker's `since` is
             the start of its 365-day window, which predates any tracking. */
          var first = days.filter(function (d) { return dayTokens(d) > 0; })[0];
          var since = first && first.date;
          $('kpi-total').innerHTML = escape(fmtCompact(total)) +
            (since ? '<small>since ' + escape(dayLabel(String(since).slice(0, 10), { month: 'long', year: 'numeric' })) + '</small>' : '');

          // Top agent across the whole window, when the Worker publishes the split.
          var bySource = {};
          days.forEach(function (d) {
            var m = d.bySource;
            if (!m || typeof m !== 'object') return;
            Object.keys(m).forEach(function (k) {
              var v = m[k] && isFinite(m[k].totalTokens) ? m[k].totalTokens : 0;
              if (v > 0) bySource[k] = (bySource[k] || 0) + v;
            });
          });
          var ranked = Object.keys(bySource).sort(function (a, b) { return bySource[b] - bySource[a]; });
          var kpiAgent = $('kpi-agent');
          if (ranked.length) {
            var sum = ranked.reduce(function (a, k) { return a + bySource[k]; }, 0);
            kpiAgent.innerHTML = escape(agentName(ranked[0])) + '<small>' + Math.round((bySource[ranked[0]] / sum) * 100) + '% of all tokens</small>';
          } else {
            kpiAgent.parentElement.hidden = true;
          }

          series = days.slice(-BARS).map(function (d) { return { date: d.date, v: dayTokens(d) }; });
          drawChart();
          var range = $('usage-range');
          if (range && data.updated) range.textContent = ago(data.updated).replace(/^u/, 'U');
        })
        .catch(function (e) {
          // Quietly gone, never broken. Console is for whoever maintains it.
          if (window.console) console.warn('[usage]', e && e.message);
          if (!series) usage.hidden = true;
        });
    };
    loadUsage();
    doc.addEventListener('visibilitychange', function () {
      if (doc.visibilityState === 'visible' && Date.now() - fetchedAt > 10 * 60 * 1000) loadUsage();
    });
  }

  /* ── Projects carousel ────────────────────────────────────────────────
     Native scroll-snap does the scrolling, so trackpads, touch and keyboard
     all work; the arrows and the "1–2 of 5" count just follow it. */
  var track = $('project-track');
  if (track) {
    var prev = $('carousel-prev');
    var next = $('carousel-next');
    var count = $('carousel-count');
    var cards = function () { return track.querySelectorAll('.project-card'); };
    var step = function () {
      var c = cards();
      if (c.length < 2) return c[0] ? c[0].offsetWidth : track.clientWidth;
      return c[1].offsetLeft - c[0].offsetLeft;
    };
    var sync = function () {
      var n = cards().length;
      var s = step() || 1;
      var first = Math.round(track.scrollLeft / s);
      var visible = Math.max(1, Math.floor((track.clientWidth + 8) / s));
      var atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
      if (prev) prev.hidden = track.scrollLeft < 8;
      if (next) next.hidden = atEnd || n <= visible;
      if (count) {
        var a = Math.min(n, first + 1);
        var b = atEnd ? n : Math.min(n, first + visible);
        count.textContent = n ? (a === b ? a : a + '–' + b) + ' of ' + n : '';
      }
    };
    var go = function (dir) {
      var s = step();
      var visible = Math.max(1, Math.floor((track.clientWidth + 8) / s));
      track.scrollBy({ left: dir * s * visible, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    };
    if (prev) prev.addEventListener('click', function () { go(-1); });
    if (next) next.addEventListener('click', function () { go(1); });
    track.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowRight') { ev.preventDefault(); track.scrollBy({ left: step() }); }
      if (ev.key === 'ArrowLeft')  { ev.preventDefault(); track.scrollBy({ left: -step() }); }
    });
    var syncTick = false;
    track.addEventListener('scroll', function () {
      if (syncTick) return;
      syncTick = true;
      requestAnimationFrame(function () { syncTick = false; sync(); });
    }, { passive: true });
    window.addEventListener('resize', sync);
    sync();
  }

  /* ── Avatar mood ──────────────────────────────────────────────────────
     The ask avatar's state, published for whatever draws it — a still image
     today, an animated 3D buddy later. Sets data-mood on #ask-avatar and
     fires `avatar:mood` ({ detail: { mood } }) on it; a timed mood falls back
     to the resting one (listening while the composer is open, else idle).
     Keystrokes fire `avatar:nod`.
     Moods: idle · hello · listening · thinking · talking · happy */
  var avatarEl = $('ask-avatar');
  var avatarTimer = 0;
  var restMood = function () { return $('ask') && $('ask').classList.contains('is-open') ? 'listening' : 'idle'; };
  var setMood = function (m, ms) {
    if (!avatarEl) return;
    clearTimeout(avatarTimer);
    avatarEl.setAttribute('data-mood', m);
    avatarEl.dispatchEvent(new CustomEvent('avatar:mood', { detail: { mood: m } }));
    if (ms) avatarTimer = setTimeout(function () { setMood(restMood()); }, ms);
  };
  var getMood = function () { return avatarEl ? avatarEl.getAttribute('data-mood') : 'idle'; };

  /* ── Ask Antares ──────────────────────────────────────────────────────
     One glass shape with three states: a capsule at rest, a composer with
     suggestions once focused, and a conversation sheet once something is
     asked. Answers come from the qa Worker; the hand-written FAQ
     (scripts/qa-faq.js) answers when the Worker cannot be reached — common
     on mainland-China networks. */
  var ask = $('ask');
  if (ask) {
    var form = $('ask-form');
    var input = $('ask-input');
    var send = $('ask-send');
    var suggest = $('ask-suggest');
    var sheet = $('ask-sheet');
    var log = $('ask-log');
    var qaUrl = (ask.getAttribute('data-qa') || '').trim();
    var convo = [];
    var busy = false;
    var boardCards = null;

    var isOpen = function () { return ask.classList.contains('is-open'); };
    var updateSend = function () { send.disabled = busy || !input.value.trim(); };

    var renderSuggest = function () {
      var faq = (window.QA && Array.isArray(window.QA.FAQ)) ? window.QA.FAQ : [];
      var qs = faq.slice(0, 3).map(function (f) { return f.q; }).filter(Boolean);
      if (!qs.length || convo.length) { suggest.hidden = true; return; }
      suggest.innerHTML = qs.map(function (q) {
        return '<button class="ask-chip" type="button" data-q="' + escape(q) + '">' + escape(q) + '</button>';
      }).join('');
      suggest.hidden = false;
    };

    var renderLog = function (pending) {
      var html = convo.map(function (m) {
        return '<div class="msg msg-' + (m.role === 'user' ? 'you' : 'bot') + '">' + escape(m.content) + '</div>';
      }).join('');
      if (pending) {
        html += '<div class="msg msg-bot"><div class="msg-dots" role="status" aria-label="Thinking"><span></span><span></span><span></span></div></div>';
      }
      log.innerHTML = html;
      log.scrollTop = log.scrollHeight;
    };

    var open = function () {
      if (isOpen()) return;
      ask.classList.add('is-open');
      doc.body.classList.add('ask-open');
      if (convo.length) { sheet.hidden = false; ask.classList.add('is-chat'); renderLog(busy); }
      else renderSuggest();
      updateSend();
      if (!busy) setMood('listening');
    };
    var close = function () {
      ask.classList.remove('is-open', 'is-chat');
      doc.body.classList.remove('ask-open');
      sheet.hidden = true;
      suggest.hidden = true;
      if (doc.activeElement && ask.contains(doc.activeElement)) doc.activeElement.blur();
      if (!busy) setMood('idle');
    };

    var loadCards = function () {
      if (boardCards) return Promise.resolve(boardCards);
      return fetch('/content/board.json').then(function (r) { return r.json(); })
        .then(function (b) { boardCards = (b && b.cards) || []; return boardCards; })
        .catch(function () { boardCards = []; return boardCards; });
    };
    var offlineAnswer = function (q) {
      return loadCards().then(function (cards) {
        var m = (window.QA && typeof window.QA.match === 'function') ? window.QA.match(q, cards) : null;
        try { if (typeof window.SITE_BEACON === 'function') window.SITE_BEACON('qa_ask', m ? 'answered' : 'unanswered'); } catch (e) {}
        var first = convo.filter(function (x) { return x.role === 'assistant'; }).length === 0;
        var note = first ? "\n\n(Quick FAQ answer — the live answer service couldn't be reached from your network. Try again later, or email chenjy4@uw.edu.)" : '';
        return (m ? m.answer : "I don't have that one written down yet — try asking about a project, what I'm working on, or how to reach me.") + note;
      });
    };

    var ask$ = function (raw) {
      var q = String(raw || '').trim().slice(0, 500);
      if (!q || busy) return;
      convo.push({ role: 'user', content: q });
      input.value = '';
      busy = true;
      updateSend();
      suggest.hidden = true;
      sheet.hidden = false;
      ask.classList.add('is-chat');
      renderLog(true);
      setMood('thinking');

      var reply = qaUrl
        ? fetch(qaUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ q: q, messages: convo }),
            signal: timeout(30000),
          }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (d) {
              if (r.ok && d && d.answer) return String(d.answer);
              return offlineAnswer(q);
            });
          }).catch(function () { return offlineAnswer(q); })
        : offlineAnswer(q);

      reply.then(function (answer) {
        convo.push({ role: 'assistant', content: answer });
        busy = false;
        renderLog(false);
        // Talk for roughly as long as the answer takes to skim, then beam.
        var talk = Math.max(1200, Math.min(3600, answer.length * 22));
        setMood('talking');
        setTimeout(function () { if (getMood() === 'talking') setMood('happy', 900); }, talk);
        updateSend();
        if (isOpen()) input.focus({ preventScroll: true });
      });
    };

    input.addEventListener('focus', open);
    input.addEventListener('input', function () {
      updateSend();
      if (!busy && avatarEl) avatarEl.dispatchEvent(new CustomEvent('avatar:nod'));
    });
    // Say hello when the pointer comes over the resting capsule.
    $('ask-shell').addEventListener('pointerenter', function (ev) {
      if (isOpen() || ev.pointerType === 'touch') return;
      setMood('hello', 1100);
    });
    // The collapsed capsule is all one target, not just the text field.
    $('ask-shell').addEventListener('click', function (ev) {
      if (!isOpen() && !ev.target.closest('button[type="submit"]')) input.focus();
    });
    $('ask-avatar').addEventListener('click', function () { input.focus(); });
    form.addEventListener('submit', function (ev) { ev.preventDefault(); ask$(input.value); });
    suggest.addEventListener('click', function (ev) {
      var chip = ev.target.closest('.ask-chip');
      if (chip) ask$(chip.getAttribute('data-q'));
    });
    $('ask-close').addEventListener('click', function (ev) { ev.stopPropagation(); close(); });
    $('ask-new').addEventListener('click', function () {
      if (busy) return;
      convo = [];
      sheet.hidden = true;
      ask.classList.remove('is-chat');
      renderSuggest();
      input.focus();
    });
    // Clicking away folds it back down; the conversation is kept and comes
    // back the next time the composer opens.
    doc.addEventListener('pointerdown', function (ev) {
      if (isOpen() && !ask.contains(ev.target)) close();
    });
    doc.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && isOpen()) { close(); return; }
      // "/" jumps to the composer, as on most search-first sites.
      if (ev.key === '/' && !isOpen() && !/^(INPUT|TEXTAREA|SELECT)$/.test((doc.activeElement || {}).tagName || '')) {
        ev.preventDefault();
        input.focus();
      }
    });
  }

  /* ── Glass refraction ─────────────────────────────────────────────────
     The part that makes it Liquid Glass rather than frosted glass: content
     behind a control bends at its rounded edge, as through a thick lens.
     Done with an SVG displacement map fed to backdrop-filter, which only
     Chromium renders; Safari and Firefox keep the blur-and-rim material,
     which is the intended fallback rather than a broken state. Each map is
     drawn for the element's current size and redrawn when it changes (the
     ask capsule animates its width). */
  var chromium = !!(navigator.userAgentData && navigator.userAgentData.brands &&
    navigator.userAgentData.brands.some(function (b) { return /Chromium/.test(b.brand); }));
  var noGlass = window.matchMedia('(prefers-reduced-transparency: reduce)');
  var defs = $('glass-defs');
  if (chromium && defs && !noGlass.matches && window.ResizeObserver) {
    var SVGNS = 'http://www.w3.org/2000/svg';

    // Signed distance from a pixel to the edge of a rounded rectangle,
    // negative inside. Gives both how deep we are and which way is out.
    var lensMap = function (w, h, r, band) {
      var canvas = doc.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');
      var img = ctx.createImageData(w, h);
      var px = img.data;
      var hw = w / 2, hh = h / 2;
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var cx = x + 0.5 - hw, cy = y + 0.5 - hh;
          var qx = Math.abs(cx) - (hw - r), qy = Math.abs(cy) - (hh - r);
          var ox = Math.max(qx, 0), oy = Math.max(qy, 0);
          var dist = Math.min(Math.max(qx, qy), 0) + Math.sqrt(ox * ox + oy * oy) - r;
          var depth = -dist;
          var dx = 0, dy = 0;
          if (depth >= 0 && depth < band) {
            var nx, ny;
            if (qx > 0 && qy > 0) { var l = Math.sqrt(qx * qx + qy * qy) || 1; nx = qx / l; ny = qy / l; }
            else if (qx > qy) { nx = 1; ny = 0; } else { nx = 0; ny = 1; }
            nx *= cx < 0 ? -1 : 1;
            ny *= cy < 0 ? -1 : 1;
            var t = 1 - depth / band;
            var m = t * t;
            dx = -nx * m; dy = -ny * m;            // sample toward the centre: the rim magnifies
          }
          var i = (y * w + x) * 4;
          px[i] = 128 + dx * 127;
          px[i + 1] = 128 + dy * 127;
          px[i + 2] = 128;
          px[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return canvas.toDataURL();
    };

    var n = 0;
    var lens = function (el) {
      var id = 'lens-' + (++n);
      var filter = doc.createElementNS(SVGNS, 'filter');
      filter.setAttribute('id', id);
      filter.setAttribute('filterUnits', 'userSpaceOnUse');
      filter.setAttribute('primitiveUnits', 'userSpaceOnUse');
      filter.setAttribute('color-interpolation-filters', 'sRGB');
      var feImage = doc.createElementNS(SVGNS, 'feImage');
      feImage.setAttribute('result', 'map');
      feImage.setAttribute('preserveAspectRatio', 'none');
      var feDisp = doc.createElementNS(SVGNS, 'feDisplacementMap');
      feDisp.setAttribute('in', 'SourceGraphic');
      feDisp.setAttribute('in2', 'map');
      feDisp.setAttribute('xChannelSelector', 'R');
      feDisp.setAttribute('yChannelSelector', 'G');
      filter.appendChild(feImage);
      filter.appendChild(feDisp);
      defs.appendChild(filter);

      var lastKey = '';
      var paint = function () {
        var w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
        if (!w || !h) return;
        var r = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, w / 2, h / 2);
        var key = w + 'x' + h + 'r' + r;
        if (key === lastKey) return;
        lastKey = key;
        var band = Math.max(8, Math.min(r * 0.9, 26));
        ['x', 'y'].forEach(function (a) { filter.setAttribute(a, '0'); feImage.setAttribute(a, '0'); });
        filter.setAttribute('width', w); filter.setAttribute('height', h);
        feImage.setAttribute('width', w); feImage.setAttribute('height', h);
        feImage.setAttribute('href', lensMap(w, h, r, band));
        feDisp.setAttribute('scale', String(Math.round(band * 1.4)));
        el.classList.add('has-lens');
        el.style.setProperty('--lens', 'url(#' + id + ')');
      };
      var queued = false;
      new ResizeObserver(function () {
        if (queued) return;
        queued = true;
        requestAnimationFrame(function () { queued = false; paint(); });
      }).observe(el);
      paint();
    };
    doc.querySelectorAll('[data-lens]').forEach(lens);
    root.classList.add('has-refraction');
  }
})();
