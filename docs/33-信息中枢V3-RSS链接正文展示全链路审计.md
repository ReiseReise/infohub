# 信息中枢 V3 RSS/链接/正文/展示全链路审计

updated: 2026-07-03
source_device: macpro-main

## 审计范围

本轮目标是把长期反复出现的“RSS/链接/正文/展示到底哪里乱”拆成可复跑证据，而不是继续按单条截图猜。

本轮新增只读审计器：

- `qa/p0/audit_rss_link_content_matrix.mjs`
- 最新报告：`qa/reports/rss-link-content-audit-2026-06-27T11-51-16-125Z.md`
- JSON 明细：`qa/reports/rss-link-content-audit-2026-06-27T11-51-16-125Z.json`
- 黄金样本矩阵：`qa/reports/golden-sample-matrix-latest.md`

审计覆盖：

- 来源层：feed URL、来源类型、采集器类型、最近抓取状态、正文 ready/degraded/missing 指标。
- 条目层：item URL、originalUrl、sourceId 归属、source host 与 item host 是否异常。
- 正文层：contentReadiness、contentEvidence 主证据层、全文可读是否误标。
- 翻译层：translationStatus、translationReason、translationAction 是否一致。
- 展示层：raw enum 泄露、索引/榜单元数据污染阅读区、Playwright 截图抽查。

## 关键结论

1. 这轮没有发现“全局 RSS 链接写错/读错”的阻断级问题。
   - 98 个来源、4789 条 API 可见条目中，高危问题为 0。
   - 这说明当前主链路的 `sourceId -> item.url -> contentReadiness` 基本可追溯。

2. 真正影响信任感的第一大问题是索引/榜单源。
   - `BestBlogs Daily Brief` 等 `curated_index/webpage_index` 有 338 条缺 `originalUrl`。
   - 它们当前状态能正确标为“榜单摘要可读”，没有伪装成全文。
   - 但阅读区仍会展示榜单 URL、榜单页等元数据，导致用户感觉“正文都是奇怪东西”。

3. 第二大问题是翻译完整性。
   - `audit-reading-quality` 抽扫 250 条，发现 133 条英文长文译文明显过短。
   - 典型样本包括 OpenAI News、Dwarkesh、Sean Goedecke、Simon Willison 等长文源。
   - 这解释了用户看到“翻译不对/翻译没效果”的体感：不是按钮必然坏，而是部分译文状态和实际译文长度不匹配。

4. 代码/数学长文的正文排版已有明显改善。
   - Playwright 抽查 `Quaternion Rotations, Claude, and Lean`，代码块和正文段落可读。
   - 相关前端/正文测试 42 条通过。

5. Daring Fireball 等 RSS host mismatch 多数是低优先级复核项。
   - 174 条 `item.host_differs_from_source` 主要来自外链型 RSS 或转载链接。
   - 这不应默认判为错误，但 Sources 健康页应提示“外链型来源”，避免用户误以为错源。

## 最新自动审计结果

命令：

```bash
node qa/p0/audit_rss_link_content_matrix.mjs --max-items all --detail-limit 260
```

结果摘要：

```json
{
  "sources": 98,
  "items": 4789,
  "issueTypes": 4,
  "high": 0,
  "medium": 677,
  "low": 174
}
```

问题分布：

| 严重级 | 类型 | 数量 | 含义 |
|---|---:|---:|---|
| medium | `display.index_metadata_reader_noise` | 338 | 索引/榜单条目缺原站链接，阅读区容易暴露榜单 URL/元数据 |
| medium | `item.original_url_missing_for_index` | 338 | 索引/榜单条目没有 `originalUrl`，只能展示索引摘要 |
| medium | `display.raw_enum_visible_risk` | 1 | 摘要/翻译/原因字段含 raw enum |
| low | `item.host_differs_from_source` | 174 | RSS 条目 host 与来源 host 不一致，需要识别外链型来源 |

## 黄金样本矩阵结果

命令：

```bash
INFOHUB_TOKEN=<local-audit-token> node qa/p0/golden_sample_matrix.mjs \
  --api http://127.0.0.1:3001/api \
  --output qa/reports/golden-sample-matrix-latest.md
```

结果：

- 12 类样本。
- 9 个通过。
- 2 个需复核。
- 1 个缺样本：网页快照/监控。

