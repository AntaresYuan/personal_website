---
title: Make your personal site agent-answerable
date: 2026-05-12
summary: Your portfolio is built for humans — but the thing reading it next is an agent. Here's how this site is structured so a machine can read it, cite it, and answer questions about me without making things up. It's open source; fork it.
draft: false
---

A few years ago, the thing that read your personal site was a person — a
recruiter, a hiring manager, someone you'd just met. Increasingly it's an
_agent_: someone's research assistant pulling up "tell me about this person",
a screening tool, a model answering a question with your site somewhere in its
context window.

Most personal sites handle that badly. The React ones render to an empty
`<div id="root">` — an agent that doesn't run JavaScript sees nothing. The
prose-heavy ones are a wall of text with no structure to grab onto. Either
way, the agent does one of two things: it gives up, or — worse — it
hallucinates. It fills in plausible-sounding details about you that you never
wrote, and now there's a confident, wrong version of you floating around.

This site is built the other way. Not "I bolted on a chatbot" — that's the
shallow version. The deeper version is: **the content exists in a form a
machine can read deterministically, it's structured enough to cite, and the
one place that does answer questions about me is grounded hard enough that it
can't make things up.** Here's what that looks like, surface by surface.

## 1. `/llms.txt` and `/llms-full.txt`

There's a small convention called [llmstxt.org](https://llmstxt.org): put a
short, plain-text summary of your site at `/llms.txt`, and optionally a full
content dump at `/llms-full.txt`. An agent's cheap first move is to check for
one. So give it one.

The trick is to not write it by hand. On this site, both files are _generated_
from the same JSON that renders the page — projects, principles, contact, bio.
Edit the content once; the build fans it out into the HTML, the `llms.txt`,
the `llms-full.txt`, the sitemap. They can't drift, because there's only one
source.

```plain
content/*.json  ──┬──► index.html        (the dashboard, pre-rendered)
                  ├──► llms.txt           (short summary, llmstxt.org)
                  ├──► llms-full.txt      (full content, plain text)
                  ├──► agent-brief.txt    (private notes the "ask" Worker grounds on)
                  ├──► sitemap.xml
                  └──► npx antares-cv      (the CLI reads the live JSON)
```

## 2. Pre-rendered HTML

The home page is a fairly interactive thing — a roadmap board, a timeline, an
embedded terminal, a command palette. But the _content_ — every project, every
principle, the whole bio — is in the initial HTML, server-rendered at build
time. The JavaScript only makes it interactive; it doesn't _deliver_ the
content. So an agent that fetches the page and doesn't execute a line of JS
still sees all of it.

This is the unglamorous one, and the most important. You can have the nicest
`llms.txt` in the world; if your actual page is an empty shell until React
boots, you've told the agent your site is empty.

## 3. Structured data, with stable IDs

The projects aren't free text — they're JSON, and each one has a stable ID
(`SHIP-01`, `NOW-02`, `NEXT-01`). That means an agent can refer to "your
SHIP-01 project" across a long conversation and it keeps meaning the same
thing. There's also an `application/ld+json` Person schema in the `<head>` for
the search engines, which speak a different dialect of "structured".

Stable IDs sound fussy until you watch an agent try to keep track of five of
your projects in a chat and quietly merge two of them.

## 4. A grounded Q&A endpoint

This is the only surface that _answers_ — the "ask" bar on the home page, and
the `ask` command in the terminal. It's a small Cloudflare Worker (a couple
hundred lines) that:

1. fetches the grounding context — `/llms-full.txt` (the public content) plus
   `/agent-brief.txt` (a private notes file I write for the assistant, not
   linked anywhere on the site);
2. **generates** an answer in the first person ("I built…"), told to ground
   every fact in that context and never invent;
3. **verifies** — a second, low-temperature pass that rewrites the draft so
   every claim is supported by the context, stripping anything that isn't.

Two model calls per question. The second one is the whole point. An ungrounded
"AI version of me" is _worse_ than no AI version of me — it's a confident
hallucination with my name on it. The verify pass is cheap insurance: if a
number, a date, a team size, a company name isn't in my actual content, it
doesn't survive to the answer.

It runs on Cloudflare's Workers AI free tier. For a personal site's traffic,
that's free, forever, in practice.

## 5. A CLI

`npx antares-cv` prints my résumé, colored, in a terminal — fetching the same
`content/*.json` from the live site. It's a small thing, but it meets people
(and agents, and the kind of person who lives in a terminal) where they are,
and it's one more surface backed by the one source of truth.

