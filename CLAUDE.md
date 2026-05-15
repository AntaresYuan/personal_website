# CLAUDE.md — rules for AI editing this repo

> Read [README.md](README.md) first for the project overview, source/artifact
> split, and commands. This file is the gotchas + hard rules that aren't
> obvious from reading code in isolation. If a rule isn't here, the README or
> the in-file comments are the source of truth.

## Hard rules (will bite if you forget)

### `[hidden] { display: none !important; }` is load-bearing

The reset at the top of `styles/main.css` makes the `hidden` HTML attribute
work. Without it, an author rule like `.foo { display: flex }` beats the UA
`[hidden] { display: none }` (cascade origin: author > UA), and elements
marked `hidden` in markup still get laid out. On mobile, full-viewport panels
(`.ask-panel`, `.palette`, `.modal-backdrop`, `.card-modal`) then become
invisible tap-eaters that swallow every touch — page scrolls but nothing is
clickable. **Don't delete the rule.** New panels/overlays don't need
per-element opt-in; the global rule covers them.

### Two markdown renderers — change both or they diverge

Any markdown feature change (new block syntax, new escape, new auto-embed)
must touch both:

- `scripts/lib/blog.js` → `mdToHtml(md)` — server, renders blog posts
- `scripts/render.js`  → `mini(md)`     — client, renders card / skill modals

If you change one and not the other, the same markdown renders differently in
`/blog/<slug>/` vs the kanban/skills side panel.

`mini()` pre-escapes input (`escape(md)` at the top), so URL-matching regexes
must `.replace(/&amp;/g, '&')` before matching.

Video auto-embed (`videoEmbedUrl`) is **gated to "the paragraph/line is one
bare URL"** (`/^\S+$/` test) — drop that gate and inline URLs in prose
silently turn into iframes. Don't.

### `cardIndex` is shared across kanban + skills

`scripts/render.js` keeps one `Map cardIndex` keyed by display ID:

- kanban project cards → `SHIP-NN` / `NOW-NN` / `NEXT-NN` / `LATER-NN`
- `/skills` rows       → `SKILL-NN`

One document-level click handler matches both:

```js
ev.target.closest('.card[data-card-id], .skill-link[data-card-id]')
```

Adding a new modal-opening surface (e.g. a future "press" or "talks" section)
means: pick a new ID prefix, hydrate `cardIndex` in the boot block, extend
that `closest()` selector. The existing modal template renders any entry that
provides `{title, summary, details, tags, status, links, displayId}`.

### Workers must bind to antaresyuan.site subdomains

Cloudflare `*.workers.dev` is intermittently DNS-poisoned / SNI-reset on
mainland-China networks. **Every Worker URL stored in `content/site.json`
must be a custom subdomain on the same zone as the main site.** Currently:

- `qa.antaresyuan.site` — the "ask" assistant
- `usage.antaresyuan.site` — `/usage` dashboard (`workers/usage/`)

Bind via Cloudflare dashboard → Worker → Settings → Domains & Routes → Add
Custom Domain. Same-zone = same Anycast endpoints that serve `antaresyuan.site`,
so a CN-reachable main site = a CN-reachable Worker. The frontend also has a
FAQ-fallback for when fetch still fails (see `wireAskPanel` in `render.js`).

### Bot rebuild workflow — no `[skip ci]`

`.github/workflows/build.yml` rebuilds artifacts on every push to `main` that
touches `content/`, `scripts/`, or `styles/`, then commits them back as
`chore: rebuild artifacts from content`.

