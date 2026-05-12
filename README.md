# personal_website

A living **PM-style dashboard** of what I've shipped, what I'm building, and where I'm going. The site is the demo: it shows my product thinking by being a working roadmap.

> Edit content in-browser at `/admin/`. Public visitors read + comment.

## Source vs. artifacts

The repo has two kinds of files. **Only edit the source.**

```
SOURCE (edit these — directly or via /admin/)
├── content/
│   ├── site.json           ← title, description, footer, add-on config (analytics/giscus/qa)
│   ├── profile.json        ← name, slogan, audience CTAs, tags, résumé links
│   ├── board.json          ← project cards (status: shipped/now/next/later)
│   ├── lens.json           ← short-form principles
│   ├── contact.json        ← email + socials + "open to" line
│   ├── agent-brief.json    ← off-site notes that feed the "ask" assistant
│   ├── doodles.json        ← special-day "doodles" — the moon mark becomes a glyph (holidays, birthday…)
│   └── blog/*.md           ← blog posts (YAML frontmatter: title/date/summary/draft + Markdown body)
├── styles/main.css         ← design tokens + dashboard styles
├── scripts/
│   ├── render.js           ← runtime: hydrates the page for interactive use
│   ├── terminal.js         ← runtime: embedded Agent Terminal
│   ├── palette.js          ← runtime: ⌘K command palette
│   ├── doodle.js           ← runtime: the brand mark = tonight's moon phase (or a doodle)
│   ├── qa-faq.js           ← runtime: shared FAQ + retrieval (palette + "ask")
│   ├── lib/blog.js         ← shared: load + render content/blog/*.md (frontmatter + Markdown)
│   ├── build-html.js       ← build:   pre-renders content into index.html
│   ├── build-blog.js       ← build:   renders /blog/ + /blog/<slug>/ from content/blog/*.md
│   ├── build-og.js         ← build:   renders a 1200×630 social card (PNG) per post
│   ├── build-llms.js       ← build:   regen /llms.txt + /llms-full.txt
│   ├── build-sitemap.js    ← build:   regen /sitemap.xml
│   ├── build-agent-brief.js← build:   regen /agent-brief.txt from agent-brief.json
│   ├── last-updated.js     ← build:   resolves the "last updated" date
│   ├── build.js            ← build:   runs all the build-* steps
│   ├── sync-devto.js       ← CI:      cross-post new posts to dev.to (canonical → home)
│   ├── scaffold-reset.js   ← `npm run reset-content` — wipe personal content for a fork
│   └── install-hooks.sh    ← installs the pre-commit hook (run once)
├── admin/
│   ├── index.html          ← Sveltia CMS bootstrap (Decap kept as a vendored fallback)
│   └── config.yml          ← collection schemas (shared Sveltia/Decap format)
├── workers/
│   ├── decap-oauth/        ← Cloudflare Worker: GitHub OAuth proxy for /admin/
│   └── qa/                 ← Cloudflare Worker: the "ask" assistant (Workers AI)
├── cli/                    ← `npx antares-cv` — the terminal résumé
├── vendor/                 ← vendored: Sveltia CMS, vis-timeline, resvg-wasm + fonts/ (for the OG cards)
├── package.json            ← `npm run build` / `reset-content` / `serve` — no dependencies
├── media/                  ← avatars + other static images
└── favicon.svg

ARTIFACTS (generated — do not hand-edit)
├── index.html              ← built by scripts/build-html.js
├── blog/                   ← built by scripts/build-blog.js (index.html + <slug>/index.html)
├── llms.txt                ← built by scripts/build-llms.js
├── llms-full.txt           ← built by scripts/build-llms.js
├── sitemap.xml             ← built by scripts/build-sitemap.js
└── agent-brief.txt         ← built by scripts/build-agent-brief.js
```

Each generated file carries a `GENERATED — do not edit` banner inside.

### After editing content

```bash
node scripts/build.js
git add . && git commit -m "..."
```

`build.js` rebuilds all three artifacts. They get committed alongside the source so any clone of the repo can deploy without a build step.

### Don't want to remember? Install the hook (one-time)

```bash
bash scripts/install-hooks.sh
```

This adds a `pre-commit` hook that detects changes to `content/*.json`, runs `build.js`, and stages the regenerated artifacts automatically. Once installed, you only ever edit JSON; the artifacts stay in sync on commit.

