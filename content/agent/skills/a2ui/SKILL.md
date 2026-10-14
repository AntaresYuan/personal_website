---
name: a2ui
title: 交互卡片
description: 当问题确实缺少一个会改变结果的选择、确认或输入时，用结构化卡片向访客询问；也可把一组准确资源显示成卡片。普通问题、已有足够信息的问题不要用。
tools: [render_ui]
enabled: true
---
## When to use

Use this skill only when the visitor must make a decision or provide missing information before a useful answer is possible. Do not turn ordinary answers into questionnaires. If a sensible default is safe, answer directly.

## Steps

1. Pick exactly one card type:
   - `choice`: two to six mutually exclusive options, or a small multi-select.
   - `form`: one to four short fields when free-form details are required.
   - `confirm`: a meaningful yes/no decision before continuing.
   - `resource`: exact Work files or links, found by a catalogue query.
2. Call render_ui once. Write the card in the visitor's language. Include a short `message` that introduces why the input is needed.
3. Stop. The visitor's submission will arrive as the next turn; answer or continue with the appropriate skill then.

## Card arguments

- Shared: `type`, `title`, optional `body`, optional `message`, optional `submitLabel`.
- Choice: `options: [{id, label, description?}]`, optional `multiple`.
- Form: `fields: [{name, label, type, required?, placeholder?, options?}]`. Field types: `text`, `email`, `date`, `textarea`, `select`.
- Confirm: optional `confirmLabel` and `cancelLabel`.
- Resource: `query`. URLs are resolved from the Work resource catalogue; never provide a URL yourself.

## Answer

Do not write the final answer in this turn. The card is the response.
