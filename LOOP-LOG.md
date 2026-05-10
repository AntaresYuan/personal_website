# Autonomous dev loop — log

Running log of the autonomous dev loop kicked off 2026-05-10 (working through
`#78` board view modes + `#76` Phase 1, per the queue agreed with the owner).
Each entry: what was done, what was tested, results, PR/commit, follow-ups.
The owner can delete this file once the loop has wrapped up.

---

## 2026-05-10 — Task 1/6: `#78` board Table view

**Branch:** `feat/board-table-view`

**What:**
- Added a **"Table"** tab to `.board-views` (between Board and Timeline); wired
  proper ARIA tablist plumbing (`role="tab"` + `aria-controls` + `aria-selected`
  + roving `tabindex` + arrow/Home/End key nav). The kanban `<div class="board">`
  now also carries `role="tabpanel"`. Disabled tabs (Timeline / Specs) left inert.
- Added `#view-table` (a `role="tabpanel"` container) after the kanban grid;
  filled lazily by `scripts/render.js` on first switch to the Table view — the
  kanban stays the SSG-prerendered default, so agents / no-JS see that.
- `render.js`: `buildTableView()` renders the same cards (from `cardIndex`, in
  board order) as a `<table>` with columns Title · Status · Tags · Impact ·
  Updated · Links. Column headers are sort buttons (`aria-sort` + ▲/▼; first
  click asc, second flips desc; stable tiebreak on title). Rows are clickable /
  Enter-Space activatable and open the existing card-detail panel. Tag filter
  chips now dim **table rows too**, not just kanban cards (shared `applyFilter`).
- `styles/main.css`: `.board-table` + friends — sticky header, hover/focus
  states, `tr.is-filtered { display:none }`, horizontal scroll on narrow widths.

**Tested:**
- `node -c scripts/render.js` → syntax OK.
- `node scripts/build.js` → passes; index.html still prerenders the kanban; my
  static additions (Table tab, `#view-table`, `role="tabpanel"`) survive the
  build; rebuild is idempotent (no diff on a second run).
- Self-review caught a bug: `.board { display:grid }` would override the UA
  `[hidden]` rule, so `board.hidden = true` wouldn't visually hide the kanban
  (you'd see kanban + table stacked). Fixed with `.board[hidden]{display:none}`.
- (No browser in this environment — full runtime behaviour to be confirmed by
  the PR code review + a post-deploy `curl` of antaresyuan.site.)

**Review:** independent sub-agent code review → verdict "OK to merge". Notes
addressed pre-merge: disabled Timeline/Specs tabs `tabindex="-1"` (one tab stop);
sort-button `aria-label="Sort by …"`; clarified the title tiebreak isn't reversed
by sort dir; the `.board[hidden]` cascade fix above.

**Known follow-up (a11y, task 6):** table rows use `role="button"` on `<tr>`,
which is a semantics gray area inside a `<table>`; revisit in the a11y pass.

**Status: ✅ DONE.** PR #79 squash-merged → `1aec4f4` on main → CF redeployed →
verified live (`data-view="table"` tab + `#view-table` panel present; CTA copy
not regressed; #75 rebuild Action found no diff). Commented on #78.

---

## 2026-05-10 — Task 2/6: `#78` board Spec view

**Branch:** `feat/board-spec-view`

**What:**
- Enabled the previously-disabled **"Specs"** tab (`data-view="specs"`, `id`/
  `aria-controls`, removed `is-disabled`/`aria-disabled`/`tabindex=-1`). Added a
  `#view-specs` `role="tabpanel"` container after `#view-table` in index.html.
- `render.js`: `buildSpecView()` renders all cards (from `cardIndex`, board
  order) as a long-form document — grouped by status (Shipped / Now / Next /
  Later), each card a `<section>` with id badge, `<h4>` title, summary, tags,
  the `details` markdown via the existing `mini()` helper, an updated/impact
  foot line, and links. Refactored `switchView()` to drive 3 panels via a
  `VIEW_PANELS` map (build lazily on first activation; toggle `hidden`).
  `wireViewTabs()` already iterates `.view-tab[data-view]`, so the new tab is
  picked up for click + arrow-key nav with no change there.
- `styles/main.css`: `.spec-doc` (prose width, centered) + `.spec-group*` /
  `.spec-card*` styles, incl. prose styles for the `mini()` output inside
  `.spec-card-body`. No `display` set on `.board-spec-view` so the UA `[hidden]`
  rule still hides it (same trick as `#view-table`).
- Deliberately **no tag-filter integration** in the Spec view — it's a
  read-the-whole-thing document; the chips are a board affordance.

**Tested:**
- `node -c scripts/render.js` → syntax OK.
- `node scripts/build.js` → passes; the new static markup (`data-view="specs"`,
  `#view-specs`) survives the build; rebuild is idempotent.

**Known follow-up (a11y, task 6):** `mini()` emits `<h2>`/`<h3>` for `details`
markdown headings, which land under the card's `<h4>` title — a heading-order
quirk (the modal has the same). Revisit in the a11y pass.

**Status:** branch pushed → PR opened → awaiting sub-agent review → merge → verify.
