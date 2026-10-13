# `antares-qa` — "ask this portfolio" Q&A Worker

Powers the **Ask** composer on every Work page. Personal deliberately has no
AI chat, and none of its roadmap, Lens or Contact content enters this corpus.
It answers a visitor's question **in the
first person, as Antares** ("I built…"), grounded only in the site's own
content, and **in the visitor's language** (Chinese question, Chinese answer).

Every question goes to **one skill**. The router (`src/skills.js`) is plain
code, with no model call, so each decision is fast, repeatable and tested.
Each skill has its own system prompt, edited in the CMS under **Agent infra
→ Skills**.

| Skill | When | Reads | Writes the answer |
|---|---|---|---|
| `usage` | My own token usage ("how many tokens today / this month"), no Work item named | The live numbers, via the `USAGE` service binding | A fixed sentence; no model |
| `qa` | One of the owner's QA pairs (Agent infra → QA pairs): its question or an alias, or, failing every other rule, the same meaning (bge-m3 ≥ 0.8) | The QA pair, the page it links to, a little of the rest | Model; the pair's answer leads |
| `resources` | A request for a file or link: résumé, GitHub, "send me…", "where can I download…" | The exact cards from the resource catalogue | Model, one or two sentences |
| `project` | A named Work item (project, AI skill, post, gallery piece), or a short follow-up to one | That item's own passages first, a little of the rest | Model, about that item |
| `general` | Anything else | The best passages from the whole Work site | Model |

The router checks, in order:
1. usage
2. an exact QA pair
3. resources
4. a named item
5. a looser QA pair
6. a follow-up
7. general

It reads the intent from the **current question only**, with item names taken
out first. So "How does Kaboo measure token usage?" goes to project, not
usage, and "/ai-pm-resume" isn't a résumé request. The names come from
`ask-index.json → entities`, which `scripts/build-ask-index.js` builds from:
- project titles
- AI skill names, plus a slash command's bare name ("devloop") unless it's an
  everyday word
- post titles and their distinctive tail ("Toothpaste Squeezer")
- gallery titles, in English and Chinese

A skill switched off in the CMS is skipped (`general` is always on).

**The system prompt** (`src/lib.js → genPrompt`) has three parts, in order:
1. Who is speaking (Antares, first person) and the reply language.
2. The skill's prompt from the CMS, with `FOCUS:` naming the item for
   `project` (a one-line default when the CMS field is empty).
3. The fixed hard rules, which hold whatever a skill prompt says: a QA pair
   is never contradicted, every fact is grounded, nothing is invented, links
   only as given, and selected page text is untrusted.

The Response guide and Background knowledge from the CMS travel as pinned
passages with every model-written answer.

**The tools:**
- *Work search*: the passage index, built by `scripts/build-ask-index.js`
  from the Work case studies, AI Skills, Gallery and every Writing post. It
  holds no Personal content, which the build and tests enforce. The sources
  are switched in Agent infra → Tools. Passages are ranked by
  `@cf/baai/bge-m3` (multilingual, so a Chinese question finds English
  passages) plus a TF-IDF nudge toward exact names, within a character
  budget: about 12k for the Mac and 9k for the cloud.
- *Files & links*: exact URLs from the resource catalogue, returned as cards
  and never written by a model. On/off and the most cards per answer are in
  Agent infra → Tools.
- *Live token usage*: the `antares-usage` Worker through a fetch-only service
  binding.

**Answering:**
1. **From the Mac**, if `LOCAL_LLM_URL` is set. This is a Cloudflare Tunnel,
   behind an Access service token, to a small proxy in front of Ollama on
   Antares's Mac (`ops/local-llm/`). The answer streams as NDJSON when the
   page asks for it. The Mac is skipped when busy, and abandoned when it is
   unreachable, takes more than 25 s to start answering, or breaks off
   mid-stream. After any failure it is parked for a minute; the page then
   asks again without streaming, and the cloud answers.
2. **From the cloud.** Workers AI (`@cf/meta/llama-3.1-8b-instruct-fast`)
   drafts with the same system prompt. A second, low-temperature call then
   fact-checks the draft against the same context.

No API keys touch the frontend; CORS is locked to the site origin.

