/* ─────────────────────────────────────────────────────────────────────────
   Personal's server-rendered lists, rendered straight from content/*.json.

   templates/personal.html is a verbatim capture of the page, so every list in
   it is a snapshot of the JSON as it was that day. build-spaces.js used to fix
   that by lifting the fresh blocks out of index.html, which only worked while
   Work rendered the same board. Work is now its own page with its own markup,
   so the lists are rendered here, into the Personal template directly.

   Markup mirrors scripts/render.js (cards, chips, skills) so the client can
   hydrate it without re-rendering.
   ───────────────────────────────────────────────────────────────────────── */
const fs = require('fs');
const path = require('path');
const { escape, safeRich, replaceInner, replaceInnerOpenMatch } = require('./html-replace');

const root = path.join(__dirname, '..', '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
// Optional files: a fork that drops one keeps an empty list rather than a crash.
const readOr = (p, fallback) => { try { return read(p); } catch { return fallback; } };

/* ── Card index (mirrors render.js) ───────────────────────────────────── */
const ID_PREFIX = { shipped: 'SHIP', now: 'NOW', next: 'NEXT', later: 'LATER' };
const pad2 = (n) => String(n).padStart(2, '0');

// Card end-date helper: mirrors render.js. `present: true` means "no fixed
// end date, still active" — for sort and display purposes the card behaves
// like today; for the chip text it shows 'ongoing' instead of a date.
const todayISO = () => new Date().toISOString().slice(0, 10);
const cardEndKey  = (c) => (c && c.present) ? todayISO() : (c?.updated ?? '');
const cardEndText = (c) => (c && c.present) ? 'ongoing'   : (c?.updated ?? '');

const allCards = (board) => {
  const cards = (board.cards ?? []).slice().sort((a, b) => {
    const ao = a.order ?? 99, bo = b.order ?? 99;
    if (ao !== bo) return ao - bo;
    return cardEndKey(b).localeCompare(cardEndKey(a));
  });
  const cols = ['shipped', 'now', 'next', 'later'];
  const out = [];
  cols.forEach((col) => {
    cards.filter(c => c.status === col).forEach((c, i) => {
      out.push({ ...c, displayId: `${ID_PREFIX[col]}-${pad2(i + 1)}` });
    });
  });
  return out;
};

// One card -> link HTML (matches render.js exactly, including data-attrs)
const cardHtml = (c) => {
  const tags = (c.tags ?? []).map((t, i) =>
    `<span class="tag${i % 2 ? ' tag-blue' : ''}">${escape(t)}</span>`
  ).join('');

  const links = (c.links ?? [])
    .filter(l => l.href && l.href !== '#')
    .map((l) => `<a href="${escape(l.href)}" target="_blank" rel="noopener">${escape(l.label)} ↗</a>`)
    .join('');

  const tagSlugs = (c.tags ?? []).map((t) => t.toLowerCase()).join('|');

  return `
            <a class="card" href="/work/${escape(c.slug || '')}/" data-id="${escape(c.id)}" data-card-id="${c.displayId}" data-tags="${escape(tagSlugs)}" aria-label="Open details for ${escape(c.title)}">
              <div class="card-meta-top">
                <span class="card-id">${c.displayId}</span>
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
};

// Filter chips (top 6 tags by frequency, plus the "All" pre-baked in HTML)
const filterChipsHtml = (cards) => {
  const counts = new Map();
  cards.forEach((c) => (c.tags ?? []).forEach((t) => {
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }));
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t);
  const allChip = `<button class="filter-chip is-active" type="button" data-filter="all" aria-pressed="true">All</button>`;
  const tagChips = top.map((tag) =>
    `<button class="filter-chip" type="button" data-filter="${escape(tag.toLowerCase())}" aria-pressed="false">${escape(tag)}</button>`
  ).join('');
  return allChip + tagChips;
};

// Lens items
const lensListHtml = (lens) =>
  (lens.items ?? []).map((it) => {
    const aside = it.aside ? `<em>${escape(it.aside)}</em>` : '';
    return `
        <div class="lens-card">
          <div class="lens-num">${escape(it.num ?? '')}</div>
          <div class="lens-text">${escape(it.main ?? '')}${aside}</div>
        </div>`;
  }).join('');

// Skills — one alias-style row per item. Each row links straight to the
// project's official site, falling back to its GitHub repository.
const skillsSorted = (skills) => (skills.items ?? []).slice().sort((a, b) =>
  (a.order ?? 99) - (b.order ?? 99) || String(a.name ?? '').localeCompare(String(b.name ?? '')));
const skillRowHtml = (s) => {
  const destination = s.site || s.repo || '#';
  const destinationLabel = s.site ? 'Visit site' : 'GitHub';
  return `
        <li class="skill-row">
          <a class="skill-link" href="${escape(destination)}" target="_blank" rel="noopener" aria-label="${escape(destinationLabel)} for ${escape(s.name ?? '')}">
            <span class="skill-name">${escape(s.name ?? '')}</span>
            ${s.category ? `<span class="skill-cat">${escape(s.category)}</span>` : ''}
            <span class="skill-summary">${escape(s.summary ?? '')}</span>
            <span class="skill-destination">${destinationLabel} ↗</span>
          </a>
        </li>`;
};

// Contact list
const contactListHtml = (contact) =>
  (contact.items ?? []).map((it) => {
    const tgt = it.href?.startsWith('http') ? ` target="_blank" rel="noopener"` : '';
    return `<a href="${escape(it.href ?? '#')}"${tgt}><span class="key">${escape(it.key ?? '')}</span><span>${escape(it.label ?? '')}</span></a>`;
  }).join('');

/* ── Apply ────────────────────────────────────────────────────────────── */
const renderPersonalBlocks = (html) => {
  const board   = read('content/board.json');
  const lens    = readOr('content/lens.json', { items: [] });
  const contact = readOr('content/contact.json', { items: [] });
  const skills  = readOr('content/skills.json', { head: {}, items: [] });

  const cards = allCards(board);
  ['shipped', 'now', 'next', 'later'].forEach((col) => {
    const filtered = cards.filter(c => c.status === col);
    const inner = filtered.length === 0
      ? `<div class="col-empty">no cards yet</div>`
      : filtered.map(cardHtml).join('');
    // .col-cards container is identified by data-cards="X" attribute.
    html = replaceInnerOpenMatch(html,
      new RegExp(`<(div)([^>]*\\sdata-cards="${col}"[^>]*)>`, 'i'), inner, `data-cards="${col}"`);
    // Count badge — span with data-count="X"
    html = replaceInnerOpenMatch(html,
      new RegExp(`<(span)([^>]*\\sdata-count="${col}"[^>]*)>`, 'i'), String(filtered.length), `data-count="${col}"`);
  });
  /* The toolbar counts and the filter chips sit outside the .board block the
     old lift copied, so they stayed frozen at whatever the template captured. */
  html = replaceInner(html, 'board-total-count', String(cards.length));
  html = replaceInner(html, 'board-shipped-count', `${cards.filter(c => c.status === 'shipped').length} shipped`);
  html = replaceInner(html, 'board-filters', filterChipsHtml(cards));

  html = replaceInner(html, 'skills-list', skillsSorted(skills).map(skillRowHtml).join(''));
  html = replaceInner(html, 'lens-list', lensListHtml(lens));
  html = replaceInner(html, 'contact-list', contactListHtml(contact));
  return { html, cardCount: cards.length };
};

module.exports = { renderPersonalBlocks };
