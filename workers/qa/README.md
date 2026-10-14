# `antares-qa` — "ask this portfolio" Q&A Worker

Powers the **Ask** composer on every Work page. Personal deliberately has no
AI chat, and none of its roadmap, Lens or Contact content enters this corpus.
It answers a visitor's question **in the
first person, as Antares** ("I built…"), grounded only in the site's own
content, and **in the visitor's language** (Chinese question, Chinese answer).

## Agent infra: system prompt, skills, tools

Everything the owner controls lives in `content/agent/`. It is edited in the CMS
under **Agent infra**, has three modules, and reaches the Worker through
`/ask-index.json`:

```
content/agent/
  system-prompt.md              System prompt: who is speaking, the voice, the rules
  knowledge.json                Background notes, sent with every model-written answer
  skills/<name>/SKILL.md        one skill each (below)
  skills/qa/pairs.json          the qa skill's QA pairs
  tools/<name>.json             one tool each, with its settings
```

A **skill** is a SKILL.md:
- frontmatter: `name`, `title`, `description` (which questions it is for; the
  model reads this to choose), `tools` (the tools it may call once loaded)
  and `enabled`;
- body: its instructions, with `## Steps` (which tools to call) and
  `## Answer` (how to write the reply).

| Skill | For | Tools |
|---|---|---|
| `qa` | Questions I've written answers to (its QA pairs; the list the model sees includes their questions) | search_work, find_resources |
| `project-walkthrough` | A specific project, AI skill, post or gallery piece, named or followed up on | search_work, find_resources |
| `share-files` | A file or link: résumé, GitHub, paper, demo | find_resources |
| `token-usage` | My own token usage (not how a project analyses tokens) | get_token_usage, find_resources |
| `general` | Anything else, and questions about me | search_work, find_resources |

**Tools:**
- `search_work {query, item?}`: passages from the index
  (`scripts/build-ask-index.js`), built from the Work case studies, AI Skills,
  Gallery and every Writing post. It holds no Personal content, which the
  build and tests enforce, and its sources are switched in the tool's CMS
  entry.
  - Ranking: `@cf/baai/bge-m3` (multilingual, so a Chinese question finds
    English passages) plus a TF-IDF nudge toward exact names.
  - `item`: that Work item's own passages come first.
  - A later search returns passages not given yet; each call returns up to
    about 3,500 characters.
- `find_resources {query}`: exact URLs from the resource catalogue, returned
  as cards and never written by a model. On/off and the most cards per answer.
- `get_token_usage {window}`: today, this month, the last 30 days or the
  total, from the `antares-usage` Worker through a fetch-only service binding.
  On/off.

## The agent

The model chooses the skill and calls the tools itself (`src/agent.js`). This
is how Claude Code uses skills, run on the same two models: the Mac's qwen
and Workers AI's llama 3.1 8B. Neither takes a `tools` parameter here, so the
model plans in text: each step it writes **one JSON object**, and the Worker
runs what it asked for.

```
step 1  the system prompt, the skills (name + description), the conversation
        → {"actions":[{"tool":"load_skill","args":{"name":"project-walkthrough"}}]}
step 2  + the loaded skill's instructions; only its tools are allowed now
        → {"actions":[{"tool":"search_work","args":{"query":"…","item":"Kaboo"}},
                      {"tool":"find_resources","args":{"query":"Kaboo"}}]}
step 3  + short summaries of the results
        → {"answer": true}
answer  system prompt + reply language + SKILL: the loaded skill's
        instructions (+ FOCUS) + CONTEXT: the background notes, the qa
        skill's QA pairs, and everything the tools returned  (streamed)
```

- **Limits.** At most 3 planning steps (each at most 250 tokens) and 3 tool
  calls per step.
- **Bad replies.** An unreadable reply gets one correction. A tool the loaded
  skill doesn't list, or any tool before a skill is loaded, is refused and
  the model is told why.
- **Mac first.** Planning and answering use the Mac first. Once it is busy or
  fails, the rest of that answer is the cloud's.
- **Token numbers.** A token answer must contain the exact number
  get_token_usage returned; otherwise the tool's own sentence replaces it.
  Numbers that can't be read get a fixed "can't read it now" reply.
