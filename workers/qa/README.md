# `antares-qa` — "ask this portfolio" Q&A Worker

Powers the hero **"ask"** bar and the terminal's **`ask <question>`** command
(issue #76, Phase 3). It's a small Cloudflare Worker that answers a visitor's
question **in the first person, as Antares** ("I built…"), grounded only in:

1. **fetch the grounding context** —
   - `/llms-full.txt` — the public site content (projects, principles, contact, bio), built from `content/*.json`.
   - `/agent-brief.txt` — **supplemental notes Antares wrote for the assistant** via the CMS ("Assistant knowledge" collection → `content/agent-brief.json` → flattened by `scripts/build-agent-brief.js`). These don't render on the public page; they just make the assistant's picture of Antares fuller. May be empty. *(It's a deployed static file — fetchable by URL, just not linked anywhere. "Off the site", not "secret".)*
2. **generate** — Workers AI answers in Antares's first-person voice, told to ground every fact in that context and never invent (no made-up numbers, dates, durations, names…); if something isn't there, it says so.
3. **verify** (anti-hallucination pass) — a second, low-temperature call rewrites the draft so every claim is supported by the context, keeping the voice. If that pass fails, the prompt-grounded draft is returned and the response's `verified` flag is `false`.

No API keys touch the frontend; CORS is locked to the site origin.

(The ⌘K command palette stays a plain search/launcher — its hand-authored FAQ
answers, #76 Phase 1, need no Worker.) If `content/site.json` → `qa.workerUrl`
is empty, the hero "ask" bar falls back to that FAQ retrieval and the terminal's
`ask` reports it isn't wired up yet; nothing else changes.

## Deploy

```bash
cd workers/qa
npx wrangler login          # one-time, browser auth
npx wrangler deploy
```

After the first deploy the URL is `https://antares-qa.<your-subdomain>.workers.dev`.
Put that URL into **`content/site.json` → `qa.workerUrl`** (or via `/admin/` →
**Site meta → Q&A assistant**). Done — the hero "ask" bar and the terminal's
`ask <question>` start returning first-person AI answers.

Workers AI is auto-provisioned; the only binding is `[ai] binding = "AI"` in
`wrangler.toml` (already there). The free tier comfortably covers a personal
site's volume — note each question is **two** model calls (generate + verify).

## API

```
POST /
Content-Type: application/json

# single turn:
{ "q": "what's the story behind Worth Fly?" }

# multi-turn (the chat panel) — user/assistant turns, ending with the new user turn:
{ "messages": [
    { "role": "user", "content": "what's Worth Fly?" },
    { "role": "assistant", "content": "Worth Fly is …" },
    { "role": "user", "content": "what did you learn from it?" }
] }

→ 200  { "answer": "Worth Fly is one of the things I shipped — …", "model": "@cf/meta/llama-3.1-8b-instruct-fast", "verified": true }
→ 4xx/5xx  { "error": "…", "detail"?: "…" }
```

History is capped at the last few turns; each turn is also length-capped.
`verified` is `true` when the fact-check pass ran (the usual case), `false` when
it errored and the raw draft was returned.

## Notes / knobs

- **Voice & grounding** live in `src/index.js` — `GEN_PROMPT` (the first-person
  answer) and `VERIFY_PROMPT` (the fact-check rewrite). To make answers richer
  *stories*, the lever is the **content**, not the prompt — the model can only
  narrate what's actually written. Two places to add content: the public stuff
  (`content/*.json` → `llms-full.txt`, e.g. a card's "Details" markdown), and
  the **off-site** stuff (the CMS "Assistant knowledge" collection →
  `content/agent-brief.json` → `agent-brief.txt`, for things you don't want on
  the visible page).
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
