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
      return '<div class="ask-msg ask-msg-' + (m.role === 'you' ? 'you' : 'bot') + '">' +
             '<div class="ask-msg-text">' + esc(m.text) + '</div></div>';
    }).join('');
    log.scrollTop = log.scrollHeight;
  };

  var send = function (q) {
    if (busy || !q) return;
    busy = true;
    convo.push({ role: 'you', text: q });
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
        context: card.title ? ('Project: ' + card.title) : undefined,
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
  window.ASK_PANEL = { open: function (q) { open(false); if (q) send(q); } };

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
