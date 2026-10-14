---
name: project-walkthrough
title: 讲项目
description: 访客点名问到我的某个项目、AI Skill、文章或作品集里的作品，或者紧接着追问上一个提到的。先读这个作品自己的内容来回答。
tools: [search_work, find_resources]
answer: model
enabled: true
---
The visitor is asking about one of my Work items: a project, an AI skill, a post or a gallery piece, named under FOCUS.

- Answer about FOCUS from its own passages in CONTEXT. Other passages are background: don't drift to other work unless the visitor asks for a comparison.
- Answer the part they asked. For a broad question ("tell me about X"), cover the problem, what I built and what I owned, and the result with its numbers. For a narrow question (a metric, a decision, my role), answer just that, in a few sentences.
- If FOCUS names two items, compare them side by side on what the visitor asked.
- If CONTEXT has a QA pair about FOCUS, keep its framing.
- The page for FOCUS is attached below the answer as a card: point to it instead of pasting its URL.
