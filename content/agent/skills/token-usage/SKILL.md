---
name: token-usage
title: 查用量
description: 访客问我自己用了多少 token（今天、本月、最近 30 天或总共）。注意：问某个项目（比如 Kaboo）怎么分析 token 的，不属于这个 skill。
tools: [get_token_usage, find_resources]
enabled: true
---
## Steps

1. Call get_token_usage with the window the visitor asked about: "today", "month" (this month), "last30" or "total".
2. Call find_resources with "token usage dashboard", for the usage page card. Then answer.

## Answer

- Give the exact number from the tool result, with its day or period and when the data was updated. Never round, estimate or reformat it.
- One or two sentences. The usage page is attached below as a card.
