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

**Known follow-up (a11y, task 6):** table rows use `role="button"` on `<tr>`,
which is a semantics gray area inside a `<table>`; revisit in the a11y pass.

**Status:** branch pushed → PR #79 opened → fixing review findings → merge → verify.
