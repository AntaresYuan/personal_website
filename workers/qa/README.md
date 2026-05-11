# `antares-qa` — "ask this portfolio" Q&A Worker

Powers the **`ask <question>`** command in the embedded terminal (issue #76,
Phase 3). It's a small Cloudflare Worker that takes a visitor's question, fetches
the site's own content (`/llms-full.txt`, ≈5 KB — the canonical dump), and asks
**Workers AI** to answer **using only that context**. The system prompt forbids
role-play and tells the model to say so when the answer isn't on the site. No
API keys touch the frontend; CORS is locked to the site origin.

(The ⌘K command palette stays a plain search/launcher — it has its own
hand-authored FAQ answers, #76 Phase 1, which need no Worker.) If
`content/site.json` → `qa.workerUrl` is empty, the terminal's `ask` command just
reports it isn't wired up yet; nothing else changes.

## Deploy

```bash
cd workers/qa
npx wrangler login          # one-time, browser auth
npx wrangler deploy
```

After the first deploy the URL is `https://antares-qa.<your-subdomain>.workers.dev`.
Put that URL into **`content/site.json` → `qa.workerUrl`** (or via `/admin/` →
**Site meta → Q&A assistant**). Done — the terminal's `ask <question>` command
will start returning AI answers.

Workers AI is auto-provisioned; the only binding is `[ai] binding = "AI"` in
`wrangler.toml` (already there). The free tier comfortably covers a personal
site's volume.

## API

```
POST /
Content-Type: application/json
{ "q": "what's Antares's strongest shipped project?" }

→ 200  { "answer": "SusBench — an IUI 2025 benchmark for …", "model": "@cf/meta/llama-3.1-8b-instruct-fast" }
→ 4xx/5xx  { "error": "…", "detail"?: "…" }
```

## Notes / knobs

- **Model**: `@cf/meta/llama-3.1-8b-instruct-fast` (cheap + fast). If it's ever
  unavailable, change `MODEL` in `src/index.js` to `@cf/meta/llama-3.1-8b-instruct`
  or `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.
- **Rate limiting** is optional and off by default — the Workers-AI free-tier
  daily budget is the backstop. To add a per-IP cap, uncomment the
  `[[unsafe.bindings]]` rate-limit block in `wrangler.toml` and redeploy; the
  Worker picks it up automatically.
- **Grounding source** is `https://antaresyuan.site/llms-full.txt`. If the site
  URL changes, update `SITE` in `src/index.js`.
- This mirrors the `workers/decap-oauth/` deploy pattern — same `wrangler`
  workflow, same "owner deploys it once" model.
