/* ════════════════════════════════════════════════════════════════════════
   terminal.js — embedded interactive CLI.
   Reads the same content/*.json files the board renders from. Exposes
   commands that map onto the board's data, so the page has two surfaces
   (mouse-friendly kanban + keyboard/agent-friendly CLI) backed by one
   source of truth.

   Boots independently of render.js so a slow card render doesn't block
   the terminal and vice versa.
   ════════════════════════════════════════════════════════════════════════ */
(() => {
  const root = document.getElementById('terminal-root');
  if (!root) return;

  const body  = document.getElementById('terminal-body');
  const input = document.getElementById('terminal-input');
  const clearBtn = document.getElementById('terminal-clear');
  if (!body || !input) return;

  const escape = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

  const json = async (p) => {
    const r = await fetch(p, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${p}: ${r.status}`);
    return r.json();
  };

  /* ── State ──────────────────────────────────────────────────────── */
  const state = { profile: null, board: null, lens: null, contact: null, qaUrl: '' };
  let askBusy = false;     // an `ask` request is in flight — the input is disabled meanwhile
  const history = [];
  let historyIdx = -1;

  const HIST_KEY = 'antares_term_history';
  const HIST_MAX = 50;

  const saveHistory = () => {
    try { localStorage.setItem(HIST_KEY, JSON.stringify(history.slice(-HIST_MAX))); }
    catch (e) { /* localStorage may be disabled — silent ok */ }
  };
  const loadHistory = () => {
    try {
      const raw = localStorage.getItem(HIST_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) history.push(...arr);
      }
    } catch (e) {}
  };

  /* ── Rendering ─────────────────────────────────────────────────── */
  // Insert lines BEFORE the prompt line so the input always stays at bottom.
  const promptLine = body.querySelector('.term-prompt-line');

  // Print buffering: when buffer is non-null, print() pushes into it instead
  // of mutating the DOM. printBatch(cb) sets it up and flushes at the end as
  // a single insertAdjacentHTML — turning N DOM mutations into 1. This is
  // the main INP fix for `cv` and other multi-section commands; without it,
  // dumping the full resume took ~3s of blocked main thread.
  let _buf = null;

  // Scroll to bottom on the next frame instead of synchronously. Reading
  // scrollHeight right after a DOM insert forces the browser to compute
  // layout immediately — Lighthouse measured this at 204ms per print on
  // mobile (terminal.js:71:26). Deferring to rAF lets the browser
  // batch the insert with its normal layout pass.
  let _scrollPending = false;
  const scrollToBottom = () => {
    if (_scrollPending) return;
    _scrollPending = true;
    requestAnimationFrame(() => {
      _scrollPending = false;
      body.scrollTop = body.scrollHeight;
    });
  };

  const print = (html, cls = 'term-out') => {
    const lineHtml = `<div class="terminal-line ${cls}">${html}</div>`;
    if (_buf) {
      _buf.push(lineHtml);
      return;
    }
    promptLine.insertAdjacentHTML('beforebegin', lineHtml);
    scrollToBottom();
  };

  const printBatch = (cb) => {
    const outer = _buf;            // support nesting (no-op if already buffered)
    if (outer) { cb(); return; }
    _buf = [];
    try { cb(); }
    finally {
      const chunks = _buf;
      _buf = null;
      if (chunks.length) {
        promptLine.insertAdjacentHTML('beforebegin', chunks.join(''));
        scrollToBottom();
      }
    }
  };

  const printCmd = (cmd) =>
    print(`<span class="term-prompt">$</span><span class="term-cmd">${escape(cmd)}</span>`, '');

  // Pretty-print structured data — used by every command's --json path.
  const printJSON = (data) => {
    const str = JSON.stringify(data, null, 2);
    print(`<pre style="margin:0;font-family:inherit;font-size:inherit;color:inherit;white-space:pre-wrap;">${escape(str)}</pre>`);
  };

  /* ── Flag parser ───────────────────────────────────────────────── */
  // Splits raw args into { positional[], opts{} }. Supports --json,
  // --status=X, --days=N, --tag=X, and bare --flag → true.
  const parseFlags = (args) => {
    const opts = { json: false };
    const positional = [];
    for (const a of args) {
      if (a === '--json')              opts.json   = true;
      else if (a.startsWith('--status=')) opts.status = a.slice(9);
      else if (a.startsWith('--days='))   opts.days   = parseInt(a.slice(7), 10);
      else if (a.startsWith('--tag='))    opts.tag    = a.slice(6);
      else if (a.startsWith('--'))        opts[a.slice(2)] = true;
      else                                positional.push(a);
    }
    return { args: positional, opts };
  };

  /* ── Card index helpers ────────────────────────────────────────── */
  const idPrefix = { shipped: 'SHIP', now: 'NOW', next: 'NEXT', later: 'LATER' };
  const pad2 = (n) => String(n).padStart(2, '0');

  // Memoized — board doesn't mutate during a session. The cache key is the
  // board reference; replaced if state.board itself changes (which only
  // happens once at boot today, but this keeps us safe for live-reload).
  let _cardsCacheFor = null;
  let _cardsCache = null;
  const allCards = () => {
    if (_cardsCacheFor === state.board && _cardsCache) return _cardsCache;
    const cards = (state.board?.cards ?? []).slice().sort((a, b) => {
      const ao = a.order ?? 99, bo = b.order ?? 99;
      if (ao !== bo) return ao - bo;
      return (b.updated ?? '').localeCompare(a.updated ?? '');
    });
    const cols = ['shipped', 'now', 'next', 'later'];
    const out = [];
    cols.forEach((col) => {
      const inCol = cards.filter((c) => c.status === col);
      inCol.forEach((c, idx) => out.push({ ...c, displayId: `${idPrefix[col]}-${pad2(idx + 1)}` }));
    });
    _cardsCacheFor = state.board;
    _cardsCache = out;
    return out;
  };

  // Render a list of cards as a tabular listing
  const printCardTable = (list) => {
    if (list.length === 0) {
      return print(`<span class="term-dim">no cards.</span>`);
    }
    const widthId = Math.max(...list.map(c => c.displayId.length));
    const lines = list.map((c) => {
      const idCell    = `<span class="term-key">${escape(c.displayId.padEnd(widthId + 2))}</span>`;
      const titleCell = `<span class="term-out">${escape(c.title)}</span>`;
      const impact    = c.impact ? `  <span class="term-ok">${escape(c.impact)}</span>` : '';
      const date      = c.updated ? `  <span class="term-dim">${escape(c.updated)}</span>` : '';
      return idCell + titleCell + impact + date;
    });
    print(lines.join('<br>'));
    print(`<span class="term-dim">${list.length} card${list.length === 1 ? '' : 's'} · cat &lt;ID&gt; or open &lt;ID&gt;</span>`);
  };

  /* ── Command catalog ───────────────────────────────────────────── */
  const cmds = {};

  cmds.help = () => {
    const rows = [
      ['help',                       'show this list'],
      ['whoami',                     'identity, slogan, location'],
      ['projects [--status=X]',      'list cards: shipped|now|next|later|all'],
      ['cat <ID>',                   'full details for a card (e.g. cat SHIP-01)'],
      ['open <ID>',                  'open a card in the side panel'],
      ['search <keyword>',           'fuzzy match across all cards'],
      ['ask <question>',             'ask this portfolio (AI answer, grounded in the site)'],
      ['recent [--days=N]',          'recently updated cards (default: top 5)'],
      ['now',                        'shortcut for projects --status=now'],
      ['lens',                       'principles / how I think'],
      ['fortune',                    'random principle'],
      ['contact',                    'email + socials + open-to'],
      ['stats',                      'counts by status, top tags'],
      ['cv',                         'one-shot resume — everything above'],
      ['clear',                      'clear screen (⌃L)'],
    ];
    const w = Math.max(...rows.map(r => r[0].length));
    print(rows.map(r =>
      `<span class="term-key">${escape(r[0].padEnd(w + 2))}</span>` +
      `<span class="term-dim">${escape(r[1])}</span>`
    ).join('<br>'));
    print(`<br><span class="term-dim">flags:</span> <span class="term-key">--json</span> <span class="term-dim">on any command for structured output</span>`);
  };

  cmds.whoami = (args, opts) => {
    const p = state.profile;
    if (!p) return print('profile not loaded', 'term-err');
    if (opts.json) return printJSON(p);
    print(
      [
        `<span class="term-key">${escape(p.name)} ${escape(p.nameAccent ?? '')}</span>`,
        `<span class="term-dim">${escape(p.role ?? '')} · ${escape(p.location ?? '')}</span>`,
        '',
        `${escape(p.slogan ?? '')}`,
        '',
        `<span class="term-dim">tags:</span> ${(p.tags ?? []).map(escape).join(', ')}`,
        `<span class="term-dim">status:</span> <span class="term-ok">●</span> ${escape(p.status ?? '')}`,
      ].join('<br>')
    );
  };

  cmds.projects = (args, opts) => {
    if (!state.board) return print('board not loaded', 'term-err');
    let list = allCards();
    if (opts.status && opts.status !== 'all') {
      list = list.filter(c => c.status === opts.status);
    }
    if (opts.tag) {
      list = list.filter(c => (c.tags ?? []).some(t => t.toLowerCase() === opts.tag.toLowerCase()));
    }
    if (opts.json) return printJSON(list);
    if (list.length === 0) {
      return print(`<span class="term-dim">no matches.</span>`);
    }
    printCardTable(list);
  };

  cmds.now = (args, opts) => cmds.projects(args, { ...opts, status: 'now' });

  cmds.cat = (args, opts) => {
    const id = (args[0] ?? '').toUpperCase();
    if (!id) return print('usage: cat &lt;ID&gt; — e.g. cat SHIP-01', 'term-err');
    const list = allCards();
    const c = list.find(x => x.displayId === id);
    if (!c) return print(`no card '${escape(id)}' — try \`projects\``, 'term-err');
    if (opts.json) return printJSON(c);

    const tags = (c.tags ?? []).map(escape).join(', ') || '<span class="term-dim">none</span>';
    const links = (c.links ?? [])
      .filter(l => l.href && l.href !== '#')
      .map(l => `<a href="${escape(l.href)}" target="_blank" rel="noopener" style="color:var(--term-cmd);">${escape(l.label)}</a>`)
      .join('  ') || '<span class="term-dim">none</span>';

    const out = [
      `<span class="term-key">${escape(c.displayId)}</span>  <span class="term-warn">${escape(c.status)}</span>  <span class="term-dim">${escape(c.updated ?? '')}</span>`,
      '',
      `<span class="term-out" style="font-weight:600">${escape(c.title)}</span>`,
      escape(c.summary ?? ''),
      '',
      `<span class="term-dim">tags:</span>   ${tags}`,
      `<span class="term-dim">impact:</span> ${c.impact ? `<span class="term-ok">${escape(c.impact)}</span>` : '<span class="term-dim">—</span>'}`,
      `<span class="term-dim">links:</span>  ${links}`,
    ];

    if (c.details) {
      out.push('');
      out.push('<span class="term-dim">─── details ───</span>');
      out.push(escape(c.details).replace(/\n/g, '<br>'));
    }
    out.push('');
    out.push(`<span class="term-dim">tip: \`open ${escape(c.displayId)}\` to view in the side panel</span>`);
    print(out.join('<br>'));
  };

  cmds.open = (args, opts) => {
    const id = (args[0] ?? '').toUpperCase();
    if (!id) return print('usage: open &lt;ID&gt; — e.g. open SHIP-01', 'term-err');
    const list = allCards();
    if (!list.find(c => c.displayId === id)) {
      return print(`no card '${escape(id)}' — try \`projects\``, 'term-err');
    }
    if (opts.json) return printJSON({ opened: id });
    print(`<span class="term-dim">opening</span> <span class="term-key">${escape(id)}</span> <span class="term-dim">→ side panel</span>`);
    document.dispatchEvent(new CustomEvent('agent:open-card', { detail: { id } }));
  };

  cmds.search = (args, opts) => {
    const q = args.join(' ').toLowerCase().trim();
    if (!q) return print('usage: search &lt;keyword&gt;', 'term-err');
    const list = allCards();
    const matches = list.filter(c => {
      const hay = [c.title, c.summary, c.details, ...(c.tags ?? [])].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
    if (opts.json) return printJSON(matches);
    if (matches.length === 0) {
      return print(`<span class="term-dim">no matches for '${escape(q)}'</span>`);
    }
    print(`<span class="term-dim">${matches.length} match${matches.length === 1 ? '' : 'es'} for '${escape(q)}':</span>`);
    printCardTable(matches);
  };

  // ask <question> — a grounded AI answer from the antares-qa Worker
  // (workers/qa/, fed the site's /llms-full.txt). Needs content/site.json →
  // qa.workerUrl to be set; otherwise it explains what's missing. The "asking…"
  // line is replaced in place when the answer (or an error) arrives. The prompt
  // is locked while we wait so nothing else prints in between.
  cmds.ask = (args) => {
    if (askBusy) return print('<span class="term-dim">one moment — still working on the last question.</span>', 'term-dim');
    const q = (args || []).join(' ').trim();
    if (!q) return print('usage: ask &lt;your question&gt; — e.g. <span class="term-key">ask are you open to roles?</span>', 'term-err');
    const url = state.qaUrl;
    if (!url) {
      return print('<span class="term-dim">the </span><span class="term-key">ask</span><span class="term-dim"> command needs the antares-qa Worker deployed (see </span><span class="term-key">workers/qa/README.md</span><span class="term-dim">). For now try </span><span class="term-key">whoami</span><span class="term-dim"> · </span><span class="term-key">projects</span><span class="term-dim"> · </span><span class="term-key">cat &lt;ID&gt;</span><span class="term-dim"> · </span><span class="term-key">search</span><span class="term-dim">.</span>');
    }
    print("<span class=\"term-dim\">asking this portfolio… (takes a few seconds — two passes)</span>", 'term-dim');
    // `print()` above is BUFFERED inside exec()'s printBatch — it isn't in the
    // DOM yet. Grab the "asking…" line only after that batch flushes (next
    // microtask), so we replace the right node and not the line above it.
    let lineNode = null;
    queueMicrotask(() => { lineNode = promptLine.previousElementSibling; });
    const setLine = (html, cls) => {
      if (lineNode) { lineNode.className = `terminal-line ${cls || 'term-out'}`; lineNode.innerHTML = html; }
      else { print(html, cls); }
      scrollToBottom();
    };
    // Lock the prompt while we wait — so a second `ask` can't be fired and its
    // answer can't land out of order. Re-enabled in .finally().
    askBusy = true;
    input.disabled = true;
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q }), signal: AbortSignal.timeout(30000) })
      .then(async (r) => {
        let data = {};
        try { data = await r.json(); } catch (_) { /* non-JSON response */ }
        if (r.ok && data && data.answer) {
          const ans = escape(String(data.answer)).replace(/\n+/g, '<br>');
          setLine(`<span class="term-dim">✨</span> ${ans}`, 'term-out');
        } else {
          const why = (data && data.error) ? ` — ${escape(String(data.error))}` : '';
          setLine(`<span class="term-err">couldn’t get an answer right now${why}.</span> <span class="term-dim">try rephrasing, or </span><span class="term-key">search ${escape((q.split(/\s+/)[0] || '').toLowerCase())}</span>`, 'term-out');
        }
      })
      .catch((e) => setLine(`<span class="term-err">${(e && e.name === 'TimeoutError') ? 'no answer in time — try again.' : "couldn’t reach the answer service."}</span> <span class="term-dim">try again in a moment.</span>`, 'term-out'))
      .finally(() => { askBusy = false; input.disabled = false; input.focus(); });
  };

  cmds.recent = (args, opts) => {
    let list = allCards()
      .filter(c => c.updated)
      .sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''));

    if (opts.days != null && Number.isFinite(opts.days)) {
      const cutoffMs = Date.now() - opts.days * 86400000;
      const cutoff = new Date(cutoffMs).toISOString().slice(0, 10);
      list = list.filter(c => (c.updated ?? '') >= cutoff);
      if (opts.json) return printJSON(list);
      print(`<span class="term-dim">updated within ${opts.days} day${opts.days === 1 ? '' : 's'}:</span>`);
    } else {
      list = list.slice(0, 5);
      if (opts.json) return printJSON(list);
      print(`<span class="term-dim">5 most recently updated:</span>`);
    }

    printCardTable(list);
  };

  cmds.stats = (args, opts) => {
    const list = allCards();
    const byStatus = { shipped: 0, now: 0, next: 0, later: 0 };
    const tagCount = new Map();
    list.forEach(c => {
      if (byStatus[c.status] != null) byStatus[c.status]++;
      (c.tags ?? []).forEach(t => tagCount.set(t, (tagCount.get(t) ?? 0) + 1));
    });
    const topTags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const lastUpdated = list.map(c => c.updated).filter(Boolean).sort().pop() ?? null;
    const lensCount = state.lens?.items?.length ?? 0;

    if (opts.json) {
      return printJSON({
        total: list.length,
        byStatus,
        topTags: Object.fromEntries(topTags),
        lastUpdated,
        lensCount,
      });
    }

    print([
      `<span class="term-key">total:</span>       ${list.length} cards`,
      `<span class="term-key">by status:</span>   shipped:${byStatus.shipped}  now:${byStatus.now}  next:${byStatus.next}  later:${byStatus.later}`,
      `<span class="term-key">top tags:</span>    ${topTags.length ? topTags.map(([t, n]) => `${escape(t)}(${n})`).join(', ') : '<span class="term-dim">—</span>'}`,
      `<span class="term-key">last update:</span> ${lastUpdated ?? '<span class="term-dim">—</span>'}`,
      `<span class="term-key">lens:</span>        ${lensCount} entr${lensCount === 1 ? 'y' : 'ies'}`,
    ].join('<br>'));
  };

  cmds.fortune = (args, opts) => {
    const items = state.lens?.items ?? [];
    if (items.length === 0) return print('no lens entries yet', 'term-dim');
    const it = items[Math.floor(Math.random() * items.length)];
    if (opts.json) return printJSON(it);
    const aside = it.aside ? `<br>  <span class="term-dim">${escape(it.aside)}</span>` : '';
    print(`<span class="term-key">${escape(it.num ?? '')}</span> ${escape(it.main ?? '')}${aside}`);
  };

  cmds.lens = (args, opts) => {
    const items = state.lens?.items ?? [];
    if (opts.json) return printJSON(items);
    if (items.length === 0) return print('no lens entries yet', 'term-dim');
    const lines = items.map(it => {
      const aside = it.aside ? `<br>  <span class="term-dim">${escape(it.aside)}</span>` : '';
      return `<span class="term-key">${escape(it.num ?? '')}</span> ${escape(it.main ?? '')}${aside}`;
    });
    print(lines.join('<br><br>'));
  };

  cmds.contact = (args, opts) => {
    const c = state.contact;
    if (!c) return print('contact not loaded', 'term-err');
    if (opts.json) return printJSON(c);
    const items = (c.items ?? []).map(it =>
      `<span class="term-key">${escape((it.key ?? '').padEnd(10))}</span><a href="${escape(it.href ?? '#')}" style="color:var(--term-cmd);">${escape(it.label ?? '')}</a>`
    ).join('<br>');
    const intro = (c.intro ?? '').replace(/<\/?em>/g, '').replace(/<\/?strong>/g, '');
    print(`<span class="term-dim">${escape(intro)}</span><br><br>${items}`);
  };

  cmds.cv = (args, opts) => {
    if (opts.json) {
      const list = allCards();
      return printJSON({
        profile: state.profile,
        board: {
          shipped: list.filter(c => c.status === 'shipped'),
          now:     list.filter(c => c.status === 'now'),
          next:    list.filter(c => c.status === 'next'),
          later:   list.filter(c => c.status === 'later'),
        },
        lens: state.lens?.items ?? [],
        contact: state.contact,
      });
    }
    cmds.whoami([], {});
    print('<br><span class="term-dim">─── shipped ───</span>');
    cmds.projects([], { status: 'shipped' });
    print('<br><span class="term-dim">─── now ───</span>');
    cmds.projects([], { status: 'now' });
    print('<br><span class="term-dim">─── next ───</span>');
    cmds.projects([], { status: 'next' });
    print('<br><span class="term-dim">─── lens ───</span>');
    cmds.lens([], {});
    print('<br><span class="term-dim">─── contact ───</span>');
    cmds.contact([], {});
  };

  cmds.clear = () => {
    body.querySelectorAll('.terminal-line').forEach(n => {
      if (n !== promptLine) n.remove();
    });
  };

  /* ── Smart autocomplete ────────────────────────────────────────── */
  // Returns FULL replacement candidates for the current input value.
  // E.g. for "cat S" returns ["cat SHIP-01", "cat SHIP-02"].
  // Each candidate is a full input.value replacement, not just the suffix —
  // so the caller never has to reconstruct prefix + completion.
  const getCompletions = (value) => {
    if (value === '') return [];

    // Token boundary: split on ANY whitespace, but preserve trailing-space
    // semantics — a value ending in space means "starting a new token".
    const endsWithSpace = /\s$/.test(value);
    const tokens = value.trim().split(/\s+/);
    const cmd = (tokens[0] ?? '').toLowerCase();

    // First-token completion (no spaces yet)
    if (tokens.length === 1 && !endsWithSpace) {
      const cmdNames = Object.keys(cmds).sort();
      return cmdNames.filter(n => n.startsWith(cmd)).map(n => n);
    }

    // Has space(s) — completing an arg or flag.
    const lastToken = endsWithSpace ? '' : tokens[tokens.length - 1];
    const beforeLast = endsWithSpace ? value : value.slice(0, value.length - lastToken.length);

    const cards = state.board ? allCards() : [];
    const cardIds = cards.map(c => c.displayId);
    const allTags = [...new Set(cards.flatMap(c => c.tags ?? []))];
    const STATUSES = ['shipped', 'now', 'next', 'later', 'all'];

    // cat <ID> / open <ID> — complete card IDs (case-insensitive prefix)
    if ((cmd === 'cat' || cmd === 'open') && tokens.length <= 2) {
      const partial = lastToken.toUpperCase();
      return cardIds
        .filter(id => id.startsWith(partial))
        .map(id => beforeLast + id);
    }

    // --status=X
    if (lastToken.startsWith('--status=')) {
      const partial = lastToken.slice(9).toLowerCase();
      return STATUSES
        .filter(s => s.startsWith(partial))
        .map(s => beforeLast + '--status=' + s);
    }

    // --tag=X
    if (lastToken.startsWith('--tag=')) {
      const partial = lastToken.slice(6).toLowerCase();
      return allTags
        .filter(t => t.toLowerCase().startsWith(partial))
        .map(t => beforeLast + '--tag=' + t);
    }

    // Flag completion: lastToken starts with -- (or just --)
    if (lastToken.startsWith('--') || (endsWithSpace && lastToken === '')) {
      const flags = ['--json'];
      if (cmd === 'projects') flags.push('--status=', '--tag=');
      if (cmd === 'recent')   flags.push('--days=');
      return flags
        .filter(f => f.startsWith(lastToken))
        .map(f => beforeLast + f);
    }

    return [];
  };

  // Longest common prefix across an array of strings — used for partial
  // completion on Tab when there are multiple candidates.
  const lcp = (strs) => {
    if (strs.length === 0) return '';
    let p = strs[0];
    for (let i = 1; i < strs.length; i++) {
      while (!strs[i].startsWith(p)) {
        p = p.slice(0, -1);
        if (p === '') return '';
      }
    }
    return p;
  };

  // Ghost-text suggestion via input selection: insert the best completion
  // after the user's typed prefix and select the appended portion. Browser
  // ::selection styling makes the selected portion render as dim/ghost text.
  // If user keeps typing, the typed char replaces the selection automatically.
  // If user presses Tab, the selection collapses to the end (= "accepted").
  const suggest = () => {
    const v = input.value;
    // Only suggest when cursor is at end and there's no existing selection
    if (input.selectionStart !== v.length || input.selectionEnd !== v.length) return;

    const candidates = getCompletions(v);
    if (candidates.length === 0) return;

    // Pick the first (best) candidate. If equal to current value, no-op.
    const best = candidates[0];
    if (!best.startsWith(v) || best === v) return;

    // Apply ghost text: extend value to best, select the appended portion
    input.value = best;
    input.setSelectionRange(v.length, best.length);
  };

  input.addEventListener('input', (ev) => {
    // Only suggest on forward typing — not on backspace, paste, undo, etc.
    if (ev.inputType === 'insertText' || ev.inputType === 'insertCompositionText') {
      suggest();
    }
  });

  /* ── Input handling ────────────────────────────────────────────── */
  // Wraps every command's output in a single printBatch so even a heavy
  // command like `cv` (which transitively calls 6+ sub-commands and prints
  // dozens of lines) results in exactly one DOM mutation + one scroll —
  // turning multi-second INP into one frame.
  const exec = (raw) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    printBatch(() => {
      printCmd(trimmed);
      history.push(trimmed);
      historyIdx = -1;
      saveHistory();

      const [name, ...rest] = trimmed.split(/\s+/);
      const fn = cmds[name.toLowerCase()];
      if (!fn) {
        print(`<span class="term-err">command not found:</span> ${escape(name)} <span class="term-dim">— try \`help\`</span>`);
        return;
      }
      const { args, opts } = parseFlags(rest);
      try { fn(args, opts); }
      catch (e) { print(`<span class="term-err">error:</span> ${escape(e.message)}`); }
    });
  };

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      // Selection (active suggestion) is part of value — accept it, then run
      exec(input.value);
      input.value = '';
      ev.preventDefault();
      return;
    }
    if (ev.key === 'Tab') {
      ev.preventDefault();
      // If a ghost suggestion is active (selection within input), accept it
      // by collapsing the selection to the end.
      if (input.selectionStart !== input.selectionEnd) {
        input.setSelectionRange(input.value.length, input.value.length);
        return;
      }
      // No active suggestion: try to complete from scratch
      const completions = getCompletions(input.value);
      if (completions.length === 0) return;
      if (completions.length === 1) {
        input.value = completions[0];
        input.setSelectionRange(input.value.length, input.value.length);
        return;
      }
      // Multiple: complete to longest common prefix + show candidates
      const common = lcp(completions);
      if (common.length > input.value.length) {
        input.value = common;
        input.setSelectionRange(common.length, common.length);
      }
      // Show just the trailing fragment of each candidate (after the prefix)
      // so output is dense — like bash.
      const tails = completions.map(c => {
        const tail = c.slice(common.length);
        return tail || c;
      });
      print(`<span class="term-dim">${tails.map(escape).join('  ')}</span>`);
      return;
    }
    if (ev.key === 'Escape') {
      // Dismiss active ghost suggestion: drop the selected suffix
      if (input.selectionStart !== input.selectionEnd) {
        ev.preventDefault();
        input.value = input.value.slice(0, input.selectionStart);
        return;
      }
    }
    if (ev.key === 'ArrowRight') {
      // Right arrow at end of selection also accepts the suggestion
      if (input.selectionStart !== input.selectionEnd &&
          input.selectionEnd === input.value.length) {
        ev.preventDefault();
        input.setSelectionRange(input.value.length, input.value.length);
        return;
      }
    }
    if (ev.key === 'ArrowUp') {
      if (history.length === 0) return;
      historyIdx = historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1);
      input.value = history[historyIdx];
      ev.preventDefault();
      return;
    }
    if (ev.key === 'ArrowDown') {
      if (historyIdx === -1) return;
      historyIdx = historyIdx + 1;
      if (historyIdx >= history.length) {
        historyIdx = -1;
        input.value = '';
      } else {
        input.value = history[historyIdx];
      }
      ev.preventDefault();
      return;
    }
    if (ev.key.toLowerCase() === 'l' && (ev.ctrlKey || ev.metaKey)) {
      cmds.clear();
      ev.preventDefault();
    }
  });

  // Click anywhere in the body focuses input — terminal-feels-like-terminal
  body.addEventListener('click', () => input.focus());
  clearBtn?.addEventListener('click', () => { cmds.clear(); input.focus(); });

  /* ── Hero "for agents" CTA → focus terminal input ─────────────── */
  // ⌘K now opens the global command palette (scripts/palette.js).
  // Anchors pointing at #terminal still focus the input on click so the
  // hero CTA continues to "land you ready to type".
  const focusTerminal = () => {
    const section = document.getElementById('terminal');
    if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => input.focus({ preventScroll: true }), 350);
  };
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest('a[href="#terminal"]');
    if (a) focusTerminal();
  });

  /* ── Boot ──────────────────────────────────────────────────────── */
  loadHistory();
  (async () => {
    try {
      const [profile, board, lens, contact, site] = await Promise.all([
        json('content/profile.json'),
        json('content/board.json'),
        json('content/lens.json'),
        json('content/contact.json'),
        json('content/site.json').catch(() => ({})),   // optional — just for qa.workerUrl
      ]);
      Object.assign(state, { profile, board, lens, contact, qaUrl: String((site && site.qa && site.qa.workerUrl) || '').trim() });

      print(
        [
          `<span class="term-dim">${escape(state.profile.name ?? '')} ${escape(state.profile.nameAccent ?? '')} · agent surface · ${new Date().toISOString().slice(0, 10)}</span>`,
          `<span class="term-dim">type</span> <span class="term-key">help</span><span class="term-dim"> for commands · </span><span class="term-key">cv</span><span class="term-dim"> for the full picture · </span><span class="term-key">⌘K</span><span class="term-dim"> from anywhere</span>`,
        ].join('<br>')
      );
    } catch (e) {
      print(`<span class="term-err">failed to load content: ${escape(e.message)}</span>`);
    }
  })();
})();
