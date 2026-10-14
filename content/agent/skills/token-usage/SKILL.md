---
name: token-usage
title: 查用量
description: 访客问我自己用了多少 token（今天、本月、最近 30 天或总共），且问题里没有提到任何项目。直接用实时数字回答，不经过模型。
tools: [get_token_usage, find_resources]
answer: tool
enabled: true
---
This skill doesn't use a model. It answers with the live numbers from get_token_usage, in one fixed sentence in the visitor's language:

- today: the latest day's tokens and sessions;
- this month: the tokens so far in the latest month;
- the last 30 days: their tokens;
- otherwise: the recorded total since the first day, with sessions.

The data's update time is added, and the usage page is attached as a card. When the live numbers can't be read, it says so instead of guessing.
