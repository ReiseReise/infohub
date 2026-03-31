---
title: 项目评审：Scrapling 与历史治理
type: review
status: archived
version: 1.0
owner: AIReie
created: 2026-03-13
updated: 2026-03-13
tags: [review, scrapling, retention, docs]
---

# 项目评审：Scrapling 与历史治理

## 结论

这轮评审的核心判断不是“项目不能用”，而是：

- 动态网页抓取能力已经从无到有
- 但可观测性还没同步到前端
- 历史裁剪已经落地
- 但数据一致性边界还需要补严
- 文档结构已经收干净
- 但解释层内容滞后于最新实现

## 主要 findings

1. `High`：30 天 retention 只删老任务行时，会误伤仍被保留条目引用的音频任务，同时留下对象存储垃圾。
2. `High`：Scrapling 抓取诊断主要停留在后端和 `config` 原始字段里，用户端无法判断“这次到底走了哪条抓取链路”。
3. `Medium`：README 与主文档没有同步 Scrapling、历史裁剪和当前真实优先级，导致项目认知继续失真。

## 本轮修正方向

- 把抓取诊断显式透到 `Feed / Monitor / Settings`
- 让 retention 在删音频前先判断引用关系，并尝试清理对象存储
- 把 README、当前状态、路线图、关键实现专题、运维手册同步到 2026-03-13 口径