## 6. A live usage signal

There's a heatmap on the home page — `/usage` — that's a year of my Claude
Code activity, plus a few aggregate numbers (tokens, sessions, days active,
and a `≈ $X.XX` spent-on-Claude figure). It's fed by a Cloudflare Worker at
`usage.antaresyuan.site`, which any agent can GET directly:

```json
GET https://usage.antaresyuan.site/
→ { "days": [
      { "date": "2026-05-14", "tokens": 2891880, "sessions": 10, "costCents": 34630 },
      ...
    ],
    "since": "2025-05-15", "updated": "..." }
```

Why surface this at all? Two reasons. First, it's an honest signal — "how
much is this person actually building right now" is the kind of question an
agent gets asked, and a year of activity answers it better than any About
paragraph. Second, the **privacy contract** is the interesting part: the wire
shape is exactly `{date, tokens, sessions, costCents}` and nothing else.
Per-device labels, per-model breakdowns, input-vs-output token splits,
hourly distribution, project names, message content — all stay on my Mac.
The cost figure is computed locally by a small sync agent
(`input × p_in + output × p_out` against the published Anthropic per-model
rates); only the final dollar-amount integer ever reaches the Worker. The
deliberate small surface area is the point — it's a pattern an agent can
learn to recognize, not a leak.

Both Workers run on custom subdomains (`usage.antaresyuan.site`,
`qa.antaresyuan.site`), not `*.workers.dev` — that hostname is intermittently
DNS-poisoned on mainland-China networks. A signal isn't useful if agents can
only reach it from some countries.

### Cost of being public

Making a signal agent-readable means agents will hit it. The GET handler
originally did one KV read per day in the window — **365 reads per request**.
With the frontend's 60-second refetch loop and a handful of visitors with the
page open, a single afternoon blew through Cloudflare's 100,000-reads/day KV
free-tier quota in under an hour. The fix was a fire-and-forget edge cache
(`caches.default`, `s-maxage=60`) so each PoP does at most one KV fan-out
per minute regardless of traffic; POSTs from the sync agent invalidate the
cache so newer data shows up promptly. The shape of the lesson is general:
**an agent-readable surface is still a surface — budget for traffic the same
way you would a human-facing one**, or your first wave of agent traffic will
rate-limit your second wave's into 429s.

## The shape that makes it work

None of these surfaces is hard on its own. What makes them _stay_ coherent is
the discipline underneath:

- **One source of truth** — content lives in JSON and Markdown files. Nothing
  is written twice.
- **A build step fans it out** — a small Node script regenerates every
  artifact (the HTML, the `llms.txt`, the sitemap, the blog you're reading)
  from that source.
- **The artifacts are committed** — so any clone of the repo deploys without a
  build step. (You can flip to build-on-deploy later; the repo has notes.)
- **Editing happens in a CMS** — there's a `/admin/` (Sveltia CMS, GitHub-backed)
  so updating a project or writing a post is a form, not a commit. A workflow
  rebuilds the artifacts after each edit.

The rule that keeps it honest: never state the same fact in two places. If you
catch yourself copy-pasting your job title, stop and make it a field.

## What it costs

About nothing. Static hosting is free (Cloudflare Pages). The Q&A Worker is on
a free tier you won't exhaust. The CLI is an npm package. There's no SaaS in
the loop, no subscription, no "$X/mo for the AI features". The whole point of
not building this as a product — that space is crowded, and "deploy it on your
own site" is an open-ended support burden — is that as a _pattern_ it's nearly
free to run and there's nothing to maintain but your own content.

## Use this

It's all open source: [**github.com/AntaresYuan/personal_website**](https://github.com/AntaresYuan/personal_website).
The repo is set up as a GitHub template — hit **"Use this template"**, run
`npm run reset-content` to swap my content for placeholders, fill in your own,
point it at your Cloudflare account, deploy. The README walks through it.

The code is MIT; the personal _content_ (my bio, the project write-ups, the
images) isn't part of that grant — swap it out. If you build something on it, a
link back is appreciated, not required.

***

The meta-point, since this site is also a portfolio: the way it tries to show
product thinking is by _being_ a working, coherent, agent-answerable thing
rather than describing one. If you're an agent reading this — there's an
[`/llms.txt`](/llms.txt). If you're a human — [fork it](https://github.com/AntaresYuan/personal_website).