复核项：

- 片段/标题兜底：36kr 样本正文不足，必须先补正文再进入翻译或日报深读。
- 低质/噪声样本：36kr 样本正文不足，适合降噪或补抓，不适合当深读材料。

## Playwright 抽查

命令：

```bash
INFOHUB_TOKEN=<local-audit-token> \
INFOHUB_WEB_URL=http://127.0.0.1 \
INFOHUB_SCREENSHOT_DIR=qa/reports/feed-readability-screens \
python3 qa/p0/probe_feed_readability.py \
  "/feed/80ade039-5f5a-4486-9f24-bbe2a9ccae19?sourceId=806" \
  "/feed/2f085434-af0d-465d-a860-bb5d48d56042?sourceId=1358" \
  "/feed/73095723-504e-4924-b9c6-0edb42ad3d35?sourceId=1360"
```

截图：

- `qa/reports/feed-readability-screens/feed-80ade039-5f5a-4486-9f24-bbe2a9ccae19-sourceid-806.png`
- `qa/reports/feed-readability-screens/feed-2f085434-af0d-465d-a860-bb5d48d56042-sourceid-1358.png`
- `qa/reports/feed-readability-screens/feed-73095723-504e-4924-b9c6-0edb42ad3d35-sourceid-1360.png`

观察：

- John D. Cook 长文：正文和代码块可读，未见明显遮挡。
- BestBlogs 榜单：状态提示正确，但原文区展示榜单 URL/元数据，阅读体验仍差。
- OpenAI News：原文长文可读，但翻译专项审计显示该类来源存在大量译文过短债务。

## 已通过测试

```bash
node --check qa/p0/audit_rss_link_content_matrix.mjs
node --test apps/web/test/feed-layout.test.ts apps/web/test/readable-content.test.ts apps/web/test/feed-diagnostics.test.ts
```

## 2026-07-02 修复验收：索引源降噪与翻译动作可见

### 已改动

- `apps/web/src/lib/feed-layout.ts`
  - 新增 `resolveFeedOriginalDisplayContent`，对 `curated_index / webpage_index / curatedSummary / indexSummary` 的阅读显示层做降噪。
  - 榜单/索引类条目不再把 `榜单日期 / 来源站点 / 榜单评分 / 榜单详情 / 榜单页 / 原文链接 / 来源页` 直接作为正文展示。
  - `translationStatus=ready` 但 `translationUsable=false` 或译文明显短于原文时，状态改为“译文不完整，建议补全”。
- `apps/web/src/features/feed/page.tsx`
  - 原文区渲染前先经过 `resolveFeedOriginalDisplayContent`，只对阅读展示层清洗，不改数据库原始内容。
  - 主阅读标签继续收敛为 `摘要 / 原文 / 翻译`，低频内容留在扩展区与工具诊断。
- `apps/web/test/feed-layout.test.ts`
  - 新增测试覆盖“短译文状态”和“榜单元数据不进入正文阅读区”。

### 验证命令

```bash
node --test apps/web/test/feed-layout.test.ts
node --test apps/web/test/feed-layout.test.ts apps/web/test/readable-content.test.ts apps/web/test/feed-diagnostics.test.ts
npm run build # in apps/web
docker cp apps/web/dist/. infohub-nginx:/usr/share/nginx/html
docker restart infohub-nginx
docker exec infohub-nginx nginx -t
```

结果：

- `feed-layout.test.ts`：23/23 通过。
- Feed 布局、可读正文、诊断文案相关测试：43/43 通过。
- `apps/web npm run build` 通过。
- `infohub-nginx` 重启成功，`nginx -t` 通过。

### Playwright 抽测

抽测链接：

- `http://localhost/feed/6ce0e974-bc99-433e-8909-440150f9f3e2?sourceId=1354`
- `http://localhost/feed/80ade039-5f5a-4486-9f24-bbe2a9ccae19?sourceId=806`

截图：

- `qa/reports/feed-fix-auth-stable-6ce0e974-bc99-433e-8909-440150f9f3e2.png`
- `qa/reports/feed-fix-auth-stable-80ade039-5f5a-4486-9f24-bbe2a9ccae19.png`
- `qa/reports/feed-translate-click-80ade039.png`

观察：

