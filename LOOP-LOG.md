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

**Review:** independent sub-agent code review → verdict "OK to merge" (no
critical/should-fix; only pre-existing nits noted). No changes needed.

**Status: ✅ DONE.** PR #80 squash-merged → `a74cd32` on main → CF redeployed →
verified live (`data-view="specs"` tab + `#view-specs` panel present; Table view
+ kanban unaffected; #75 rebuild Action found no diff). Commented on #78.

---

## 2026-05-10 — Task 3/6: `#78` board Timeline view

**Branch:** `feat/board-timeline-view`

**What:**
- Enabled the previously-disabled **"Timeline"** tab (`data-view="timeline"`,
  `id`/`aria-controls`; dropped `is-disabled`/`aria-disabled`/`tabindex=-1`).
  New `#view-timeline` `role="tabpanel"` container after `#view-specs`.
- `render.js`: `buildTimelineView()` — Shipped cards on a real time axis
  (sorted by `c.updated` ascending = a "ship log", grouped by year, vertical
  rail + dots, each entry: date · title · summary · impact · links, clickable
  to open the card-detail panel). Now/Next/Later below as an un-dated
  "Horizon" section with three lanes — copy says "priority order, not a
  schedule". `VIEW_PANELS` now has 4 entries; `switchView` lazy-builds the
  timeline on first activation. Refactored the `#view-table` card-open
  delegation into a small `wireCardOpener(containerId, sel)` helper, reused
  for `#view-timeline`.
- `styles/main.css`: `.timeline-doc` (max-width 880, centered) + `.timeline-*`
  (rail/dot/year/entry) + `.horizon-*` (3-col lanes, collapses to 1 col ≤768px).
  No `display` declared on `.board-timeline-view` (so the UA `[hidden]` rule
  still hides it). No tag-filter integration (reading view, like the spec view).

**Tested:**
- `node -c scripts/render.js` → syntax OK.
- `node scripts/build.js` → passes; new static markup (`data-view="timeline"`,
  `#view-timeline`) survives the build; rebuild idempotent.

**Status:** branch pushed → PR opened → awaiting sub-agent review → merge → verify.

**Review:** independent sub-agent code review → verdict "OK to merge" (no
critical/should-fix). One nit — a stale block comment in render.js
("kanban ⇄ table" / "Disabled tabs Timeline/Specs stay inert") — fixed
pre-merge (commit 9eecc9f).

**Status: ✅ DONE.** PR #81 squash-merged → `7533353` on main → CF redeployed →
verified live (`data-view="timeline"` tab + `#view-timeline` panel present;
Spec/Table/kanban unaffected; #75 rebuild Action found no diff). Commented on
#78. **Board view modes complete: Board · Table · Timeline · Specs.**

---

## 2026-05-10 — Task 4/6: `#78` audience lens

**Branch:** `feat/board-audience-lens`

**What:**
- Added a small `<select id="audience-lens">` to the board toolbar (right side,
  after the card counts): **For everyone** (default) · For HR · For founders ·
  For collaborators. `aria-label` on the control.
- `render.js`: `currentAudience` state; `scoreFor(c, persona)` (a per-persona
  scoring fn — HR boosts shipped + cards with an `impact`; founders boost `0→1`
  tags + next/later; collaborators boost `now` + cards with links); `personaSort`
  (stable sort by score desc; `'everyone'` returns the array untouched). The
  four `buildXView` functions now order their card list through `personaSort`.
  `applyAudience(persona)` re-orders the kanban column DOM nodes in place
  (`appendChild`, with a board-order tiebreak so `'everyone'` restores the
  original order) and rebuilds any flat view that's currently visible. The
  Timeline's Shipped section stays chronological regardless (a date axis is its
  identity); only its Horizon lanes re-order. Wired a `change` listener on the
  select. **`'everyone'` is a strict no-op** — boot doesn't call `applyAudience`,
  so the SSG-prerendered card order is unchanged (verified: `git diff` on
  index.html is +7 lines = just the `<select>` markup, no reordered cards).
- `styles/main.css`: `.audience-lens` — small monospace `<select>` matching the
  toolbar; hover state. Existing tokens.

**Tested:**
- `node -c scripts/render.js` → syntax OK.
- `node scripts/build.js` → passes; `id="audience-lens"` present in built HTML;
  prerendered kanban card order unchanged; rebuild idempotent.

**Status:** branch pushed → PR opened → awaiting sub-agent review → merge → verify.

**Review:** independent sub-agent code review → verdict "OK to merge" (no bugs).
Two clarifying comments added pre-merge (053a88a): the audience lens vs
card-panel-nav order tradeoff; persona order vs an explicit table column sort.

**Status: ✅ DONE.** PR #82 squash-merged → `e8744f6` on main → CF redeployed →
verified live (`id="audience-lens"` present, `aria-label` intact; Timeline tab
still present; #75 rebuild Action found no diff). **#78 CLOSED** — all four parts
shipped (Board · Table · Timeline · Specs view modes + the audience lens; PRs
#79 #80 #81 #82). The "filter chips: frequency vs curated featuredTags"
sub-decision left for the owner.

---

## 2026-05-10 — Task 5/6: `#76` Phase 1 — pure-retrieval "ask this portfolio"

**Branch:** `feat/qa-phase1`

**What** (folded into the existing ⌘K palette — no new file, no new surface):
- `scripts/palette.js`: a hand-authored `FAQ` array (~13 entries — "are you
  looking for a job", "strongest shipped project", "what are you building now",
  "tech stack", "what's a Pi-shaped AI PM", project blurbs, etc.). Each becomes
  a palette item of `kind: 'faq'` — the question is the label, the answer shows
  inline, and selecting it opens the relevant card panel (`agent:open-card`
  CustomEvent), scrolls to a section, or opens a link. The FAQ map is in JS,
  NOT in content/*.json.
- Scoring: added a **token-overlap** tier to `score()` for multi-word /
  question-like queries (tokenize, drop stopwords, count how many tokens hit
  the item's search text) — ranks above bare subsequence so "are you looking
  for a job" surfaces the right FAQ/card. Single-word queries unchanged.
- `render()` special-cases `kind === 'faq'` to show the answer in a prose
  `.palette-result-answer` line (not the uppercase `.palette-result-desc`).
- The empty-query default set now includes the first FAQ ("looking for a job").
- `index.html`: palette placeholder → "Search · or just ask…".
- `styles/main.css`: `.palette-result-answer`.
- **NO embeddings, NO Workers AI, NO model calls** — Phase 2 (build-time
  embeddings) and Phase 3 (Workers AI generation) are deliberately left for the
  owner to decide; not touched.

**Tested:**
- `node -c scripts/palette.js` → syntax OK.
- `node scripts/build.js` → passes; rebuild idempotent.

**Status:** branch pushed → PR opened → awaiting sub-agent review → merge → verify.

**Review:** independent sub-agent code review → verdict "OK to merge" (no
critical/should-fix). Verified: no LLM/network calls (deterministic string
matching); the new token-overlap tier never demotes a prefix/substring hit and
single-word queries are unchanged; FAQ cardIds (SHIP-01/SHIP-03/NOW-02) resolve
correctly against content/board.json's order; FAQ label + answer escaped on
render. No changes needed.

**Status: ✅ DONE.** PR #83 squash-merged → `143bfc7` on main → CF redeployed →
verified live (palette placeholder = "Search · or just ask…"; audience-lens
still present; #75 rebuild Action found no diff). Commented on #76 (kept open —
Phase 2 [embeddings] / Phase 3 [Workers AI] left for the owner).

---

## 2026-05-10 — Task 6/6: a11y polish + simplify pass on the loop's new code

**Branch:** `feat/a11y-views-pass`

**What:**
- `mini()` (the tiny markdown renderer) gained an optional `opts.demote` (a
  number, default 0) that shifts emitted heading levels down, clamped to `<h6>`.
  `buildSpecView` now calls `mini(c.details, { demote: 3 })` so a `## …`
  heading inside a card's `details` renders as `<h5>` — below the card's `<h4>`
  title instead of jumping back up to `<h2>`. CSS: `.spec-card-body h2, h3` →
  `.spec-card-body h5, h6`. (The card-detail *modal* keeps its existing
  heading order — pre-existing, lower priority, not touched here.)
- Documented the `role="button"`-on-`<tr>` / `.timeline-entry` / `.horizon-card`
  clickable-row pattern in a code comment: it overrides the implicit `row`
  role, but the elements carry `aria-label` + `tabindex=0`, the Enter/Space
  handler (`wireCardOpener`) preventDefaults Space, and inner `<a>` clicks pass
  through; the "purer" alternative (a `<button>` in the title cell) was
  considered and skipped because it loses whole-row clicks. (Kept as-is.)
- Verified (read-through): focus order is sane (`.board-views` tabs → toolbar
  `<select>` → `.board-filters` chips → board/table/timeline content → card
  panel → ⌘K palette). `prefers-reduced-motion`: the global `*` rule already
  zeroes `transition-duration`, covering the new hover transforms; no new
  `@keyframes` in the loop's code — nothing to add.
- Simplify pass (self-review — the loop's code already went through 6 sub-agent
  reviews; the only DRY win): extracted `currentCards()` = `personaSort([...
  cardIndex.values()], currentAudience)`, used by the three `buildXView`
  functions instead of the inline expression. No other refactors warranted
  (shared `applyFilter` / `wireCardOpener` / `personaSort`+`scoreFor` /
  `VIEW_PANELS` are already in place; the build fns render different enough
  markup that further abstraction would hurt readability).

**Tested:**
- `node -c scripts/render.js` → syntax OK.
- `node scripts/build.js` → passes; rebuild idempotent; `index.html` unchanged
  (the diff is JS + CSS only).

**Status:** branch pushed → PR opened → awaiting sub-agent review → merge → verify.
