# CLAUDE.md — rules for AI editing this repo

> Read [README.md](README.md) first for the project overview, source/artifact
> split, and commands. This file is the gotchas + hard rules that aren't
> obvious from reading code in isolation. If a rule isn't here, the README or
> the in-file comments are the source of truth.

## Hard rules (will bite if you forget)

### `[hidden] { display: none !important; }` is load-bearing

The reset at the top of `styles/main.css` (and of `styles/work.css`) makes
the `hidden` HTML attribute work. Without it, an author rule like `.foo { display: flex }` beats the UA
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

- `qa.antaresyuan.site` — the "ask" assistant (`workers/qa/`), an agent.
  Its Agent infra lives in `content/agent/` (CMS → Agent infra): the
  system prompt, one `skills/<name>/SKILL.md` per skill, and the tools.
  The model loads a skill by its description and calls that skill's tools
  in a JSON plan the Worker executes (`workers/qa/src/agent.js`), then
  answers from the skill's instructions and the results; when it can't
  plan, the fixed router (`skills.js`) answers. Models: the one on
  Antares's Mac when `LOCAL_LLM_URL` is set (`ops/local-llm/`, a Cloudflare
  Tunnel behind an Access service token), else Workers AI. The Mac's
  hostname is only ever called by the Worker. A new skill is a SKILL.md
  plus its CMS entry (and a rule in `skills.js` for the fallback); check
  choices with `npm run eval:agent` against
  `workers/qa/test/routing-cases.json`.
  `a2ui` is the cross-turn interaction skill: its `render_ui` tool returns a
  bounded choice, form, confirmation or catalogue-backed resource card. The
  model never writes card HTML or resource URLs; `scripts/ask-render.js`
  renders the validated payload, and the next request carries a structured
  `interaction` alongside the human-readable message.
- `usage.antaresyuan.site` — `/usage` dashboard (`workers/usage/`)
- `comments.antaresyuan.site` — reactions + comments on Writing posts
  (`workers/comments/`, D1; client `scripts/comments.js`). Off until
  `content/site.json → comments.endpoint` is set — posts keep giscus till then.

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

### Work and Personal share content, not markup or styles

- **Work** (`/`, `/projects/`, `/blog/`, `/gallery/`, `/skills/`): `styles/work.css` +
  `scripts/work.js` (+ `buddy.js`; `gallery.js` on /gallery/). Every page
  shares one chrome — rail, top controls, ask composer + side panel, footer —
  from `scripts/lib/work-shell.js`; the home page is a template filled in
  place (`build-html.js`), the rest are generated whole (`build-projects.js`,
  `build-blog.js`, `build-gallery.js`, `build-skills-page.js`). Paths are
  root-relative. Project cards (home carousel + /projects/) come from
  `scripts/lib/projects.js`, which reads `content/projects/<slug>.json` (one
  file per project — a folder collection in the CMS; an `.svg` cover is
  inlined so it follows the theme); a case study's empty fields render as `.ph`
  placeholders. A project's `board` embeds `content/boards/<id>.json`
  (scripts/board.js, fetched at runtime — no rebuild after editing).
  Boards are edited at /board-editor/?id=<id>; `npm run board`
  (ops/board-dev.js, 127.0.0.1 only) is what lets Save write the file.
  Does **not** load `main.css` or `render.js` — no skins, no board, no
  terminal. A new Work page: generate it with `shell.pageHtml({ active })`
  and give its nav item an `href` in `content/work.json`.
- **Personal** (`/personal/`): `templates/personal.html` + `styles/main.css` +
  `scripts/render.js`. `build-spaces.js` re-renders its lists (board, chips,
  counts, skills, lens, contact) from JSON via `scripts/lib/personal-blocks.js`.

A style or behaviour change for one space goes in that space's files only.
`content/skills.json` feeds both: Personal's /skills list and Work's
/skills/ catalogue (which also reads the optional install / eval / stats
fields). The ask panel pushes the page by growing `--side-r`; layout that
must react to it uses `@container page`, not viewport media queries.
Glass (`.glass`) is for the navigation/control layer — never content cards,
never glass on glass. Refraction (`data-lens`) is Chromium-only by design;
other engines get the blur-and-rim fallback.

### Two languages: English at `/`, Chinese at `/zh/`

The Work pages are built twice, by the same builders: English at the site
root, Chinese under `/zh/` (`/zh/`, `/zh/projects/…`, `/zh/blog/…`,
`/zh/gallery/`, `/zh/skills/`). `scripts/lib/i18n.js` is the whole model:

