/* ─────────────────────────────────────────────────────────────────────────
   Project detail pages: wire the ask panel and open it on the right.

   Standalone rather than a call into render.js — a detail page is a thin,
   fast page that does not load the dashboard bundle, and pulling in 130KB of
   board rendering to answer questions would defeat the point.

   The panel opens automatically here, unlike the home page. On a detail page
   the visitor is already looking at one specific project, which is exactly the
   moment a question is likely, and the question almost always concerns the
   thing on screen. The page seeds that context so "how did you build it" has a
   referent.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var panel = document.getElementById('ask-panel');
  var log = document.getElementById('ask-panel-log');
  var form = document.getElementById('ask-panel-form');
  var input = document.getElementById('ask-panel-input');
  if (!panel || !log || !form || !input) return;

  var card = window.WORK_CARD || {};
  var convo = [];
  var busy = false;
  var endpoint = null;

  var esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };

  var render = function () {
    if (!convo.length) {
      log.innerHTML =
        '<div class="ask-empty">' +
        '<p class="ask-empty-lead">Ask about <strong>' + esc(card.title || 'this project') +
        '</strong> — how it was built, what it took, what I would do differently.</p>' +
        '<div class="ask-starters">' +
        ['How did you build this?', 'What was the hardest part?', 'What did you learn?']
          .map(function (q) {
            return '<button class="ask-starter" type="button" data-q="' + esc(q) + '">' +
                   esc(q) + '</button>';
          }).join('') +
        '</div></div>';
      return;
    }
    log.innerHTML = convo.map(function (m) {
      if (m.pending) {
        return '<div class="ask-msg ask-msg-bot is-thinking">' +
               '<span class="ask-msg-dots" role="status" aria-label="Thinking">' +
               '<i></i><i></i><i></i></span></div>';
      }
      var quoted = (m.role === 'you' && m.quote)
        ? '<div class="ask-msg-quote">' + esc(m.quote) + '</div>' : '';
      return '<div class="ask-msg ask-msg-' + (m.role === 'you' ? 'you' : 'bot') + '">' +
             quoted + '<div class="ask-msg-text">' + esc(m.text) + '</div></div>';
    }).join('');
    log.scrollTop = log.scrollHeight;
  };

  var pendingQuote = '';
  var quoteChip = document.getElementById('ask-quote-chip');
  var renderQuoteChip = function () {
    if (!quoteChip) return;
    if (!pendingQuote) { quoteChip.hidden = true; quoteChip.innerHTML = ''; return; }
    quoteChip.hidden = false;
    quoteChip.innerHTML =
      '<span class="ask-quote-text"></span>' +
      '<button class="ask-quote-x" type="button" aria-label="Remove quoted text">' +
      '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" ' +
      'stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>';
    /* textContent: the passage is arbitrary page text. */
    quoteChip.querySelector('.ask-quote-text').textContent = pendingQuote;
    quoteChip.querySelector('.ask-quote-x')
      .addEventListener('click', function () { setPendingQuote(''); });
  };
  var setPendingQuote = function (t) {
    pendingQuote = String(t || '').slice(0, 1200);
    renderQuoteChip();
  };

  var send = function (q) {
    if (busy || !q) return;
    busy = true;
    var quote = pendingQuote;
    if (quote) setPendingQuote('');
    convo.push(quote ? { role: 'you', text: q, quote: quote } : { role: 'you', text: q });
    convo.push({ role: 'bot', pending: true });
    render();

    var finish = function (text) {
      /* Replace the pending placeholder rather than appending, or a failed
         request leaves a spinner running forever next to the answer. */
      for (var i = convo.length - 1; i >= 0; i--) {
        if (convo[i].pending) { convo[i] = { role: 'bot', text: text }; break; }
      }
      busy = false;
      render();
    };

    if (!endpoint) {
      finish('The assistant is not configured on this page yet. ' +
             'Ask me from the home page, or reach out directly.');
      return;
    }

    /* The project is sent as context so a bare "why?" resolves to this page
       rather than the whole board. */
    fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        q: q,
        context: [
          card.title ? ('Project: ' + card.title) : '',
          quote ? ('The visitor highlighted this passage:\n"' + quote + '"') : ''
        ].filter(Boolean).join('\n\n') || undefined,
        messages: convo.filter(function (m) { return !m.pending; })
          .map(function (m) { return { role: m.role === 'you' ? 'user' : 'assistant', content: m.text }; })
      })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) { finish(d.answer || d.text || 'No answer came back.'); })
      .catch(function () { finish('Could not reach the assistant. Try again in a moment.'); });
  };

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var q = input.value.trim();
    input.value = '';
    if (q) send(q);
  });

  /* Delegated: render() rebuilds the starters each paint, so direct listeners
     would go stale the first time anything is sent. */
  log.addEventListener('click', function (ev) {
    var chip = ev.target.closest('.ask-starter');
    if (chip && !busy) send(chip.dataset.q || chip.textContent.trim());
  });

  var close = function () {
    try { localStorage.setItem('antares.copilot', 'closed'); } catch (e) {}
    panel.classList.remove('is-open');
    document.body.classList.remove('ask-panel-open');
    setTimeout(function () {
      if (!panel.classList.contains('is-open')) panel.hidden = true;
    }, 220);
  };
  var open = function (quiet) {
    if (!panel.classList.contains('is-open')) {
      panel.hidden = false;
      void panel.offsetWidth;
      panel.classList.add('is-open');
      document.body.classList.add('ask-panel-open');
      render();
    }
    if (!quiet) setTimeout(function () { input.focus(); }, 50);
  };

  document.getElementById('ask-panel-close').addEventListener('click', close);
  document.getElementById('ask-panel-clear').addEventListener('click', function () {
    if (busy) return;
    convo = [];
    render();
    input.focus();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape' || !panel.classList.contains('is-open')) return;
    if (!panel.contains(document.activeElement)) return;
    close();
  });

  /* Expose it so anything else on the page can hand over a question. */
  /* Same contract as the home page's panel, so scripts/ask-selection.js can
     drive either without knowing which page it is on. */
  window.ASK_PANEL = {
    open: function (q, opts) {
      if (opts && opts.quote) setPendingQuote(String(opts.quote));
      open(false);
      if (q) send(q);
    }
  };

  fetch('/content/site.json', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (site) {
      var qa = (site && site.qa) || {};
      if (qa.workerUrl) endpoint = qa.workerUrl;

      var dismissed = false;
      try { dismissed = localStorage.getItem('antares.copilot') === 'closed'; } catch (e) {}
      /* Same guards as the home page: respect a visitor who closed it, and
         never auto-open where the drawer would cover the whole viewport. */
      if (!dismissed && window.innerWidth > 560) open(true);
    })
    .catch(function () { /* leave the panel closed rather than half-working */ });
})();