- 两个深链详情均可加载目标文章。
- 正文主标签可见为 `摘要 / 原文 / 翻译`。
- `榜单详情`、`榜单评分` 未进入页面正文文本。
- `一键翻译全文` 可见且会触发真实请求 `/api/items/:id/translate-full`。
- John D. Cook 样本点击翻译后，后端返回 `译文偏短，建议重新生成完整译文。`，说明按钮链路已通，但后端全文翻译仍有质量债。

### 剩余问题

- `translate-full` 当前能被点击、能返回失败原因，但对长英文技术文章仍可能生成过短译文；下一步需要后端做强制分块翻译、合并和完整性重试，而不是只由前端提示。
- 索引/榜单类条目的原站补抓质量仍要继续在后端治理；本轮只保证阅读区不再把技术元数据当正文。

结果：

- 审计脚本语法检查通过。
- Feed 布局、可读正文、诊断文案相关测试 42/42 通过。

## 2026-07-02 修复验收：John D. Cook 长文全文翻译

样本：

- 页面：`http://localhost/feed/80ade039-5f5a-4486-9f24-bbe2a9ccae19?sourceId=806`
- 原文：`https://www.johndcook.com/blog/2026/06/15/quaternions-claude-lean/`

根因拆解：

- 前端：翻译按钮曾被全局 `stageReprocessing` 禁用，其他低频修复状态会误锁当前文章的翻译入口。
- 后端：`resolveItemText` 对 `readabilityContent` 先做 `cleanArticleBody`，代码/定理密集长文被误截断为约 1195 字，导致全文翻译只覆盖开头部分。
- 网关：真正按 8739 字可读正文翻译时，同步请求可能超过 nginx `/api/` 120 秒超时，前端会先看到 504；后端实际可能仍完成写入。

已修复：

- `apps/web/src/lib/feed-layout.ts` 新增 `shouldDisableFeedTranslationAction`，只在当前条目当前阶段为 `translation` 时禁用当前翻译按钮。
- `services/hub-engine/src/lib/item-enrichment.ts` 对长 `readabilityContent` 增加清洗长度保护：清洗结果明显短于原始可读层时保留原始可读正文，避免代码/公式/定理长文被截短。
- `services/hub-engine/src/processors/ai-summarizer.ts` 已有分块翻译和二次补全路径；本轮验证确认修复后翻译源从 1195 字提升到 8739 字。
- `nginx/nginx.conf` 将普通 `/api/` `proxy_read_timeout` 从 120s 提高到 300s，作为同步长任务的短期缓冲。

验证：

- 后端回归：`node --import tsx --test src/lib/item-enrichment.test.ts src/processors/ai-summarizer.test.ts src/lib/reading-context.test.ts`，47/47 通过。
- 后端构建：`npm run build` in `services/hub-engine` 通过。
- 前端回归：`node --test apps/web/test/feed-layout.test.ts`，24/24 通过。
- 前端构建：`npm run build` in `apps/web` 通过。
- Docker：`hub-engine` 已重建并 healthy；`nginx` 已热加载新配置并 healthy。
- 真实数据：同一条文章 `translationStatus=ready`，`translationCompleteness.complete=true`，`basisLength=8140`，`translatedLength=5852`，译文长度约 6101 字。
- Playwright 页面截图：`qa/reports/feed-translation-ready-80ade039.png`；页面可见完整中文译文样本，无 `translation_truncated_or_empty`、无“译文不完整”、无加载态。

剩余问题：

- 全文翻译仍是同步接口，长文会让用户等待 2-4 分钟；正式方案应接入异步 job/progress，像日报生成一样显示阶段、耗时、失败点和完成入口。
- 当前 `nginx` 超时提升只是短期缓冲，不能替代异步化。

## 优先修复计划

## 2026-07-03 修复验收：外链 RSS 可信分层与长代码阅读收口

目标：

- 避免把“外链型 RSS 的评论/摘要”误标成目标站完整正文。
- 保留 Daring Fireball 这类外链 RSS 的真实语义：来源负责发现和评论，目标站正文需要单独补抓。
- 修复 John D. Cook / Lean / 代码密集文章在阅读区横向撑开的问题。
- 确认 BestBlogs 无 `originalUrl` 时仍是“榜单摘要可读”，不伪装成全文。

已修复：

