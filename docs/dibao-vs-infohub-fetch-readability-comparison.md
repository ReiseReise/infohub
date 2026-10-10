---
title: Dibao 与信息中枢 V3 抓取解析对比报告
type: investigation-report
status: draft
updated: 2026-06-16
source_device: macpro-main
---

# Dibao 与信息中枢 V3 抓取解析对比报告

## 结论先行

Dibao 在你截图里的解析和阅读体验确实明显更好，但原因不是简单的“Dibao 网页抓取器一定更强”。本次只读排查显示，差异主要来自五层：

1. **输入范围更克制**：Dibao 当前主要吃 RSS/Atom；信息中枢同时吃 RSS、网页快照、网页索引、榜单索引、邮件等，来源类型混到同一个阅读流里。
2. **Feed 字段解析更稳**：信息中枢 RSS collector 当前没有读取 Atom 的 `summary` 字段，导致 Simon Willison 这类 feed 明明在 `summary` 里提供了 19k-20k 字正文，却被当成空内容后转去网页补抓，最后抓到 sponsor/站点模板噪音。
3. **内容模型分层更清楚**：Dibao 拆成 `articles` 与 `article_contents(content_html/content_text/extraction_status)`；信息中枢很多内容只有一份 `items.content`，里面混有 HTML、Markdown、纯文本、快照摘要、榜单摘要。
4. **阅读器更像阅读器**：Dibao 把正文区域作为主视觉，按钮和状态弱化；信息中枢虽然已经做三栏，但详情顶部、诊断和提示仍占用阅读面积。
5. **失败降级更少打扰**：Dibao 的 feed-only 状态对读者几乎透明；信息中枢把“索引摘要、网页快照、全文可读”放在一个阅读区展示，用户很容易误以为抓错了文章。

所以，当前问题应该拆成两条线修：**抓取解析层迁移 Dibao 的 feed-first/字段分层思路**，**阅读层迁移 Dibao/QMReader 的正文优先布局**。直接把 Dibao 套壳只能提供对照底座，不能自动修复信息中枢日报、AI资产、来源健康这些上层能力。

## 数据证据

### Dibao 当前本地数据

本次从 `data/dibao/dibao.sqlite` 只读抽样：

| 指标 | 结果 |
|---|---:|
| 文章数 | 2371 |
| Feed 数 | 92 |
| `article_contents.extraction_status=feed_only` | 2371 |
| 平均正文长度 | 5473 字符 |
| 中位正文长度 | 661 字符 |
| >= 2000 字文章 | 1006 |
| >= 8000 字文章 | 458 |
| 含代码结构文章 | 384 |
| 含列表结构文章 | 573 |
| 含引用结构文章 | 359 |
| 含图片文章 | 635 |
| 检测到 sponsor/press kit 噪音 | 0 |

这说明 Dibao 当前优势很大一部分来自 **RSS feed 本身给了足够干净的内容**，并且 Dibao 将 HTML 与纯文本分别存储，阅读和排序各用各的字段。

### 信息中枢近 14 天数据

本次从 `hub.items / hub.sources` 只读抽样：

| 来源类型 | 条目数 | 平均 content 长度 | 中位长度 | >=2000 字 | HTML-like | 噪音命中 | 索引类 |
|---|---:|---:|---:|---:|---:|---:|---:|
| rss/rss/rSS | 7016 | 5428 | 1032 | 3120 | 3837 | 2 | 0 |
| curated_index/webpage_index/media | 136 | 422 | 413 | 0 | 0 | 0 | 136 |
| rss/rss/blog | 116 | 6682 | 811 | 38 | 38 | 75 | 0 |
| webpage/webpage/media | 108 | 541 | 469 | 0 | 0 | 0 | 0 |
| curated_index/webpage_index/official | 26 | 601 | 379 | 0 | 0 | 11 | 12 |

信息中枢总体不缺内容量，但类型混杂。RSS 中有不少全文；网页/索引类多数只是摘要或快照；blog 类里噪音比例偏高，Simon Willison 是典型例子。

## 关键案例

### 案例 1：Simon Willison / Claude Fable

Dibao 中：

- `Initial impressions of Claude Fable 5`：约 11970 字。
- `Claude Fable is relentlessly proactive`：约 9427 字。
- 内容没有 sponsor 噪音。