- **Content overlay.** `content/<file>` is English and complete;
  `content/zh/<same path>` holds only the Chinese for the fields that have it.
  `i18n.content(rel, lang)` merges them — objects by key, lists by `slug` /
  `id` or else by position, empty = keep the English. So a missing
  translation falls back to English, never to a blank. Posts:
  `content/zh/blog/<same file>.md` (title, summary, tags, body); without one
  the /zh/ post shows the English with a note. Boards:
  `content/boards/zh/<id>.json`, a full copy (same layout, Chinese text).
  Covers: `content/zh/covers.json` → `node tools/covers/covers.js` →
  `cover.zh.svg`.
- **UI words** come from `content/strings.json` / `content/zh/strings.json`
  via `t('key', lang)`. Browser scripts read theirs from the
  `#ui-strings` JSON each page embeds (its `client` section); the English is
  the fallback written in the script.
- **Paths.** `i18n.localPath(path, lang)` maps a link to the reader's
  language — only paths matched by `LOCALIZED` have a /zh/ twin. `/usage/`
  (and the switched-off `/about/`) are English-only for now; `/usage/` keeps
  the browser-side translator `scripts/i18n.js`, which Personal also uses.
  A new localized page: build it in the `for (const lang of LANGS)` loop with
  `pageHtml({ lang, path })`, and add its prefix to `LOCALIZED` **and** to
  the copy in `functions/_middleware.js` (the test checks they match).
- **Who sees which.** `functions/_middleware.js` (routes in `_routes.json`):
  a visitor from mainland China (CN only), or one who picked Chinese
  (`site_lang_pref` cookie, set by the switch's `?lang=` link), is redirected
  from an English Work page to its /zh/ twin. /zh/ URLs and crawlers are
  never redirected; hreflang links tell search engines about both.

### `index.html` is BOTH source template AND artifact

`scripts/build-html.js` mutates `index.html` (the Work home) in-place every build:

- Edit: the structural markup, anchors, placeholder containers (e.g.
  `<ul id="project-track"></ul>`). New section blocks go in the template
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

On Personal the `/usage` section sits **inside the `.hero` grid** with
`grid-column: 1 / -1`; its heatmap SSR shell is frozen in
`templates/personal.html` and redrawn by `scripts/render.js`. On Work it is
the hero's middle column (`#usage`), drawn entirely by `scripts/work.js` —
no SSR shell to keep in lockstep. Both hide on a failed fetch.

**Worker GET is edge-cached.** `workers/usage/src/index.js` stashes the
assembled JSON in `caches.default` for `GET_CACHE_TTL_S` (60s). POST handler
**must invalidate** (`caches.default.delete(GET_CACHE_KEY)`) — without it, a
sync agent's data lags by up to 60s. Background: `workers/usage/README.md` §
"Edge cache (read-rate control)".

### Code is English; Chinese lives in content

The site is bilingual (see "Two languages" below), so Chinese is allowed in
**content** — `content/zh/`, `content/boards/zh/`, and the owner's own text
in `content/agent/` (skill titles and descriptions, QA aliases) — and in the pages
generated from it (`zh/`, `media/projects/*/cover.zh.svg`), and in test
fixtures that hold what visitors type (`workers/qa/test/routing-cases.json`).
Everything else stays **pure English**: code, code comments, READMEs,
CLAUDE.md, CMS labels.
A script that needs a Chinese word reads it from a strings table instead of
spelling it (a `\uXXXX` escape is the last resort). `scripts/i18n.test.js`
checks the i18n code; for anything else you touched:

```sh
grep -nP '[\x{4e00}-\x{9fff}]' <code files>   # must return zero
```

The user's other public repos (`~/code/claude-devloop`, `~/code/ai-pm-resume`,
`~/code/claude-skill-interview-sim`) remain pure English throughout.

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

`blog/`, `zh/blog/`, `llms-full.txt`, `sitemap.xml`, `agent-brief.txt`,
`glyphs.html`, `ask-index.json` are pure outputs. The bot rebuilds them after
merge. Reset before commit:

```sh
git checkout -- blog/ zh/blog/ llms-full.txt sitemap.xml agent-brief.txt glyphs.html ask-index.json
```

`index.html` (and `zh/index.html`) is the exception — it's mutated in-place and must be committed
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
| `npm run board` | Board editor with save-to-repo at 127.0.0.1:4322/board-editor/ |
| `gh pr merge <N> --squash --admin` | Squash-merge bypassing branch protection |
