/* ════════════════════════════════════════════════════════════════════════
   qa-faq.js — runtime matcher for the CMS-authored FAQ, exposed as
   `window.QA = { FAQ, starters, match }`.

   The data is generated from content/agent/skills/qa/pairs.json into qa-faq-data.js. Consumed by:
     - scripts/palette.js  — surfaces FAQ entries as ⌘K search results
     - scripts/render.js   — the hero "ask" bar (`wireHeroAsk`): when the
       antares-qa Worker isn't configured, it answers inline from QA.match()
       instead of generating — so it's self-contained and never bounces the
       visitor into the command palette.

   Loaded as a plain <script defer> before render.js / palette.js. If it
   somehow doesn't load, those degrade gracefully (no FAQ entries / no inline
   retrieval answer) — nothing breaks.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  var FAQ = (Array.isArray(window.QA_FAQ_DATA) ? window.QA_FAQ_DATA : []).map(function (f) {
    return {
      q: String(f.question || '').trim(),
      a: String(f.answer || '').trim(),
      aliases: Array.isArray(f.aliases) ? f.aliases : [],
      starter: f.starter === true,
      href: f.href,
    };
  }).filter(function (f) { return f.q && f.a; });

  function starters(n) {
    var picked = FAQ.filter(function (f) { return f.starter; });
    return (picked.length ? picked : FAQ).slice(0, n || 3);
  }

  var STOP = {};
  ('a an the is are was were be of to in on at for and or do does did what whats how why who when where which whose your you my me i we this that it its with about can could should would have has get got tell show give describe explain any am re s'
    .split(' ')).forEach(function (w) { STOP[w] = true; });

  function tokens(s) {
    var text = String(s || '').toLowerCase();
    var out = (text.match(/[a-z0-9][a-z0-9+.-]{1,}/g) || []).map(function (w) { return w.replace(/[.-]+$/, ''); });
    var han = text.match(/[\u3400-\u9fff\uf900-\ufaff]+/g) || [];
    han.forEach(function (run) {
      if (run.length === 1) out.push(run);
      for (var i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2));
    });
    return out.filter(function (t) { return t.length > 1 && !STOP[t]; });
  }
  function overlap(qt, text) {
    var t = String(text || '').toLowerCase(), n = 0;
    for (var i = 0; i < qt.length; i++) if (t.indexOf(qt[i]) !== -1) n++;
    return n;
  }

  /* Best curated answer for `query`, drawn from the FAQ first and the cards as
     a weaker fallback. `cards` may be the displayId-tagged entries (so a card
     hit can offer "open <ID>"). Returns { answer, cardId?, anchor?, href? } or
     null when nothing scores high enough (caller shows a "not on the site" line). */
  function match(query, cards) {
    query = String(query || '').trim();
    if (!query) return null;
    var ql = query.toLowerCase();
    var qt = tokens(query);
    if (!qt.length) return null;
    var best = null, bestScore = 0;

    FAQ.forEach(function (f) {
      var fq = f.q.toLowerCase(), aliasesList = f.aliases || [], aliases = aliasesList.join(' ').toLowerCase(), s = 0;
      if (fq.indexOf(ql) !== -1 || ql.indexOf(fq) !== -1) s += 4;             // near-exact question
      if (aliasesList.some(function (a) {
        var al = String(a || '').toLowerCase();
        return al.indexOf(ql) !== -1 || ql.indexOf(al) !== -1;
      })) s += 4;
      s += overlap(qt, fq + ' ' + aliases + ' ' + f.a) * 1.2;
      if (s > bestScore) { bestScore = s; best = { answer: f.a, href: f.href }; }
    });

    (cards || []).forEach(function (c) {
      var hay = [c.title, c.summary, (c.tags || []).join(' '), c.details].filter(Boolean).join(' ');
      var s = overlap(qt, hay) * 0.85 + (overlap(qt, String(c.title || '')) * 1.5);
      if (s > bestScore) {
        bestScore = s;
        var lead = c.summary || c.details || '';
        best = { answer: (c.title || '') + (lead ? ' — ' + String(lead).split('. ')[0].replace(/\.$/, '') + '.' : ''), cardId: c.displayId };
      }
    });

    return bestScore >= 2 ? best : null;   // below ~2 token-hits it's a guess, not an answer
  }

  window.QA = { FAQ: FAQ, starters: starters, match: match };
})();