- `services/hub-engine/src/lib/reading-context.ts`
  - `ContentReadiness.kind` 新增 `external_link_summary`。
  - `ContentEvidenceLayer` 新增 `externalLinkSummary`。
  - 对 RSS/RSSHub 跨站条目增加 host 判断：当 `item.url` 与 `source.siteUrl/source.feedUrl/source.name` 明显不同，且没有可用 readability 正文时，标为“外链摘要可读”。
  - 已补到目标站 readability 正文的外链条目仍可标为“全文可读”，不因为 host mismatch 错降级。
- `apps/web/src/lib/feed-layout.ts`
  - `externalLinkSummary` 的翻译动作改为 `fetch_then_translate`，用户语言为“先补抓目标站正文，再翻译”。
  - 外链摘要在原文区用阅读化 Markdown 展示，不再裸露 RSS HTML 或技术字段。
- `apps/web/src/components/MarkdownContent.tsx`
  - 阅读正文中的 `pre/code` 改为自动换行，避免 Lean/数学/代码长行撑出横向滚动。

验证命令：

```bash
node --import tsx --test src/lib/reading-context.test.ts
node --test apps/web/test/feed-layout.test.ts apps/web/test/markdown-content-style.test.ts apps/web/test/readable-content.test.ts
npm run build # services/hub-engine
npm run build # apps/web
git diff --check
docker compose up -d --build hub-engine
docker cp apps/web/dist/. infohub-nginx:/usr/share/nginx/html/
docker exec infohub-nginx nginx -s reload
```

结果：

- `reading-context.test.ts`：21/21 通过。
- Feed 布局、Markdown 样式、可读内容测试：34/34 通过。
- `services/hub-engine npm run build` 通过。
- `apps/web npm run build` 通过。
- `git diff --check` 通过。
- Docker 本地栈：`infohub-engine` healthy，`infohub-nginx` healthy。

真实页面抽测：

```bash
python3 /tmp/infohub_feed_quality_probe.py
```

抽测样本：

- `http://localhost/feed/95f38db5-2d16-4c1c-83c8-058a2d81b130?sourceId=1358`
  - 当前是 Daring Fireball 发现的 Gizmodo 目标站正文。
  - 因数据库已存在目标站 readability 正文，所以页面正确显示“全文可读”，并且翻译页能展示中文译文。
  - 截图：`output/playwright/feed-daring-translated-readable.png`
- `http://localhost/feed/0f78adb3-7401-4862-ad12-e21789c13b5e?sourceId=1358`
  - BestBlogs 无原站链接样本。
  - 页面显示“榜单摘要可读 / 打开原文”，没有伪装成完整原站正文。
  - 截图：`output/playwright/feed-bestblogs-summary-open-original.png`
- `http://localhost/feed/80ade039-5f5a-4486-9f24-bbe2a9ccae19?sourceId=806`
  - John D. Cook 长代码样本。
  - 页面无横向溢出，Lean 代码块可读。
  - 截图：`output/playwright/feed-johndcook-long-code.png`

浏览器验收结果：

- `scrollWidth == clientWidth`，三条样本均无横向溢出。
- 页面正文未出现 `externalLinkSummary / curatedSummary / translation_truncated_or_empty / content_unavailable / readability_failed` 等 raw enum。
- Console 无 error。
- 路由快速切换时存在旧请求 `ERR_ABORTED`，目前判断为浏览器取消上一个详情请求，不是用户可见错误；后续若做严格网络验收，应把这种导航取消与真实失败分开统计。

剩余问题：

- Feed 顶部筛选和来源栏仍占据较大空间，阅读比例已经改善但还没达到 Folo/QMReader 参考图的沉浸程度。
- BestBlogs 的根问题仍是大量条目没有 `originalUrl`；本轮只保证“不装成全文”，下一步仍要提高原站链接解析率和补抓率。
- 全文翻译已能异步执行，但长文模型输出质量仍需要继续用黄金样本矩阵监控。

## 2026-07-03 修复验收：BestBlogs 原站链接解析与重复条目回填

目标：

- 让 BestBlogs 条目不长期停留在“榜单摘要可读”，尽可能解析出原站链接。
- 重新抓取时，即便条目是重复项，也能补齐 `originalUrl / curationUrl / curationSource / curationMeta`。
- 不因为补齐 provenance 就覆盖旧正文、旧摘要或旧翻译。

