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
    /* Resolve content paths from the site root, not the current directory.
       These are written as 'content/*.json' — relative — which is correct at
       "/" and 404s everywhere else. /personal/ mirrors the home page, so it
       ran the same code from one level down and asked for
       /personal/content/profile.json, which does not exist: the page rendered
       with an error banner and empty charts.

       Only bare relative paths are touched; absolute URLs and paths that are
       already root-relative pass through untouched. */
    const url = /^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith('/') ? path : `/${path}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
    return res.json();
  };

  /* ── Renderers ──────────────────────────────────────────────────── */

  /* The topnav "updated <date>" stamp.

     Two writers, and precedence matters:
       1. site.json footer.lastUpdated — an explicit pin by the site owner,
          which must win over everything.
       2. the usage Worker's data watermark — the live path, set once usage
          data lands (see the refetch handler).
     The build-time value baked into index.html is only the fallback for
     visitors whose usage fetch never completes.

     `dataDatePinned` records case 1 so the live path cannot overwrite a
     deliberate pin. Monotonic: never moves the label backwards, so a stale
     edge-cached response can't make the page look older than it already
     claims. */
  let dataDatePinned = false;
  let dataDateMs = 0;
  const stampDataDate = (ms) => {
    if (dataDatePinned) return;
    if (!Number.isFinite(ms) || ms <= 0) return;
    if (ms <= dataDateMs) return;                 // monotonic
    const el = document.getElementById('last-updated');
    if (!el) return;
    // Local calendar date, matching how the rest of the page renders dates.
    const d = new Date(ms);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    dataDateMs = ms;
    el.textContent = `updated ${iso}`;
  };

  const renderMeta = (site) => {
    document.title = site.meta?.title ?? document.title;
    if (site.meta?.lang) document.documentElement.lang = site.meta.lang;
    if (site.meta?.description) {
      const m = document.querySelector('meta[name="description"]');
      if (m) m.setAttribute('content', site.meta.description);
    }
    $('#brand-name').textContent = site.meta?.title?.split('—')[0]?.trim() ?? '';
    // A pinned footer.lastUpdated is the owner's explicit choice, so it wins
    // over both the build-time value and the live data watermark.
    if (site.footer?.lastUpdated) {
      $('#last-updated').textContent = `updated ${site.footer.lastUpdated}`;
      dataDatePinned = true;
    }
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
        `<span class="sep">·</span><span class="now-pill">${escape(profile.status)}</span>`);
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

  // Card "end date" — formerly always `c.updated` (a YYYY-MM-DD); now also
  // honours `c.present: true` which means "no fixed end date, still active".
  // Present cards sort like today, display as 'ongoing', and on the timeline
  // get an open-ended range like a `now`-status card. Existing cards without
  // the field continue to behave exactly as before (falsy `present`).
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const cardEndKey  = (c) => (c && c.present) ? todayISO()        : (c?.updated ?? '');
  const cardEndText = (c) => (c && c.present) ? 'ongoing'          : (c?.updated ?? '');
  const cardEndFootLabel = (c) =>
    (c && c.present) ? 'ongoing'
    : (c && c.updated) ? `until ${c.updated}` : '';

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
  // Video auto-embed (YouTube / Vimeo / Bilibili). Returns the embed URL for
  // a recognised video URL, else null. IDs are tight so the iframe src is safe.
  const videoEmbedUrl = (url) => {
    let m;
    if ((m = /(?:youtube\.com\/(?:watch\?(?:[^"]*&)?v=|shorts\/|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(url))) return 'https://www.youtube-nocookie.com/embed/' + m[1];
    if ((m = /vimeo\.com\/(?:video\/)?(\d{6,12})/.exec(url))) return 'https://player.vimeo.com/video/' + m[1];
    if ((m = /bilibili\.com\/video\/(BV[A-Za-z0-9]{8,12})/.exec(url))) return 'https://player.bilibili.com/player.html?bvid=' + m[1] + '&page=1&high_quality=1';
    return null;
  };
  const videoEmbedHtml = (src) => `<div class="video-embed"><iframe src="${src}" title="Embedded video" loading="lazy" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
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
      // a line that's *just* a recognised video URL → an inline player.
      // Gated to "one token" so an inline URL inside prose stays a hyperlink.
      const vsrc = /^\S+$/.test(line) && videoEmbedUrl(line.replace(/&amp;/g, '&'));
      if (vsrc) { html += videoEmbedHtml(vsrc); continue; }
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
      // Sort by end-date desc; `present` cards sort like today (top).
      return cardEndKey(b).localeCompare(cardEndKey(a));
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
          <a class="card" href="/work/${escape(c.slug || '')}/" data-id="${escape(c.id)}" data-card-id="${displayId}" data-tags="${escape(tagSlugs)}" aria-label="Open details for ${escape(c.title)}">
            <div class="card-meta-top">
              <span class="card-id">${displayId}</span>
              <span class="card-handle" aria-hidden="true">⋮⋮</span>
            </div>
            <div class="card-title">${escape(c.title)}</div>
            ${c.summary ? `<div class="card-summary">${safeRich(c.summary)}</div>` : ''}
            ${tags ? `<div class="card-tags">${tags}</div>` : ''}
            <div class="card-footer">
              <span class="card-footer-left">
                <span>${escape(cardEndText(c))}</span>
                <span class="card-comments">0</span>
              </span>
              ${c.impact ? `<span class="card-impact">${escape(c.impact)}</span>` : ''}
            </div>
            ${links ? `<div class="card-links">${links}</div>` : ''}
          </a>`;
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
      case 'updated': return cardEndKey(c);                         // YYYY-MM-DD; `present` sorts as today
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
      { key: 'updated', label: 'Until' },
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
        <td class="tt-updated">${escape(cardEndText(c))}</td>
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
      const endLabel = cardEndFootLabel(c);
      const foot = [
        endLabel ? `<span class="spec-card-updated">${escape(endLabel)}</span>` : '',
        c.impact ? `<span class="spec-card-impact">${escape(c.impact)}</span>` : '',
      ].filter(Boolean).join('<span class="spec-card-sep" aria-hidden="true">·</span>');
      return `<section class="spec-card" data-status="${escape(c.status ?? '')}" aria-labelledby="spec-${escape(c.displayId)}">
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
        <h3 class="spec-group-head"><span class="spec-group-dot" data-status="${s}" aria-hidden="true"></span>${STATUS_LABEL[s]} <span class="spec-group-count">${gc.length}</span></h3>
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

    // One vis item per card. Two regimes:
    //   ongoing  (status="now" OR card.present=true) → open-ended:
    //              range [started, today] if `started`, else point at today.
    //              `c.updated` is ignored when present=true (no fixed end).
    //   closed   (status="shipped" with present=false) → range [started, updated]
    //              when both dates exist and started < updated, else point at updated.
    // `present` lets a shipped card declare "still active under maintenance"
    // and a now-status card pin a specific until-date if it had one.
    const visItems = [];
    let nShipped = 0, nNow = 0;
    cards.forEach((c) => {
      const isOngoing = c.present === true || c.status === 'now';
      const start = isoDate(c.started);
      const end   = isoDate(c.updated);
      const tone  = `vt-tone-${toneOf.get(categoryOf(c))}`;
      let span, dateText, cls;
      if (isOngoing) {
        nNow++;
        cls = `vt-item ${tone} vt-now`;
        if (start)              { span = { start: toDate(start), end: NOW, type: 'range' }; dateText = `ongoing · since ${fmtFull(start)}`; }
        else if (end && !c.present) { span = { start: toDate(end), type: 'point' };          dateText = `ongoing · updated ${fmtFull(end)}`; }
        else                    { span = { start: NOW, type: 'point' };                     dateText = 'ongoing'; }
      } else {                                   // closed (shipped)
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

    const headMain = nNow > 0 ? 'Shipped &amp; ongoing' : 'Shipped';
    const headHtml = `<h3 class="timeline-head">${headMain} <span class="timeline-head-note">— a project timeline, by date</span></h3>`;
    if (visItems.length === 0) {
      host.innerHTML = `<div class="timeline-doc"><h3 class="timeline-head">Timeline <span class="timeline-head-note">— a project timeline, by date</span></h3><p class="timeline-empty">nothing on the timeline yet</p></div>`;
      timelineBuilt = true;
      return;
    }
    const legendHtml = legendItems.length >= 2
      ? `<div class="vt-legend">${legendItems.map((L) => `<span class="vt-legend-item vt-tone-${L.tone}"><span class="vt-swatch" aria-hidden="true"></span>${escape(L.label)}</span>`).join('')}${nNow > 0 ? `<span class="vt-legend-item vt-legend-now"><span class="vt-swatch" aria-hidden="true"></span>ongoing</span>` : ''}</div>`
      : (nNow > 0 ? `<div class="vt-legend"><span class="vt-legend-item vt-legend-now"><span class="vt-swatch" aria-hidden="true"></span>ongoing</span></div>` : '');

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
      let tab = ev.target.closest('.view-tab[data-view]');
      if (!tab) {                       // clicked the segmented control's gap/padding — snap to the nearest tab by x
        const x = ev.clientX; let best = Infinity;
        enabledTabs().forEach((t) => {
          const r = t.getBoundingClientRect();
          const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
          if (d < best) { best = d; tab = t; }
        });
      }
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
        <span class="modal-updated" id="modal-updated">${escape(cardEndFootLabel(c))}</span>
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
  /* Only post once giscus has announced itself.

     The iframe element exists well before giscus.app is loaded into it, and
     until then its contentWindow is still same-origin about:blank. Posting
     with targetOrigin 'https://giscus.app' at that moment cannot be
     delivered, so the browser logs "Failed to execute 'postMessage' ... does
     not match the recipient window's origin". Harmless but noisy, and it
     buries real console errors.

     Widening targetOrigin to '*' would silence it by broadcasting the message
     to whatever currently occupies the frame — the wrong trade. Instead wait
     for giscus's own ready message (handled below), which is the only point
     at which the frame is guaranteed to be giscus.app. Theme changes made
     before that are not lost: data-theme is set on <html> first, and the
     ready handler pushes the current theme when the frame arrives. */
  let giscusReady = false;
  const syncGiscus = (theme) => {
    if (!giscusReady) return;
    const frame = document.querySelector('iframe.giscus-frame');
    if (!frame || !frame.contentWindow) return;
    try { frame.contentWindow.postMessage({ giscus: { setConfig: { theme } } }, 'https://giscus.app'); } catch (_) { /* noop */ }
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
    // giscus's first message marks the frame as really being giscus.app; only
    // from then on can a setConfig post be delivered. Flip the flag before
    // syncing so this very message's push goes through.
    window.addEventListener('message', (ev) => {
      if (ev.origin !== 'https://giscus.app') return;
      if (!ev.data || typeof ev.data !== 'object' || !('giscus' in ev.data)) return;
      giscusReady = true;
      syncGiscus(resolvedTheme(themeStored()));
    });
    syncGiscus(resolvedTheme(themeStored()));   // in case the iframe is already up
  };

  /* ── /usage — live AI usage dashboard ──────────────────────────────
     Fetches site.usage.endpoint (the antares-usage Worker), renders a
     12-week hand-SVG heatmap + 4 stat numbers + a rotating fun-fact
     line, refetches every 60s while the tab is visible. The Worker's
     privacy contract is what's on the wire — this side only consumes
     {date, tokens, sessions} per day.

     SSR shell already drew an empty 12×7 grid + em-dash stats so the
     section doesn't reflow when data lands. On fetch failure the
     section silently hides — a fork without the Worker doesn't see a
     broken widget; disabling via site.usage.enabled = false hides the
     section even before the first fetch.

     Heatmap layout matches GitHub's calendar grid: rightmost column =
     this calendar week (Sun..today UTC), each prior column = full prior
     week. 84 cells visible. Shade = quartile of NON-zero token totals
     across the window, so a light week of activity isn't drowned out
     by one big day. Empty days use the soft-line theme color. */
  // GitHub-style year strip: 52 weeks × 7 days. Keep in lockstep with
  // scripts/build-html.js (same names + values), otherwise SSR shell and
  // client-rendered version mismatch on first paint.
  const HEATMAP_COLS = 52;
  const HEATMAP_ROWS = 7;
  const HEATMAP_CELL = 16;
  const HEATMAP_GAP  = 3;
  const HEATMAP_LABEL_BAND = 18;    // top: month-name strip
  const HEATMAP_LEFT_LABEL = 30;    // left: Mon/Wed/Fri row labels (GitHub-style)
  const FUNFACT_ROTATE_MS = 7000;
  // Refetch hourly. The data only updates on the local sync agent's
  // hourly LaunchAgent tick or a Claude Code Stop-hook, so anything more
  // frequent re-fetches identical bytes — wastes Worker quota and the
  // visitor's bandwidth. The pulsing dot still pulses to signal "section
  // is healthy"; the label below reads "updated Nm ago" from the Worker's
  // response, so visitors see actual data staleness instead of "Ns since
  // I last polled" which is mostly noise.
  const REFETCH_MS = 60 * 60 * 1000;
  // Tick the "updated Nm ago" label every 30s so it stays current
  // without polling the API.
  const LABEL_TICK_MS = 30 * 1000;

  // Comparison set for the fun-fact rotator. Token estimates are deliberately
  // round so visitors get a relatable "≈ Nx" intuition, not a precise count.
  const FUNFACT_REFS = [
    { tokens:  63000, label: 'The Great Gatsby' },
    { tokens:  63000, label: "The Hitchhiker's Guide to the Galaxy" },
    { tokens: 640000, label: 'the Lord of the Rings trilogy' },
    { tokens:   6500, label: 'the U.S. Constitution' },
  ];

  // ── skin lexicon ────────────────────────────────────────────────
  // An IP skin can rename every label in this panel (Observatory turns
  // "sessions" into "nights out"; Abyss turns it into "dives"). Look the
  // skin up on each call rather than caching it: the skin changes without a
  // reload, and the panel re-renders on refetch and on view switch.
  //
  // Fails soft in three ways, because this panel must not depend on the
  // skin feature existing: no SITE_SKINS (skins.js not loaded), no lexicon
  // on the active skin, or no entry for this key → the key comes back
  // unchanged, which IS the default English copy.
  const W = (key) => {
    try {
      const S = window.SITE_SKINS;
      if (!S || typeof S.word !== 'function') return key;
      return S.word(document.documentElement.getAttribute('data-skin') || 'default', key);
    } catch (_) { return key; }
  };

  const fmtCompact = (n) => {
    if (!Number.isFinite(n) || n <= 0) return '0';
    if (n >= 1e9)  return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (n >= 1e6)  return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3)  return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(Math.round(n));
  };

  // Quartile bin (0..3) for a non-zero value against a sorted list of
  // non-zero values. Returns -1 for zero/missing so the caller can
  // render the "empty" class instead of a yellow shade.
  const quartileBin = (val, sortedNonZero) => {
    if (!Number.isFinite(val) || val <= 0) return -1;
    const n = sortedNonZero.length;
    if (n === 0) return 0;
    if (n === 1) return 3;   // single non-zero day: max shade
    // pick 3 thresholds at 25/50/75 percentiles of the non-zero distribution
    const q = [0.25, 0.5, 0.75].map(p => sortedNonZero[Math.min(n - 1, Math.floor(p * n))]);
    if (val <= q[0]) return 0;
    if (val <= q[1]) return 1;
    if (val <= q[2]) return 2;
    return 3;
  };

  // Build the {col, row} grid coordinates for every cell in the 12×7
  // window. GitHub-style calendar alignment: rightmost column = current
  // week (Sun..today filled, todayDow+1..Sat as future-day placeholders),
  // each prior column = a full Sun..Sat week. Iterates over grid slots
  // (not over the input days), so the count is always exactly 84 and the
  // math has no edge case when today is Sunday (the prior approach
  // dropped cells via a col<0 guard).
  const buildHeatmapGrid = (days, todayUTC) => {
    const todayDow = new Date(todayUTC + 'T00:00:00Z').getUTCDay();
    const todayMs = new Date(todayUTC + 'T00:00:00Z').getTime();
    const byDate = new Map();
    for (const d of days) byDate.set(d.date, d);
    const cells = [];
    for (let col = 0; col < HEATMAP_COLS; col++) {
      for (let row = 0; row < HEATMAP_ROWS; row++) {
        const weeksBack = HEATMAP_COLS - 1 - col;
        const daysAgo = todayDow - row + 7 * weeksBack;
        if (daysAgo < 0) {
          // Future day of the current week — empty placeholder, no real date.
          cells.push({ col, row, tokens: 0, sessions: 0, costCents: 0, date: '' });
          continue;
        }
        const date = new Date(todayMs - daysAgo * 86400000).toISOString().slice(0, 10);
        const e = byDate.get(date) || { date, tokens: 0, sessions: 0, costCents: 0 };
        cells.push({ col, row, ...e });
      }
    }
    return cells;
  };

  const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DAY_LABELS = [null, 'Mon', null, 'Wed', null, 'Fri', null];   // alternating, GitHub-style
  const renderHeatmap = (cells) => {
    /* Colour by the same basis as the headline, or the quartile ramp would
       be shading a different quantity than the number printed above it. */
    const nonZero = cells.map(cellTokens).filter(t => t > 0).sort((a, b) => a - b);

    let firstActiveDate = '';
    for (const c of cells) {
      if (c.tokens > 0 && (!firstActiveDate || c.date < firstActiveDate)) firstActiveDate = c.date;
    }

    // Only draw the columns that contain real activity (plus one lead-in
    // week). The Worker returns a dense 365-day range, so plotting all 52
    // columns pinned the data into the right-hand fifth and left the rest of
    // the strip visibly empty — it read as a broken layout, not as history.
    let firstCol = 0;
    if (firstActiveDate) {
      let earliest = HEATMAP_COLS;
      for (const c of cells) {
        if (c.tokens > 0 && c.col < earliest) earliest = c.col;
      }
      firstCol = Math.max(0, Math.min(HEATMAP_COLS - 1, earliest - 1));
    }
    const cols = HEATMAP_COLS - firstCol;

    // Scale the cell so the visible range fills the strip. 22px is the upper
    // bound: past that the squares stop reading as a calendar and start
    // looking like a bar chart. With ~11 weeks this lands at 22px → ~290px
    // of grid, which then centres rather than being upscaled to 900px.
    const targetGridW = 860 - HEATMAP_LEFT_LABEL;
    const cell = Math.max(9, Math.min(22, Math.floor((targetGridW - (cols - 1) * HEATMAP_GAP) / cols)));
    const gridW = cols * cell + (cols - 1) * HEATMAP_GAP;
    const gridH = HEATMAP_ROWS * cell + (HEATMAP_ROWS - 1) * HEATMAP_GAP;
    const w = HEATMAP_LEFT_LABEL + gridW;
    const h = HEATMAP_LABEL_BAND + gridH;

    const grid = [];
    for (let c = 0; c < HEATMAP_COLS; c++) {
      for (let r = 0; r < HEATMAP_ROWS; r++) {
        grid.push({ col: c, row: r, tokens: 0, sessions: 0, date: '' });
      }
    }
    for (const cell of cells) {
      const idx = cell.col * HEATMAP_ROWS + cell.row;
      if (idx >= 0 && idx < grid.length) grid[idx] = cell;
    }

    // Month labels along the top — drop a label the first time a new
    // calendar month appears in the column sequence (read off row-0
    // Sundays). x is shifted by HEATMAP_LEFT_LABEL so labels land above
    // the cell grid, not the row-label band.
    const monthLabels = [];
    let prevMonth = -1;
    for (let c = firstCol; c < HEATMAP_COLS; c++) {
      const sunday = grid[c * HEATMAP_ROWS];
      if (!sunday.date) continue;
      const m = new Date(sunday.date + 'T00:00:00Z').getUTCMonth();
      if (m !== prevMonth) {
        const x = HEATMAP_LEFT_LABEL + (c - firstCol) * (cell + HEATMAP_GAP);
        monthLabels.push(`<text x="${x}" y="13" class="usage-month-label">${MONTH_ABBR[m]}</text>`);
        prevMonth = m;
      }
    }

    // Day-of-week labels on the left — Mon / Wed / Fri only (GitHub
    // convention). Each text is vertically centered on its row.
    const dayLabels = [];
    for (let r = 0; r < HEATMAP_ROWS; r++) {
      if (!DAY_LABELS[r]) continue;
      const yRow = HEATMAP_LABEL_BAND + r * (cell + HEATMAP_GAP) + cell / 2;
      dayLabels.push(`<text x="${HEATMAP_LEFT_LABEL - 6}" y="${yRow}" class="usage-day-label" text-anchor="end" dominant-baseline="middle">${DAY_LABELS[r]}</text>`);
    }

    const rects = grid.filter(c => c.col >= firstCol).map(cellData => {
      const x = HEATMAP_LEFT_LABEL + (cellData.col - firstCol) * (cell + HEATMAP_GAP);
      const y = HEATMAP_LABEL_BAND + cellData.row * (cell + HEATMAP_GAP);
      const isOutside = !cellData.date
                     || (firstActiveDate && cellData.date < firstActiveDate);
      let cls, dataAttrs;
      if (isOutside) {
        cls = 'usage-cell-outside';
        dataAttrs = '';
      } else {
        const bin = quartileBin(cellTokens(cellData), nonZero);
        cls = bin < 0 ? 'usage-cell-empty' : `usage-cell-q${bin}`;
        dataAttrs = `data-date="${cellData.date}" data-tokens="${cellTokens(cellData)}" data-sessions="${cellData.sessions}"`;
        // Optional v2 attributes — only emitted when the Worker publishes
        // the backing field, so the tooltip enriches itself without any
        // frontend change when a dimension is switched on.
        if (Number.isFinite(cellData.totalTokens) && cellData.totalTokens > 0) {
          dataAttrs += ` data-total="${cellData.totalTokens}"`;
        }
        if (Number.isFinite(cellData.cachedInputTokens) && cellData.cachedInputTokens > 0) {
          dataAttrs += ` data-cached="${cellData.cachedInputTokens}"`;
        }
        if (Number.isFinite(cellData.costCents) && cellData.costCents > 0) {
          dataAttrs += ` data-cost="${cellData.costCents}"`;
        }
      }
      return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" class="usage-cell ${cls}" ${dataAttrs}/>`;
    }).join('');
    return `<svg viewBox="0 0 ${w} ${h}" style="--chart-w:${w}px" preserveAspectRatio="xMidYMin meet" aria-hidden="true">${monthLabels.join('')}${dayLabels.join('')}${rects}</svg>`;
  };

  // Sum costCents across all cells, format as `$xx.xx` or `$xx,xxx.xx`.
  // Returns '' when no cost data has reached the wire yet (older sync
  // agents not upgraded) — render.js then hides the cost row entirely
  // instead of showing "$0.00", which would read as "I haven't spent
  // anything" rather than "I don't have the data."
  const formatCostUsd = (cells) => {
    let totalCents = 0;
    let any = false;
    for (const cell of cells) {
      if (Number.isFinite(cell.costCents) && cell.costCents > 0) {
        totalCents += cell.costCents;
        any = true;
      }
    }
    if (!any) return '';
    const usd = totalCents / 100;
    return usd >= 1000
      ? '$' + usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '$' + usd.toFixed(2);
  };

  // ── optional v2 dimensions ──────────────────────────────────────
  // The Worker decides which extra fields/dims reach the public GET (its
  // USAGE_PUBLISH config). This side is deliberately DATA-DRIVEN: a field
  // renders iff it's present and non-zero, and disappears the moment the
  // Worker stops publishing it. No frontend redeploy needed to flip a
  // dimension on or off, and a v1 Worker keeps rendering exactly as before.
  const sumField = (cells, field) => {
    let total = 0;
    for (const cell of cells) {
      if (Number.isFinite(cell[field])) total += cell[field];
    }
    return total;
  };

  const hasField = (cells, field) =>
    cells.some(c => Number.isFinite(c[field]) && c[field] > 0);

  /* The headline token basis, per cell, with a fallback that matters.
     Rows written by the v1 CLI (the old laptop, 2026-05-01..06-20) have no
     detail block: totalTokens is 0 while `tokens` holds a real input+output
     figure. Summing totalTokens alone would silently render those 40 days as
     zero and delete that machine from the chart -- a wrong answer wearing the
     costume of a working page. Those days stay on the older, narrower basis;
     understated but present beats absent. */
  const cellTokens = (c) => {
    const total = Number(c.totalTokens);
    if (Number.isFinite(total) && total > 0) return total;
    return Number.isFinite(c.tokens) ? c.tokens : 0;
  };
  const sumHeadline = (cells) => {
    let total = 0;
    for (const cell of cells) total += cellTokens(cell);
    return total;
  };

  // Merge a per-day breakdown map ({model: {...}}) across the window into
  // one ranked list. Returns [] when the dim isn't published.
  const mergeDim = (cells, dim, metric = 'totalTokens') => {
    const acc = new Map();
    for (const cell of cells) {
      const m = cell[dim];
      if (!m || typeof m !== 'object') continue;
      for (const key of Object.keys(m)) {
        const v = m[key];
        if (!v || typeof v !== 'object') continue;
        const n = Number.isFinite(v[metric]) ? v[metric] : 0;
        if (n <= 0) continue;
        acc.set(key, (acc.get(key) || 0) + n);
      }
    }
    return [...acc.entries()].sort((a, b) => b[1] - a[1]);
  };

  // "57% served from cache" — the single most interesting derived number
  // once cache counters are published, and impossible to compute from the
  // v1 wire shape at all.
  const cacheSharePct = (cells) => {
    const cached = sumField(cells, 'cachedInputTokens');
    const total = sumField(cells, 'totalTokens');
    if (cached <= 0 || total <= 0) return null;
    return Math.round((cached / total) * 100);
  };

  const renderUsageStats = (cells) => {
    // `billedTokens` is deliberately the narrow basis (input + output): it is
    // rendered as the "tokens billed" line. The headline uses sumHeadline().
    let billedTokens = 0, totalSessions = 0, daysActive = 0;
    let oldestActive = '';
    for (const cell of cells) {
      billedTokens += cell.tokens;
      totalSessions += cell.sessions;
      // Count a day as active on the headline basis, so "days active" cannot
      // disagree with the coloured cells in the heatmap beside it.
      if (cellTokens(cell) > 0) {
        daysActive++;
        if (!oldestActive || cell.date < oldestActive) oldestActive = cell.date;
      }
    }
    // Recent activity = days active in the last 7 CALENDAR days.
    //
    // Not `cells.slice(-7)`: buildHeatmapGrid fills column-major (col outer,
    // row inner), so the final 7 entries are the last COLUMN — this week's
    // Sun..Sat, including empty placeholders for days that haven't happened
    // yet. On a Monday that's 1 real day and 6 blanks, which rendered as
    // "1/7 days active" under a heatmap showing near-daily activity.
    // Selecting by date keeps the number honest regardless of weekday.
    const dated = cells.filter(c => c.date);
    let newest = '';
    for (const c of dated) if (c.date > newest) newest = c.date;
    const last7Active = newest
      ? (() => {
          const cutoffMs = new Date(newest + 'T00:00:00Z').getTime() - 6 * 86400000;
          const seen = new Set();
          for (const c of dated) {
            if (c.tokens > 0 && new Date(c.date + 'T00:00:00Z').getTime() >= cutoffMs) {
              seen.add(c.date);
            }
          }
          return seen.size;
        })()
      : 0;
    // Cost slots inline as one of the data items — only emitted when we
    // have costCents data. "≈" because Anthropic pricing has tier rules
    // (1M-context Opus doubles above 200K input) we don't model.
    // "≈" because tiered pricing rules (e.g. 1M-context Opus doubling above
    // 200K input) are not modelled.
    const costStr = formatCostUsd(cells);

    // ── the stats block ─────────────────────────────────────────────
    // Previously this was eleven numbers joined by "·" across four wrapped
    // lines. Two problems, both fatal to reading it: nothing told you which
    // number was which kind of thing, and "1B tokens" sat three items away
    // from "2.4B total" with no hint that one is a subset of the other.
    //
    // Now it's a definition grid — label above value, fixed columns, aligned
    // baselines. Same data, but scannable, and the two token figures are
    // named so the difference is self-evident:
    //   "tokens billed"    = input + output (what you pay per-token for)
    //   "tokens processed" = all five categories, including cache reads
    const items = [];
    // Every user-facing label goes through W(). With no skin (or a skin
    // without a lexicon) this is the identity function, so the default copy
    // is byte-identical to what it was before the IP skins existed.
    const push = (k, v, title) =>
      items.push(
        `<div class="hstat-cell"${title ? ` title="${title}"` : ''}>` +
          `<dt class="hstat-k">${W(k)}</dt>` +
          `<dd class="hstat-v">${v}</dd>` +
        `</div>`
      );

    /* Headline is the kaboo basis: input + output + cache read + cache write
       + reasoning (kaboo's cli/export_cmd.go). Cache reads dominate a Claude
       Code workload -- roughly 55% of volume here -- and omitting them made
       this number look absurd beside the spend figure next to it. kaboo hit
       exactly this and fixed it in their migration 000006, whose note says
       the old basis understated reality "by 5-100x".

       "tokens billed" stays as a second line: it is the honest answer to a
       different question -- what actually costs full price. */
    const hasTotal = hasField(cells, 'totalTokens');
    push(
      'tokens',
      `<strong>${fmtCompact(hasTotal ? sumHeadline(cells) : billedTokens)}</strong>`,
      hasTotal ? 'All five categories, including cache reads and writes' : ''
    );
    if (hasTotal) {
      push(
        'tokens billed',
        `<strong>${fmtCompact(billedTokens)}</strong>`,
        'Input + output only — the categories charged per token'
      );
    }
    const cachePct = cacheSharePct(cells);
    if (cachePct !== null) {
      push('from cache', `<strong>${cachePct}%</strong>`,
        'Share of processed tokens served from cache rather than re-read');
    }
    if (costStr) {
      push('spend', `&asymp;<strong>${costStr}</strong>`,
        'Approximate — tiered pricing rules are not modelled');
    }
    push('sessions', `<strong>${totalSessions.toLocaleString()}</strong>`);
    if (hasField(cells, 'activeSeconds')) {
      const hrs = sumField(cells, 'activeSeconds') / 3600;
      push('at keyboard', `<strong>${hrs >= 10 ? Math.round(hrs) : hrs.toFixed(1)}h</strong>`,
        'Active agent time, not wall clock');
    }
    push('active this week', `<strong>${last7Active}</strong><span class="hstat-sub">/7 ${W('days')}</span>`);

    // Top tool / model, when published.
    for (const dim of ['bySource', 'byModel']) {
      const ranked = mergeDim(cells, dim);
      if (ranked.length === 0) continue;
      const [topKey, topVal] = ranked[0];
      const dimTotal = ranked.reduce((a, [, v]) => a + v, 0);
      const pct = dimTotal > 0 ? Math.round((topVal / dimTotal) * 100) : 0;
      push(
        dim === 'bySource' ? 'top tool' : 'top model',
        `<strong>${escape(String(topKey).slice(0, 20))}</strong><span class="hstat-sub">${pct}%</span>`
      );
    }

    // "since" is provenance, not a metric — it was the one cell that wrapped
    // to a lonely second row. It reads better appended to the footer line,
    // which is already where the "updated Nh ago" provenance lives.
    return `<dl class="hstat-grid">${items.join('')}</dl>` +
      `<div class="hstat-since">${W('tracking since')} <strong>${oldestActive || '—'}</strong></div>`;
  };

  // ── view 2: rhythm — 7×24 weekday × local-hour ──────────────────
  // The calendar heatmap answers "how often"; this answers "when". kaboo's
  // dashboard leads with the same shape because it's the one chart that
  // reads as a portrait of a working style rather than a usage total.
  //
  // Hours are LOCAL to the device that recorded them (normalised by the sync
  // agent — the browser can't know a past session's timezone), so the axis
  // means "the hour it felt like where I was sitting".
  const RHYTHM_CELL = 15;
  const RHYTHM_GAP = 3;
  const RHYTHM_LEFT = 30;
  const RHYTHM_TOP = 18;
  const RHYTHM_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Sum the flat 168-slot vectors across every day in the window.
  const mergeWeekHours = (cells) => {
    const flat = new Array(168).fill(0);
    let any = false;
    for (const cell of cells) {
      const v = cell.promptWeekHours;
      if (!Array.isArray(v) || v.length !== 168) continue;
      any = true;
      for (let i = 0; i < 168; i++) {
        if (Number.isFinite(v[i])) flat[i] += v[i];
      }
    }
    return any ? flat : null;
  };

  const renderRhythm = (cells) => {
    const flat = mergeWeekHours(cells);
    if (!flat) return '';
    const nonZero = flat.filter((n) => n > 0).sort((a, b) => a - b);
    if (nonZero.length === 0) return '';

    const gridW = 24 * RHYTHM_CELL + 23 * RHYTHM_GAP;
    const gridH = 7 * RHYTHM_CELL + 6 * RHYTHM_GAP;
    const w = RHYTHM_LEFT + gridW;
    const h = RHYTHM_TOP + gridH;

    // Hour ruler every 3h — dense enough to locate a peak, sparse enough
    // not to collide at mobile widths.
    const hourLabels = [];
    for (let hr = 0; hr < 24; hr += 3) {
      const x = RHYTHM_LEFT + hr * (RHYTHM_CELL + RHYTHM_GAP);
      hourLabels.push(
        `<text x="${x}" y="13" class="usage-month-label">${String(hr).padStart(2, '0')}</text>`
      );
    }

    const dayLabels = [];
    for (let d = 0; d < 7; d++) {
      // Alternate rows like the calendar view so the labels stay legible.
      if (d % 2 === 0) continue;
      const y = RHYTHM_TOP + d * (RHYTHM_CELL + RHYTHM_GAP) + RHYTHM_CELL / 2;
      dayLabels.push(
        `<text x="${RHYTHM_LEFT - 6}" y="${y}" class="usage-day-label" text-anchor="end" dominant-baseline="middle">${RHYTHM_DAYS[d]}</text>`
      );
    }

    const rects = [];
    for (let d = 0; d < 7; d++) {
      for (let hr = 0; hr < 24; hr++) {
        const n = flat[d * 24 + hr] || 0;
        const x = RHYTHM_LEFT + hr * (RHYTHM_CELL + RHYTHM_GAP);
        const y = RHYTHM_TOP + d * (RHYTHM_CELL + RHYTHM_GAP);
        const bin = quartileBin(n, nonZero);
        const cls = bin < 0 ? 'usage-cell-empty' : `usage-cell-q${bin}`;
        const attrs = n > 0
          ? ` data-rhythm="1" data-day="${RHYTHM_DAYS[d]}" data-hour="${hr}" data-prompts="${n}"`
          : '';
        rects.push(
          `<rect x="${x}" y="${y}" width="${RHYTHM_CELL}" height="${RHYTHM_CELL}" rx="2" class="usage-cell ${cls}"${attrs}/>`
        );
      }
    }
    return `<svg viewBox="0 0 ${w} ${h}" style="--chart-w:${w}px" preserveAspectRatio="xMidYMin meet" aria-hidden="true">${hourLabels.join('')}${dayLabels.join('')}${rects.join('')}</svg>`;
  };

  // Caption under the rhythm view: the two facts a visitor actually takes
  // away — when the peak is, and how much of the work is after hours.
  const rhythmCaption = (cells) => {
    const flat = mergeWeekHours(cells);
    if (!flat) return '';
    let peakIdx = -1;
    let peakVal = 0;
    let total = 0;
    let night = 0;      // 22:00–05:59
    let weekend = 0;
    for (let i = 0; i < 168; i++) {
      const n = flat[i] || 0;
      total += n;
      if (n > peakVal) { peakVal = n; peakIdx = i; }
      const d = Math.floor(i / 24);
      const hr = i % 24;
      if (hr >= 22 || hr < 6) night += n;
      if (d === 0 || d === 6) weekend += n;
    }
    if (total === 0 || peakIdx < 0) return '';
    const pd = RHYTHM_DAYS[Math.floor(peakIdx / 24)];
    const ph = peakIdx % 24;
    const parts = [
      `<span class="usage-stat">${W('peak')} <strong>${pd} ${String(ph).padStart(2, '0')}:00</strong></span>`,
      `<span class="usage-stat-sep">·</span>`,
      `<span class="usage-stat"><strong>${Math.round((night / total) * 100)}%</strong> ${W('after hours')}</span>`,
      `<span class="usage-stat-sep">·</span>`,
      `<span class="usage-stat"><strong>${Math.round((weekend / total) * 100)}%</strong> ${W('weekend')}</span>`,
      `<span class="usage-stat-sep">·</span>`,
      `<span class="usage-stat">${total.toLocaleString()} ${W('prompts')}</span>`,
    ];
    return parts.join('');
  };

  // ── view 3: trend — weekly totals as an area+line sparkline ──────
  // The calendar and rhythm views both flatten time; this is the only one
  // that shows direction (ramping up, tapering off, a gap while travelling).
  //
  // The viewBox aspect ratio IS the rendered aspect ratio: the svg scales to
  // the container width and takes its height from this ratio. At 1015x148 a
  // 622px-wide strip collapsed to 91px tall, which read as a sparkline
  // squeezed into a footnote rather than a chart.
  //
  // This view renders full-strip (up to 900px), so the ratio is picked for
  // that: at 900 wide, a height of 200 keeps the line readable without
  // dwarfing the 7-row grids it alternates with.
  //
  // Side padding is in viewBox units and scales with the width, so it's sized
  // to hold half of the widest tick label ("Aug 30") at this scale.
  const TREND_W = 900;
  const TREND_H = 200;
  const TREND_PAD_L = 34;
  const TREND_PAD_R = 34;   // room for the right-most date label
  const TREND_PAD_B = 26;
  // Headroom above the peak. The tooltip sits above the dot it describes, so
  // a peak pinned to the very top of the plot pushes its own label out of the
  // chart and over the section heading. This band is sized to fit the label
  // (~26px tall) plus its gap, so even the tallest week keeps its label inside
  // the chart and clear of the line.
  const TREND_PAD_T = 36;

  // Group daily cells into ISO-ish weeks (Sun-started, matching the grid).
  const weeklySeries = (cells) => {
    const byWeek = new Map();
    for (const cell of cells) {
      if (!cell.date) continue;
      const t = new Date(cell.date + 'T00:00:00Z');
      // Snap back to the Sunday that starts this week.
      const sunday = new Date(t.getTime() - t.getUTCDay() * 86400000)
        .toISOString()
        .slice(0, 10);
      if (!byWeek.has(sunday)) byWeek.set(sunday, { week: sunday, tokens: 0, total: 0, cost: 0 });
      const w = byWeek.get(sunday);
      w.tokens += cell.tokens || 0;
      /* Fallback basis, so a week made only of v1 rows plots at its real
         height instead of collapsing to zero in the middle of the series. */
      w.total += cellTokens(cell);
      if (Number.isFinite(cell.costCents)) w.cost += cell.costCents;
    }
    const all = [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week));
    // Start at the first week that actually has tokens. Keeping a zero week
    // as a lead-in drew a flat tail on the left that read as "no data here"
    // rather than as a chart baseline — the caption already states the range.
    const firstReal = all.findIndex((w) => (w.total || w.tokens || 0) > 0);
    return firstReal <= 0 ? all : all.slice(firstReal);
  };

  const renderTrend = (cells) => {
    const series = weeklySeries(cells);
    if (series.length < 2) return '';
    // Prefer the honest all-category total; fall back to v1 `tokens` when the
    // Worker doesn't publish totalTokens.
    const useTotal = series.some((s) => s.total > 0);
    const vals = series.map((s) => (useTotal ? s.total : s.tokens));
    const max = Math.max(...vals);
    if (max <= 0) return '';

    const plotW = TREND_W - TREND_PAD_L - TREND_PAD_R;
    const plotH = TREND_H - TREND_PAD_B - TREND_PAD_T;
    const stepX = series.length > 1 ? plotW / (series.length - 1) : plotW;
    const xAt = (i) => TREND_PAD_L + i * stepX;
    const yAt = (v) => TREND_PAD_T + plotH - (v / max) * plotH;

    const linePts = vals.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
    const areaPts = `${TREND_PAD_L},${(TREND_PAD_T + plotH).toFixed(1)} ${linePts} ${xAt(series.length - 1).toFixed(1)},${(TREND_PAD_T + plotH).toFixed(1)}`;

    // Month ticks along the bottom. With a trimmed range there's room for
    // roughly eight labels; include the day so two ticks inside the same
    // month stay distinguishable (a bare "Aug Aug" reads as a bug).
    const ticks = [];
    const every = Math.max(1, Math.ceil(series.length / 7));
    series.forEach((s, i) => {
      if (i % every !== 0 && i !== series.length - 1) return;
      const d = new Date(s.week + 'T00:00:00Z');
      ticks.push(
        `<text x="${xAt(i).toFixed(1)}" y="${TREND_H - 4}" class="usage-month-label" text-anchor="middle">${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCDate()}</text>`
      );
    });

    // One hover target per week, full plot height so it's easy to hit. The
    // target is a tall column, but the thing it describes is the dot at
    // yAt(v) — so carry that dot's position on the rect and let the tooltip
    // anchor to it. Without this the label tracked the cursor and drifted far
    // from the actual data point whenever the pointer sat low in the column.
    const hits = series.map((s, i) => {
      const v = useTotal ? s.total : s.tokens;
      const bw = Math.max(6, stepX);
      return `<rect x="${(xAt(i) - bw / 2).toFixed(1)}" y="${TREND_PAD_T}" width="${bw.toFixed(1)}" height="${plotH.toFixed(1)}" fill="transparent" data-trend="1" data-week="${s.week}" data-value="${v}" data-cost="${s.cost}" data-dot-x="${xAt(i).toFixed(1)}" data-dot-y="${yAt(v).toFixed(1)}"/>`;
    });

    const dots = vals.map((v, i) =>
      `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(v).toFixed(1)}" r="2" class="usage-trend-dot"/>`
    );

    // No --chart-w here: a line chart has no square grid to distort, so it
    // takes the full strip. Emitting `--chart-w:100%` would inherit down to
    // the wrapper and resolve against the wrapper's own width, collapsing it.
    return `<svg viewBox="0 0 ${TREND_W} ${TREND_H}" preserveAspectRatio="xMidYMin meet" aria-hidden="true">`
      + `<polygon points="${areaPts}" class="usage-trend-area"/>`
      + `<polyline points="${linePts}" class="usage-trend-line" fill="none"/>`
      + dots.join('')
      + ticks.join('')
      + hits.join('')
      + `</svg>`;
  };

  const trendCaption = (cells) => {
    const series = weeklySeries(cells);
    if (series.length < 2) return '';
    const useTotal = series.some((s) => s.total > 0);
    const vals = series.map((s) => (useTotal ? s.total : s.tokens));
    const peak = Math.max(...vals);
    const peakWeek = series[vals.indexOf(peak)].week;
    // Drop the in-progress week before comparing averages. Today is only
    // partway through its week, so including it makes every Monday look
    // like a collapse — on 2026-08-31 the raw comparison read -77% purely
    // because the newest "week" was one day long.
    const newest = series[series.length - 1].week;
    const weekEndMs = new Date(newest + 'T00:00:00Z').getTime() + 6 * 86400000;
    const complete = Date.now() > weekEndMs + 86400000 ? vals : vals.slice(0, -1);
    const tail = complete.slice(-4);
    const prev = complete.slice(-8, -4);
    const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const now = avg(tail);
    const before = avg(prev);
    const parts = [
      `<span class="usage-stat">${series.length} weeks</span>`,
      `<span class="usage-stat-sep">·</span>`,
      `<span class="usage-stat">${W('peak')} week <strong>${fmtCompact(peak)}</strong></span>`,
    ];
    if (before > 0 && tail.length === 4 && prev.length === 4) {
      const delta = Math.round(((now - before) / before) * 100);
      const sign = delta > 0 ? '+' : '';
      parts.push(
        `<span class="usage-stat-sep">·</span>`,
        `<span class="usage-stat">last 4 full weeks <strong>${sign}${delta}%</strong></span>`
      );
    }
    return parts.join('');
  };

  // Sum tokens for this calendar month (UTC). Used by the fun-fact line.
  const tokensThisMonth = (cells) => {
    const monthPrefix = new Date().toISOString().slice(0, 7);   // YYYY-MM
    return cells
      .filter(c => c.date && c.date.startsWith(monthPrefix))
      .reduce((a, c) => a + c.tokens, 0);
  };

  let funFactIdx = 0;
  const renderFunFact = (cells) => {
    const monthly = tokensThisMonth(cells);
    if (monthly <= 0) return '';
    const ref = FUNFACT_REFS[funFactIdx % FUNFACT_REFS.length];
    funFactIdx++;
    const multiple = Math.round(monthly / ref.tokens);
    if (multiple < 1) return `~ a fraction of ${ref.label} this month`;
    return `&asymp; ${multiple.toLocaleString()}&times; ${ref.label} this month`;
  };

  const wireUsage = (site) => {
    /* Honour a pinned footer.lastUpdated here, not only in renderMeta.
       renderMeta runs ONLY in the non-prerendered branch, so on a prerendered
       page the pin would never register and the live watermark below would
       quietly overwrite the owner's explicit choice. wireUsage runs in both
       modes, and before any fetch can resolve. */
    if (site && site.footer && site.footer.lastUpdated) dataDatePinned = true;
    const section  = document.getElementById('usage');
    if (!section) return;
    const cfg = site && site.usage;
    if (!cfg || cfg.enabled === false || !cfg.endpoint) {
      section.hidden = true;
      return;
    }
    const heatmapEl = document.getElementById('usage-heatmap');
    const statsEl   = document.getElementById('usage-stats');
    const factEl    = document.getElementById('usage-funfact');
    const liveEl    = document.getElementById('usage-live-text');
    if (!heatmapEl || !statsEl || !factEl || !liveEl) {
      section.hidden = true;
      return;
    }

    let lastUpdatedMs = 0;   // ms-epoch of the Worker's most recent write (from GET response)
    let lastCells = null;
    let refetchTimer = null;
    let liveTickTimer = null;
    let factRotateTimer = null;
    let inFlight = false;

    // ── view switching ──────────────────────────────────────────────
    // Three lenses on the same fetched data — no extra requests when
    // switching. `calendar` is the v1 view and stays the default so the
    // section looks unchanged to anyone who doesn't touch the tabs.
    //
    // A view is only offered when its data is actually present: `rhythm`
    // needs the Worker to publish promptWeekHours, and `trend` needs at
    // least two weeks of history. That keeps the tab row honest rather than
    // showing controls that lead to an empty panel.
    const VIEWS = [
      { id: 'calendar', label: 'calendar', render: (c) => renderHeatmap(c), caption: null,
        available: () => true },
      { id: 'rhythm', label: 'rhythm', render: (c) => renderRhythm(c), caption: rhythmCaption,
        available: (c) => !!mergeWeekHours(c) },
      { id: 'trend', label: 'trend', render: (c) => renderTrend(c), caption: trendCaption,
        available: (c) => weeklySeries(c).length >= 2 },
    ];

    // Which views the site owner wants on the homepage, and in what order.
    // `site.usage.views` is an allowlist of ids; omit it to offer all three.
    // Unknown ids are ignored and an empty/invalid result falls back to the
    // full set, so a typo degrades to "show everything" rather than to a
    // blank section.
    const pickViews = () => {
      const want = Array.isArray(cfg.views) ? cfg.views : null;
      if (!want || !want.length) return VIEWS;
      const chosen = want
        .map((id) => VIEWS.find((v) => v.id === id))
        .filter(Boolean);
      return chosen.length ? chosen : VIEWS;
    };
    const OFFERED = pickViews();
    // `site.usage.defaultView` picks the one shown first; default to the
    // owner's first offered view.
    const wantedDefault = typeof cfg.defaultView === 'string' ? cfg.defaultView : '';
    let currentView = OFFERED.some((v) => v.id === wantedDefault)
      ? wantedDefault
      : OFFERED[0].id;

    // Auto-advance every 5s so a visitor who never touches the tabs still
    // sees each lens. Hovering (or focusing, or interacting with the tabs)
    // pauses it — the rotation must never fight the reader. It also stops
    // while the tab is backgrounded, and stops permanently once the visitor
    // picks a view by hand, since that's an explicit choice.
    const ROTATE_MS = 5000;
    let rotateTimer = null;
    let rotatePaused = false;
    let rotateDisabled = false;

    // Respect the OS "reduce motion" setting: an unattended 5s swap is
    // exactly the kind of motion that setting exists to suppress.
    const prefersReducedMotion = () =>
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    const stopRotate = () => {
      if (rotateTimer) { clearInterval(rotateTimer); rotateTimer = null; }
    };
    const startRotate = () => {
      stopRotate();
      if (rotateDisabled || rotatePaused) return;
      if (document.hidden) return;
      // Nothing to rotate between.
      if (!lastCells) return;
      const usable = OFFERED.filter((v) => v.available(lastCells));
      if (usable.length < 2) return;
      if (prefersReducedMotion()) return;
      rotateTimer = setInterval(() => {
        if (!lastCells) return;
        const list = OFFERED.filter((v) => v.available(lastCells));
        if (list.length < 2) return;
        const i = list.findIndex((v) => v.id === currentView);
        const nextId = list[(i + 1) % list.length].id;
        // Fade out, swap, fade in — the class is removed on the next frame
        // after the new SVG is in the DOM.
        heatmapEl.classList.add('is-swapping');
        setTimeout(() => {
          currentView = nextId;
          paint(lastCells);
          renderTabs(lastCells);
          requestAnimationFrame(() => heatmapEl.classList.remove('is-swapping'));
        }, 250);
      }, ROTATE_MS);
    };

    const tabsEl = document.getElementById('usage-views');
    const captionEl = document.getElementById('usage-caption');
    const legendEl = section.querySelector('.usage-legend');

    const viewById = (id) => VIEWS.find((v) => v.id === id) || VIEWS[0];

    const paint = (cells) => {
      const view = viewById(currentView);
      const svg = view.render(cells);
      // A view that yields nothing (e.g. rhythm with no vector data) falls
      // back to the calendar rather than blanking the section.
      if (!svg && view.id !== 'calendar') {
        currentView = 'calendar';
        paint(cells);
        return;
      }
      heatmapEl.innerHTML = svg;
      heatmapEl.setAttribute('data-view', currentView);
      // Lift the chart's own width onto the wrapper so the legend and caption
      // below it share the chart's left/right edges. Read it off the rendered
      // svg rather than duplicating the per-view geometry here. A percentage
      // would resolve against the wrapper itself, so only pixel widths get
      // promoted; the trend view falls through to the full-width CSS default.
      const svgEl = heatmapEl.querySelector('svg');
      const cw = svgEl && svgEl.style.getPropertyValue('--chart-w');
      if (cw && cw.endsWith('px')) heatmapEl.style.setProperty('--chart-w', cw);
      else heatmapEl.style.removeProperty('--chart-w');
      // Mirror the view onto the stack so it can go full width for the line
      // chart. CSS :has() covers this too, but a class keeps it working in
      // browsers without :has() rather than silently shrinking the chart.
      const innerEl = heatmapEl.parentElement;
      if (innerEl && innerEl.classList.contains('usage-heatmap-inner')) {
        innerEl.classList.toggle('is-wide', currentView === 'trend');
      }
      if (captionEl) {
        const cap = view.caption ? view.caption(cells) : '';
        captionEl.innerHTML = cap;
        captionEl.hidden = !cap;
      }
      // The Less/More ramp describes the two heatmap views; it means nothing
      // against a line chart.
      if (legendEl) legendEl.hidden = currentView === 'trend';
    };

    const renderTabs = (cells) => {
      if (!tabsEl) return;
      const usable = OFFERED.filter((v) => v.available(cells));
      // One usable view = nothing to switch between; don't show chrome.
      if (usable.length < 2) { tabsEl.hidden = true; return; }
      tabsEl.hidden = false;
      tabsEl.innerHTML = usable
        .map((v) => `<button type="button" class="usage-view-tab${v.id === currentView ? ' is-active' : ''}" data-view="${v.id}" aria-pressed="${v.id === currentView}">${v.label}</button>`)
        .join('');
    };

    // Pause rotation whenever the reader is plausibly looking at or using
    // the chart: pointer over the section, keyboard focus inside it, or the
    // browser tab hidden.
    const pauseRotate = () => { rotatePaused = true; stopRotate(); };
    const resumeRotate = () => { rotatePaused = false; startRotate(); };
    section.addEventListener('pointerenter', pauseRotate);
    section.addEventListener('pointerleave', resumeRotate);
    section.addEventListener('focusin', pauseRotate);
    section.addEventListener('focusout', (ev) => {
      if (!section.contains(ev.relatedTarget)) resumeRotate();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopRotate();
      else startRotate();
    });

    if (tabsEl) {
      tabsEl.addEventListener('click', (ev) => {
        const btn = ev.target.closest('button[data-view]');
        if (!btn || !lastCells) return;
        const id = btn.getAttribute('data-view');
        // An explicit pick ends the carousel for this visit — continuing to
        // swap under someone who just chose a view would be hostile.
        rotateDisabled = true;
        stopRotate();
        /* Only a deliberate click counts. The 5s auto-rotation also changes
           currentView, and counting that would report the timer's taste
           rather than the visitor's — the numbers would just track how long
           the tab stayed open. */
        try {
          if (typeof window.SITE_BEACON === 'function' && id !== currentView) {
            window.SITE_BEACON('chart_open', id);
          }
        } catch (_) { /* noop */ }
        if (id === currentView) return;
        currentView = id;
        paint(lastCells);
        renderTabs(lastCells);
      });
    }

    // Let the skin runtime ask for a repaint. An IP skin renames every
    // label in this panel, and those labels are baked into the HTML that
    // paint()/renderUsageStats() emit — so switching skin has to re-run
    // them. Without this the new vocabulary wouldn't appear until the next
    // hourly refetch. Guarded on lastCells: before the first successful
    // fetch there's nothing to repaint and the skeleton is still showing.
    window.SITE_REPAINT_USAGE = () => {
      if (!lastCells || section.hidden) return;
      paint(lastCells);
      renderTabs(lastCells);
      statsEl.innerHTML = renderUsageStats(lastCells);
    };

    // The label tracks DATA staleness (when the worker last got new data
    // from a sync agent), not FETCH staleness (when this page last polled).
    // For a 1h-refetch loop the latter is meaningless noise — the former
    // is what visitors actually want to know.
    const updateLiveLabel = () => {
      if (!lastUpdatedMs) { liveEl.textContent = 'live'; return; }
      const sec = Math.max(0, Math.round((Date.now() - lastUpdatedMs) / 1000));
      if (sec < 60)        liveEl.textContent = `updated ${sec}s ago`;
      else if (sec < 3600) liveEl.textContent = `updated ${Math.round(sec / 60)}m ago`;
      else if (sec < 86400){
        const h = Math.floor(sec / 3600);
        const m = Math.round((sec % 3600) / 60);
        liveEl.textContent = m ? `updated ${h}h ${m}m ago` : `updated ${h}h ago`;
      }
      else liveEl.textContent = `updated ${Math.round(sec / 86400)}d ago`;
    };

    const refetch = async () => {
      // Don't fire while hidden — visibilitychange will kick a refetch when
      // we come back. Avoids a stale tick from chewing through bytes on
      // a backgrounded tab.
      if (document.hidden) return;
      if (inFlight) return;
      inFlight = true;
      try {
        // 8s timeout so a hung Worker doesn't leave us sitting on the
        // skeleton em-dashes forever. Falls into the silent-hide path.
        const signal = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout)
          ? AbortSignal.timeout(8000) : undefined;
        const res = await fetch(cfg.endpoint.replace(/\/+$/, '') + '/',
          signal ? { cache: 'no-store', signal } : { cache: 'no-store' });
        if (!res.ok) throw new Error('http ' + res.status);
        const data = await res.json();
        if (!data || !Array.isArray(data.days)) throw new Error('bad shape');
        // Worker returns 90 days; trim to the most recent 84 for the 12-week grid.
        const trimmed = data.days.slice(-(HEATMAP_COLS * HEATMAP_ROWS));
        const todayUTC = trimmed[trimmed.length - 1]?.date || new Date().toISOString().slice(0, 10);
        const cells = buildHeatmapGrid(trimmed, todayUTC);
        lastCells = cells;
        // Vectors live on the raw day rows, not the grid cells — carry them
        // across so the rhythm view can find them.
        for (const cell of cells) {
          if (!cell.date) continue;
          const src = trimmed.find((d) => d && d.date === cell.date);
          if (src && Array.isArray(src.promptWeekHours)) {
            cell.promptWeekHours = src.promptWeekHours;
          }
        }
        renderTabs(cells);
        paint(cells);
        // Data is in, so the carousel now knows how many views are usable.
        startRotate();
        statsEl.innerHTML   = renderUsageStats(cells);
        const fact = renderFunFact(cells);
        factEl.innerHTML    = fact;
        // When the funfact returns empty (no data yet this month), hide
        // the leading "·" separator in the flourish row so it doesn't read
        // as "· updated 2s ago".
        const flourishSep = factEl.parentElement && factEl.parentElement.querySelector('.usage-flourish-sep');
        if (flourishSep) flourishSep.hidden = !fact;
        section.classList.add('usage-loaded');
        // Use the Worker's `updated` watermark (newest write across all
        // sources) instead of "now" — that's the timestamp visitors care
        // about. Falls back to "now" if the field is missing (no data
        // yet) so the label has something to show.
        const updIso = typeof data.updated === 'string' ? data.updated : null;
        const parsed = updIso ? Date.parse(updIso) : NaN;
        lastUpdatedMs = Number.isFinite(parsed) ? parsed : Date.now();
        updateLiveLabel();
        /* Topnav "updated <date>" follows the DATA, not the build.

           It used to be baked in at build time from the last commit date, so
           it sat at 2026-06-20 while the data behind it had moved to 09-07 --
           the page claimed to be three months older than the numbers on it.
           Reuse the watermark already parsed above rather than fetching again;
           only move the label forward, so a stale cached response can never
           make the site look older than it is. */
        stampDataDate(lastUpdatedMs);
      } catch (e) {
        // Silent hide on failure — fork without Worker, network blip, CORS,
        // CN-block, any reason. Don't show a broken widget. console for ops.
        console.warn('[usage] fetch failed:', e.message);
        section.hidden = true;
        stopTimers();
      } finally {
        inFlight = false;
      }
    };

    const startTimers = () => {
      stopTimers();
      refetchTimer = setInterval(refetch, REFETCH_MS);
      liveTickTimer = setInterval(updateLiveLabel, LABEL_TICK_MS);
      // Fun-fact rotates locally without refetching the API.
      factRotateTimer = setInterval(() => {
        if (lastCells) factEl.innerHTML = renderFunFact(lastCells);
      }, FUNFACT_ROTATE_MS);
    };
    const stopTimers = () => {
      if (refetchTimer)    { clearInterval(refetchTimer);    refetchTimer = null; }
      if (liveTickTimer)   { clearInterval(liveTickTimer);   liveTickTimer = null; }
      if (factRotateTimer) { clearInterval(factRotateTimer); factRotateTimer = null; }
    };

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopTimers();
      } else if (!section.hidden) {
        refetch();
        startTimers();
      }
    });

    // ── Custom hover tooltip on heatmap cells ──────────────────────
    // The tooltip lives as a child of `section` (NOT heatmapEl), because
    // refetch() does `heatmapEl.innerHTML = …` which would otherwise wipe
    // the tooltip on every cycle. Each rect carries data-date / data-tokens;
    // one delegated mouseover handler positions the tooltip absolutely
    // against the section. Content stays minimal — just `Month D — N` —
    // since the stats row below already shows aggregate sessions.
    let tipEl = document.getElementById('usage-tip');
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.id = 'usage-tip';
      tipEl.className = 'usage-tip';
      tipEl.hidden = true;
      section.appendChild(tipEl);
    }
    const formatDate = (iso) => {
      const d = new Date(iso + 'T00:00:00Z');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
    };
    const showTip = (rect) => {
      // Rhythm cell: weekday + local hour + prompt count.
      if (rect.hasAttribute('data-rhythm')) {
        const day = rect.getAttribute('data-day') || '';
        const hr = parseInt(rect.getAttribute('data-hour'), 10) || 0;
        const n = parseInt(rect.getAttribute('data-prompts'), 10) || 0;
        tipEl.innerHTML =
          `<span class="usage-tip-date">${day} ${String(hr).padStart(2, '0')}:00</span>` +
          ` &mdash; <strong>${n.toLocaleString()}</strong> prompt${n === 1 ? '' : 's'}`;
        positionTip(rect);
        return;
      }
      // Trend hit-area: week-of date + that week's tokens.
      if (rect.hasAttribute('data-trend')) {
        const week = rect.getAttribute('data-week') || '';
        const v = parseInt(rect.getAttribute('data-value'), 10) || 0;
        const cost = parseInt(rect.getAttribute('data-cost'), 10) || 0;
        let html =
          `<span class="usage-tip-date">week of ${formatDate(week)}</span>` +
          ` &mdash; <strong>${fmtCompact(v)}</strong>`;
        if (cost > 0) html += ` &middot; $${(cost / 100).toFixed(2)}`;
        tipEl.innerHTML = html;
        positionTip(rect);
        return;
      }
      const date = rect.getAttribute('data-date');
      if (!date) { tipEl.hidden = true; return; }
      const tokens = parseInt(rect.getAttribute('data-tokens'), 10) || 0;
      // Base line stays exactly as v1: date — tokens. Extra segments append
      // only when the Worker published them (see dataAttrs above).
      let html =
        `<span class="usage-tip-date">${formatDate(date)}</span>` +
        ` &mdash; <strong>${tokens.toLocaleString()}</strong>`;
      const total = parseInt(rect.getAttribute('data-total'), 10) || 0;
      const cached = parseInt(rect.getAttribute('data-cached'), 10) || 0;
      const cost = parseInt(rect.getAttribute('data-cost'), 10) || 0;
      if (total > 0) html += ` / ${fmtCompact(total)} total`;
      if (total > 0 && cached > 0) {
        html += ` &middot; ${Math.round((cached / total) * 100)}% cached`;
      }
      if (cost > 0) html += ` &middot; $${(cost / 100).toFixed(2)}`;
      tipEl.innerHTML = html;
      positionTip(rect);
    };
    // Shared placement: anchor to the DATA POINT, not the cursor.
    //
    // Two earlier attempts got this wrong. Anchoring to the hovered rect's
    // top-left worked on the grids (a cell IS its data point) but put the
    // label a column-height away on the trend view, whose hit-areas are
    // full-height transparent columns. Following the cursor then made the
    // label track empty space inside those columns — the dot could be at the
    // top of the plot while the pointer sat at the bottom.
    //
    // A grid cell's own box is its data point; the trend view carries the
    // dot's coordinates on the rect (data-dot-x / data-dot-y in viewBox
    // units) so both cases resolve to "the mark the number belongs to".
    function anchorRect(rect) {
      const box = rect.getBoundingClientRect();
      const dx = rect.getAttribute('data-dot-x');
      const dy = rect.getAttribute('data-dot-y');
      if (dx === null || dy === null) return box;   // grid cell: box is the mark
      // Map viewBox units to screen px through the owning <svg>.
      const svg = rect.ownerSVGElement;
      const vb = svg && svg.viewBox && svg.viewBox.baseVal;
      if (!vb || !vb.width || !vb.height) return box;
      const svgBox = svg.getBoundingClientRect();
      const sx = svgBox.width / vb.width;
      const sy = svgBox.height / vb.height;
      const cx = svgBox.left + (parseFloat(dx) - vb.x) * sx;
      const cy = svgBox.top + (parseFloat(dy) - vb.y) * sy;
      // A zero-size box centred on the dot: the caller only needs a centre
      // and a top edge, and both collapse to the dot itself.
      return { left: cx, right: cx, width: 0, top: cy, bottom: cy, height: 0 };
    }
    function positionTip(rect) {
      const sectionBox = section.getBoundingClientRect();
      const markBox = anchorRect(rect);
      const xCenter = markBox.left + markBox.width / 2 - sectionBox.left;
      const markTop = markBox.top - sectionBox.top;
      tipEl.hidden = false;
      // Measure after un-hiding so width is real
      const tipW = tipEl.offsetWidth;
      const tipH = tipEl.offsetHeight;
      const sectionW = sectionBox.width;
      const left = Math.max(0, Math.min(sectionW - tipW, xCenter - tipW / 2));
      const GAP = 8;
      const MIN_GAP = 3;   // still reads as "attached" when space is tight
      // Ceiling is the top of the chart, not of the section: floating above
      // the chart parks the label over the section heading.
      const chartBox = heatmapEl.getBoundingClientRect();
      const chartTop = chartBox.top - sectionBox.top;
      let top = markTop - tipH - GAP;
      if (top < chartTop) {
        // Tight above the mark. Prefer shrinking the gap over flipping, since
        // flipping puts the label on top of the line/area it describes.
        const squeezed = markTop - tipH - MIN_GAP;
        top = squeezed >= chartTop ? squeezed : markBox.bottom - sectionBox.top + GAP;
      }
      tipEl.style.left = `${left}px`;
      tipEl.style.top  = `${top}px`;
    }
    heatmapEl.addEventListener('mouseover', (ev) => {
      const r = ev.target.closest('rect.usage-cell, rect[data-trend]');
      if (r) showTip(r);
    });
    heatmapEl.addEventListener('mouseout', (ev) => {
      // Only hide when leaving the heatmap entirely; cell→cell shouldn't flicker.
      if (!ev.relatedTarget || !heatmapEl.contains(ev.relatedTarget)) {
        tipEl.hidden = true;
      }
    });

    // First fetch + start the loop.
    refetch().then(() => {
      if (!section.hidden) startTimers();
    });
  };

  /* ── Hero "ask this portfolio" bar ──────────────────────────────────
     Self-contained — it never bounces the visitor into ⌘K. With the
     antares-qa Worker (site.json → qa.workerUrl) it answers inline with a
     grounded generation; otherwise (or if the Worker errors) it answers
     inline from the hand-authored FAQ / card retrieval in qa-faq.js. */
  // The multi-turn "ask Antares" chat panel. Returns { open(seedQ?) } so the
  // hero "ask" bar (wireHeroAsk) can pop it open with a question. Answers come
  // from the antares-qa Worker (site.json → qa.workerUrl) with the running
  // conversation; without a Worker, each turn falls back to the hand-authored
  // FAQ/card retrieval in window.QA (one-shot, not really conversational).
  const wireAskPanel = (site, board) => {
    const panel = document.getElementById('ask-panel');
    const log = document.getElementById('ask-panel-log');
    const form = document.getElementById('ask-panel-form');
    const input = document.getElementById('ask-panel-input');
    const sendBtn = document.getElementById('ask-panel-send');
    if (!panel || !log || !form || !input) return null;
    const url = String((site && site.qa && site.qa.workerUrl) || '').trim();
    const cards = (board && board.cards) ? board.cards : [];
    let convo = [];          // [{ role:'user'|'assistant', content }]
    let busy = false;

    /* Message shape follows what Claude / ChatGPT / Cursor converged on. The
       old version was quietly signalling the wrong thing:

       - The assistant reply is FULL-WIDTH with no bubble. Rounded coloured
         bubbles read as SMS and undermine the tool framing; the serious AI
         chats all dropped them. Only the user's turn keeps a bubble, which is
         what lets the two be told apart without labelling either.
       - No "ANTARES" tag above every reply. In a two-party conversation the
         alignment already says who is speaking; a repeated uppercase label is
         noise. Standalone AI chats skip the assistant avatar and label for
         exactly this reason.
       - The reply is full-contrast body text, not dimmed. Dimming it says
         "secondary", which is backwards — the answer is the product.
       - "thinking…" in italics becomes three pulsing dots. Italic prose reads
         as something the model wrote; a pulse reads as a state the interface
         is in. */
    const renderLog = (pending) => {
      if (!convo.length && !pending) {
        /* Starter chips, not just a sentence. A tall empty panel with one line
           of prose gives the visitor nothing to act on, and "ask me anything"
           is the hardest possible prompt to answer. The questions are taken
           from the hand-authored FAQ so a click always lands on an answer the
           offline path can serve even if the Worker is unreachable. */
        const starters = (window.QA && Array.isArray(window.QA.FAQ) ? window.QA.FAQ : [])
          .slice(0, 4).map((f) => f.q).filter(Boolean);
        const chips = starters.length
          ? `<div class="ask-starters">${starters.map((q) =>
              `<button class="ask-starter" type="button" data-q="${escape(q)}">${escape(q)}</button>`).join('')}</div>`
          : '';
        log.innerHTML = `<p class="ask-panel-empty">Ask me about a project, what I'm building, how I think, or how to reach me — and we can keep going from there.</p>${chips}`;
        return;
      }
      let html = convo.map((m) => {
        const you = m.role === 'user';
        /* A highlighted passage renders above the question as a quote, not
           inside it — the visitor asked the question, they did not type the
           passage, and merging the two makes the log unreadable. */
        const quote = (you && m.quote)
          ? `<div class="ask-msg-quote">${escape(m.quote)}</div>` : '';
        return `<div class="ask-msg ask-msg-${you ? 'you' : 'bot'}">${quote}<div class="ask-msg-text">${escape(m.content)}</div></div>`;
      }).join('');
      /* role=status + aria-label because three animated dots convey nothing to
         a screen reader. `status` is implicitly aria-live=polite, which waits
         for a pause instead of interrupting mid-sentence. */
      if (pending) html += `<div class="ask-msg ask-msg-bot is-thinking"><div class="ask-msg-dots" role="status" aria-label="Thinking"><span></span><span></span><span></span></div></div>`;
      log.innerHTML = html;
      log.scrollTop = log.scrollHeight;
    };
    const setBusy = (b) => { busy = b; input.disabled = b; if (sendBtn) sendBtn.disabled = b; };

    // Offline / network-degraded fallback: serve the hand-authored FAQ match
    // (or a card-retrieval hit) so a visitor whose network can't reach the
    // Worker — common on mainland-China connections vs *.workers.dev, which
    // has DNS-poisoning + SNI-reset issues — still gets a useful answer
    // instead of "try again in a moment". The first such answer carries a
    // language-aware tag explaining why this is the short form.
    const isZh = /^zh/i.test((navigator.language || navigator.userLanguage || ''));
    const offlineAnswer = (q) => {
      const m = (window.QA && typeof window.QA.match === 'function') ? window.QA.match(q, cards) : null;
      const firstAnswer = convo.filter((x) => x.role === 'assistant').length === 0;
      const tag = firstAnswer
        ? (isZh
            ? '\n\n（这是离线 FAQ 的简短回答——网络受限，连不上对话式 AI 服务。完整功能请稍后再试，或邮件联系 chenjy4@uw.edu。）'
            : "\n\n(quick FAQ answer — couldn't reach the live answer service from your network. Try again later, or email chenjy4@uw.edu.)")
        : '';
      /* Answered vs not — the whole point of counting this. A run of
         'unanswered' is a to-do list for the FAQ, and it is the one
         counter here that names a concrete next action. The QUESTION
         TEXT is never sent: only which of the two outcomes happened. */
      try {
        if (typeof window.SITE_BEACON === 'function') {
          window.SITE_BEACON('qa_ask', m ? 'answered' : 'unanswered');
        }
      } catch (_) { /* noop */ }
      if (m) return m.answer + tag;
      return (isZh
        ? '抱歉，这个问题我没有在这里写过——可以看看下面的 roadmap 或者邮件 chenjy4@uw.edu。'
        : "I don't see that covered here — the roadmap below has what I've shipped and what I'm building.") + tag;
    };

    /* `selection` is text the visitor highlighted on the page. It rides along
       as context so a question like "what does this mean?" has a referent,
       without being shown as if they had typed it. */
    /* Pending quote: set when the visitor picks "Ask about this", consumed by
       the next send(). Rendered as a dismissible chip so it never silently
       attaches to a question the visitor thought was about something else. */
    let pendingQuote = '';
    const quoteChip = document.getElementById('ask-quote-chip');
    const renderQuoteChip = () => {
      if (!quoteChip) return;
      if (!pendingQuote) { quoteChip.hidden = true; quoteChip.innerHTML = ''; return; }
      quoteChip.hidden = false;
      quoteChip.innerHTML =
        `<span class="ask-quote-text"></span>` +
        `<button class="ask-quote-x" type="button" aria-label="Remove quoted text">` +
        `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" ` +
        `stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>`;
      /* textContent, not interpolation: the passage is arbitrary page text and
         may contain < or &. */
      quoteChip.querySelector('.ask-quote-text').textContent = pendingQuote;
      quoteChip.querySelector('.ask-quote-x')
        .addEventListener('click', () => setPendingQuote(''));
    };
    const setPendingQuote = (t) => { pendingQuote = String(t || '').slice(0, 1200); renderQuoteChip(); };

    const send = (raw, selection) => {
      const q = String(raw || '').trim().slice(0, 500);
      if (!q || busy) return;
      const sel = String(selection || pendingQuote || '').trim().slice(0, 1200);
      if (pendingQuote) setPendingQuote('');   // consumed by this turn
      /* Stored on the turn rather than concatenated into the question: the log
         shows what was asked, and the quote renders as its own block above it.
         Splicing it into `content` would put the whole passage in the user's
         bubble as though they had typed it. */
      convo.push(sel ? { role: 'user', content: q, quote: sel }
                     : { role: 'user', content: q });
      renderLog(true);
      setBusy(true);
      const finish = (answer) => { convo.push({ role: 'assistant', content: answer }); renderLog(false); setBusy(false); input.focus(); };
      if (!url) { setTimeout(() => finish(offlineAnswer(q)), 220); return; }
      // Send both: `messages` for the multi-turn Worker, `q` so an older
      // single-turn deployment still works (it ignores `messages`).
      fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q, messages: convo, context: sel ? `The visitor highlighted this passage on the page:\n"${sel}"` : undefined }), signal: AbortSignal.timeout(30000) })
        .then(async (r) => {
          let d = {};
          try { d = await r.json(); } catch (_) { /* non-JSON */ }
          // Happy path: a real model answer.
          if (r.ok && d && d.answer) return String(d.answer);
          // Worker reachable but errored (rate-limit, upstream model failure,
          // grounding fetch failure). Fall back to the offline FAQ retrieval —
          // it almost always beats showing a raw error to a visitor.
          return offlineAnswer(q);
        })
        .catch(() => offlineAnswer(q))
        .then(finish);
    };

    /* A side panel, not a modal. The page beside it stays readable, scrollable
       and clickable — you can open the chat, keep browsing the board, and ask
       about what you are looking at. That is the whole point of putting it on
       the side rather than over the top.

       So: no backdrop, no scroll lock, no aria-modal, and focus is NOT trapped
       inside the panel. */
    /* `quiet` opens the panel without taking focus. Auto-opening on load and
       then grabbing the caret would hijack the page from someone who came to
       read it — and on a phone it summons the keyboard over the content. A
       panel the visitor opened deliberately still focuses, as before. */
    const open = (seedQ, opts) => {
      const quiet = !!(opts && opts.quiet);
      /* A highlighted passage arrives before the question does. Park it and
         attach it to whatever gets asked next, showing a chip above the
         composer so it is obvious the question will be about that text and
         not the page at large. */
      if (opts && opts.quote) setPendingQuote(String(opts.quote));
      if (!panel.classList.contains('is-open')) {
        panel.hidden = false;
        void panel.offsetWidth;                              // reflow so the transition fires
        panel.classList.add('is-open');
        document.body.classList.add('ask-panel-open');
        renderLog(false);
      }
      if (quiet && !seedQ) return;
      setTimeout(() => { input.focus(); if (seedQ) send(seedQ); }, 50);
    };
    const close = () => {
      /* Record that this was closed on purpose. Without it the panel would
         reappear on every navigation for someone who keeps dismissing it —
         auto-open is a default, not a policy. */
      try { localStorage.setItem('antares.copilot', 'closed'); } catch (e) {}
      panel.classList.remove('is-open');
      document.body.classList.remove('ask-panel-open');
      setTimeout(() => { if (!panel.classList.contains('is-open')) { panel.hidden = true; } }, 220);
    };
    const clearConvo = () => { if (busy) return; convo = []; renderLog(false); input.value = ''; input.focus(); };

    form.addEventListener('submit', (ev) => { ev.preventDefault(); const q = input.value.trim(); input.value = ''; if (q) send(q); });
    /* Delegated, because renderLog() rebuilds the chips on every paint —
       binding them directly would leave dead listeners behind and miss the
       set that reappears after "new". */
    log.addEventListener('click', (ev) => {
      const chip = ev.target.closest('.ask-starter');
      if (!chip || busy) return;
      send(chip.dataset.q || chip.textContent.trim());
    });
    document.getElementById('ask-panel-close')?.addEventListener('click', close);
    document.getElementById('ask-panel-clear')?.addEventListener('click', clearConvo);
    /* Escape still closes, but only when focus is actually inside the panel.
       As a non-modal surface it no longer owns the whole page, so swallowing
       every Escape would break the palette and the card panel. */
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape' || !panel.classList.contains('is-open')) return;
      if (!panel.contains(document.activeElement)) return;
      close();
    });

    return { open };
  };

  // The hero "ask" bar → opens the chat panel, seeded with the question.
  // It also docks: once the hero bar scrolls out of view it re-forms as a
  // floating pill in the bottom-right, draggable to any corner of the viewport.
  /* Open the assistant automatically in the spaces configured for it.
     "Work" is a workspace — the copilot being already there is the point, the
     same way an IDE opens with its side panel out. Other spaces stay quiet
     until asked.

     Deliberately conservative about when NOT to fire:
       - a visitor who closed it stays closed, across visits and navigations
       - never below the drawer's breakpoint, where it covers the whole
         viewport and would bury the page behind a chat nobody asked for
       - never when a deep link already targets something specific (#hash), or
         when the palette handed over a question — that flow opens the panel
         itself, with focus, and this would race it
     Opens in quiet mode, so it does not steal the caret from someone reading. */
  const autoOpenCopilot = (askPanel, site) => {
    if (!askPanel || typeof askPanel.open !== 'function') return;

    const cfg = (site && site.spaces) || {};
    const autoSpaces = cfg.autoCopilot || [];
    if (!autoSpaces.length) return;

    /* Same longest-prefix rule scripts/spaces.js uses, and for the same
       reason: "/" is a prefix of every path, so a plain startsWith would
       report "work" on /personal/ too. */
    const items = cfg.items || [];
    let here = null;
    items.forEach((sp) => {
      const href = sp.href || '/';
      if (location.pathname.indexOf(href) === 0 &&
          (!here || href.length > (here.href || '/').length)) here = sp;
    });
    if (!here || autoSpaces.indexOf(here.id) === -1) return;

    let dismissed = false;
    try { dismissed = localStorage.getItem('antares.copilot') === 'closed'; } catch (e) {}
    if (dismissed) return;

    if (window.innerWidth <= 560) return;
    if (location.hash) return;

    /* On the home page the assistant sits at the BOTTOM, not the side. Work
       reads as a résumé — one column, top to bottom — and a side drawer that
       opens on arrival shoves that column sideways before the visitor has read
       a line. The docked composer stays out of the way until they reach it,
       and any question they ask promotes it to the side panel (wireHeroAsk).
       Detail pages do the opposite: there the visitor is already on one
       subject, so the panel opens beside it. */
    document.body.classList.add('ask-dock-bottom');
    /* Clear any saved drag position. The pill writes inline left/right/bottom
       when dragged, and inline styles beat the stylesheet — a position saved
       from the corner-pill layout left the bottom composer stuck at the old
       coordinates (measured: 187px off centre). The centred composer is not
       draggable, so the stored position has nothing to apply to here. */
    const pill = document.getElementById('hero-ask');
    if (pill) {
      pill.style.removeProperty('left');
      pill.style.removeProperty('right');
      pill.style.removeProperty('bottom');
    }
  };

  const wireHeroAsk = (askPanel) => {
    const wrap = document.getElementById('hero-ask');
    const form = document.getElementById('hero-ask-form');
    const input = document.getElementById('hero-ask-input');
    if (!form || !input || !askPanel) return;

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const q = input.value.trim();
      input.value = '';
      /* Clearing the value does not clear the class -- the pill would stay
         expanded over an empty field, which reads as "still waiting for you"
         while the panel is already answering. */
      wrap?.classList.remove('has-draft');
      askPanel.open(q || undefined);   // empty → just open the panel
    });

    if (!wrap) return;

    /* Keep the pill open while there is text in it, so it cannot collapse and
       swallow a half-typed question when the pointer wanders off. */
    input.addEventListener('input', () => {
      wrap.classList.toggle('has-draft', input.value.trim().length > 0);
    });

    /* Always docked. The hero used to carry a full-width copy of this bar, and
       the pill only appeared once that scrolled away — but the pill is always
       reachable, so the hero copy was a second entry point to the same panel
       occupying a whole row above the fold.

       With that copy gone, everything that made docking conditional goes with
       it: the IntersectionObserver, the sentinel that triggered it, the spacer
       that held the hero's grid row open, and the guard that refused to dock
       while the field had focus.

       What stays is the one part that was never about scrolling — the node has
       to live on <body>. `position: fixed` is NOT viewport-relative when an
       ancestor has a transform, and .hero carries one permanently (its `rise`
       entrance animation uses fill-mode `both`, so the final frame sticks).
       Left inside the hero, the pill anchored to that box and sat hundreds of
       pixels below the fold: present in the DOM, invisible on screen. */
    document.body.appendChild(wrap);
    wrap.classList.add('is-docked');

    /* ── Draggable ──────────────────────────────────────────────────────────
       Parked bottom-right by default, but that is exactly where a page tends
       to put things worth reading, so the pill has to be movable.

       Position stays expressed as `right`/`bottom`, never converted to
       `left`/`top`. The pill grows leftward when it expands (52px → 380px), so
       a left-anchored pill would shove its own input off the right edge of the
       screen as soon as you focused it. Anchoring to the right edge means the
       growth happens away from the boundary it is pinned to.

       Drag only starts after the pointer has travelled DRAG_SLOP. Without that
       threshold every click would register as a zero-distance drag and the
       pill would stop opening the panel — the failure mode being that a click
       does nothing at all and looks broken. */
    const DRAG_SLOP = 4;
    const EDGE_GAP = 12;
    const POS_KEY = 'askPillPos';

    const clampPos = (right, bottom) => {
      const r = wrap.getBoundingClientRect();
      /* Clamp against the COLLAPSED size, not the current one. Dragging while
         expanded would otherwise let the 380px form define the limit, and the
         pill would sit unreachably far off once it shrank back to 52px. */
      const w = wrap.classList.contains('is-dragging') ? 52 : r.width;
      const h = 52;
      return {
        right: Math.min(Math.max(right, EDGE_GAP), Math.max(EDGE_GAP, innerWidth - w - EDGE_GAP)),
        bottom: Math.min(Math.max(bottom, EDGE_GAP), Math.max(EDGE_GAP, innerHeight - h - EDGE_GAP))
      };
    };

    const applyPos = (pos) => {
      const c = clampPos(pos.right, pos.bottom);
      wrap.style.right = c.right + 'px';
      wrap.style.bottom = c.bottom + 'px';
      wrap.style.left = 'auto';
      return c;
    };

    /* Re-anchor to the nearer horizontal edge, converting `right` into an
       equivalent `left` when the pill is sitting in the left half. Done only
       at drop time, never mid-drag: swapping the anchor while the pointer is
       moving makes the pill jump under the cursor. */
    const setAnchor = () => {
      if (!pos) return;
      const collapsed = 52;
      const leftPx = innerWidth - pos.right - collapsed;
      if (leftPx < innerWidth / 2) {
        wrap.style.left = Math.max(EDGE_GAP, leftPx) + 'px';
        wrap.style.right = 'auto';
      } else {
        wrap.style.left = 'auto';
        wrap.style.right = pos.right + 'px';
      }
    };

    let pos = null;
    try {
      const saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (saved && Number.isFinite(saved.right) && Number.isFinite(saved.bottom)) pos = saved;
    } catch (e) { /* corrupt value — fall back to the CSS corner */ }
    if (pos) { applyPos(pos); setAnchor(); }

    let drag = null;
    wrap.addEventListener('pointerdown', (ev) => {
      /* Only drag by the pill's own body. Once expanded it is a text field and
         a button, where a press means "put the caret here", not "move me". */
      if (ev.button !== 0) return;
      if (wrap.classList.contains('has-draft') || wrap.matches(':focus-within')) return;
      const r = wrap.getBoundingClientRect();
      drag = {
        id: ev.pointerId,
        startX: ev.clientX, startY: ev.clientY,
        right: innerWidth - r.right, bottom: innerHeight - r.bottom,
        moved: false
      };
    });

    wrap.addEventListener('pointermove', (ev) => {
      if (!drag || ev.pointerId !== drag.id) return;
      const dx = ev.clientX - drag.startX;
      const dy = ev.clientY - drag.startY;
      if (!drag.moved) {
        if (Math.hypot(dx, dy) < DRAG_SLOP) return;
        drag.moved = true;
        wrap.classList.add('is-dragging');
        /* Capture AFTER the slop is crossed. Capturing on pointerdown would
           swallow the click that opens the panel. */
        try { wrap.setPointerCapture(drag.id); } catch (e) {}
      }
      /* Inverted: dragging right REDUCES the distance to the right edge. */
      pos = applyPos({ right: drag.right - dx, bottom: drag.bottom - dy });
      ev.preventDefault();
    });

    const endDrag = (ev) => {
      if (!drag || (ev && ev.pointerId !== drag.id)) return;
      const wasDragging = drag.moved;
      try { wrap.releasePointerCapture(drag.id); } catch (e) {}
      drag = null;
      if (!wasDragging) return;
      wrap.classList.remove('is-dragging');
      /* Re-clamp: the collapsed width is only knowable once is-dragging is off,
         and a drag that ended mid-expand could otherwise leave it out of reach. */
      if (pos) pos = applyPos(pos);
      /* Pick the anchor edge by which half it landed in. The pill grows from
         52px to 380px when it expands, and it grows AWAY from whichever edge
         it is anchored to. Right-anchored is correct on the right half; keep
         it there on the left half and expanding drives the input off the left
         edge (measured: left: -294px). Flipping to a left anchor makes it grow
         rightward, into the space that is actually available. */
      setAnchor();
      try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (e) {}
      /* Suppress the click that the browser fires after the drag, or letting go
         would also open the panel. */
      wrap.addEventListener('click', (c) => { c.stopPropagation(); c.preventDefault(); },
        { capture: true, once: true });
    };
    wrap.addEventListener('pointerup', endDrag);
    wrap.addEventListener('pointercancel', endDrag);

    /* A pill parked against one edge would hang off-screen if the window
       shrank; re-clamping keeps it reachable. */
    addEventListener('resize', () => { if (pos) { pos = applyPos(pos); setAnchor(); } });
  };

  const wireModal = () => {
    // Card / skill click → open the same side-panel modal. The two surfaces
    // (kanban .card buttons + /skills .skill-link buttons) share displayIds
    // by namespace (SHIP-NN / NOW-NN / NEXT-NN / LATER-NN / SKILL-NN), so
    // one handler + one cardIndex Map is enough.
    document.addEventListener('click', (ev) => {
      const card = ev.target.closest('.card[data-card-id], .skill-link[data-card-id]');
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

  // Hydrate the /skills section into cardIndex — the section is always
  // prerendered (build-html.js writes the markup); JS just needs the Map
  // populated so a click on a .skill-link opens the same side-panel modal
  // the board cards use. Skill rows carry data-card-id="SKILL-NN".
  const hydrateSkills = (skills) => {
    const items = (skills && skills.items) || [];
    const sorted = items.slice().sort((a, b) =>
      (a.order ?? 99) - (b.order ?? 99) || String(a.name ?? '').localeCompare(String(b.name ?? '')));
    sorted.forEach((s, idx) => {
      const displayId = `SKILL-${pad2(idx + 1)}`;
      cardIndex.set(displayId, {
        displayId,
        status: 'skill',
        title: s.name ?? '',
        summary: s.summary ?? '',
        details: s.details ?? '',
        tags: s.category ? [s.category] : [],
        links: Array.isArray(s.links) ? s.links : [],
      });
    });
  };

  /* ── Boot ───────────────────────────────────────────────────────── */
  (async () => {
    try {
      const [site, profile, board, lens, contact, skills] = await Promise.all([
        json('content/site.json'),
        json('content/profile.json'),
        json('content/board.json'),
        json('content/lens.json'),
        json('content/contact.json'),
        json('content/skills.json').catch(() => ({ items: [] })),  // optional — empty if absent
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
      // Skills hydrate the same Map regardless of prerender state — the
      // section is SSR-rendered by build-html.js, runtime just needs the
      // index for click-to-open and for the cross-surface open-card event.
      hydrateSkills(skills);
      // Wire interactive behavior — needed in both prerendered and runtime
      // modes since build-html.js only emits markup, not event listeners.
      wireFilterChipClicks();
      wireViewTabs();
      wireModal();
      wireTheme();
      /* Expose the panel so other surfaces can hand it a question. The command
         palette needs it for its "ask Antares" row, and palette.js is a
         separate script with no import path into this closure. */
      const askPanel = wireAskPanel(site, board);
      window.ASK_PANEL = askPanel;
      wireHeroAsk(askPanel);
      autoOpenCopilot(askPanel, site);
      wireUsage(site);
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
