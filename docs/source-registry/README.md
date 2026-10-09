# 信息中枢原始信息源注册表

这个目录维护“人工确认过的原始信息源链接”，不从系统导出反推。

用途：

- 记录每个来源最初的 URL、类型、分层、标签和使用意图。
- 支撑后续信息源清洗，避免数据库里抓取、导入、去重后的状态污染源头判断。
- 新增来源时先写 `raw-sources.json`，再导入系统。

边界：

- 这里不是运行态统计，不记录抓取成功率、日报命中率、AI 状态。
- 这里不是系统导出文件；系统导出的 OPML/CSV 只能作为对照，不能覆盖本注册表。
- 私密邮箱、账号态页面、临时测试源不要直接写入；确需记录时先脱敏。

## 冷启动精简集

- `high-value-rss.json` 是人工筛选的高价值 RSS 真源，数量必须不超过 50。
- `high-value-rss.opml` 是由上述 JSON 生成的导入载体，可以重建，不反向覆盖 JSON。
- `collection=core_analysis` 用于长文精读；`collection=news_radar` 用于高可信快讯扫读。
- 冷启动集只收 RSS/Atom；邮箱、网页监控、榜单和其它独特通道应走独立脚本或连接器。

## 外部参考源候选库

- `reference-source-catalog.json` 累计记录 QMReader、Follow Builders、AI HOT 和源头信息员的公开来源线索，供人工筛选，不属于运行态来源。
- `reference-source-catalog.csv` 是同一候选库的人工审阅视图，完整保留全部候选、订阅地址、站点地址和证据地址；它由公开候选真源生成，不是从信息中枢数据库导出的运行数据。
- `reference-source-decisions.json` 只记录 Reise 已做出的人工选择。未列出的候选一律视为“待决定”；`observing` 只表示隔离观察，不等于正式订阅。
- `adopted-reference-sources.json` 是“从外部参考项目正式吸收了哪些源”的独立维护清单。当前为空；只有 Reise 明确确认 `active` 后才能追加。
- 候选库中的所有条目都固定为 `defaultEnabled=false`；刷新文件不会导入、启用、暂停或修改数据库中的来源。
- 当前累计共 260 个候选：QMReader 61、Follow Builders 35、AI HOT 159、源头信息员 5；其中 256 个是当前公开观测，4 个是历史观测，64 个具有可直接使用的 RSS/播客订阅地址。
- `reference-source-catalog.csv` 同步展示每个候选的人工决定、运行状态、正式订阅和决定理由，便于离线审阅；页面仍是日常选择入口。
- 单个 X 账号、微信公众号、网页索引和 AI HOT 观测到的单源标签完整保留。Follow Builders X 精选已提供独立适配器，其余未适配来源保持“待适配”或“仅记录”。
- 页面中的候选导入必须由用户逐项勾选，单次最多 5 个；服务端只接受候选 `key`，不会信任前端提交的任意 URL 或来源配置。
- 调度容量分为三个门槛：影子参考源最多 10 个、正式参考源最多 5 个、总调度来源最多 31 个；影子转正式不会重复占用总调度容量。
- 候选库不会覆盖 `raw-sources.json`。只有用户确认纳入长期维护的来源，才应另行写入原始来源注册表。
- 刷新时不再删除上游暂时消失的来源；它们会保留并标记为 `historical`，不会自动导入。
- 第三方归属、许可证和复用边界见 `../37-第三方参考与订阅源归属清单.md`。

### 四层清单与唯一写入边界

| 清单 | 记录什么 | 谁可以改变 | 是否创建运行中来源 |
|---|---|---|---|
| `reference-source-catalog.json/.csv` | 外部参考项目里观测到的全部候选订阅源和来源线索 | 刷新脚本只更新公开观测证据；不得改人工决定 | 否 |
| `reference-source-decisions.json` | Reise 对候选做出的 `undecided / observing / active / paused / removed` 决定 | 仅人工选择流程 | 否 |
| `adopted-reference-sources.json` | 已由 Reise 明确确认、从候选库正式吸收的订阅源 | 仅正式采纳流程；shadow 不得写入 | 否 |
| `raw-sources.json` | 信息中枢长期维护、可用于重建的原始来源真源 | 正式采纳或人工维护流程 | 否；导入动作另行执行 |

候选目录必须完整保留，不因当前不想订阅而删除。Reise 在页面或离线 CSV 中选择后，系统才允许进入 shadow；只有再次明确确认正式启用，才同步维护正式采纳清单和原始来源真源。任何刷新、预览和质量观察都不能替 Reise 自动完成这一步。

