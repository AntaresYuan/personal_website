# `antares-qa` — "ask this portfolio" Q&A Worker

Powers the **Ask** composer on every Work page (and the terminal's
**`ask <question>`** on Personal). It answers a visitor's question **in the
first person, as Antares** ("I built…"), grounded only in the site's own
content, and **in the visitor's language** (Chinese question, Chinese answer).

1. **Retrieve.** The Worker fetches `/ask-index.json`. This is the site cut into
   titled passages by `scripts/build-ask-index.js`:
   - CMS-authored FAQ answer briefs are checked first by canonical question
     and aliases; a match becomes authoritative guidance for the answer
   - the Work case studies
   - AI Skills and Gallery
   - every Writing post, section by section
   - the Personal project log and Lens

   The response guide and background notes from CMS → **Assistant** →
   `content/assistant.json` go with every question, along with an overview
   assembled from the website sources enabled there. The rest are ranked against the question:
   - `@cf/baai/bge-m3`, a multilingual embedding model, so a Chinese question
     finds English passages;
   - a small TF-IDF nudge toward exact names.

   They are then taken in order until a character budget is spent. The FAQ and
   passage index refreshes within about a minute after a CMS deploy; passage
   vectors are computed once per content-derived index version and cached.
2. **Answer from the Mac**, if `LOCAL_LLM_URL` is set. This is a Cloudflare
   Tunnel, behind an Access service token, to a small proxy in front of Ollama
   on Antares's Mac (`ops/local-llm/`). It is skipped when the Mac is busy, and
   abandoned when it is unreachable or takes more than 25 s. After a failure the
   Mac is parked for a minute.
3. **Answer from the cloud.** Workers AI (`@cf/meta/llama-3.1-8b-instruct-fast`)
   drafts an answer. A second, low-temperature call then fact-checks the draft
   against the same passages.

No API keys touch the frontend; CORS is locked to the site origin.

If `content/site.json` → `qa.workerUrl` is empty (or the Worker can't be
reached), the Ask panel falls back to the same CMS-authored FAQ compiled from
`content/assistant.json` into `scripts/qa-faq-data.js`.

## Deploy

```bash
cd workers/qa
npx wrangler deploy
```

Bound to `qa.antaresyuan.site` (a custom domain on the site's zone; see
CLAUDE.md). The only binding is `[ai] binding = "AI"`. To answer from the
Mac, follow `ops/local-llm/README.md`, then:
1. Set `LOCAL_LLM_URL`.
2. Add the `ACCESS_CLIENT_ID` / `ACCESS_CLIENT_SECRET` secrets.
3. Redeploy.

## API

```
POST /
Content-Type: application/json

{ "messages": [                       # the chat so far, ending with the new question
    { "role": "user", "content": "what's Kaboo?" },
    { "role": "assistant", "content": "Kaboo is …" },
    { "role": "user", "content": "what did you own there?" }
  ],
  "lang": "en" }                       # the page's language; used only when the question has no letters

# or a single question: { "q": "what's Kaboo?" }

→ 200  { "answer": "…", "model": "qwen3.5:4b", "via": "local", "verified": false }
→ 200  { "answer": "…", "model": "@cf/meta/llama-3.1-8b-instruct-fast", "via": "cloud", "verified": true }
→ 4xx/5xx  { "error": "…", "detail"?: "…" }
```

History is capped at the last 8 turns; each turn at 600 characters.

## Notes / knobs

- **Prompts and retrieval** live in `src/lib.js`:
  - `genPrompt`, the first-person answer
  - `verifyPrompt`, the fact-check
  - `selectPassages`, the budget
  - `replyLang`
- **Recurring answers belong in Assistant FAQ.** Write the authoritative
  answer brief and likely English/Chinese aliases in the CMS. A matched brief
  takes priority; retrieved site passages can only support or expand it.
- **Other background belongs in Assistant knowledge.** The model can only
  narrate what is written on the site or in those supplemental notes.
- **Budgets** (in characters) are `BUDGET` in `src/index.js`: about 12k for
  the Mac and 9k for the cloud.
- **Rate limiting** is optional and off by default; uncomment the rate-limit
  block in `wrangler.toml` and redeploy.
- **When the index is missing**, the Worker grounds in the first part of
  `/llms-full.txt`, the old behaviour.
- **Tests**: `node workers/qa/test/lib.test.js && node workers/qa/test/worker.test.js`.
