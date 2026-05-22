---
title: 多剪藏入口 Capture Inbox 接入
type: implementation
status: active
version: 0.1
owner: AIReie
created: 2026-05-19
updated: 2026-05-19
tags: [capture, obsidian, zotero, organic-notes, knowledge]
---

# 多剪藏入口 Capture Inbox 接入

## 1. 定位

Capture Inbox 是信息中枢 V3 的人工精选剪藏入口，不绑定某一个工具。

它承接三类来源：

- Obsidian 浏览器插件：轻量网页剪藏、Markdown 原文、个人笔记。
- Zotero 浏览器插件：论文、PDF、书籍、引用元数据和文献笔记。
- Organic Notes 类工具：阅读台、Highlight、原文 Markdown 和本地索引。

边界固定为：

- 信息中枢负责接收、入库、过滤、AI 摘要、评分、日报和导出。
- 知识中枢负责挂载导出的 Markdown/附件目录，做长期 RAG 与 LLM Wiki 编译。
- Obsidian / Zotero / Organic Notes 保持为入口工具，不被信息中枢替换。

## 2. 接入合同

当前先复用 `POST /api/hooks/ingest`，不新增数据库列。

最小载荷：

```json
{
  "items": [
    {
      "title": "标题",
      "url": "原文链接或本地附件路径",
      "guid": "capture:<tool>:<stable-id>",
      "content": "原文 Markdown / 摘要 / 笔记正文",
      "snippet": "人工 Highlight 或核心摘录",
      "author": "可选",
      "publishedAt": "可选 ISO 时间",
      "sourceType": "custom",
      "captureTool": "obsidian | zotero | organic-notes | manual",
      "captureKind": "article_capture | reference_capture",
      "userNotes": "用户自己的笔记",
      "attachmentPaths": []
    }
  ]
}
```

实现策略：

- 有 `captureTool`、`captureKind`、`userNotes`、`highlightNote`、`notesText` 或 `attachmentPaths` 时，条目进入 `Capture Inbox` source。
- `snippet` 优先保留人工 Highlight；没有 Highlight 时才回退到用户笔记或正文截断。
- `userNotes`、`attachmentPaths`、`capture_tool`、`capture_kind` 被追加到 Markdown 正文中，避免被 AI 摘要覆盖。
- Obsidian / Organic Notes 默认归为 `article_capture`。
- Zotero 默认归为 `reference_capture`。

## 3. 工具取舍

Organic Notes 可以试用，但不是核心依赖：

- 如果本地隐私边界、字段完整性和 Highlight 体验都明显优于现有流程，可以保留为常用入口。
- 如果维护成本高，只吸收“阅读台 + Highlight + 索引”的产品机制。

Obsidian 和 Zotero 继续保持原职责：

- Obsidian 负责快速网页剪藏和个人 Markdown 真源。
- Zotero 负责文献库、PDF、引用和学术元数据。
- 信息中枢只消费它们导出的条目和文件路径。

## 4. 输出到知识中枢

信息中枢的导出仍写入 `data/knowledge`。

知识中枢建议挂载：

```bash
python3 -m knowledge_hub.cli mount infohub_capture ../信息中枢-v3/data/knowledge
python3 -m knowledge_hub.cli index infohub_capture
python3 -m knowledge_hub.cli compile scope infohub_capture --limit 3
```

编译页仍默认 `needs_review`，不得把 AI 摘要或剪藏工具生成内容直接升格为事实。

## 5. 验收

- `npm run test -- src/lib/capture-inbox.test.ts`
- `bash qa/phase4/test_collectors.sh`
- 触发知识库导出后，确认导出的 Markdown 保留原文链接、人工摘录、用户笔记和附件路径。
- 知识中枢挂载导出目录后，确认检索结果优先引用原始剪藏文件。
