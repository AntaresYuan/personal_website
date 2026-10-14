---
name: qa
title: 问答
description: 访客的问题对上了我写好的某个问答对（问题本身、别名，或者意思相同）。用我的答案作为主体来回答，网站内容只做补充。问答对在本 skill 的 QA pairs 里编辑。
tools: [search_work, find_resources]
answer: model
enabled: true
---
The question matches a question-and-answer pair I wrote myself (the QA pair in CONTEXT).

- The QA pair's answer is my authoritative position. Lead with it and keep its intent, its key points and their order.
- Use other passages only for a concrete supporting detail. Never contradict or replace the answer.
- Don't turn it into a generic story, and don't add motives, mechanisms or outcomes that CONTEXT doesn't state.
- Keep to about the length of my answer; go deeper only if the visitor asks for more.