**Never add `[skip ci]` to the bot's commit message.** Cloudflare Pages also
honors `[skip ci]` and would skip *deploying* the rebuilt artifacts —
leaving the live site one full rebuild behind every CMS edit. The paths
filter alone is enough to prevent re-trigger loops (the bot commit only
touches artifacts, which aren't watched).

### `index.html` is BOTH source template AND artifact

`scripts/build-html.js` mutates `index.html` in-place every build:

- Edit: the structural markup, anchors, placeholder containers (e.g.
  `<div id="skills-list"></div>`). New section blocks go in the template
  area between sibling sections.
- Don't edit by hand: anything inside `replaceInner` / `replaceInnerOpenMatch`
  targets — build-html will overwrite on next run.
- Always run `node scripts/build.js` after editing source.

The build also bumps the `?v=<hash>` cache-bust on `<link rel="stylesheet">`
and `<script>` tags from the file's content hash. Don't hand-edit those
hashes.

### Privacy contract — `/usage`

The public POST/GET payload is **only** `{ date, tokens, sessions, costCents }`.
`costCents` is a precomputed scalar — the sync agent applies a per-model
pricing table locally (`scripts/sync-usage.js` → `MODEL_PRICING`) and ships
just the final dollar-amount integer. The per-model token split that feeds it
**never reaches the Worker.** Never expose: source / device labels, hourly
distribution, project names, model breakdowns, streak counters, or any device
identifiers. The Worker enforces the schema server-side; the local sync agent
enforces it client-side; the GET response strips anything but the daily total.
Full hard-line list lives in `workers/usage/README.md` § "Privacy contract — read
first, do not bend".

The `/usage` section sits **inside the `.hero` grid** (between `.hero-ctas`
and `.hero-ask`) with `grid-column: 1 / -1` spanning both columns. Heatmap
constants (`HEATMAP_COLS=52`, `HEATMAP_CELL=16`, etc.) are duplicated in
`scripts/build-html.js` and `scripts/render.js` — keep them in lockstep
or the SSR shell and client render mismatch on first paint.

**Worker GET is edge-cached.** `workers/usage/src/index.js` stashes the
assembled JSON in `caches.default` for `GET_CACHE_TTL_S` (60s). POST handler
**must invalidate** (`caches.default.delete(GET_CACHE_KEY)`) — without it, a
sync agent's data lags by up to 60s. Background: `workers/usage/README.md` §
"Edge cache (read-rate control)".

### Public OSS repos: pure English

Repos that get pushed to public GitHub — this one, plus the user's open-source
Claude Code skills (`~/code/claude-devloop`, `~/code/ai-pm-resume`,
`~/code/claude-skill-interview-sim`) — are **pure English**. No CJK characters
in any committed file (SKILL.md, README.md, code comments, anything). Verify
before commit:

```sh
grep -rP '[\x{4e00}-\x{9fff}]' <files>   # must return zero
```

Local-only files (memory, scratch notes) are bilingual-OK.

### Doodle glyphs + UI icons: hand SVG, never emoji

The brand "moon" mark and any `/admin/` Doodles entry use single-color SVG in
the site-yellow palette. **Never emoji.** New glyphs go in
`scripts/doodle.js` → `GLYPHS` object; the gallery at `/glyphs` regenerates
via `scripts/build-glyphs.js`.

## Workflow conventions

### PR cycle

```sh
git checkout -b feat/<short-name>
# edit source — content/ scripts/ styles/ index.html template / admin/
node scripts/build.js
git add <source files — drop pure artifacts>
git commit -F - <<'EOF'
<type>(<scope>): <subject>

<body>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
git push -u origin feat/<short-name>
gh pr create --title "..." --body-file - <<'EOF'
...
EOF
gh pr merge --squash --admin
git checkout main && git pull --ff-only && git branch -d feat/<short-name>
# verify Pages deploy via background curl-poll for the changed asset
```

Heredoc bodies (`-F -` / `--body-file -`) avoid shell-quoting hell with
embedded `"`, `$`, or backticks.

### Don't commit pure artifacts in feature PRs

`blog/`, `llms-full.txt`, `sitemap.xml`, `agent-brief.txt`, `glyphs.html`
are pure outputs. The bot rebuilds them after merge. Reset before commit:

```sh
git checkout -- blog/ llms-full.txt sitemap.xml agent-brief.txt glyphs.html
```

`index.html` is the exception — it's mutated in-place and must be committed
with your source changes. The bot will re-run build and produce the same
content (deterministic), so it's a no-op rebuild.

### `rm` is blocked in this environment

Use one of: `git rm <file>`, `mv <file> /tmp/`, or `node -e "fs.rmSync(...)"`.

### Schedule background work, don't sleep

Long waits (Pages deploy, CI run) — use `Bash run_in_background: true` with
an `until <check>; do sleep 5; done` loop. Don't chain foreground sleeps.

## Quick reference

| Command | What |
|---|---|
| `node scripts/build.js` | Full rebuild (HTML + blog + OG + llms + sitemap + agent-brief + glyphs) |
| `npm run reset-content` | Wipe personal content for a fork |
| `bash scripts/install-hooks.sh` | One-time pre-commit hook (auto-build on content changes) |
| `npx serve .` | Local preview at localhost:3000 |
| `gh pr merge <N> --squash --admin` | Squash-merge bypassing branch protection |