根因：

- `BestBlogs Daily Brief` 公开 brief API 不稳定提供原站链接，很多条目只有 BestBlogs 内部详情页。
- 现有 resolver 只识别少数字段，不能解析 App Router / Next payload 中的 `articleUrl/articleLink/targetUrl`，也不能解包 `/redirect?url=...`。
- 采集 pipeline 对重复项只在“新正文明显更丰富”时更新；如果只是补齐 `originalUrl`，旧条目不会升级。

已修复：

- `services/hub-engine/src/collectors/webpage-index.ts`
  - `resolveBestBlogsOriginalUrlFromHtml` 支持多层转义的 App Router payload。
  - 新增识别 `articleUrl / articleLink / targetUrl / targetLink`。
  - 支持解包 BestBlogs outbound tracking 链接中的 `url / u / target / to / redirect` 参数。
  - 避免把 `siteUrl` 这种站点首页误当成单篇原文。
- `services/hub-engine/src/lib/duplicate-content-upgrade.ts`
  - 新增 `shouldUpgradeDuplicateProvenance`，重复条目在旧 `originalUrl` 为空、新抓取解析到原站链接时允许元数据升级。
- `services/hub-engine/src/scheduler/pipeline.ts`
  - 重复条目不替换正文时，也会补齐 provenance 字段。
  - 保留旧 `curationSource/curationMeta`，不因 incoming 字段为空而抹掉已有信息。
- `services/hub-engine/src/collectors/rss.ts`
  - 旧 BestBlogs RSS 源中 `bestblogs.dev/article/...` 详情页支持解析原站链接。
  - 只对 BestBlogs article URL 生效，并设置每次最多 8 条的小预算，避免普通 RSS 调度被拖慢。

验证命令：

```bash
node --import tsx --test src/collectors/webpage-index.test.ts src/lib/duplicate-content-upgrade.test.ts src/lib/content-upgrade-policy.test.ts
node --import tsx --test src/collectors/rss.test.ts src/collectors/webpage-index.test.ts
npm run build # services/hub-engine
docker compose up -d --build hub-engine
```

结果：

- BestBlogs/webpage-index/duplicate/content-upgrade 相关测试：21/21 通过。
- RSS + webpage-index collector 测试：15/15 通过。
- `services/hub-engine npm run build` 通过。
- Docker 重建后 `infohub-engine` healthy。

真实数据验证：

```bash
POST /api/fetch/source/1358?mode=sync&contentLimit=0&aiLimit=0&translationLimit=0
```

结果：

- 源：`BestBlogs Daily Brief`
- `itemsFound=23`
- `itemsNew=0`
- `itemsDuplicate=23`
- `itemsUpdated=12`
- `aiProcessed.filtered/scored/summarized/translated = 0`，本轮没有额外消耗模型。
- 数据库统计：
  - 修复前：`source_id=1358` 的 `original_url` 命中数为 0。
  - 修复后：`source_id=1358` 的 `original_url` 命中数为 12。

样例：

| 标题 | 解析到的原站链接 |
|---|---|
| Senior SWE-Bench | `https://senior-swe-bench.snorkel.ai/` |
| 如何将 AI 编程的混乱转化为可复制的实战手册？ | `https://stackoverflow.blog/2026/07/02/ai-coding-chaos-into-a-repeatable-playbook/` |
| GitHub 如何利用密钥扫描实现“收件箱清零” | `https://github.blog/security/application-security/how-github-used-secret-scanning-to-reach-inbox-zero/` |
| Amazon SageMaker AI 中多轮强化学习的最佳实践 | `https://aws.amazon.com/blogs/machine-learning/best-practices-for-multi-turn-reinforcement-learning-in-amazon-sagemaker-ai/` |

边界说明：

- `source_id=367 / BestBlogs.dev` 属于 `reise@infohub.local`，当前验收 token 是 `acceptance.admin@infohub.local`，接口按权限正确返回 `Source not found`；本轮没有跨用户直接写入该源。
- 该旧 RSS 源的代码路径已经支持原站链接解析，后续用对应用户或后台调度重新抓取时才能回填。

## 2026-07-02 修复验收：全文翻译异步任务化

目标：