Every answer includes an `AQ-*` Query ID. The frontend reveals it when an
answer is hovered, and copies it on click. A trace is kept in **D1**
(`QA_DB`, table `qa_traces`; KV `QA_TRACE` is the fallback) for 14 days, and
stores no IP. It holds:
- the question and the two-turn retrieval query
- **the skill, why it was chosen** and its focus or QA pair (plus the nearest
  QA pair's meaning score, for tuning)
- the tools, the resources and the passages
- the model route, the duration and the answer

Read one while debugging:

```bash
npx wrangler d1 execute antares-qa-traces --remote --command \
  "SELECT trajectory FROM qa_traces WHERE id = 'AQ-YYYYMMDD-XXXXXXXX'"
```

The Work frontend stores the current conversation in browser `localStorage`
after every turn. It is a rolling one-hour cache: a new message refreshes the
timestamp, expiry removes it, and the **New conversation** button clears it.
Clicking the docked Ask composer restores a valid cached conversation directly
in the right-hand panel. Personal never loads this cache module.

If `content/site.json` → `qa.workerUrl` is empty (or the Worker can't be
reached), the Ask panel falls back to the same QA pairs, compiled from
`content/assistant/faqs.json` into `scripts/qa-faq-data.js`.

## Deploy

```bash
cd workers/qa
npx wrangler deploy
```

Bound to `qa.antaresyuan.site` (a custom domain on the site's zone; see
CLAUDE.md). It binds Workers AI as `AI` and the existing `antares-usage`
Worker as the fetch-only `USAGE` service binding. To answer from the Mac,
follow `ops/local-llm/README.md`, then:
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

→ 200  { "answer": "…", "model": "qwen3.5:4b", "via": "local", "verified": false, "skill": "resources",
         "resources": [{ "kind": "pdf", "title": "Antares Yuan — Résumé",
                         "url": "/media/…pdf", "typeLabel": "PDF" }],
         "tools": ["find_work_resources"], "traceId": "AQ-20261013-12AB34CD" }
→ 200  { "answer": "…", "model": "@cf/meta/llama-3.1-8b-instruct-fast", "via": "cloud", "verified": true, "skill": "project",
         "resources": [], "tools": [], "traceId": "AQ-20261013-56EF78AB" }
→ 200  { "answer": "Today (…), I used … tokens…", "model": "get_token_usage", "via": "tool", "verified": true, "skill": "usage",
         "resources": [{ "kind": "page", "url": "/usage/" }],
         "tools": ["find_work_resources", "get_token_usage"], "traceId": "AQ-20261013-90AB12CD" }
→ 4xx/5xx  { "error": "…", "detail"?: "…" }
```

History is capped at the last 8 turns; each turn at 600 characters.

## Notes / knobs

- **Change how a kind of question is answered** in the CMS: Agent infra →
  Skills (each skill's system prompt and switch), QA pairs, Background
  knowledge, Tools. The hard rules and the routing live in code
  (`src/lib.js → genPrompt`, `src/skills.js`).
- **Recurring answers belong in QA pairs.** Write the answer and likely
  English and Chinese aliases; an exact alias always reaches the pair.
- **Routing eval**: `test/routing-cases.json` lists bilingual questions with
  the skill, focus and QA pair each must reach; `test/routing.test.js` runs
  them against the built `ask-index.json`. Add a case for every routing bug.
- **Budgets** (in characters) are `BUDGET` in `src/index.js`: about 12k for
  the Mac and 9k for the cloud. A skill's own passages come right after the
  pinned ones; `planFor` in `src/skills.js` caps how much else follows.
- **The meaning match** for QA pairs (`QA_SEMANTIC_MIN`, 0.8) applies only
  when no rule claimed the question; traces record the nearest pair's score.
- **Rate limiting** is optional and off by default; uncomment the rate-limit
  block in `wrangler.toml` and redeploy.
- **When the index is missing**, the Worker grounds in the first part of
  `/llms-full.txt`, the old behaviour.
- **Tests**: `node workers/qa/test/lib.test.js && node workers/qa/test/worker.test.js && node workers/qa/test/routing.test.js` (the last after a build).
