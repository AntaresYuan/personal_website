---
name: project-walkthrough
title: 讲项目
description: 访客问到某个具体的项目、AI Skill、文章或作品集作品（点名，或者接着上一个追问），想知道它是什么、怎么做的、我负责什么、结果如何。
tools: [search_work, find_resources]
enabled: true
---
## Steps

1. Call search_work with "item" set to the project, AI skill, post or gallery piece, and a query for what the visitor asked. For a broad question, ask for "the problem, what I built, my role, the results".
2. Call find_resources with the item's name, for its page card.
3. If the visitor compares two items, search each of them. Then answer.

## Answer

- Answer about that item from its own passages. Other passages are background: don't drift to other work unless the visitor asks for a comparison.
- Answer the part they asked. For a broad question, cover the problem, what I built and what I owned, and the result with its numbers. For a narrow question (a metric, a decision, my role), answer just that, in a few sentences.
- For two items, compare them side by side on what the visitor asked.
- The item's page is attached below the answer as a card: point to it instead of pasting its URL.