- 解决 `translate-full` 同步请求等待过久、用户看不到进度、可能被 nginx 504 截断的问题。
- 保留旧同步接口兼容；前端点击主按钮默认走异步任务。

已修复：

- 后端新增 `item-translation` BullMQ 队列。
- 新增 `GET /api/items/translate-full/jobs/:jobId`，返回 `state / stage / percent / message / result`。
- `POST /api/items/:id/translate-full` 支持 `{ "async": true }`，立即返回 `jobId` 和 `pollUrl`。
- `runFullItemTranslation` 抽成共享服务，同步接口和 worker 走同一条“补抓正文 -> 准备翻译 -> 分块翻译 -> 保存译文”逻辑。
- 前端 Feed 点击“一键翻译全文/补抓原文并翻译”后创建异步任务，轮询显示阶段进度，完成后刷新当前文章。

真实验证：

- 样本：`6ce0e974-bc99-433e-8909-440150f9f3e2`
- 真实标题：`TCS and Anthropic partner to bring Claude to regulated industries`
- 注意：这个 deep link 的 `sourceId=1354` 是 Anthropic Newsroom，不是 OpenAI Nextdoor；这再次证明后续还要单独收口 deep-link/source 上下文错觉。
- API 创建任务立即返回：
  - `jobId=item_translation_fe07349f-480e-48ed-99ac-73b4ddc8737a_6ce0e974-bc99-433e-8909-440150f9f3e2`
  - `status=active`
- 轮询阶段可见：
  - `fetching_content 25%：正在检查并补抓原站正文。`
  - `translating 62%：正在分块翻译全文。`
  - `completed 100%：全文翻译已完成。`
- 最终条目状态：
  - `translationStatus=ready`
  - `translationCompleteness.complete=true`
  - `basisLength=4460`
  - `translatedLength=1636`
  - `chunkCount=3`
  - `translationLen=1655`

验证命令：

```bash
node --import tsx --test src/lib/item-translation-progress.test.ts src/lib/item-enrichment.test.ts src/processors/ai-summarizer.test.ts
npm run build # services/hub-engine
npm run build # apps/web
docker compose up -d --build hub-engine
docker cp apps/web/dist/. infohub-nginx:/usr/share/nginx/html/
docker exec infohub-nginx nginx -t && docker exec infohub-nginx nginx -s reload
```

结果：

- 后端小范围回归：29/29 通过。
- `services/hub-engine npm run build` 通过。
- `apps/web npm run build` 通过。
- `git diff --check` 通过。
- `infohub-engine / infohub-nginx / infohub-redis` 均 healthy。

剩余问题：

- 前端 Playwright 对 `http://localhost/feed/6ce0e974-bc99-433e-8909-440150f9f3e2?sourceId=1354` 的截图验证不稳定，原因是 deep-link 与来源筛选上下文会影响详情选中；API 明确显示该 item 真实来源为 Anthropic Newsroom。下一步应优先修 `feed/:id?sourceId=` 的详情选中与来源上下文展示。
- 自动 enrich 和翻译任务可能并发出现在同一 item 上；本轮最终状态正确，但后续需要加“同一 item 阶段互斥/防覆盖”机制，避免摘要、补正文、翻译互相重置。

## 2026-07-02 修复验收：Feed 深链来源上下文自动纠偏

问题：`/feed/:id?sourceId=...` 中的 `sourceId` 是列表筛选上下文，不是文章归属。深链文章真实来源与 URL 中的来源筛选不一致时，页面会保留错误筛选，导致左侧来源、文章队列和右侧详情看起来互相矛盾，用户会误以为正文抓错来源。

修复：

- 新增 `resolveFeedDetailSourceContext`，明确判断深链详情是否需要清理过期来源筛选。
- `fetchDetail` 在深链进入时会把真实详情插入当前文章队列顶部；即使列表原本被其他来源过滤，目标文章也不会只出现在右侧孤岛。
- 当 `selectedItem.sourceId` 与 URL `sourceId` 不一致时，前端自动清除 URL 中的 `sourceId`，并给出一条短提示，避免继续污染列表和刷新状态。

验证：

