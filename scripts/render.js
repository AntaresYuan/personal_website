/* ════════════════════════════════════════════════════════════════════════
   render.js — fetches /content/*.json and populates the dashboard.
   Single source of truth: content files. CMS edits commit those files;
   a redeploy (or live reload in dev) reflects the changes.
   ════════════════════════════════════════════════════════════════════════ */
(() => {
  const $ = (sel) => document.querySelector(sel);

  const escape = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

  // Allow the small set of inline tags we use in copy (em, strong, br).
  const safeRich = (s) => {
    return escape(s).replace(/&lt;(\/?(em|strong|br)\s*\/?)&gt;/gi, '<$1>');
  };

  const json = async (path) => {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
    return res.json();
  };

  /* ── Renderers ──────────────────────────────────────────────────── */

  const renderMeta = (site) => {
    document.title = site.meta?.title ?? document.title;
    if (site.meta?.lang) document.documentElement.lang = site.meta.lang;
    if (site.meta?.description) {
      const m = document.querySelector('meta[name="description"]');
      if (m) m.setAttribute('content', site.meta.description);
    }
    $('#brand-name').textContent = site.meta?.title?.split('—')[0]?.trim() ?? '';
    // Only override the build-time "updated <date>" if site.json pins one;
    // otherwise leave the auto value (last-commit date) baked in by build-html.js.
    if (site.footer?.lastUpdated) $('#last-updated').textContent = `updated ${site.footer.lastUpdated}`;
    $('#footer-copyright').innerHTML = [
      escape(site.footer?.copyright ?? ''),
      site.footer?.tagline ? `<em>${escape(site.footer.tagline)}</em>` : '',
    ].filter(Boolean).join(' · ');
  };

  const renderHero = (profile) => {
    // Avatar — calm by default; talking on hover/focus/tap.
    if (profile.avatar) {
      const calm    = $('#avatar-calm');
      const talking = $('#avatar-talking');
      if (calm)    { calm.src = profile.avatar.calm    ?? ''; calm.alt = profile.avatar.alt ?? ''; }
      if (talking) { talking.src = profile.avatar.talking ?? ''; }
      const wrap = $('#hero-avatar');
      if (wrap) {
        // Tap toggle for touch devices (hover doesn't fire there).
        wrap.addEventListener('click', () => {
          wrap.classList.toggle('is-talking');
          // Auto-revert after a beat so it doesn't stick if forgotten
          clearTimeout(wrap._revertTimer);
          if (wrap.classList.contains('is-talking')) {
            wrap._revertTimer = setTimeout(() => wrap.classList.remove('is-talking'), 1800);
          }
        });
      }
    }

    const accent = profile.nameAccent
      ? ` <em>${escape(profile.nameAccent)}</em>`
      : '';
    $('#hero-name').innerHTML = escape(profile.name) + accent;
    $('#hero-slogan').textContent = profile.slogan ?? '';

    const meta = $('#hero-meta');
    meta.innerHTML = '';
    if (profile.role) {
      meta.insertAdjacentHTML('beforeend', `<span>${escape(profile.role)}</span>`);
    }
    if (profile.location) {
      meta.insertAdjacentHTML('beforeend', `<span class="sep">·</span><span>${escape(profile.location)}</span>`);
    }
    if (profile.status) {
      meta.insertAdjacentHTML('beforeend',
        `<span class="sep">·</span><span class="now-pill"><span class="pulse"></span>${escape(profile.status)}</span>`);
    }
    (profile.tags ?? []).forEach((t) => {
      meta.insertAdjacentHTML('beforeend', `<span class="pill">${escape(t)}</span>`);
    });

    const ctas = $('#hero-ctas');
    ctas.innerHTML = '';
    (profile.ctas ?? []).forEach((c) => {
      const a = document.createElement('a');
      a.className = 'cta';
      a.href = c.anchor || '#';
      a.innerHTML = `
        <div>
          <div class="cta-label">${escape(c.audience ?? '')}</div>
          <div class="cta-text">${escape(c.label ?? '')}</div>
        </div>
        <span class="cta-arrow">→</span>`;
      ctas.appendChild(a);
    });
  };

  // Status → ID prefix used for the Linear-style "SHIP-01" badge on each card.
  const idPrefix = { shipped: 'SHIP', now: 'NOW', next: 'NEXT', later: 'LATER' };
  const pad2 = (n) => String(n).padStart(2, '0');

  // Card index keyed by display ID (e.g. SHIP-01) — populated during render,
  // consumed by the panel/hash router. Map preserves insertion order, which
  // is the visual board order (Shipped → Now → Next → Later, by render order
  // within each column), so prev/next nav can iterate the keys directly.
  const cardIndex = new Map();
  const orderedIds = () => Array.from(cardIndex.keys());

  // Tiny markdown renderer for card details. Handles: ## h2, ### h3,
  // - / * lists, paragraphs, inline `code`, **bold**, *italic*. No HTML
  // pass-through — input is escaped first. `opts.demote` (default 0) shifts
  // emitted heading levels down (clamped to h6) so `details` headings can sit
  // *below* the surrounding title's level — e.g. the spec view's <h4> card
  // titles want their `details` headings at <h5>+.
  const mini = (md, opts) => {
    if (!md) return '';
    const demote = (opts && opts.demote) || 0;
    const lines = escape(md).split(/\r?\n/);
    let html = '';
    let listOpen = false;
    const closeList = () => { if (listOpen) { html += '</ul>'; listOpen = false; } };
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { closeList(); continue; }
      const m = /^(#{2,3})\s+(.*)$/.exec(line);
      if (m) {
        closeList();
        const lvl = Math.min(6, m[1].length + demote);
        html += `<h${lvl}>${m[2]}</h${lvl}>`;
        continue;
      }
      if (/^[-*]\s+/.test(line)) {
        if (!listOpen) { html += '<ul>'; listOpen = true; }
        html += `<li>${line.replace(/^[-*]\s+/, '')}</li>`;
        continue;
      }
      closeList();
      html += `<p>${line}</p>`;
    }
    closeList();
    return html
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  };

  const renderBoard = (board) => {
    const cards = (board.cards ?? []).slice().sort((a, b) => {
      const ao = a.order ?? 99, bo = b.order ?? 99;
      if (ao !== bo) return ao - bo;
      return (b.updated ?? '').localeCompare(a.updated ?? '');
    });

    const cols = ['shipped', 'now', 'next', 'later'];
    let total = 0;
    let shippedCount = 0;

    cols.forEach((col) => {
      const root = document.querySelector(`[data-cards="${col}"]`);
      const countEl = document.querySelector(`[data-count="${col}"]`);
      const filtered = cards.filter((c) => c.status === col);
      countEl.textContent = filtered.length;
      total += filtered.length;
      if (col === 'shipped') shippedCount = filtered.length;
      root.innerHTML = '';

      if (filtered.length === 0) {
        root.insertAdjacentHTML('beforeend',
          `<div class="col-empty">no cards yet</div>`);
        return;
      }

      filtered.forEach((c, idx) => {
        const tags = (c.tags ?? []).map((t, i) =>
          `<span class="tag${i % 2 ? ' tag-blue' : ''}">${escape(t)}</span>`
        ).join('');

        const links = (c.links ?? []).filter(l => l.href && l.href !== '#').map((l) =>
          `<a href="${escape(l.href)}" target="_blank" rel="noopener">${escape(l.label)} ↗</a>`
        ).join('');

        const displayId = `${idPrefix[col]}-${pad2(idx + 1)}`;
        const tagSlugs = (c.tags ?? []).map((t) => t.toLowerCase()).join('|');

        // Stash for the detail modal — keyed by display ID
        cardIndex.set(displayId, { ...c, displayId });

        const html = `
          <button type="button" class="card" data-id="${escape(c.id)}" data-card-id="${displayId}" data-tags="${escape(tagSlugs)}" aria-label="Open details for ${escape(c.title)}">
            <div class="card-meta-top">
              <span class="card-id">${displayId}</span>
              <span class="card-handle" aria-hidden="true">⋮⋮</span>
            </div>
            <div class="card-title">${escape(c.title)}</div>
            ${c.summary ? `<div class="card-summary">${safeRich(c.summary)}</div>` : ''}
            ${tags ? `<div class="card-tags">${tags}</div>` : ''}
            <div class="card-footer">
              <span class="card-footer-left">
                <span>${escape(c.updated ?? '')}</span>
                <span class="card-comments">0</span>
              </span>
              ${c.impact ? `<span class="card-impact">${escape(c.impact)}</span>` : ''}
            </div>
            ${links ? `<div class="card-links">${links}</div>` : ''}
          </button>`;
        root.insertAdjacentHTML('beforeend', html);
      });
    });

    // Toolbar counts
    const totalEl = document.getElementById('board-total-count');
    const shippedEl = document.getElementById('board-shipped-count');
    if (totalEl) totalEl.textContent = total;
    if (shippedEl) shippedEl.textContent = `${shippedCount} shipped`;

    renderFilterChips(cards);
  };

  // Renders the filter chips into the DOM. Skipped when the page is
  // pre-rendered (build-html.js produces the same chip markup statically).
  const renderFilterChips = (cards) => {
    const root = document.getElementById('board-filters');
    if (!root) return;

    const counts = new Map();
    cards.forEach((c) => (c.tags ?? []).forEach((t) => {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }));
    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([t]) => t);

    root.querySelectorAll('[data-filter]:not([data-filter="all"])').forEach(n => n.remove());

    const allChip = root.querySelector('[data-filter="all"]');
    if (allChip) allChip.setAttribute('aria-pressed', 'true');

    top.forEach((tag) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'filter-chip';
      b.dataset.filter = tag.toLowerCase();
      b.setAttribute('aria-pressed', 'false');
      b.textContent = tag;
      root.appendChild(b);
    });
  };

  /* ── Board view modes + tag filter ─────────────────────────────────
     The board has four views: Kanban (default — what build-html prerenders,
     so agents / no-JS see it), Table (sortable/filterable), Spec (long-form
     doc), Timeline (a horizontal Shipped-only ship-log / mini-Gantt).
     The non-default views are built lazily on first switch, mostly from
     cardIndex (already in board order; Timeline is always chronological).
     Tag filter chips dim kanban cards AND table rows (the Spec and Timeline
     views are reading docs — no filter). The audience lens reorders the
     kanban / table / spec; the Timeline stays chronological. */

  let currentFilter = 'all';
  let currentAudience = 'everyone';        // audience lens — see personaSort / applyAudience
  let tableBuilt = false;
  let specsBuilt = false;
  let timelineBuilt = false, timelineInstance = null;
  let tableRows = [];                      // [{ tr, c }] — for sorting
  let tableSort = { key: null, dir: 1 };   // dir: 1 = asc, -1 = desc

  const STATUS_LABEL = { shipped: 'Shipped', now: 'Now', next: 'Next', later: 'Later' };
  const STATUS_RANK  = { shipped: 0, now: 1, next: 2, later: 3 };

  /* ── Audience lens ─────────────────────────────────────────────────
     A reading preset that re-orders cards for a particular reader,
     cutting across every view. Default 'everyone' is a strict no-op, so
     the SSG-prerendered output is unchanged. Just a sort/curation layer
     — no layout change. Higher score = earlier. */
  const scoreFor = (c, persona) => {
    const tags = (c.tags ?? []).map((t) => String(t).toLowerCase());
    const hasImpact = !!(c.impact && String(c.impact).trim());
    const hasLinks = (c.links ?? []).some((l) => l.href && l.href !== '#');
    const is01 = tags.includes('0→1') || tags.includes('0->1');
    switch (persona) {
      case 'hr':            return (c.status === 'shipped' ? 3 : 0) + (hasImpact ? 2 : 0);
      case 'founders':      return (is01 ? 3 : 0) + (c.status === 'next' || c.status === 'later' ? 2 : 0) + (c.status === 'now' ? 1 : 0);
      case 'collaborators': return (c.status === 'now' ? 3 : 0) + (hasLinks ? 1 : 0) + (c.status === 'next' ? 1 : 0);
      default:              return 0;       // 'everyone'
    }
  };
  // Returns a re-ordered COPY. Array.sort is stable, so equal-score cards
  // keep their incoming (board) order; 'everyone' returns the copy untouched.
  const personaSort = (cards, persona) => (persona && persona !== 'everyone')
    ? cards.slice().sort((a, b) => scoreFor(b, persona) - scoreFor(a, persona))
    : cards.slice();
  // All cards, in board order, lensed by the current audience — what the
  // Table / Spec / Timeline views render from.
  const currentCards = () => personaSort([...cardIndex.values()], currentAudience);

  // Toggle `.is-filtered` (CSS hides it) on every card and table row whose
  // data-tags doesn't include the active tag. Re-applied when the table is
  // built so it inherits whatever filter is currently selected.
  const applyFilter = (f) => {
    document.querySelectorAll('.card[data-tags], .board-table tbody tr[data-tags]').forEach((el) => {
      if (f === 'all') { el.classList.remove('is-filtered'); return; }
      const tags = (el.dataset.tags || '').split('|');
      el.classList.toggle('is-filtered', !tags.includes(f));
    });
  };

  // Click delegation for filter chips. Always wired regardless of whether
  // the chips were rendered statically (build-html) or dynamically.
  const wireFilterChipClicks = () => {
    const root = document.getElementById('board-filters');
    if (!root) return;
    root.addEventListener('click', (ev) => {
      const chip = ev.target.closest('.filter-chip');
      if (!chip) return;
      root.querySelectorAll('.filter-chip').forEach(c => {
        c.classList.remove('is-active');
        c.setAttribute('aria-pressed', 'false');
      });
      chip.classList.add('is-active');
      chip.setAttribute('aria-pressed', 'true');
      currentFilter = chip.dataset.filter || 'all';
      applyFilter(currentFilter);
    });
  };

  const sortValue = (c, key) => {
    switch (key) {
      case 'title':   return (c.title ?? '').toLowerCase();
      case 'status':  return STATUS_RANK[c.status] ?? 9;
      case 'tags':    return (c.tags ?? []).join(' ').toLowerCase();
      case 'impact':  return (c.impact ?? '').toLowerCase();
      case 'updated': return c.updated ?? '';                       // YYYY-MM-DD sorts lexically
      case 'links':   return (c.links ?? []).filter(l => l.href && l.href !== '#').length;
      default:        return '';
    }
  };

  // Re-order the tbody rows per tableSort + reflect the state in <th>s.
  const applyTableSort = () => {
    const host = document.getElementById('view-table');
    const tbody = host && host.querySelector('tbody');
    if (!tbody || !tableSort.key || tableRows.length === 0) return;
    const { key, dir } = tableSort;
    tableRows.slice().sort((a, b) => {
      const va = sortValue(a.c, key), vb = sortValue(b.c, key);
      let r = va < vb ? -1 : va > vb ? 1 : 0;
      if (r === 0) {                                                // tiebreak: always title-ascending (intentionally not reversed by dir)
        const ta = (a.c.title ?? '').toLowerCase(), tb = (b.c.title ?? '').toLowerCase();
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      }
      return r * dir;
    }).forEach(({ tr }) => tbody.appendChild(tr));                  // appendChild moves existing nodes
    host.querySelectorAll('th[data-col]').forEach((th) => {
      const arrow = th.querySelector('.sort-arrow');
      if (th.dataset.col === key) {
        th.setAttribute('aria-sort', dir === 1 ? 'ascending' : 'descending');
        if (arrow) arrow.textContent = dir === 1 ? '▲' : '▼';
      } else {
        th.removeAttribute('aria-sort');
        if (arrow) arrow.textContent = '';
      }
    });
  };

  const sortTableBy = (key) => {
    if (tableSort.key === key) tableSort.dir = -tableSort.dir;
    else { tableSort.key = key; tableSort.dir = 1; }
    applyTableSort();
  };

  // Build the <table> into #view-table from cardIndex. Idempotent; called
  // lazily on first switch to the Table view.
  const buildTableView = () => {
    const host = document.getElementById('view-table');
    if (!host) return;
    const cards = currentCards();
    if (cards.length === 0) {
      host.innerHTML = `<p class="table-empty">no cards yet</p>`;
      tableBuilt = true;
      return;
    }
    const COLS = [
      { key: 'title',   label: 'Title' },
      { key: 'status',  label: 'Status' },
      { key: 'tags',    label: 'Tags' },
      { key: 'impact',  label: 'Impact' },
      { key: 'updated', label: 'Updated' },
      { key: 'links',   label: 'Links' },
    ];
    const headHtml = COLS.map((col) =>
      `<th scope="col" data-col="${col.key}"><button type="button" aria-label="Sort by ${col.label}">${col.label}<span class="sort-arrow" aria-hidden="true"></span></button></th>`
    ).join('');
    // Whole rows are clickable (open the card panel). `role="button"` on a
    // `<tr>` overrides the implicit `row` role — a pragmatic clickable-row
    // pattern (cf. Linear/Notion); the row carries `aria-label` + `tabindex=0`
    // and the Enter/Space handler (wireCardOpener) preventDefaults Space, and
    // inner `<a>` clicks pass through. A "purer" alternative (a `<button>` in
    // the title cell) was considered and skipped — it loses whole-row clicks.
    const rowHtml = (c) => {
      const tagSlugs = (c.tags ?? []).map(t => t.toLowerCase()).join('|');
      const links = (c.links ?? []).filter(l => l.href && l.href !== '#')
        .map(l => `<a href="${escape(l.href)}" target="_blank" rel="noopener">${escape(l.label)} ↗</a>`).join('');
      return `<tr data-card-id="${escape(c.displayId)}" data-tags="${escape(tagSlugs)}" tabindex="0" role="button" aria-label="Open details for ${escape(c.title ?? '')}">
        <td class="tt-title">${escape(c.title ?? '')}</td>
        <td class="tt-status">${escape(STATUS_LABEL[c.status] ?? c.status ?? '')}</td>
        <td class="tt-tags">${escape((c.tags ?? []).join(' · '))}</td>
        <td class="tt-impact">${escape(c.impact ?? '')}</td>
        <td class="tt-updated">${escape(c.updated ?? '')}</td>
        <td class="tt-links">${links}</td>
      </tr>`;
    };
    host.innerHTML = `<table class="board-table">
      <thead><tr>${headHtml}</tr></thead>
      <tbody>${cards.map(rowHtml).join('')}</tbody>
    </table>`;

    const tbody = host.querySelector('tbody');
    tableRows = Array.from(tbody.querySelectorAll('tr[data-card-id]')).map((tr, i) => ({ tr, c: cards[i] }));
    host.querySelectorAll('th[data-col] button').forEach((btn) => {
      btn.addEventListener('click', () => sortTableBy(btn.closest('th').dataset.col));
    });
    applyFilter(currentFilter);
    // Rows arrive in personaSort order (the audience lens); a column the user
    // has explicitly sorted by takes precedence over that. No-op if unsorted.
    applyTableSort();
    tableBuilt = true;
  };

  // Build the long-form Spec view into #view-specs from cardIndex — every
  // card with its `details` expanded, grouped by status. A reading view:
  // no filter integration (the tag chips are a board affordance).
  const buildSpecView = () => {
    const host = document.getElementById('view-specs');
    if (!host) return;
    const cards = currentCards();
    if (cards.length === 0) {
      host.innerHTML = `<p class="spec-empty">no cards yet</p>`;
      specsBuilt = true;
      return;
    }
    const cardSection = (c) => {
      const tags = (c.tags ?? []).map((t, i) =>
        `<span class="tag${i % 2 ? ' tag-blue' : ''}">${escape(t)}</span>`).join('');
      const links = (c.links ?? []).filter(l => l.href && l.href !== '#')
        .map(l => `<a href="${escape(l.href)}" target="_blank" rel="noopener">${escape(l.label)} ↗</a>`).join('');
      const details = mini(c.details, { demote: 3 });   // spec-card titles are <h4> → headings here at <h5>/<h6>
      const foot = [
        c.updated ? `<span class="spec-card-updated">updated ${escape(c.updated)}</span>` : '',
        c.impact ? `<span class="spec-card-impact">${escape(c.impact)}</span>` : '',
      ].filter(Boolean).join('');
      return `<section class="spec-card" aria-labelledby="spec-${escape(c.displayId)}">
        <p class="spec-card-id">${escape(c.displayId)}</p>
        <h4 class="spec-card-title" id="spec-${escape(c.displayId)}">${escape(c.title ?? '')}</h4>
        ${c.summary ? `<p class="spec-card-summary">${safeRich(c.summary)}</p>` : ''}
        ${tags ? `<div class="spec-card-tags">${tags}</div>` : ''}
        ${details ? `<div class="spec-card-body">${details}</div>` : ''}
        ${foot ? `<p class="spec-card-foot">${foot}</p>` : ''}
        ${links ? `<div class="spec-card-links">${links}</div>` : ''}
      </section>`;
    };
    const groups = ['shipped', 'now', 'next', 'later'].map((s) => {
      const gc = cards.filter((c) => c.status === s);
      if (gc.length === 0) return '';
      return `<section class="spec-group">
        <h3 class="spec-group-head">${STATUS_LABEL[s]} <span class="spec-group-count">${gc.length}</span></h3>
        ${gc.map(cardSection).join('')}
      </section>`;
    }).join('');
    host.innerHTML = `<div class="spec-doc">${groups}</div>`;
    specsBuilt = true;
  };

  // ── Timeline view ──────────────────────────────────────────────────
  // Roadmap → Timeline renders a real interactive timeline (drag to pan,
  // ⌃-scroll to zoom) via the vendored vis-timeline library, loaded lazily
  // the first time the tab is opened. One item per Shipped card: a `range`
  // bar [`started` → `updated`] when a `started` date is given, otherwise a
  // `point` (a dot at the ship date — no fake width). vis lane-stacks
  // overlapping items; a "current time" line marks today. Clicking an item
  // opens its card-detail panel. Only Shipped cards; the audience lens
  // doesn't apply (always chronological).

  const VIS_TIMELINE_VER = '8.5.1';
  // Lazily load the vendored vis-timeline bundle (≈540 KB) + its stylesheet,
  // once. Resolves with the global `vis` (which carries Timeline + DataSet).
  let visTimelinePromise = null;
  const loadVisTimeline = () => {
    if (window.vis && window.vis.Timeline) return Promise.resolve(window.vis);
    if (visTimelinePromise) return visTimelinePromise;
    visTimelinePromise = new Promise((resolve, reject) => {
      const base = 'vendor/vis-timeline/vis-timeline-graph2d.min';
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `${base}.css?v=${VIS_TIMELINE_VER}`;
      document.head.appendChild(link);
      const s = document.createElement('script');
      s.src = `${base}.js?v=${VIS_TIMELINE_VER}`;
      s.onload = () => (window.vis && window.vis.Timeline)
        ? resolve(window.vis)
        : reject(new Error('vis-timeline loaded but window.vis is missing'));
      s.onerror = () => reject(new Error('failed to load vendor/vis-timeline'));
      document.head.appendChild(s);
    });
    return visTimelinePromise;
  };

  const buildTimelineView = () => {
    const host = document.getElementById('view-timeline');
    if (!host) return;

    // Shipped + Now: the two statuses with real dates. Next/Later have no
    // `started` (only the card's last-edit `updated`), so they'd have nowhere
    // to sit on a date axis — they stay in the Board/Table/Specs views.
    const cards = [...cardIndex.values()].filter((c) => c.status === 'shipped' || c.status === 'now');
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    // 'YYYY-MM-DD' / 'YYYY-MM' → 'YYYY-MM-DD' (DD defaults to 01); null if it
    // doesn't look like a date.
    const isoDate = (d) => {
      const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(String(d ?? ''));
      return m ? `${m[1]}-${m[2]}-${m[3] || '01'}` : null;
    };
    const toDate  = (iso) => new Date(`${iso}T12:00:00`);   // local noon — dodges DST edges
    const fmtFull = (iso) => { const [y, mo, da] = iso.split('-').map(Number); return `${MONTHS[mo - 1]} ${da}, ${y}`; };
    const NOW = new Date();    // live "today" — in-progress projects extend to here

    // Colour-by-category: a card's "category" is its first tag (or "Other").
    // Categories get a palette tone in first-seen order — the first 4 distinct
    // ones get named tones 1–4, anything beyond shares the neutral tone 0.
    // (Tone colours live in styles/main.css as `.vt-tone-N { --tone-fill/-stroke }`.)
    const TONE_COUNT = 4;
    const categoryOf = (c) => (c.tags && c.tags.length ? c.tags[0] : 'Other');
    const toneOf = new Map();          // category → tone index (0…TONE_COUNT)
    cards.forEach((c) => {
      const cat = categoryOf(c);
      if (!toneOf.has(cat)) toneOf.set(cat, toneOf.size < TONE_COUNT ? toneOf.size + 1 : 0);
    });
    const legendItems = [...toneOf.entries()].filter(([, t]) => t >= 1).map(([cat, t]) => ({ tone: t, label: cat }));
    if ([...toneOf.values()].includes(0)) legendItems.push({ tone: 0, label: 'Other' });

    // One vis item per card. Shipped → a `range` [started, updated] (if a
    // `started` date is given and is earlier), else a `point` at `updated`.
    // Now → a `range` [started, today] (open-ended, marked `vt-now`), or a
    // `point` at `updated`/today if there's no `started`.
    const visItems = [];
    let nShipped = 0, nNow = 0;
    cards.forEach((c) => {
      const start = isoDate(c.started);
      const end   = isoDate(c.updated);
      const tone  = `vt-tone-${toneOf.get(categoryOf(c))}`;
      let span, dateText, cls;
      if (c.status === 'now') {
        nNow++;
        cls = `vt-item ${tone} vt-now`;
        if (start)    { span = { start: toDate(start), end: NOW, type: 'range' }; dateText = `in progress · since ${fmtFull(start)}`; }
        else if (end) { span = { start: toDate(end), type: 'point' };             dateText = `in progress · updated ${fmtFull(end)}`; }
        else          { span = { start: NOW, type: 'point' };                     dateText = 'in progress'; }
      } else {                                   // shipped
        if (!end) return;
        nShipped++;
        cls = `vt-item ${tone}`;
        if (start != null && start < end) { span = { start: toDate(start), end: toDate(end), type: 'range' }; dateText = `${fmtFull(start)} → ${fmtFull(end)}`; }
        else                              { span = { start: toDate(end), type: 'point' };                    dateText = fmtFull(end); }
      }
      visItems.push({
        id: c.displayId,
        content: `<span class="vt-id">${escape(c.displayId)}</span> ${escape(c.title ?? '')}`,
        title: `${escape(c.title ?? '')} · ${escape(dateText)}`,    // hover tooltip
        ...span,
        className: cls,
      });
    });

    const headMain = nNow > 0 ? 'Shipped &amp; in&nbsp;progress' : 'Shipped';
    const headHtml = `<h3 class="timeline-head">${headMain} <span class="timeline-head-note">— a project timeline, by date</span></h3>`;
    if (visItems.length === 0) {
      host.innerHTML = `<div class="timeline-doc"><h3 class="timeline-head">Timeline <span class="timeline-head-note">— a project timeline, by date</span></h3><p class="timeline-empty">nothing on the timeline yet</p></div>`;
      timelineBuilt = true;
      return;
    }
    const legendHtml = legendItems.length >= 2
      ? `<div class="vt-legend">${legendItems.map((L) => `<span class="vt-legend-item vt-tone-${L.tone}"><span class="vt-swatch" aria-hidden="true"></span>${escape(L.label)}</span>`).join('')}${nNow > 0 ? `<span class="vt-legend-item vt-legend-now"><span class="vt-swatch" aria-hidden="true"></span>in progress</span>` : ''}</div>`
      : (nNow > 0 ? `<div class="vt-legend"><span class="vt-legend-item vt-legend-now"><span class="vt-swatch" aria-hidden="true"></span>in progress</span></div>` : '');

    host.innerHTML = `<div class="timeline-doc">${headHtml}${legendHtml}<div class="vt-host" aria-label="Shipped and in-progress projects on a timeline">loading…</div><p class="tl-hint">drag to pan · Ctrl-scroll to zoom · click an item to open the project</p></div>`;
    timelineBuilt = true;   // claim it now so a second tab-click doesn't re-load the bundle

    // Window bounds: around the data + today, with margin (so an item near the
    // edge has room for its label spilling out) plus extra pan room beyond.
    const DAY = 86400000;
    const stamps = visItems.flatMap((it) => [it.start.getTime(), it.end ? it.end.getTime() : null]).filter((n) => n != null);
    stamps.push(Date.now());
    const lo = Math.min(...stamps), hi = Math.max(...stamps);
    const winPad = Math.max(DAY * 14, (hi - lo) * 0.1);
    const panPad = Math.max(DAY * 60, (hi - lo) * 0.35);

    loadVisTimeline().then((vis) => {
      const el = host.querySelector('.vt-host');
      if (!el) return;
      el.textContent = '';
      if (timelineInstance) { try { timelineInstance.destroy(); } catch (_) { /* noop */ } timelineInstance = null; }
      timelineInstance = new vis.Timeline(el, new vis.DataSet(visItems), {
        locale: 'en',                 // pin English month names — vis otherwise sniffs navigator.language
        orientation: { axis: 'top', item: 'top' },
        align: 'auto',
        stack: true,
        margin: { item: { horizontal: 12, vertical: 8 }, axis: 14 },
        min: new Date(lo - panPad),
        max: new Date(hi + panPad),
        start: new Date(lo - winPad),
        end: new Date(hi + winPad),
        zoomMin: DAY * 21,            // don't let it zoom in past ~3 weeks…
        zoomMax: DAY * 366 * 25,      // …or out past ~25 years
        zoomKey: 'ctrlKey',           // plain wheel scrolls the page; Ctrl-wheel zooms
        showCurrentTime: true,        // the "today" line
        selectable: true,
        multiselect: false,
        editable: false,
        clickToUse: false,
        maxHeight: 460,
        tooltip: { followMouse: true, overflowMethod: 'cap' },
      });
      timelineInstance.on('select', (props) => {
        const id = props.items && props.items[0];
        if (id != null) { openCardModal(String(id)); timelineInstance.setSelection([]); }
      });
    }).catch((err) => {
      console.error('[timeline]', err);
      const el = host.querySelector('.vt-host');
      if (el) el.innerHTML = `<p class="timeline-empty">couldn’t load the timeline view — ${escape(String((err && err.message) || err))}</p>`;
    });
  };

  // Apply the audience lens: re-order the kanban column DOM nodes in place,
  // and (re)build the order-sensitive flat views (table, specs). 'everyone'
  // restores board order. The Timeline is always chronological so the lens
  // doesn't touch it — and rebuilding it would leak the live vis-timeline
  // instance, so we deliberately leave `timelineBuilt` alone. Note: the lens
  // is purely a visual curation layer — the card-detail panel's ↑/↓ nav (and
  // its "N / M" indicator) stay in the canonical board order, not the lensed
  // order, since "next card" would otherwise be view-dependent.
  const applyAudience = (persona) => {
    currentAudience = (persona && persona !== 'everyone') ? persona : 'everyone';
    const orderIdx = new Map();
    orderedIds().forEach((id, i) => orderIdx.set(id, i));
    ['shipped', 'now', 'next', 'later'].forEach((status) => {
      const root = document.querySelector(`[data-cards="${status}"]`);
      if (!root) return;
      const pairs = Array.from(root.querySelectorAll('.card[data-card-id]'))
        .map((n) => ({ n, c: cardIndex.get(n.dataset.cardId), o: orderIdx.get(n.dataset.cardId) ?? 0 }))
        .filter((p) => p.c);
      pairs.sort((a, b) => {
        const s = (currentAudience === 'everyone') ? 0 : (scoreFor(b.c, currentAudience) - scoreFor(a.c, currentAudience));
        return s !== 0 ? s : a.o - b.o;                  // tie / 'everyone' → board order
      });
      pairs.forEach(({ n }) => root.appendChild(n));
    });
    // Flat views order via personaSort on build — invalidate, and rebuild any
    // that's currently visible so the change is immediate. (Timeline excluded:
    // chronological, and not safe to blindly rebuild — see comment above.)
    tableBuilt = specsBuilt = false;
    const rebuildIfVisible = (id, build) => { const el = document.getElementById(id); if (el && !el.hidden) build(); };
    rebuildIfVisible('view-table', buildTableView);
    rebuildIfVisible('view-specs', buildSpecView);
  };

  // The four view panels, keyed by their tab's data-view value.
  const VIEW_PANELS = { board: 'board', table: 'view-table', specs: 'view-specs', timeline: 'view-timeline' };

  // Switch the active board view. Only tabs carrying [data-view] are
  // switchable; disabled ones are ignored. The non-default views
  // (table, specs, timeline) are built lazily on first activation.
  const switchView = (view) => {
    document.querySelectorAll('.board-views .view-tab').forEach((t) => {
      const active = t.dataset.view === view;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
      if (t.dataset.view) t.tabIndex = active ? 0 : -1;
    });
    // Show the active panel, hide the rest — do this FIRST, so the view
    // actually changes even if a lazy build below throws.
    Object.entries(VIEW_PANELS).forEach(([v, id]) => {
      const el = document.getElementById(id);
      if (el) el.hidden = (v !== view);
    });
    // Build the non-default views lazily on first activation. Guard it so a
    // build error surfaces (console + an in-panel message) instead of leaving
    // the view blank with no clue why.
    try {
      if (view === 'table'    && !tableBuilt)    buildTableView();
      if (view === 'specs'    && !specsBuilt)    buildSpecView();
      if (view === 'timeline' && !timelineBuilt) buildTimelineView();
    } catch (e) {
      console.error('[render] failed to build view:', view, e);
      const el = document.getElementById(VIEW_PANELS[view]);
      if (el) el.innerHTML = `<p style="padding:24px;color:var(--color-text-faint);font-family:var(--font-mono);font-size:13px;">Couldn’t build this view — ${escape(String((e && e.message) || e))}</p>`;
    }
    // vis-timeline can't size itself while its panel is display:none, so a
    // redraw on (re-)show fixes a timeline that was built/grew while hidden.
    if (view === 'timeline' && timelineInstance) {
      try { timelineInstance.redraw(); } catch (_) { /* a transient redraw hiccup shouldn't nuke the view */ }
    }
  };

  const wireViewTabs = () => {
    const list = document.querySelector('.board-views');
    if (!list) return;
    const enabledTabs = () => Array.from(list.querySelectorAll('.view-tab[data-view]'));
    list.addEventListener('click', (ev) => {
      const tab = ev.target.closest('.view-tab[data-view]');
      if (tab) switchView(tab.dataset.view);
    });
    // Roving-tabindex arrow nav (ARIA tablist pattern).
    list.addEventListener('keydown', (ev) => {
      if (!ev.target.closest('.view-tab[data-view]')) return;
      const tabs = enabledTabs();
      const i = tabs.indexOf(ev.target);
      let next = null;
      if (ev.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
      else if (ev.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
      else if (ev.key === 'Home') next = tabs[0];
      else if (ev.key === 'End') next = tabs[tabs.length - 1];
      if (next) { ev.preventDefault(); next.focus(); switchView(next.dataset.view); }
    });
    enabledTabs().forEach((t) => { t.tabIndex = t.classList.contains('is-active') ? 0 : -1; });

    // Open the card-detail panel when an element matching `sel` (carrying
    // data-card-id) inside `containerId` is clicked or Enter/Space-activated.
    // Used by the Table view (table rows). The Timeline view wires its own
    // open-on-select handler (vis-timeline owns those clicks).
    const wireCardOpener = (containerId, sel) => {
      const host = document.getElementById(containerId);
      if (!host) return;
      host.addEventListener('click', (ev) => {
        if (ev.target.closest('a')) return;                        // let link clicks through
        const el = ev.target.closest(sel);
        if (el) openCardModal(el.dataset.cardId);
      });
      host.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        const el = ev.target.closest(sel);
        if (el && document.activeElement === el) { ev.preventDefault(); openCardModal(el.dataset.cardId); }
      });
    };
    wireCardOpener('view-table', 'tr[data-card-id]');

    // Audience lens — re-order cards per reader (no-op for 'everyone').
    document.getElementById('audience-lens')?.addEventListener('change', (ev) => applyAudience(ev.target.value));
  };

  const renderLens = (lens) => {
    if (lens.head) {
      $('#lens-cmd').textContent  = lens.head.cmd  ?? '';
      $('#lens-title').textContent = lens.head.title ?? '';
      $('#lens-meta').textContent  = lens.head.meta  ?? '';
    }
    const list = $('#lens-list');
    list.innerHTML = '';
    (lens.items ?? []).forEach((it) => {
      const aside = it.aside ? `<em>${escape(it.aside)}</em>` : '';
      list.insertAdjacentHTML('beforeend', `
        <div class="lens-card">
          <div class="lens-num">${escape(it.num ?? '')}</div>
          <div class="lens-text">${escape(it.main ?? '')}${aside}</div>
        </div>`);
    });
  };

  const renderContact = (contact) => {
    if (contact.head) {
      $('#contact-cmd').textContent  = contact.head.cmd  ?? '';
      $('#contact-title').textContent = contact.head.title ?? '';
    }
    $('#contact-intro').innerHTML = safeRich(contact.intro ?? '');

    const list = $('#contact-list');
    list.innerHTML = '';
    (contact.items ?? []).forEach((it) => {
      const a = document.createElement('a');
      a.href = it.href ?? '#';
      if (it.href?.startsWith('http')) {
        a.target = '_blank';
        a.rel = 'noopener';
      }
      a.innerHTML = `<span class="key">${escape(it.key ?? '')}</span><span>${escape(it.label ?? '')}</span>`;
      list.appendChild(a);
    });
  };

  /* ── Card detail panel ─────────────────────────────────────────── */
  const statusLabel = { shipped: 'Shipped', now: 'Now', next: 'Next', later: 'Later' };
  let currentCardId = null;

  const openCardModal = (displayId) => {
    const c = cardIndex.get(displayId);
    if (!c) return;
    currentCardId = displayId;

    const modal    = $('#card-modal');
    const backdrop = $('#modal-backdrop');
    const panelBody = $('.panel-body');
    if (!modal || !backdrop || !panelBody) return;

    // Build the entire panel body in a single string + commit with one
    // innerHTML write. The previous code did 9 separate textContent /
    // innerHTML mutations which each forced style recalc; combined with
    // the slide-in transition that pushed card-open INP to ~1s. One write
    // collapses the layout work into a single frame.
    const tagsHtml = (c.tags ?? []).map((t, i) =>
      `<span class="tag${i % 2 ? ' tag-blue' : ''}">${escape(t)}</span>`
    ).join('');

    const linksHtml = (c.links ?? [])
      .filter(l => l.href && l.href !== '#')
      .map((l) => `<a href="${escape(l.href)}" target="_blank" rel="noopener">${escape(l.label)} ↗</a>`)
      .join('');

    const detailsHtml = mini(c.details);
    const statusText  = statusLabel[c.status] ?? c.status;

    panelBody.innerHTML = `
      <div class="modal-meta-top">
        <span class="modal-id" id="modal-id">${escape(displayId)}</span>
        <span class="modal-status s-${escape(c.status)}" id="modal-status">${escape(statusText)}</span>
      </div>
      <h2 class="modal-title" id="modal-title">${escape(c.title ?? '')}</h2>
      <p class="modal-summary" id="modal-summary">${escape(c.summary ?? '')}</p>
      <div class="modal-tags" id="modal-tags">${tagsHtml}</div>
      <div class="modal-details" id="modal-details">${detailsHtml}</div>
      <div class="modal-foot">
        <span class="modal-updated" id="modal-updated">${c.updated ? `updated ${escape(c.updated)}` : ''}</span>
        <span class="modal-impact" id="modal-impact">${escape(c.impact ?? '')}</span>
      </div>
      <div class="modal-links" id="modal-links">${linksHtml}</div>`;

    // Position indicator + prev/next disabled state (3 small writes; cheap)
    const ids = orderedIds();
    const idx = ids.indexOf(displayId);
    $('#panel-position').textContent = `${idx + 1} / ${ids.length}`;
    $('#panel-prev').disabled = idx <= 0;
    $('#panel-next').disabled = idx >= ids.length - 1;

    panelBody.scrollTop = 0;

    if (!document.body.classList.contains('modal-open')) {
      backdrop.hidden = false;
      // Force reflow so the slide-in transition fires from translateX(100%)
      void modal.offsetWidth;
      backdrop.classList.add('is-open');
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('modal-open');
      $('#modal-close')?.focus();
    }

    // Sync URL hash for deep-linking; don't re-trigger open
    if (location.hash !== `#card/${displayId}`) {
      history.replaceState(null, '', `#card/${displayId}`);
    }
  };

  const closeCardModal = () => {
    const modal    = $('#card-modal');
    const backdrop = $('#modal-backdrop');
    if (!modal || !backdrop) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    backdrop.classList.remove('is-open');
    document.body.classList.remove('modal-open');
    currentCardId = null;
    setTimeout(() => { if (!backdrop.classList.contains('is-open')) backdrop.hidden = true; }, 250);

    if (location.hash.startsWith('#card/')) {
      history.replaceState(null, '', location.pathname + location.search);
    }
  };

  const navCard = (delta) => {
    if (!currentCardId) return;
    const ids = orderedIds();
    const idx = ids.indexOf(currentCardId);
    const nextIdx = idx + delta;
    if (nextIdx < 0 || nextIdx >= ids.length) return;
    openCardModal(ids[nextIdx]);
  };

  /* ── Theme toggle ───────────────────────────────────────────────────
     The inline <head> script already set <html data-theme> (resolved
     light|dark) and data-theme-mode (auto|light|dark) from localStorage / the
     OS. Here we wire the topnav button to cycle auto → light → dark, keep
     "auto" tracking the OS as it changes, and nudge the giscus iframe to match. */
  const THEME_MODES = ['auto', 'light', 'dark'];
  const themeStored = () => { try { const t = localStorage.getItem('theme'); return (t === 'light' || t === 'dark') ? t : 'auto'; } catch (_) { return 'auto'; } };
  const osDark = () => !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const resolvedTheme = (mode) => (mode === 'auto') ? (osDark() ? 'dark' : 'light') : mode;
  const syncGiscus = (theme) => {
    try { document.querySelector('iframe.giscus-frame')?.contentWindow?.postMessage({ giscus: { setConfig: { theme } } }, 'https://giscus.app'); } catch (_) { /* noop */ }
  };
  const applyTheme = (mode) => {
    const t = resolvedTheme(mode);
    document.documentElement.setAttribute('data-theme', t);
    document.documentElement.setAttribute('data-theme-mode', mode);
    syncGiscus(t);
  };
  const themeLabel = (mode) => mode === 'auto' ? 'Theme: auto (follows your system) — click for light'
    : mode === 'light' ? 'Theme: light — click for dark'
    : 'Theme: dark — click for auto';
  const wireTheme = () => {
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      const refreshLabel = (mode) => { btn.setAttribute('aria-label', themeLabel(mode)); btn.title = themeLabel(mode); };
      refreshLabel(themeStored());
      btn.addEventListener('click', () => {
        const next = THEME_MODES[(THEME_MODES.indexOf(themeStored()) + 1) % THEME_MODES.length];
        try { if (next === 'auto') localStorage.removeItem('theme'); else localStorage.setItem('theme', next); } catch (_) { /* noop */ }
        applyTheme(next);
        refreshLabel(next);
      });
    }
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => { if (themeStored() === 'auto') applyTheme('auto'); };
      if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
    }
    // When giscus (re)loads its iframe, push the current theme to it.
    window.addEventListener('message', (ev) => {
      if (ev.origin === 'https://giscus.app' && ev.data && typeof ev.data === 'object' && 'giscus' in ev.data) syncGiscus(resolvedTheme(themeStored()));
    });
    syncGiscus(resolvedTheme(themeStored()));   // in case the iframe is already up
  };

  /* ── Hero "ask this portfolio" bar ──────────────────────────────────
     With the antares-qa Worker (site.json → qa.workerUrl) it answers
     inline; without one it opens the ⌘K palette pre-filled with the
     question (the palette has the hand-authored FAQ retrieval). */
  const wireHeroAsk = (site) => {
    const form = document.getElementById('hero-ask-form');
    const input = document.getElementById('hero-ask-input');
    const ans = document.getElementById('hero-ask-answer');
    if (!form || !input || !ans) return;
    const url = String((site && site.qa && site.qa.workerUrl) || '').trim();
    const show = (html, cls) => { ans.className = `hero-ask-answer${cls ? ' ' + cls : ''}`; ans.innerHTML = html; ans.hidden = false; };
    const openPalette = (q) => {
      document.getElementById('palette-fab')?.click();
      setTimeout(() => {
        const pi = document.getElementById('palette-input');
        if (pi) { pi.value = q; pi.dispatchEvent(new Event('input', { bubbles: true })); pi.focus(); }
      }, 60);
    };
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      if (!url) { ans.hidden = true; openPalette(q); return; }
      show('thinking…', 'is-thinking');
      fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q }) })
        .then(async (r) => {
          let data = {};
          try { data = await r.json(); } catch (_) { /* non-JSON */ }
          if (r.ok && data && data.answer) {
            show(`<p class="hero-ask-answer-text">${escape(String(data.answer)).replace(/\n+/g, '<br>')}</p>`
              + `<p class="hero-ask-note">✨ generated from this site's content — answers reflect the data here, not me</p>`);
          } else {
            const why = (data && data.error) ? ` (${escape(String(data.error))})` : '';
            show(`<p class="hero-ask-answer-text">Couldn’t get an answer right now${why}.</p>`
              + `<p class="hero-ask-note">Press ⌘K to search the site instead.</p>`);
          }
        })
        .catch(() => show(`<p class="hero-ask-answer-text">Couldn’t reach the answer service.</p>`
          + `<p class="hero-ask-note">Press ⌘K to search the site instead.</p>`));
    });
    input.addEventListener('input', () => { if (!input.value.trim()) ans.hidden = true; });
  };

  const wireModal = () => {
    // Card click → open
    document.addEventListener('click', (ev) => {
      const card = ev.target.closest('.card[data-card-id]');
      if (!card) return;
      ev.preventDefault();
      openCardModal(card.dataset.cardId);
    });

    // Header buttons
    $('#modal-close')?.addEventListener('click', closeCardModal);
    $('#panel-prev') ?.addEventListener('click', () => navCard(-1));
    $('#panel-next') ?.addEventListener('click', () => navCard(+1));
    $('#modal-backdrop')?.addEventListener('click', closeCardModal);

    // Keyboard: ESC close, ↑ prev, ↓ next
    document.addEventListener('keydown', (ev) => {
      if (!document.body.classList.contains('modal-open')) return;
      if (ev.key === 'Escape')   { ev.preventDefault(); closeCardModal(); }
      if (ev.key === 'ArrowUp')  { ev.preventDefault(); navCard(-1); }
      if (ev.key === 'ArrowDown'){ ev.preventDefault(); navCard(+1); }
    });

    // Hash router: open on initial load + on navigation
    const handleHash = () => {
      const m = /^#card\/(.+)$/.exec(location.hash);
      if (m) openCardModal(m[1]);
      else if (document.body.classList.contains('modal-open')) closeCardModal();
    };
    window.addEventListener('hashchange', handleHash);
    setTimeout(handleHash, 0);

    // Cross-surface: terminal can request a card open via custom event
    document.addEventListener('agent:open-card', (ev) => {
      const id = ev.detail?.id;
      if (id) openCardModal(id);
    });
  };

  /* ── Boot ───────────────────────────────────────────────────────── */
  (async () => {
    try {
      const [site, profile, board, lens, contact] = await Promise.all([
        json('content/site.json'),
        json('content/profile.json'),
        json('content/board.json'),
        json('content/lens.json'),
        json('content/contact.json'),
      ]);
      // If the page was pre-rendered by scripts/build-html.js, the DOM is
      // already populated with identical content. Skip the populate pass so
      // we avoid a redundant innerHTML rewrite (and the brief flicker that
      // would cause). We still need cardIndex populated for the side-panel
      // nav and for the agent:open-card cross-surface event.
      const prerendered = document.documentElement.dataset.prerendered === 'true';
      if (prerendered) {
        // Hydrate cardIndex from the same data the build script used —
        // no DOM mutation, just the in-memory Map for modal/terminal nav.
        const sorted = (board.cards ?? []).slice().sort((a, b) => {
          const ao = a.order ?? 99, bo = b.order ?? 99;
          if (ao !== bo) return ao - bo;
          return (b.updated ?? '').localeCompare(a.updated ?? '');
        });
        const cols = ['shipped', 'now', 'next', 'later'];
        cols.forEach((col) => {
          sorted.filter(c => c.status === col).forEach((c, idx) => {
            const displayId = `${idPrefix[col]}-${pad2(idx + 1)}`;
            cardIndex.set(displayId, { ...c, displayId });
          });
        });
      } else {
        renderMeta(site);
        renderHero(profile);
        renderBoard(board);
        renderLens(lens);
        renderContact(contact);
      }
      // Wire interactive behavior — needed in both prerendered and runtime
      // modes since build-html.js only emits markup, not event listeners.
      wireFilterChipClicks();
      wireViewTabs();
      wireModal();
      wireTheme();
      wireHeroAsk(site);
    } catch (e) {
      console.error('[render]', e);
      const main = document.querySelector('main');
      if (main) {
        main.insertAdjacentHTML('afterbegin',
          `<div style="padding:16px;background:#FFE56B;border-radius:6px;font-family:monospace;font-size:13px;">
            content load failed — check that /content/*.json files exist and are valid JSON. error: ${escape(e.message)}
           </div>`);
      }
    }
  })();
})();