> Note: committing the artifacts is a "stay simple now" choice — see [Switching to deploy-time builds](#switching-to-deploy-time-builds-when-ready) below. Once the build runs on the host, the artifacts won't need to live in git.

## Use this as a template

This repo is a GitHub **template** — hit **"Use this template"** at the top of [the repo page](https://github.com/AntaresYuan/personal_website) to get your own copy (a clean repo — no fork link, no commit history). Then:

1. **Wipe my content** — `npm run reset-content`. Swaps `content/*.json` and `content/blog/*.md` for placeholders, clears the tokens in `content/site.json`, and prints the rest of the checklist. (Touches no code, styles, CMS config, or Workers. From the original repo it refuses unless you pass `--force` — a guard so it can't nuke the live site by accident.)
2. **Make it yours** — edit `content/*.json` (directly or, once deployed, via `/admin/`): `site.json` (title, URL, footer), `profile.json` (name, slogan, tags, CTAs, résumé links), `board.json` (your projects), `lens.json`, `contact.json`, `doodles.json` (special-day doodles — your birthday, holidays…). Replace `media/avatar-calm.png` / `avatar-talking.png` with your own images. Edit the FAQ array in `scripts/qa-faq.js` (the answers behind ⌘K and the "ask" bar). Write posts in `content/blog/*.md` (or `/admin/` → **Blog**).
3. **Deploy** — point **Cloudflare Pages** at your repo, output directory `/`. Build command is optional: the artifacts are committed, so "no build command" works; or set it to `node scripts/build.js`. Two optional Workers (each deploys itself — see the README in its folder): `workers/decap-oauth/` makes `/admin/` sign-in work, `workers/qa/` powers the "ask" assistant (put its URL in `site.json → qa.workerUrl`). Both degrade gracefully if you skip them.
4. **Keep artifacts in sync** — `npm run build` then commit; or install the pre-commit hook ([above](#dont-want-to-remember-install-the-hook-one-time)); or let the bundled GitHub Action (`.github/workflows/build.yml`) rebuild on push.

The **code** is MIT; the personal **content** (my bio, the project write-ups, the images) isn't part of that grant — that's what `reset-content` clears. See [License & attribution](#license--attribution). Built something on it? A link back is appreciated, and there's an [In the wild](#built-on-this) list you can PR yourself into.

## Resume in your terminal

```bash
npx antares-cv
```

Single-file Node CLI in `cli/` that fetches `content/*.json` from the live site and prints a colored resume. Same data as the website, terminal-shaped. See [`cli/README.md`](cli/README.md) for options (`--full`, `--json`, `--no-color`).

## Blog

Posts are Markdown files in `content/blog/` — YAML frontmatter (`title`, `date`, `summary`, `draft`), then the body. Edit them in `/admin/` → **Blog**, or by hand. `scripts/build-blog.js` renders `/blog/` (the index), `/blog/<slug>/` (one page each — byline, reading-progress bar, giscus comments), and an RSS feed at **`/blog/feed.xml`**. Each post also gets a 1200×630 **social-share card** at `/blog/<slug>/og.png` (`scripts/build-og.js`, rendered at build time with vendored `resvg-wasm` + JetBrains Mono — no npm install; if anything's missing the build just skips the cards and the HTML falls back to the avatar OG image). Posts with `draft: true` are skipped everywhere.

### Syndicating to Medium / dev.to

The blog is the canonical home for what you write — so syndicate *out*, don't pull *in*:

- **dev.to** — wired up. Add a repo **secret `DEVTO_API_KEY`** (DEV → Settings → Extensions → DEV API Keys); then `.github/workflows/sync-devto.yml` mirrors new posts to dev.to on every push to `main`, with `canonical_url` pointing back to your post. Created as **drafts** by default (review + publish on dev.to); set a repo variable `DEVTO_PUBLISH=true` to publish immediately. Stateless — `scripts/sync-devto.js` checks dev.to's API by `canonical_url`, so re-runs are safe; no-op until the secret is set.
- **Medium** — manual (Medium closed its write API to new integrations in Jan 2025). Paste a published post's URL (`https://yoursite/blog/<slug>/`) into Medium's [Import tool](https://medium.com/p/import): it creates a draft with `rel=canonical` → your post, backdated. (Medium can also watch `/blog/feed.xml` and drop new posts into your Drafts.)
- **Hashnode** — not wired up; its GraphQL API has an `originalArticleURL` field, so the same pattern works ([issue #124](https://github.com/AntaresYuan/personal_website/issues/124)).

Pulling Medium → site would be backwards: it canonicalizes those posts to Medium (so Medium, not you, gets the SEO) and drags in Medium's HTML + paywall stubs. Keep one source of truth.

## How agent-friendly is this?

The site exposes three machine-readable surfaces backed by the same JSON:

- **`/llms.txt`** — short summary per [llmstxt.org](https://llmstxt.org)
- **`/llms-full.txt`** — full content dump in plain text
- **`/content/*.json`** — typed structured data

Plus: cards have stable IDs (`SHIP-01`, `NOW-01`, …) so agents can cite them across conversations, and the home HTML is **pre-rendered** — agents that don't execute JavaScript still see all content.

## Local preview

```bash
npx serve .
# open http://localhost:3000
```

## Edit content

Two paths — pick whichever's faster for the moment.

### A. Browser (Sveltia CMS)

1. Go to `/admin/` on the deployed site.
2. Sign in with GitHub. (Only repo collaborators can authenticate — single-editor by design.)
3. Edit any collection. Saving commits to `main` directly; the site rebuilds.

> [Sveltia CMS](https://github.com/sveltia/sveltia-cms) — a faster, smaller drop-in successor to Decap CMS — is vendored at `admin/sveltia-cms.js`. It reads the same `admin/config.yml`. Decap is still vendored (`admin/decap-cms.js`) as a fallback; to switch back, swap the `<script>` in `admin/index.html`.
>
> Local dev mode: visit `/admin/?local_backend=true` and run `npx @sveltia/cms-proxy-server` (or `npx decap-server` — Sveltia accepts either) in another terminal — no auth, writes straight to the filesystem.

### B. Direct file edits

Edit any `content/*.json` file in your editor or the GitHub web UI. Same outcome.

## Live

Production: <https://antaresyuan.site> on Cloudflare Pages.

Two Cloudflare Workers back it (each deploys itself — see the README in its folder):
- `workers/decap-oauth/` — GitHub OAuth proxy for `/admin/` sign-in. (The folder name stuck from Decap; Sveltia speaks the same OAuth protocol.)
- `workers/qa/` — the "ask" assistant on Cloudflare Workers AI. Optional: when `site.json → qa.workerUrl` is empty, the "ask" bar falls back to the hand-authored FAQ.

## Add-ons (configured via `content/site.json` or `/admin/`)

### Cloudflare Web Analytics

1. Go to **dash.cloudflare.com → Web Analytics → Add a site** (or pick the existing Pages site).
2. Copy the token from the embedded `data-cf-beacon='{"token": "..."}'` snippet.
3. Paste into `site.json → analytics.cfAnalyticsToken` (or in `/admin/` → Site meta).
4. Run `node scripts/build.js` and commit. The beacon script gets injected into `<head>` automatically.

Empty token = no script, no tracking.

### Giscus comments

1. **Enable Discussions** on the GitHub repo (Settings → Features → Discussions).
2. Visit <https://giscus.app>, configure for `AntaresYuan/personal_website`, pick a category.
3. Copy the generated `data-repo-id` and `data-category-id` into `site.json → giscus.repoId` and `giscus.categoryId` (or via `/admin/`).
4. Run `node scripts/build.js` and commit. The comments section auto-activates.

While unconfigured, the comments section shows a placeholder.

## Switching to deploy-time builds (when ready)

Right now the artifacts (`index.html`, `llms.txt`, `llms-full.txt`) live in git so any clone can deploy without building. Once you're comfortable with the flow:

1. In **Cloudflare Pages → Settings → Builds & deployments**, set:
   - Build command: `node scripts/build.js`
   - Build output directory: `/`
2. Trigger a deploy and confirm the site rebuilds correctly.
3. Then in a follow-up PR: add the artifacts to `.gitignore`, run `git rm --cached index.html llms.txt llms-full.txt`, and commit. From then on, the source-of-truth is JSON only and the artifacts are generated at every deploy.

## Roadmap

See [Issue #39](https://github.com/AntaresYuan/personal_website/issues/39) for the live phase plan.

## Tech stack

- Vanilla HTML / CSS / JS; a small Node build step (`scripts/build.js`), no framework
- [Sveltia CMS](https://github.com/sveltia/sveltia-cms) for in-browser editing (vendored — `admin/sveltia-cms.js`; Decap kept as a fallback)
- Cloudflare Pages (hosting) + Cloudflare Workers (OAuth proxy + the "ask" assistant on Workers AI)
- [vis-timeline](https://github.com/visjs/vis-timeline) for the Roadmap → Timeline view (vendored, lazy-loaded)
- [Giscus](https://giscus.app) for comments (config-driven via `site.json`)
- [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/) (config-driven via `site.json`)

## Design

- **Palette:** warm yellow (`#F5C518`) primary, cobalt blue (`#2347D9`) accent, cream (`#FAF7F0`) background.
- **Type:** Inter (body) · Fraunces (display) · JetBrains Mono (accent).
- All tokens live in `styles/main.css` `:root`. Edit there to retheme globally.

## License & attribution

The **code** — build scripts, CSS/JS, the HTML template, the CMS config, the Workers — is [MIT](LICENSE). Fork it, change it, ship it (commercially or not). No permission needed.

The **content** is not part of that grant. The text in `content/*.json` (bio, project write-ups, principles, the "open to" line), the images in `media/`, and any résumés are © Antares Yuan, all rights reserved — they're in the repo so the site runs, not as a licence to republish them as your own. **Swap them for your own content** when you fork.

If you build something on this template, you're not *required* to credit it — but a visible link back is genuinely appreciated, and it does something concrete: it keeps the lineage clear, so as more people use it the **original doesn't get mistaken for the copy**. Two easy ways:

- a line in your site footer or README pointing to <https://github.com/AntaresYuan/personal_website>, and/or
- keep the `<meta name="generator">` tag and the short attribution comment that `scripts/build-html.js` bakes into `index.html` (they cost you nothing).

This is the canonical source — **github.com/AntaresYuan/personal_website**, first published May 2026. There's a [`CITATION.cff`](CITATION.cff) if you want a formal citation (GitHub renders a "Cite this repository" button from it).

### Built on this?

If you ship something using this template, open a PR adding it here — happy to list it:

<!-- in-the-wild:start -->
- _(yours could be here)_
<!-- in-the-wild:end -->
