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
  // The page's words (work-shell embeds them as #ui-strings, per language).
  // English is the fallback written here; Chinese comes from content/zh/strings.json.
  var UI = (function () { try { return JSON.parse($('ui-strings').textContent) || {}; } catch (e) { return {}; } })();
  var T = function (key, fallback, vars) {
    var v = key.split('.').reduce(function (o, k) { return o && o[k]; }, UI);
    var s = typeof v === 'string' ? v : fallback;
    return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return k in vars ? String(vars[k]) : m; }) : s;
  };
  var LOCALE = /^zh/i.test(root.lang || '') ? 'zh-CN' : 'en-US';
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
        // Same space: from a sub-page (Writing, Gallery…) "Work" still goes home.
        if (opt.classList.contains('is-active')) {
          if (location.pathname === opt.getAttribute('href')) ev.preventDefault();
          return;
        }
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
  // With no stored choice, follow the visitor's system preference. Explicit
  // light / dark / auto choices still persist across Work and Personal.
  var storedMode = function () {
    try { var t = localStorage.getItem('theme'); return (t === 'light' || t === 'dark' || t === 'auto') ? t : 'auto'; }
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
    current.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (typeof setGlassOpen === 'function') setGlassOpen(false);
      setThemeOpen(true);
    });
    themeSwitch.querySelectorAll('[data-mode]').forEach(function (b) {
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var m = b.getAttribute('data-mode');
        try { localStorage.setItem('theme', m); } catch (e) {}
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

  /* ── Liquid Glass ────────────────────────────────────────────────────
     One material control for every floating surface. More intensity means
     clearer glass, stronger backdrop colour and a brighter refractive rim;
     less intensity settles into a quieter frosted surface. */
  var glassControl = $('glass-control');
  var glassTrigger = $('glass-control-trigger');
  var glassPanel = $('glass-control-panel');
  var glassRange = $('glass-control-range');
  var glassOutput = $('glass-control-output');
  var GLASS_KEY = 'antares.glass';
  var GLASS_DEFAULT = 80;
  var clampGlass = function (value) {
    var n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : GLASS_DEFAULT;
  };
  var storedGlass = function () {
    try {
      var value = localStorage.getItem(GLASS_KEY);
      return value === null ? GLASS_DEFAULT : clampGlass(value);
    } catch (e) { return GLASS_DEFAULT; }
  };
  var mixGlass = function (from, to, amount) { return from + (to - from) * amount; };
  var applyGlass = function (value, persist) {
    value = clampGlass(value);
    var amount = value / 100;
    var set = function (name, n, unit) {
      root.style.setProperty(name, Number(n).toFixed(unit === 'px' ? 1 : 3) + (unit || ''));
    };
    root.setAttribute('data-glass-intensity', String(value));
    set('--glass-bg-alpha', mixGlass(0.58, 0.24, amount));
    set('--glass-clear-alpha', mixGlass(0.44, 0.08, amount));
    set('--glass-typing-alpha', mixGlass(0.82, 0.50, amount));
    set('--glass-strong-alpha', mixGlass(0.97, 0.84, amount));
    set('--glass-blur', mixGlass(8, 24, amount), 'px');
    set('--glass-sat', mixGlass(1.05, 2.25, amount));
    set('--glass-lens-blur', mixGlass(1.8, 0.35, amount), 'px');
    set('--glass-lens-sat', mixGlass(1.1, 2.45, amount));
    set('--glass-lens-bright', mixGlass(1, 1.07, amount));
    set('--glass-rim-opacity', mixGlass(0.52, 1, amount));
    set('--glass-glare-idle', mixGlass(0.18, 0.62, amount));
    set('--glass-glare-hover', mixGlass(0.32, 1, amount));
    if (glassRange) {
      glassRange.value = String(value);
      glassRange.style.setProperty('--glass-range', value + '%');
      glassRange.setAttribute('aria-valuetext', value + '%');
    }
    if (glassOutput) glassOutput.value = value + '%';
    if (persist) {
      try { localStorage.setItem(GLASS_KEY, String(value)); } catch (e) {}
    }
  };
  applyGlass(storedGlass(), false);

  var setGlassOpen = function (open) {
    if (!glassControl || !glassTrigger || !glassPanel) return;
    glassControl.classList.toggle('is-open', open);
    glassTrigger.setAttribute('aria-expanded', String(open));
    glassPanel.hidden = !open;
    if (open && glassRange) setTimeout(function () { glassRange.focus({ preventScroll: true }); }, 40);
  };
  if (glassControl && glassTrigger && glassPanel && glassRange) {
    glassTrigger.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (typeof setThemeOpen === 'function') setThemeOpen(false);
      setGlassOpen(!glassControl.classList.contains('is-open'));
    });
    glassPanel.addEventListener('click', function (ev) { ev.stopPropagation(); });
    glassRange.addEventListener('input', function () { applyGlass(glassRange.value, true); });
    doc.addEventListener('click', function (ev) {
      if (glassControl.classList.contains('is-open') && !glassControl.contains(ev.target)) setGlassOpen(false);
    });
    glassControl.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && glassControl.classList.contains('is-open')) {
        setGlassOpen(false);
        glassTrigger.focus();
      }
    });
    window.addEventListener('storage', function (ev) {
      if (ev.key === GLASS_KEY) applyGlass(ev.newValue === null ? GLASS_DEFAULT : ev.newValue, false);
    });
  }

  /* ── Rail ─────────────────────────────────────────────────────────────
     The selection lozenge marks the current page and stays there while other
     items are hovered or focused. Items without a page yet ("soon") give a
     small shake instead of navigating. */
  var rail = $('rail');
  if (rail) {
    var items = [].slice.call(rail.querySelectorAll('.rail-item'));
    var active = rail.querySelector('.rail-item.is-active');
    var placeBlob = function (el) {
      if (!el) return;
      rail.style.setProperty('--blob-x', el.offsetLeft + 'px');
      rail.style.setProperty('--blob-y', el.offsetTop + 'px');
    };
    if (active) {
      placeBlob(active);
      requestAnimationFrame(function () { rail.classList.add('is-ready'); });
    }
    items.forEach(function (el) {
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
    var relayout = function () { requestAnimationFrame(function () { placeBlob(active); }); };
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
  var CHART_H = 84;

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
    return new Date(iso + 'T00:00:00Z').toLocaleDateString(LOCALE, Object.assign({ timeZone: 'UTC' }, opts));
  };
  var ago = function (iso) {
    var t = Date.parse(iso || '');
    if (!isFinite(t)) return '';
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return T('updated.now', 'updated just now');
    if (s < 3600) return T('updated.m', 'updated {n}m ago', { n: Math.round(s / 60) });
    if (s < 86400) return T('updated.h', 'updated {n}h ago', { n: Math.round(s / 3600) });
    return T('updated.d', 'updated {n}d ago', { n: Math.round(s / 86400) });
  };

  var series = null;      // [{date, v}] — the last BARS days
  var drawChart = function () {
    if (!chartEl) return;
    var W = Math.max(200, Math.round(chartEl.clientWidth || 320));
    var top = 14, bottom = 2, H = CHART_H;     // room for the avg label; no axis row
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
      // Left end: the right end is today, usually the tallest bar of the lot.
      out.push('<text class="avg-label" x="0" y="' + (ay - 5).toFixed(1) + '">' + escape(T('usage.avg', 'avg {n}', { n: fmtCompact(avg) })) + '</text>');
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
      tip.innerHTML = escape(d.v > 0 ? T('usage.tokens', '{n} tokens', { n: fmtCompact(d.v) }) : T('usage.none', 'No activity')) +
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
            (since ? '<small>' + escape(T('usage.since', 'since {date}', { date: dayLabel(String(since).slice(0, 10), { month: 'long', year: 'numeric' }) })) + '</small>' : '');

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
            kpiAgent.innerHTML = escape(agentName(ranked[0])) + '<small>' + escape(T('usage.share', '{pct}% of all tokens', { pct: Math.round((bySource[ranked[0]] / sum) * 100) })) + '</small>';
          } else {
            kpiAgent.parentElement.hidden = true;
          }

          series = days.slice(-BARS).map(function (d) { return { date: d.date, v: dayTokens(d) }; });
          drawChart();
          // Freshness lives in the title link's tooltip.
          var titleLink = usage.querySelector('.col-link');
          if (titleLink && data.updated) titleLink.title = T('usage.allCharts', 'All charts · {ago}', { ago: ago(data.updated) });
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
    // How many cards fit the column. The track itself runs to the window
    // edges, so its own width would overcount.
    var column = track.closest('.projects') || track;
    var perView = function (s) { return Math.max(1, Math.floor((column.clientWidth + 20) / s)); };
    var sync = function () {
      var n = cards().length;
      var s = step() || 1;
      var first = Math.round(track.scrollLeft / s);
      var visible = perView(s);
      var atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
      if (prev) { prev.disabled = track.scrollLeft < 8; prev.hidden = n <= visible; }
      if (next) { next.disabled = atEnd; next.hidden = n <= visible; }
      if (count) {
        var a = Math.min(n, first + 1);
        var b = atEnd ? n : Math.min(n, first + visible);
        count.textContent = n ? T('carousel.count', '{range} of {n}', { range: a === b ? a : a + '–' + b, n: n }) : '';
      }
    };
    var go = function (dir) {
      var s = step();
      track.scrollBy({ left: dir * s * perView(s), behavior: reduceMotion.matches ? 'auto' : 'smooth' });
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

  /* ── Filters ──────────────────────────────────────────────────────────
     Any [data-filter-for="<list id>"] row of [data-filter] buttons filters
     that list's [data-tags] items (pipe-separated, lower-case). Shared by
     Writing, Gallery and AI Skills. */
  doc.querySelectorAll('[data-filter-for]').forEach(function (group) {
    var list = $(group.getAttribute('data-filter-for'));
    if (!list) return;
    group.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-filter]');
      if (!b) return;
      var f = b.getAttribute('data-filter');
      group.querySelectorAll('[data-filter]').forEach(function (x) {
        var on = x === b;
        x.classList.toggle('is-on', on);
        x.setAttribute('aria-pressed', String(on));
      });
      list.querySelectorAll('[data-tags]').forEach(function (item) {
        var tags = (item.getAttribute('data-tags') || '').split('|');
        item.hidden = f !== 'all' && tags.indexOf(f) < 0;
      });
      list.classList.toggle('is-filtered', f !== 'all');
    });
  });

  /* ── Copy and search ──────────────────────────────────────────────────
     [data-copy] buttons copy their value (install commands); a
     [data-search-for="<list id>"] field narrows that list's [data-search]
     items, alongside any active filter chip. */
  doc.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-copy]');
    if (!b) return;
    var text = b.getAttribute('data-copy');
    var done = function () {
      var label = b.querySelector('span');
      var was = label ? label.textContent : '';
      b.classList.add('is-done');
      if (label) label.textContent = T('copied', 'Copied');
      setTimeout(function () { b.classList.remove('is-done'); if (label) label.textContent = was; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
  });
  doc.querySelectorAll('[data-search-for]').forEach(function (field) {
    var list = $(field.getAttribute('data-search-for'));
    if (!list) return;
    var empty = $(list.id + '-empty');
    field.addEventListener('input', function () {
      var q = field.value.trim().toLowerCase();
      var shown = 0;
      list.querySelectorAll('[data-search]').forEach(function (item) {
        var miss = q && item.getAttribute('data-search').indexOf(q) < 0;
        item.classList.toggle('is-searched-out', !!miss);
        if (!miss && !item.hidden) shown++;
      });
      if (empty) empty.hidden = shown > 0;
    });
  });

  /* ── Avatar mood ──────────────────────────────────────────────────────
     The ask avatar's state, published for whatever draws it — a still image
     today, an animated 3D buddy later. Sets data-mood on #ask-avatar and
     fires `avatar:mood` ({ detail: { mood } }) on it; a timed mood falls back
     to the resting one (listening while the composer is open, else idle).
     Keystrokes fire `avatar:nod`.
     Moods: idle · hello · listening · thinking · talking · happy */
  var avatarEl = $('ask-avatar');
  var avatarTimer = 0;
  var restMood = function () {
    var open = ($('ask') && $('ask').classList.contains('is-open')) || ($('ask-panel') && $('ask-panel').classList.contains('is-open'));
    return open ? 'listening' : 'idle';
  };
  var setMood = function (m, ms) {
    if (!avatarEl) return;
    clearTimeout(avatarTimer);
    avatarEl.setAttribute('data-mood', m);
    avatarEl.dispatchEvent(new CustomEvent('avatar:mood', { detail: { mood: m } }));
    if (ms) avatarTimer = setTimeout(function () { setMood(restMood()); }, ms);
  };
  var getMood = function () { return avatarEl ? avatarEl.getAttribute('data-mood') : 'idle'; };

  /* ── Ask Antares ──────────────────────────────────────────────────────
     Two surfaces. The composer docked at the bottom is for asking: a capsule
     at rest, wider once focused, with suggested questions floating above it.
     Answers open in a side panel on the right, which pushes the page aside
     (body.ask-panel-open re-margins the layout) rather than covering what
     the visitor was reading; the avatar moves into the panel's header while
     it is open. Answers come from the qa Worker; the CMS-authored FAQ
     (content/assistant/faqs.json → scripts/qa-faq-data.js) answers when the Worker cannot be reached — common
     on mainland-China networks. */
  var ask = $('ask');
  var panel = $('ask-panel');
  if (ask && panel) {
    var form = $('ask-form');
    var input = $('ask-input');
    var send = $('ask-send');
    var suggest = $('ask-suggest');
    var log = $('ask-log');
    var pForm = $('ask-panel-form');
    var pInput = $('ask-panel-input');
    var pSend = $('ask-panel-send');
    var avatarHome = $('ask-avatar') && $('ask-avatar').parentNode;
    var avatarSlot = $('ask-panel-avatar');
    var sourceEl = $('ask-model-source');
    var qaUrl = (ask.getAttribute('data-qa') || '').trim();
    var historyCache = window.ASK_HISTORY || null;
    var restoredHistory = historyCache ? historyCache.load() : null;
    var convo = restoredHistory ? restoredHistory.messages : [];
    var busy = false;
    var boardCards = null;
    var saveHistory = function () {
      if (historyCache) historyCache.save(convo);
    };
    var clearHistory = function () {
      if (historyCache) historyCache.clear();
    };

    /* The route is decided per answer: the Mac is tried first, then Workers
       AI takes over if it is unavailable. Keep that decision in the panel
       chrome instead of repeating a footnote under every answer. */
    var sourceIcons = {
      idle: '<svg class="ask-source-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="8" r="1.5"/><circle cx="13" cy="8" r="1.5"/><path d="M4.5 8h7"/></svg>',
      pending: '<svg class="ask-source-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.25"/><path d="M8 4.75V8l2.25 1.5"/></svg>',
      local: '<svg class="ask-source-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.25" y="2.5" width="11.5" height="8" rx="1.5"/><path d="M1.5 13h13"/></svg>',
      cloud: '<svg class="ask-source-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.1 12.25h6.2a2.45 2.45 0 0 0 .35-4.88A4 4 0 0 0 4 6.25v.1a3 3 0 0 0 1.1 5.9Z"/></svg>',
      offline: '<svg class="ask-source-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5h7l3 3v8H3z"/><path d="M10 2.5v3h3M5.5 9h5M5.5 11.5h3.5"/></svg>'
    };
    var setSource = function (source, model) {
      if (!sourceEl) return;
      var labels = {
        idle: T('ask.source.idle', 'Local first \u00b7 cloud fallback'),
        pending: T('ask.source.pending', 'Choosing an available model\u2026'),
        local: T('ask.source.local', 'Local \u00b7 {model}', { model: model || 'Ollama' }),
        cloud: T('ask.source.cloud', 'Cloud \u00b7 Workers AI'),
        offline: T('ask.source.offline', 'Built-in FAQ \u00b7 no model')
      };
      sourceEl.setAttribute('data-source', source);
      sourceEl.innerHTML = (sourceIcons[source] || sourceIcons.idle) + '<span>' + escape(labels[source] || labels.idle) + '</span>';
      sourceEl.title = model ? T('ask.source.model', 'Model: {model}', { model: model }) : '';
    };
    var setSourceFromHistory = function () {
      var last = null;
      for (var i = convo.length - 1; i >= 0; i--) {
        if (convo[i].role === 'assistant') { last = convo[i]; break; }
      }
      if (last && (last.via === 'local' || last.via === 'cloud' || last.via === 'offline')) {
        setSource(last.via, last.model || '');
      } else {
        setSource('idle');
      }
    };
    setSourceFromHistory();

    var isOpen = function () { return ask.classList.contains('is-open'); };
    var panelOpen = function () { return panel.classList.contains('is-open'); };
    var updateSend = function () {
      send.disabled = busy || !input.value.trim();
      pSend.disabled = busy || !pInput.value.trim();
    };
    // Starter questions: the FAQ's starters (content/faq.json). A Chinese
    // page asks each one by its first Chinese alias.
    var zhPage = /^zh/i.test(root.lang || '');
    var HAN = /[\u3400-\u9fff]/;
    var starters = function (n) {
      var faq = (window.QA && typeof window.QA.starters === 'function')
        ? window.QA.starters(n)
        : ((window.QA && Array.isArray(window.QA.FAQ)) ? window.QA.FAQ.slice(0, n) : []);
      return faq.map(function (f) {
        var zh = zhPage && (f.aliases || []).filter(function (a) { return HAN.test(a); })[0];
        return zh || f.q;
      }).filter(Boolean);
    };
    var chip = function (q) {
      var label = q.charAt(0).toUpperCase() + q.slice(1);
      return '<button class="ask-chip glass" type="button" data-q="' + escape(q) + '">' + escape(label) + '</button>';
    };

    var renderSuggest = function () {
      var qs = starters(3);
      if (!qs.length || convo.length) { suggest.hidden = true; return; }
      suggest.innerHTML = qs.map(chip).join('');
      suggest.hidden = false;
    };

    var renderLog = function (pending) {
      if (!convo.length && !pending) {
        log.innerHTML = '<p class="ask-empty">' + escape(T('ask.empty', 'Ask about a project, what I’m building, how I think, or how to reach me.')) + '</p>' +
          '<div class="ask-starters">' + starters(4).map(chip).join('') + '</div>';
        return;
      }
      var html = convo.map(function (m) {
        return '<div class="msg msg-' + (m.role === 'user' ? 'you' : 'bot') + '">' + escape(m.content) + '</div>';
      }).join('');
      if (pending) {
        html += '<div class="msg msg-bot"><div class="msg-dots" role="status" aria-label="' + escape(T('ask.thinking', 'Thinking')) + '"><span></span><span></span><span></span></div></div>';
      }
      log.innerHTML = html;
      log.scrollTop = log.scrollHeight;
    };

    /* Composer */
    var open = function () {
      if (isOpen()) return;
      ask.classList.add('is-open');
      doc.body.classList.add('ask-open');
      renderSuggest();
      updateSend();
      if (!busy) setMood('listening');
    };
    var close = function () {
      ask.classList.remove('is-open');
      doc.body.classList.remove('ask-open');
      suggest.hidden = true;
      if (doc.activeElement && ask.contains(doc.activeElement)) doc.activeElement.blur();
      if (!busy && !panelOpen()) setMood('idle');
    };

    /* Panel */
    var moveAvatar = function (into) {
      var av = $('ask-avatar');
      if (!av) return;
      if (into && avatarSlot) avatarSlot.appendChild(av);
      else if (!into && avatarHome) avatarHome.insertBefore(av, avatarHome.firstChild);
    };
    var panelTimer = 0;
    var openPanel = function () {
      if (panelOpen()) return;
      clearTimeout(panelTimer);
      close();
      panel.hidden = false;
      void panel.offsetWidth;                     // reflow so the slide-in runs
      panel.classList.add('is-open');
      doc.body.classList.add('ask-panel-open');
      moveAvatar(true);
      renderLog(busy);
    };
    var closePanel = function () {
      if (!panelOpen()) return;
      panel.classList.remove('is-open');
      doc.body.classList.remove('ask-panel-open');
      moveAvatar(false);
      if (!busy) setMood('idle');
      panelTimer = setTimeout(function () { if (!panelOpen()) panel.hidden = true; }, 420);
    };

    /* The cache is a rolling one-hour window. Re-read it at the moment the
       visitor clicks the docked composer, not only at page load: a tab may
       have been sitting open past the expiry, or another Work tab may have
       added/cleared a conversation in the meantime. */
    var refreshHistory = function () {
      if (!historyCache || busy) return convo.length > 0;
      var cached = historyCache.load();
      convo = cached ? cached.messages : [];
      setSourceFromHistory();
      return convo.length > 0;
    };
    var openCachedHistory = function () {
      if (!refreshHistory()) return false;
      openPanel();
      setTimeout(function () { if (!busy) pInput.focus({ preventScroll: true }); }, 50);
      return true;
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
        var note = first ? '\n\n' + T('ask.offlineNote', "(Quick FAQ answer — the live answer service couldn't be reached from your network. Try again later, or email chenjy4@uw.edu.)") : '';
        return (m ? m.answer : T('ask.noAnswer', "I don't have that one written down yet — try asking about a project, what I'm working on, or how to reach me.")) + note;
      });
    };

    var ask$ = function (raw) {
      var q = String(raw || '').trim().slice(0, 500);
      if (!q || busy) return;
      convo.push({ role: 'user', content: q });
      saveHistory();
      input.value = '';
      pInput.value = '';
      busy = true;
      updateSend();
      openPanel();
      setSource('pending');
      renderLog(true);
      setMood('thinking');

      var reply = qaUrl
        ? fetch(qaUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ q: q, messages: convo, lang: document.documentElement.lang || 'en' }),
            // Room for the Mac's model (up to ~25 s) and then the cloud fallback.
            signal: timeout(45000),
          }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (d) {
              if (r.ok && d && d.answer) return { answer: String(d.answer), via: d.via, model: d.model };
              return offlineAnswer(q);
            });
          }).catch(function () { return offlineAnswer(q); })
        : offlineAnswer(q);

      reply.then(function (res) {
        var answer = typeof res === 'string' ? res : res.answer;
        var via = res && res.via;
        var model = res && res.model ? String(res.model) : '';
        if (via === 'local') setSource('local', model);
        else if (via === 'cloud') setSource('cloud', model);
        else setSource('offline');
        convo.push({ role: 'assistant', content: answer, via: via, model: model });
        saveHistory();
        busy = false;
        renderLog(false);
        // Talk for roughly as long as the answer takes to skim, then beam.
        var talk = Math.max(1200, Math.min(3600, answer.length * 22));
        setMood('talking');
        setTimeout(function () { if (getMood() === 'talking') setMood('happy', 900); }, talk);
        updateSend();
        if (panelOpen()) pInput.focus({ preventScroll: true });
      });
    };

    input.addEventListener('focus', function () {
      if (!openCachedHistory()) open();
    });
    [input, pInput].forEach(function (field) {
      field.addEventListener('input', function () {
        updateSend();
        if (!busy && avatarEl) avatarEl.dispatchEvent(new CustomEvent('avatar:nod'));
      });
    });
    pInput.addEventListener('focus', function () { if (!busy) setMood('listening'); });
    // Say hello when the pointer comes over the resting capsule.
    $('ask-shell').addEventListener('pointerenter', function (ev) {
      if (isOpen() || ev.pointerType === 'touch') return;
      setMood('hello', 1100);
    });
    // The collapsed capsule is all one target, not just the text field.
    $('ask-shell').addEventListener('click', function (ev) {
      if (isOpen() || ev.target.closest('button[type="submit"]')) return;
      if (!openCachedHistory()) input.focus();
    });
    $('ask-avatar').addEventListener('click', function () {
      if (!panelOpen() && !openCachedHistory()) input.focus();
    });
    form.addEventListener('submit', function (ev) { ev.preventDefault(); ask$(input.value); });
    pForm.addEventListener('submit', function (ev) { ev.preventDefault(); ask$(pInput.value); });
    [suggest, log].forEach(function (box) {
      box.addEventListener('click', function (ev) {
        var c = ev.target.closest('.ask-chip');
        if (c) ask$(c.getAttribute('data-q'));
      });
    });
    $('ask-close').addEventListener('click', closePanel);
    $('ask-new').addEventListener('click', function () {
      if (busy) return;
      convo = [];
      clearHistory();
      setSource('idle');
      renderLog(false);
      pInput.focus();
    });
    window.addEventListener('storage', function (ev) {
      if (!historyCache || ev.key !== historyCache.key || busy) return;
      var cached = historyCache.load();
      convo = cached ? cached.messages : [];
      setSourceFromHistory();
      if (panelOpen()) renderLog(false);
    });
    // Clicking away folds the composer down. The panel is not modal: it stays
    // until closed, so the page beside it can be read and clicked.
    doc.addEventListener('pointerdown', function (ev) {
      if (isOpen() && !ask.contains(ev.target)) close();
    });
    doc.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') {
        // "/" jumps to the composer, as on most search-first sites.
        if (ev.key === '/' && !isOpen() && !/^(INPUT|TEXTAREA|SELECT)$/.test((doc.activeElement || {}).tagName || '')) {
          ev.preventDefault();
          (panelOpen() ? pInput : input).focus();
        }
        return;
      }
      if (isOpen()) { close(); return; }
      if (panelOpen() && panel.contains(doc.activeElement)) closePanel();
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
      filter.appendChild(feImage);
      /* Chromatic aberration: red, green and blue are each bent by a slightly
         different amount, then recombined, so the rim picks up the faint
         colour fringe real glass has. */
      var CHANNELS = [
        ['R', '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', 1.0],
        ['G', '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0', 1.07],
        ['B', '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0', 1.14],
      ];
      var disps = CHANNELS.map(function (ch) {
        var d = doc.createElementNS(SVGNS, 'feDisplacementMap');
        d.setAttribute('in', 'SourceGraphic');
        d.setAttribute('in2', 'map');
        d.setAttribute('xChannelSelector', 'R');
        d.setAttribute('yChannelSelector', 'G');
        d.setAttribute('result', 'd' + ch[0]);
        var m = doc.createElementNS(SVGNS, 'feColorMatrix');
        m.setAttribute('in', 'd' + ch[0]);
        m.setAttribute('type', 'matrix');
        m.setAttribute('values', ch[1]);
        m.setAttribute('result', 'c' + ch[0]);
        filter.appendChild(d);
        filter.appendChild(m);
        return { el: d, k: ch[2] };
      });
      var b1 = doc.createElementNS(SVGNS, 'feBlend');
      b1.setAttribute('in', 'cR'); b1.setAttribute('in2', 'cG'); b1.setAttribute('mode', 'screen'); b1.setAttribute('result', 'rg');
      var b2 = doc.createElementNS(SVGNS, 'feBlend');
      b2.setAttribute('in', 'rg'); b2.setAttribute('in2', 'cB'); b2.setAttribute('mode', 'screen');
      filter.appendChild(b1);
      filter.appendChild(b2);
      defs.appendChild(filter);

      var lastKey = '';
      var paint = function () {
        var w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
        if (!w || !h) return;
        var r = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, w / 2, h / 2);
        var key = w + 'x' + h + 'r' + r;
        if (key === lastKey) return;
        lastKey = key;
        // A wide, strong bend: the lens reaches a good way in from the rim.
        // The displacement stays at or under the band width — past that the
        // mapping folds back on itself and what is behind shows up mirrored.
        var band = Math.max(10, Math.min(r, 32));
        ['x', 'y'].forEach(function (a) { filter.setAttribute(a, '0'); feImage.setAttribute(a, '0'); });
        filter.setAttribute('width', w); filter.setAttribute('height', h);
        feImage.setAttribute('width', w); feImage.setAttribute('height', h);
        feImage.setAttribute('href', lensMap(w, h, r, band));
        disps.forEach(function (d) { d.el.setAttribute('scale', String(Math.round(band * 0.95 * d.k))); });
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
