/* ════════════════════════════════════════════════════════════════════════
   palette.js — Cmd+K command palette.

   Owns the global ⌘K / Ctrl+K shortcut and the floating bottom-right
   trigger (#palette-fab). Opens a centered overlay with a
   search input. Items are derived from the same content/*.json the rest
   of the site renders from, plus a static set of section anchors,
   terminal commands, and external links.

   Selecting an item dispatches a context-appropriate action:
     section → smooth-scroll to anchor
     card    → CustomEvent('agent:open-card')  (render.js opens the panel)
     command → focus terminal input + prefill
     faq     → show the answer inline; jump to the relevant card / section
     link    → open in new tab

   The palette doubles as a pure-retrieval "ask this portfolio" (#76 Phase 1):
   a small hand-authored FAQ list (below) plus token-overlap scoring, so a
   typed question like "are you looking for a job" surfaces the right FAQ
   entry / card. No embeddings, no model calls — just retrieval. */
(() => {
  const root = document.getElementById('palette');
  const backdrop = document.getElementById('palette-backdrop');
  const input = document.getElementById('palette-input');
  const list = document.getElementById('palette-results');
  if (!root || !backdrop || !input || !list) return;

  const escape = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

  const json = async (p) => {
    const r = await fetch(p, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${p}: ${r.status}`);
    return r.json();
  };

  /* ── Data sources ──────────────────────────────────────────────── */
  // Built once on boot. If content changes during a session (e.g. CMS
  // save), refresh manually. Cheap to rebuild — no need for live sync.
  let items = [];

  const STATIC_SECTIONS = [
    { label: 'Hero',     desc: 'name, slogan, intro',          anchor: '#main-content' },
    { label: 'Board',    desc: 'shipped / now / next / later', anchor: '#shipped' },
    { label: 'Terminal', desc: 'agent CLI',                    anchor: '#terminal' },
    { label: 'Lens',     desc: 'how I think',                  anchor: '#lens' },
    { label: 'Agents',   desc: 'machine-readable surfaces',    anchor: '#agents' },
    { label: 'Contact',  desc: 'email + socials',              anchor: '#contact' },
  ];

  const TERMINAL_COMMANDS = [
    ['help',     'list commands'],
    ['whoami',   'identity, slogan'],
    ['projects', 'list cards by status'],
    ['cv',       'one-shot resume'],
    ['stats',    'cards by status, top tags'],
    ['recent',   'recently updated'],
    ['lens',     'principles'],
    ['fortune',  'random principle'],
    ['contact',  'email + socials'],
    ['search',   'fuzzy search across cards'],
    ['cat',      'card detail (cat SHIP-01)'],
    ['open',     'open card in side panel'],
    ['clear',    'clear screen'],
  ];

  const STATIC_EXTERNAL = [
    { label: 'Source on GitHub', desc: 'AntaresYuan/personal_website', href: 'https://github.com/AntaresYuan/personal_website', external: true },
    { label: '/llms.txt',        desc: 'agent-readable summary',        href: '/llms.txt',      external: true },
    { label: '/llms-full.txt',   desc: 'agent full content',            href: '/llms-full.txt', external: true },
    { label: '/admin/',          desc: 'CMS (auth required)',           href: '/admin/',        external: true },
    { label: 'npx antares-cv',   desc: 'resume in your terminal',       href: 'https://www.npmjs.com/package/antares-cv', external: true },
  ];

  // Hand-authored FAQ — the "ask this portfolio" corpus (#76 Phase 1). The
  // data + a tiny retrieval matcher now live in scripts/qa-faq.js (window.QA),
  // shared with the hero "ask" bar (scripts/render.js). Loaded as a <script>
  // before this one; if it didn't load, FAQ entries just won't show in ⌘K —
  // everything else still works.
  const FAQ = (window.QA && window.QA.FAQ) || [];

  const STATUS_GLYPH = { shipped: '✓', now: '→', next: '◇', later: '○' };
  const idPrefix = { shipped: 'SHIP', now: 'NOW', next: 'NEXT', later: 'LATER' };
  const pad2 = (n) => String(n).padStart(2, '0');

  const buildItems = (board, lens, posts = [], skills = { items: [] }) => {
    const out = [];

    // Sections
    STATIC_SECTIONS.forEach((s) => {
      out.push({
        kind: 'section',
        icon: '#',
        label: s.label,
        desc:  s.desc,
        meta:  'jump',
        search: `${s.label} ${s.desc}`.toLowerCase(),
        action: () => scrollToAnchor(s.anchor),
      });
    });

    // Blog — the index + each post. These navigate (a different page), not
    // an in-page anchor.
    out.push({
      kind: 'post', icon: '✎', label: 'Writing', desc: 'blog — posts & writeups', meta: 'open',
      search: 'writing blog posts writeups',
      action: () => { window.location.href = '/blog/'; },
    });
    (posts ?? []).forEach((p) => {
      out.push({
        kind: 'post', icon: '✎',
        label: p.title,
        desc: `post${p.date ? ' · ' + p.date : ''}`,
        meta: 'open',
        search: `${p.title} ${p.summary ?? ''} blog post writing`.toLowerCase(),
        action: () => { window.location.href = `/blog/${p.slug}/`; },
      });
    });

    // Cards — sort same as render.js
    const cards = (board.cards ?? []).slice().sort((a, b) => {
      const ao = a.order ?? 99, bo = b.order ?? 99;
      if (ao !== bo) return ao - bo;
      return (b.updated ?? '').localeCompare(a.updated ?? '');
    });
    const cols = ['shipped', 'now', 'next', 'later'];
    cols.forEach((col) => {
      const inCol = cards.filter((c) => c.status === col);
      inCol.forEach((c, idx) => {
        const id = `${idPrefix[col]}-${pad2(idx + 1)}`;
        out.push({
          kind: 'card',
          icon: STATUS_GLYPH[col],
          label: `${id}  ${c.title ?? ''}`,
          desc: col,
          meta: c.updated ?? '',
          search: `${id} ${c.title ?? ''} ${(c.tags ?? []).join(' ')} ${c.summary ?? ''}`.toLowerCase(),
          action: () => {
            // Trigger the existing side-panel open path
            document.dispatchEvent(new CustomEvent('agent:open-card', { detail: { id } }));
          },
        });
      });
    });

    // Skills (/skills section). Same modal open path as cards — dispatch
    // agent:open-card with the SKILL-NN id and render.js opens the panel.
    const skillItems = (skills && skills.items) || [];
    skillItems.slice().sort((a, b) =>
      (a.order ?? 99) - (b.order ?? 99) || String(a.name ?? '').localeCompare(String(b.name ?? ''))
    ).forEach((s, idx) => {
      const id = `SKILL-${pad2(idx + 1)}`;
      out.push({
        kind: 'skill',
        icon: '⌘',
        label: `${id}  ${s.name ?? ''}`,
        desc: s.category ? `skill · ${s.category}` : 'skill',
        meta: '',
        search: `${id} ${s.name ?? ''} ${s.category ?? ''} ${s.summary ?? ''} skill dotfile ai workflow`.toLowerCase(),
        action: () => { document.dispatchEvent(new CustomEvent('agent:open-card', { detail: { id } })); },
      });
    });

    // Terminal commands
    TERMINAL_COMMANDS.forEach(([name, desc]) => {
      out.push({
        kind: 'cmd',
        icon: '$',
        label: name,
        desc,
        meta: 'terminal',
        search: `${name} ${desc}`.toLowerCase(),
        action: () => prefillTerminal(name),
      });
    });

    // Lens entries (jump to lens with that one highlighted via hash)
    (lens.items ?? []).forEach((it) => {
      const num = it.num ?? '';
      out.push({
        kind: 'lens',
        icon: '◦',
        label: `${num} ${it.main ?? ''}`,
        desc: 'lens',
        meta: '',
        search: `lens ${num} ${it.main ?? ''} ${it.aside ?? ''}`.toLowerCase(),
        action: () => scrollToAnchor('#lens'),
      });
    });

    // External / housekeeping links
    STATIC_EXTERNAL.forEach((l) => {
      out.push({
        kind: 'ext',
        icon: '↗',
        label: l.label,
        desc: l.desc,
        meta: '',
        search: `${l.label} ${l.desc}`.toLowerCase(),
        action: () => window.open(l.href, '_blank', 'noopener'),
      });
    });

    // FAQ — "ask this portfolio". The question is the label; the answer is
    // shown inline; selecting it jumps to the relevant card / section / link.
    FAQ.forEach((f) => {
      out.push({
        kind: 'faq',
        icon: '?',
        label: f.q,
        answer: f.a,
        meta: '',
        search: `${f.q} ${f.a}`.toLowerCase(),
        action: () => {
          if (f.cardId) document.dispatchEvent(new CustomEvent('agent:open-card', { detail: { id: f.cardId } }));
          else if (f.anchor) scrollToAnchor(f.anchor);
          else if (f.href) window.open(f.href, '_blank', 'noopener');
        },
      });
    });

    return out;
  };

  /* ── Actions ───────────────────────────────────────────────────── */
  const scrollToAnchor = (sel) => {
    const el = document.querySelector(sel);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const prefillTerminal = (cmd) => {
    const t = document.getElementById('terminal');
    const i = document.getElementById('terminal-input');
    if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => {
      if (i) {
        i.focus({ preventScroll: true });
        i.value = cmd + ' ';
        // Place cursor at end so user can keep typing
        i.setSelectionRange(i.value.length, i.value.length);
      }
    }, 350);
  };

  /* ── Search / scoring ──────────────────────────────────────────── */
  // Common words to ignore when scoring multi-word ("question-like") queries.
  const STOPWORDS = new Set(['a','an','the','is','are','was','were','be','of','to','in','on','at','for','and','or','do','does','did','what','whats','how','why','who','when','where','your','you','my','i','me','we','this','that','it','its','with','about','can','could','should','would','have','has','get','tell','show','give','any','am','re','s']);

  // Tiers, best to worst: prefix-on-label > substring-on-label > substring-on-
  // search > token-overlap (for multi-word / question queries — this is the
  // "ask" path) > subsequence. Empty query returns a curated default set.
  const score = (q, item) => {
    if (!q) return 0;
    const label = item.label.toLowerCase();
    const search = item.search;

    if (label.startsWith(q)) return 1000 - label.length;
    if (label.includes(q))   return 500  - label.indexOf(q);
    if (search.includes(q))  return 250  - search.indexOf(q);

    // Token overlap — for multi-word / natural-language queries. Score by how
    // many meaningful query tokens appear in the item's search text. Ranks
    // above bare subsequence (which matches almost anything for long queries).
    const tokens = q.split(/[^a-z0-9+]+/).filter((t) => t.length > 1 && !STOPWORDS.has(t));
    if (tokens.length >= 2) {
      const hits = tokens.filter((t) => search.includes(t)).length;
      if (hits >= 2 || (hits === 1 && tokens.length === 2)) return 150 + hits;
    }

    // Subsequence: every char of q appears in order
    let i = 0;
    for (const ch of search) {
      if (ch === q[i]) { i++; if (i === q.length) break; }
    }
    if (i === q.length) return 100;
    return -1;
  };

  const filter = (q) => {
    q = q.trim().toLowerCase();
    if (!q) {
      // Default landing set — most useful entry points
      const order = ['Board', 'Terminal', 'Agents', 'Contact'];
      const sections = items.filter((it) =>
        it.kind === 'section' && order.includes(it.label)
      ).sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
      const writing = items.filter((it) => it.kind === 'post' && it.label === 'Writing').slice(0, 1);
      const topShipped = items.filter((it) => it.kind === 'card' && it.desc === 'shipped').slice(0, 2);
      const cv = items.filter((it) => it.kind === 'cmd' && it.label === 'cv');
      const faq = items.filter((it) => it.kind === 'faq').slice(0, 1);   // first FAQ ("are you looking for a job")
      const ext = items.filter((it) => it.kind === 'ext' && it.label.startsWith('Source')).slice(0, 1);
      return [...sections, ...writing, ...topShipped, ...faq, ...cv, ...ext];
    }
    return items
      .map((it) => ({ it, s: score(q, it) }))
      .filter((x) => x.s > -1)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((x) => x.it);
  };

  /* ── Rendering ─────────────────────────────────────────────────── */
  let selected = 0;

  const render = () => {
    const q = input.value;
    const matches = filter(q);

    if (matches.length === 0) {
      list.innerHTML = `<li class="palette-empty">no matches for "${escape(q)}"</li>`;
      selected = 0;
      return;
    }

    if (selected >= matches.length) selected = 0;

    list.innerHTML = matches.map((it, i) => {
      const secondLine = (it.kind === 'faq' && it.answer)
        ? `<div class="palette-result-answer">${escape(it.answer)}</div>`
        : (it.desc ? `<div class="palette-result-desc">${escape(it.desc)}</div>` : '');
      return `<li class="palette-result ${i === selected ? 'is-selected' : ''}" data-idx="${i}" role="option" aria-selected="${i === selected}">
        <span class="palette-result-icon" aria-hidden="true">${escape(it.icon)}</span>
        <div class="palette-result-body">
          <div class="palette-result-label">${escape(it.label)}</div>
          ${secondLine}
        </div>
        ${it.meta ? `<span class="palette-result-meta">${escape(it.meta)}</span>` : ''}
      </li>`;
    }).join('');

    list._matches = matches;
  };

  const ensureSelectedVisible = () => {
    const el = list.querySelector('.palette-result.is-selected');
    if (el) el.scrollIntoView({ block: 'nearest' });
  };

  /* ── Open / close ──────────────────────────────────────────────── */
  const open = () => {
    if (root.classList.contains('is-open')) return;
    backdrop.hidden = false;
    root.hidden = false;
    // Force reflow so transitions fire
    void root.offsetWidth;
    backdrop.classList.add('is-open');
    root.classList.add('is-open');
    document.body.classList.add('palette-open');
    input.value = '';
    selected = 0;
    render();
    setTimeout(() => input.focus(), 50);
  };

  const close = () => {
    backdrop.classList.remove('is-open');
    root.classList.remove('is-open');
    document.body.classList.remove('palette-open');
    setTimeout(() => {
      if (!root.classList.contains('is-open')) {
        root.hidden = true;
        backdrop.hidden = true;
      }
    }, 200);
  };

  const activate = (i) => {
    const matches = list._matches ?? [];
    const it = matches[i];
    if (!it) return;
    close();
    setTimeout(() => it.action(), 80);
  };

  /* ── Keyboard ──────────────────────────────────────────────────── */
  window.addEventListener('keydown', (ev) => {
    // ⌘K / Ctrl+K — global open
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      open();
      return;
    }
  });

  input.addEventListener('input', () => { selected = 0; render(); });

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); close(); return; }
    const matches = list._matches ?? [];
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      selected = Math.min(matches.length - 1, selected + 1);
      render();
      ensureSelectedVisible();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      selected = Math.max(0, selected - 1);
      render();
      ensureSelectedVisible();
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      activate(selected);
    }
  });

  list.addEventListener('mousemove', (ev) => {
    const li = ev.target.closest('.palette-result');
    if (!li) return;
    const i = Number(li.dataset.idx);
    if (i !== selected) { selected = i; render(); }
  });

  list.addEventListener('click', (ev) => {
    const li = ev.target.closest('.palette-result');
    if (!li) return;
    activate(Number(li.dataset.idx));
  });

  backdrop.addEventListener('click', close);

  // Floating bottom-right trigger (also the visible cue for the ⌘K shortcut).
  document.getElementById('palette-fab')?.addEventListener('click', open);

  /* ── Boot ──────────────────────────────────────────────────────── */
  (async () => {
    try {
      const [board, lens, posts, skills] = await Promise.all([
        json('content/board.json'),
        json('content/lens.json'),
        json('blog/posts.json').catch(() => []),         // best-effort — empty if the blog isn't built
        json('content/skills.json').catch(() => ({ items: [] })),  // optional file
      ]);
      items = buildItems(board, lens, posts, skills);
    } catch (e) {
      // Even if content fails to load, sections + commands + ext links still work
      items = buildItems({ cards: [] }, { items: [] }, [], { items: [] });
      console.error('[palette]', e);
    }
  })();
})();
