/* ════════════════════════════════════════════════════════════════════════
   qa-faq.js — the hand-authored "ask this portfolio" FAQ + a tiny retrieval
   matcher, exposed as `window.QA = { FAQ, match }`.

   Single source of truth for the FAQ. Consumed by:
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
  // Each entry: q (the question), a (a one-line curated answer), and one of
  // cardId | anchor | href as "where to go for more".
  var FAQ = [
    { q: 'are you looking for a job / open to roles?', a: 'Yes — open to AI PM roles at top labs & big-tech, founder conversations, and independent collaborations.', anchor: '#contact' },
    { q: "what's your strongest shipped project?", a: 'SusBench — an IUI 2025 benchmark for how susceptible computer-use agents are to UI dark patterns; cited by 2 papers.', cardId: 'SHIP-03' },
    { q: 'what are you building right now?', a: 'Lark Loom (a collaborative AI agent in the Lark ecosystem), Gmail++ (AI email ranking), and ApplyMint (one-click job-application autofill).', anchor: '#now' },
    { q: 'how do I get in touch / contact you?', a: "Email and socials are in the Contact section — that's the fastest way.", anchor: '#contact' },
    { q: 'where did you study / education?', a: 'Human-Centered Design & Engineering (HCDE) at the University of Washington.', anchor: '#main-content' },
    { q: 'is this site agent-friendly? can an AI read it?', a: 'Yes — /llms.txt and /llms-full.txt, an embedded CLI on the page, and `npx antares-cv`. See the agent surfaces section.', anchor: '#agents' },
    { q: "what's the site built with / tech stack?", a: 'Vanilla HTML/CSS/JS, Sveltia CMS, a pre-rendering SSG, deployed on Cloudflare Pages. Source is on GitHub.', href: 'https://github.com/AntaresYuan/personal_website' },
    { q: 'what does "a star to ship by" mean?', a: 'A north star you steer by — pick a direction worth committing to, then ship toward it.', anchor: '#main-content' },
    { q: "what's a Pi-shaped AI PM?", a: 'Product + HCI-research depth, plus enough builder fluency to ship 0→1 — not just spec it.', anchor: '#lens' },
    { q: "what's Worth Fly?", a: 'WorthFly — flight search, decision support and alert drafts; the final fare, inventory and ticketing stay with the real booking channel.', cardId: 'SHIP-01' },
    { q: "what's Gmail++ / Gmail Plus Plus?", a: 'An AI email-ranking layer over Gmail: a read-only reply queue with visible reasoning and reversible, account-scoped preferences.', cardId: 'NOW-02' },
    { q: 'is the source code available?', a: 'Yes — github.com/AntaresYuan/personal_website (and there is a /admin/ CMS for editing content).', href: 'https://github.com/AntaresYuan/personal_website' },
    { q: 'how do I edit the content?', a: 'Through Sveltia CMS at /admin/ (GitHub OAuth — owner only). A GitHub Action then rebuilds the static artifacts.', href: '/admin/' },
  ];

  var STOP = {};
  ('a an the is are was were be of to in on at for and or do does did what whats how why who when where which whose your you my me i we this that it its with about can could should would have has get got tell show give describe explain any am re s'
    .split(' ')).forEach(function (w) { STOP[w] = true; });

  function tokens(s) {
    return String(s || '').toLowerCase().split(/[^a-z0-9+]+/).filter(function (t) { return t.length > 1 && !STOP[t]; });
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
      var fq = f.q.toLowerCase(), s = 0;
      if (fq.indexOf(ql) !== -1 || ql.indexOf(fq) !== -1) s += 4;             // near-exact question
      s += overlap(qt, fq + ' ' + f.a) * 1.2;
      if (s > bestScore) { bestScore = s; best = { answer: f.a, cardId: f.cardId, anchor: f.anchor, href: f.href }; }
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

  window.QA = { FAQ: FAQ, match: match };
})();