### 吸收与维护规则

- `available`：只记录在候选目录，不创建运行中信源。
- `shadow`：允许抓取和质量观察，但不进入普通 Feed、日报或未读数。
- `active`：只能由 Reise 确认后进入正式订阅。运行配置必须保留 `referenceCatalogKey`、`referenceProvider` 和 `attribution`，以便追溯到原参考项目。
- 正式纳入长期维护的来源，在同一个维护批次追加到 `adopted-reference-sources.json` 和 `raw-sources.json`；原始源条目的 `provenance` 应记录 `referenceCatalogKey`、`provider`、`sourceUrl`、`adoptedAt` 和人工决策理由。
- 人工决定的维护顺序固定为：先更新 `reference-source-decisions.json`，再执行 shadow/active 生命周期；只有正式确认 `active` 后才同步写入 `adopted-reference-sources.json` 和 `raw-sources.json`。候选刷新脚本不得覆盖这三个人工文件。
- 暂停、移出或刷新候选库都不删除原始候选记录；原项目仍是来源归属证据。
- 影子观察使用只读命令 `node scripts/source-registry/capture-reference-shadow-observation.mjs`；脚本只读取鉴权目录并把快照写入 `output/source-archive/2026-07-20-reference-shadow-start/observations/`，不会启用、暂停或删除来源。
- 质量口径分开记录：`主题相关率` 的分子只计入主池中 `quality_decision=pass` 的明确已评估条目，`quality_decision=NULL` 不得被视为 pass；`AI 处理率` 表示已有评分或标签。两者不可互相冒充，且 AI 处理率低于 60% 时不具备启用资格。
- 达到所有质量阈值只表示 `eligibleForActivation`；仍必须由 Reise 显式调用人工 `POST /enable` 才能切换生命周期，系统永不自动切换为 `active`。
- 日报对比使用只读命令 `node scripts/source-registry/capture-reference-daily-comparison.mjs`；脚本同时记录当前运行稿和最新已发布日报，并逐条校验正式正文中的 `/feed/:id` 链接。它不会触发日报生成，也不会修改参考源生命周期。
- 日报对比快照写入 `output/source-archive/2026-07-20-reference-shadow-start/daily-comparisons/`。当天运行稿若仍为降级草稿，会如实保留，但不会冒充正式日报。

刷新命令：

```bash
node scripts/source-registry/refresh-reference-source-catalog.mjs
```

只重建 5 个静态源头信息员入口并保留其余候选观测时间：

```bash
node scripts/source-registry/refresh-reference-source-catalog.mjs --origin12-only
```

刷新脚本读取公开 API/仓库配置，保留候选文件里已有的人工备注和选择判断，并重新写入来源证据与观测时间，同时重建人工审阅 CSV。网络失败时应保留上一版文件，不用不完整结果覆盖候选库；人工选择账本与正式原始来源注册表永远不由刷新脚本改写。

一致性校验：

```bash
node scripts/source-registry/validate-reference-source-adoptions.mjs
```

## Follow Builders X 精选

- 在“信源管理 → 打开候选源”中搜索 `Follow Builders X 精选`，点“预览”读取当日公开帖文；预览不创建来源、写入文章或调用模型。
- 以一个聚合来源限定 karpathy、swyx、bcherny、trq212、steipete 五个账号。上游每天更新，调度定义为每 6 小时检查，最多 15 条；单次快照不保证覆盖完整时间线。
- 适配器固定读取上游 `feed-x.json`，不加载远程提示词或执行上游脚本。超出 48 小时、未来时间、错误结构或上游错误均明确失败，不用旧缓存冒充新内容。
- 帖文须有匹配作者/帖子 ID 的 HTTPS 原文链接和有效发布时间；过滤缺少引用上下文的转引、显式回复、短文字和未命中 AI/Agent 关键词的内容。保留文字归因及缺少附件/完整讨论串的说明；筛选不是事实核验。
- 帖子 ID 和规范原文 URL 稳定，继续使用现有入库去重。原文时间与快照生成时间分开记录；零条有效结果与上游失败分开。
- 候选键为 `follow_builders:feed:x-selected`，默认关闭。正式采纳仍遵循已有 7 天门禁及人工决定；运行决定和当前验收状态只在 [36 号文件](../36-信息中枢V3可信可用收口任务跟踪.md) 维护。