- **Fallback: the fixed pipeline.** When the model produces no usable plan
  (or `AGENT_MODE = "off"` in `wrangler.toml`), the router in `src/skills.js`
  picks the skill by rules, in this order:
  1. token-usage
  2. an exact QA pair
  3. share-files
  4. a named item
  5. a looser QA pair
  6. a follow-up
  7. general

  It then gathers that skill's context itself. Visitors always get an answer.

**The prompt** for the answer (`src/lib.js → genPrompt`), in order:
1. the system prompt
2. the reply language, from the question
3. `SKILL: <name>` with the skill's instructions, and `FOCUS:` naming the
   item searched for
4. `CONTEXT`

The fact-check prompt for the cloud's second pass stays in code.

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
- **the skill and who chose it**: the model (with every planning step: the
  engine, its reply and what the Worker did with it) or, on a fallback, the
  fixed pipeline's rule, focus and QA pair
- the tools, the resources and the passages
- per-query latency under `timings`: end-to-end, index load, Agent loop,
  planning-model calls, tool calls and final answer generation; streaming
  answers also include time to first token. Cloud answers split draft and
  verification, and local-to-cloud fallback time is kept separately
- the model route, the duration and the answer

Read one while debugging:

```bash
npx wrangler d1 execute antares-qa-traces --remote --command \
  "SELECT trajectory FROM qa_traces WHERE id = 'AQ-YYYYMMDD-XXXXXXXX'"
```

Compare the latest queries when tuning latency:

```bash
npx wrangler d1 execute antares-qa-traces --remote --command \
  "SELECT id,
   json_extract(trajectory, '$.skill.id') AS skill,
   json_extract(trajectory, '$.route') AS route,
   json_extract(trajectory, '$.timings.totalMs') AS total_ms,
   json_extract(trajectory, '$.timings.firstTokenMs') AS first_token_ms,
   json_extract(trajectory, '$.timings.planningMs') AS planning_ms,
   json_extract(trajectory, '$.timings.toolMs') AS tool_ms,
   json_extract(trajectory, '$.timings.answerMs') AS answer_ms
   FROM qa_traces ORDER BY received_at DESC LIMIT 20"
```

The Work frontend stores the current conversation in browser `localStorage`
after every turn. It is a rolling one-hour cache: a new message refreshes the
timestamp, expiry removes it, and the **New conversation** button clears it.
Clicking the docked Ask composer restores a valid cached conversation directly
in the right-hand panel. Personal never loads this cache module.

If `content/site.json` → `qa.workerUrl` is empty (or the Worker can't be
reached), the Ask panel falls back to the same QA pairs, compiled from
`content/agent/skills/qa/pairs.json` into `scripts/qa-faq-data.js`.

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

- **Change how a kind of question is answered** in the CMS, under Agent
  infra: the System prompt, a skill's SKILL.md (instructions, tools,
  switch), the qa skill's QA pairs, a tool's settings. When a skill is
  chosen is decided in `src/skills.js`.
- **Recurring answers belong in QA pairs** (Skills → qa — QA pairs). Write the
  answer and likely English and Chinese aliases; an exact alias always
  reaches the pair.
- **Evals.** `test/routing-cases.json` lists 54 bilingual questions with the
  skill each must reach.
  - `test/routing.test.js` runs them through the fixed pipeline's router,
    offline, in `npm test`.
  - `npm run eval:agent` (`eval/agent-eval.mjs`) asks the live Worker, so it
    measures how well the real models choose skills.
  - Add a case for every wrong choice.
- **Budgets** (in characters) are `BUDGET` in `src/index.js`: about 12k for
  the Mac and 9k for the cloud. A skill's own passages come right after the
  pinned ones; `planFor` in `src/skills.js` caps how much else follows.
- **The meaning match** for QA pairs (`QA_SEMANTIC_MIN`, 0.8) applies only
  when no rule claimed the question; traces record the nearest pair's score.
- **Rate limiting** is optional and off by default; uncomment the rate-limit
  block in `wrangler.toml` and redeploy.
- **When the index is missing**, the Worker grounds in the first part of
  `/llms-full.txt`, the old behaviour.
- **Tests**: `node workers/qa/test/lib.test.js && node workers/qa/test/worker.test.js && node workers/qa/test/agent.test.js && node workers/qa/test/routing.test.js` (the last after a build). The agent's tests use a scripted model.