- `node --test apps/web/test/feed-layout.test.ts`：25/25 通过。
- `apps/web npm run build` 通过。
- Docker nginx 已同步最新 `dist` 并 reload。
- Playwright 真实栈验收：
  - 输入：`http://localhost/feed/6ce0e974-bc99-433e-8909-440150f9f3e2?sourceId=806`
  - 输出 URL：`http://localhost/feed/6ce0e974-bc99-433e-8909-440150f9f3e2`
  - `sourceIdCleared=true`
  - `hasTargetTitle=true`
  - `hasRealSource=true`
  - `hasWrongFilterChip=false`
  - `consoleErrorCount=0`
  - 截图：`qa/reports/feed-deeplink-source-filter-fixed.png`

### P0：索引/榜单阅读降噪

目标：BestBlogs / webpage_index 条目不再把榜单 URL、榜单页、评分等元数据当正文主内容展示。

建议改动：

- Feed 原文区对 `contentReadiness.kind=curated_summary/index_summary` 使用专用阅读组件。
- 元数据移动到“来源信息”或右侧工具栏。
- 正文主区只展示榜单摘要、为什么值得看、打开榜单/原站按钮。
- 如果 `originalUrl` 缺失，主按钮是“打开榜单页”而不是“全文阅读”。

### P0：翻译完整性收口

目标：英文长文不再显示“已翻译但只有几百字”。

建议改动：

- 对 `translation_too_short_for_long_source` 批量标记为 failed 或 incomplete。
- Feed 翻译页显示“一键精译全文/补全译文”，而不是“翻译已完成”。
- `translate-full` 必须写入 `translationCompleteness.complete=true/false`。
- 日报引用英文长文时优先用摘要和原文链接，不能用短译文冒充完整译文。

### P1：外链型 RSS 来源解释

目标：Daring Fireball 这类外链型 RSS 不再被误判为错源。

建议改动：

- 来源健康新增 `external_link_feed` 标签。
- Feed 详情显示“来源：Daring Fireball；原文站点：MacRumors”。
- host mismatch 只在非外链型来源中升为告警。

### P1：网页快照/监控样本补齐

目标：黄金样本矩阵 12 类不缺样本。

建议改动：

- 找一个真实网页监控源保留为 `webpage snapshot` 样本。
- Feed 中明确标为“网页监控快照”，默认不进入深读和日报主线。

## 下一步行动

先修 P0 两项：索引/榜单阅读降噪、翻译完整性收口。修完后重跑：

```bash
node qa/p0/audit_rss_link_content_matrix.mjs --max-items all --detail-limit 260
node qa/p0/golden_sample_matrix.mjs --api http://127.0.0.1:3001/api --output qa/reports/golden-sample-matrix-latest.md
node --test apps/web/test/feed-layout.test.ts apps/web/test/readable-content.test.ts apps/web/test/feed-diagnostics.test.ts
```

## 2026-07-03 修复验收：Feed 顶部压缩与阅读宽度回收

问题：Feed 三栏结构已经成立，但顶部工作台控件和详情右侧低频诊断栏仍抢占阅读空间。1920px 桌面下，右侧诊断栏过早并排会把正文卡压到约 694px，低于长文阅读需要的 760-820px。

修复：

- Feed 顶部从多层卡片压缩为单行工具带，搜索、状态、筛选、排序和低频动作收在同一条工具栏。
- 工作台桌面高度预算从 `100dvh - 7.5rem` 调整为 `100dvh - 5.75rem`，避免红框区域占掉首屏阅读高度。
- 低频工具与诊断侧栏从 `1800px` 断点推迟到 `2100px`，普通桌面不再横向挤压正文，仍保留折叠入口。

验证：

- `node --test apps/web/test/feed-layout.test.ts`：27/27 通过。
- `npm run build` in `apps/web` 通过。
- Docker nginx 已同步最新 `dist` 并 reload。
- Playwright 真实栈验收：
  - `/feed`：顶部工具带高度 56px，工作台从 y=72 开始，无横向溢出。
  - `/feed/6fbec8eb-decf-42b3-a175-3382dc39160d`：正文卡宽度 820px，低频侧栏在正文下方，页面无横向溢出，无 `translation_truncated_or_empty/content_unavailable/summary_must_be_chinese` raw enum 暴露。
  - 截图：`output/playwright/feed-compact-topbar-final-1920.png`、`output/playwright/feed-detail-readable-width-final-1920.png`。