信息中枢中：

- `Initial impressions of Claude Fable 5`：约 502 字。
- `Claude Fable is relentlessly proactive`：约 654 字。
- 多条内容以 `Sponsored by: AWS/Teleport...` 开头。

根因已验证：Simon 的 Atom feed 中 `<content>` 为空，但 `<summary>` 有完整 HTML 正文，例如 `Claude Fable is relentlessly proactive` 的 `summary` 约 19518 字，`Initial impressions of Claude Fable 5` 的 `summary` 约 20915 字。信息中枢的 `services/hub-engine/src/collectors/rss.ts` 当前取：

```ts
const baseContent = contentEncoded || String(entry.content || entry.contentSnippet || '').trim();
```

它没有把 `entry.summary` 作为候选字段。因此系统以为空内容，触发网页补抓；网页补抓又抓到了页面 sponsor/模板，最终污染正文。这个是确定性 bug。

### 案例 2：Max Bernstein / inlining heuristics

Dibao 中：

- `A survey of inlining heuristics`：约 35672 字纯文本，代码和列表在阅读器里可读。

信息中枢中：

- 同题条目已入库，`items.content` 约 86365 字，包含完整 HTML、代码块、列表、脚注。

这说明信息中枢并非所有抓取都弱。对于 full RSS，后端已经拿到了足够内容；问题主要在前端阅读呈现：当前会把 HTML 转 Markdown 再渲染，仍容易损失代码块、表格、脚注、图片语义，同时详情页顶部诊断和按钮占比过大。

### 案例 3：Anthropic Newsroom

信息中枢现在已有两类 Anthropic 数据：

1. 旧 `webpage` 快照：标题类似 `Newsroom \ Anthropic`，正文含 `press@anthropic.com / Download press kit`，本质是官网新闻列表页面变化，不是单篇文章。
2. 新 `curated_index / webpage_index`：能拆出 `TCS and Anthropic partner...`、`Responsible Scaling Policy` 等单篇条目，但多数只有索引摘要，内容约 240-380 字，需要再补抓 `originalUrl` 才能成为真正全文。

你截图里 `TCS and Anthropic partner...` 显示“原文待补抓”，这比之前“Newsroom \ Anthropic”已经更正确，但它仍然不是完整正文。这里的问题不是页面排版，而是新闻索引源还没有稳定进入“原站正文补抓成功”阶段。

## Dibao 到底更强在哪里

### 值得迁移

1. **feed-first 内容模型**
   - RSS/Atom 条目优先使用 feed 内正文，不急着网页补抓。
   - Atom 的 `summary`、RSS 的 `description`、`content:encoded` 都应进入候选字段池。
   - 选择字段时不是简单按字段优先级，而是按“可读长度、HTML结构、噪音比例、重复标题/导航比例”评分。

2. **内容双字段**
   - `content_html`：保留段落、列表、代码、引用、图片、链接。
   - `content_text`：用于搜索、AI、排序、摘要。
   - `extraction_status`：明确 `feed_only / full_content / failed / skipped`。

3. **Reader 状态独立**
   - 阅读状态、收藏、隐藏、not interested 不应挤在内容主表。
   - 信息中枢已有 `item_feedback`，但阅读流还没有像 Dibao 那样把行为反馈和推荐状态分层。

4. **推荐/最新双队列**
   - Dibao 的强项是读前排序，推荐可以错，但“最新”永远兜底。
   - 信息中枢现在推荐、质量、日报、来源过滤混在一起，用户难以判断为什么看到它。

5. **阅读区克制**
   - 标题、来源、时间、打开原文。
   - 正文占主视觉。
   - 诊断和工具低频收起。

### 不能直接照搬

1. **Dibao 主要解决 RSS 阅读，不解决日报**
   - 它不承担信息中枢的日报雷达、AI资产、来源健康和外部源治理。

2. **Dibao 的 feed-only 成功依赖源质量**
   - 对 36kr、TechCrunch 摘要源、Anthropic 新闻索引这种短摘要/索引页，Dibao 也不会凭空变出完整正文。

3. **Dibao 是单用户本地 RSS 推荐器**
   - 信息中枢现在有更多 source kind 和 AI 流水线，不能把所有条目都当普通 RSS article。

## 信息中枢当前明确问题清单

### P0：确定性 bug

1. **RSS collector 未读取 Atom `summary`**
   - 直接导致 Simon Willison 等源从完整正文退化成网页补抓噪音。
   - 修法：候选字段加入 `summary`，按质量选择最优正文。

2. **网页补抓触发条件过粗**
   - 当前只看 `plainTextLength(baseContent) < 220`。
   - 应改为：如果 baseContent 命中 sponsor/nav/模板噪音，即使超过 220 也应继续尝试原文抽取或清洗。

3. **索引摘要状态仍容易干扰阅读**
   - `curated_index/webpage_index` 应默认显示为“索引摘要 / 原文待补”，不应让用户误以为是全文。

### P1：结构性问题

1. **缺 content_html/content_text 分层**
   - 现有 `items.content` 承载太多形态，导致前端和 AI 都需要猜。

2. **HTML 到 Markdown 转换太简化**
   - 当前 `htmlToReadableMarkdown` 是正则级转换，能救一部分段落，但对代码块、表格、脚注、图片、相对链接不够。

3. **阅读页仍偏诊断面板**
   - 你红框指出的顶部区域确实应收缩。
   - Dibao 的正文阅读占比更高，信息中枢需要把工具/状态从主视觉移走。

### P2：产品策略问题

1. **日报素材层没有充分利用长文**
   - RSS 全文已经有不少，例如 BestBlogs.dev、bernsteinbear、三联、爱范儿、智东西，但日报仍像“少量候选拼接”。
   - 需要先把内容层归类为：精选深写、模块引用、更多动态、全池索引。

2. **来源健康没有形成输入质量控制**
   - 同一类 RSS 源中，全文源、摘要源、广告污染源、网页索引源应有不同处理策略。

## 建议实施路线

### 第一阶段：马上修抓取解析

1. RSS 字段候选改为：
   - `content:encoded`
   - `summary`
   - `content`
   - `description`
   - `contentSnippet`
2. 新增 `chooseBestFeedContent()`：
   - 计算纯文本长度。
   - 识别 HTML 结构密度。
   - 惩罚 sponsor/nav/press/contact/footer 噪音。
   - 同标题重复、链接堆砌、站点模板比例过高则降级。
3. 对 Simon Willison 增加回归测试：
   - Atom `summary` 有 19000+ 字时，不应网页补抓。
   - 内容不应以 `Sponsored by` 开头。

### 第二阶段：迁移 Dibao 式内容分层

短期不一定新建大表，可先加 nullable 字段：

- `content_html`
- `content_text`
- `content_source`
- `extraction_status`
- `extraction_error`

再逐步让前端读 `content_html` 渲染正文，AI 用 `content_text`。

### 第三阶段：阅读器降噪

1. 顶部“信息流标题区 + 搜索 + 到期源提醒”压缩为一行工具栏或默认收起。
2. 详情首屏只留标题、来源、时间、打开原文、正文状态一行。
3. 正文区域仿 Dibao：更宽留白、更高行距、按钮不抢视线。
4. 工具/诊断移到右侧轻量栏或折叠区。

### 第四阶段：日报用内容层重建

日报不应该再直接吃混合 `items.content`，而应吃结构化素材：

- `full_text_articles`：长文深写。
- `index_items`：索引线索，只进动态/待补。
- `snapshot_items`：网页变化，只进监控摘要。
- `feed_summary_items`：短摘要，只做动态或候选。

这会直接提升日报厚度和可信度。

## 判断

Dibao 更好的部分值得抄，但应该抄它的 **分层和取舍**，不是把整个系统替换掉：

- 抓取层：抄 feed-first + 字段选择 + content_html/content_text。
- 阅读层：抄正文优先 + 低频工具收敛。
- 推荐层：抄推荐/最新双队列和解释。
- 日报层：继续用信息中枢自有能力，但必须基于更干净的内容层。

最优下一步不是继续大改 UI，而是先修 `rss.ts` 的 Atom summary 解析和正文质量选择。这个修完，Simon/Claude 这类核心信息源会立刻变好，也能验证 Dibao 的优势是否可复制到信息中枢主链路。
