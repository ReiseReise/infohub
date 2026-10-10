---
title: 信息中枢 v3 设计日志
type: project-design-log
status: active
version: v0.4
updated: 2026-07-26
source_device: macpro-main
---

# 设计日志

## 2026-07-02

### 环境确认

- 目标项目：`共享工作台/项目集/基建/信息中枢-v3`
- 本地服务：Docker stack 运行中，`/api/health` 返回 `status=ok`。
- 前端捕获服务：Vite dev server `http://127.0.0.1:5173`
- Figma 文件：`https://www.figma.com/design/nFZbnEWt6FLIHTMSNvcPCj`

### 页面盘点

从 `apps/web/src/App.tsx` 确认需要覆盖的路由：

- 公开页：`/login`、`/register`
- 主页面：`/insights`、`/daily/workbench`、`/feed`、`/podcast`、`/audio`、`/sources`、`/monitor`、`/rules`、`/filtered`、`/export`、`/ai-usage`、`/reader-lab`、`/settings`
- 子页面：`/daily/workflows`、`/daily/candidates`、`/daily/reports/latest`、`/reader-lab/setup`、`/reader-lab/compare`
- 详情状态：`/feed/:id`

### Baseline 复制

- 生成桌面截图 21 张。
- 生成移动端核心截图 4 张。
- 截图保存到 `docs/design/screenshots/`。
- 截图上传并整理到 Figma `01 Baseline - Current`。

### Redesign v0.1

已在 Figma 中建立：

- `00 Cover / Sitemap`
- `02 Audit Notes`
- `03 Design System`
- `04 Redesign - Desktop`
- `05 Redesign - Mobile`
- `06 Handoff`

核心设计判断：

- 全局 Shell 从“导航清单”升级为“运行态控制台”。
- 首页从指标堆叠改为“今日判断 + 加工漏斗 + 待处理队列 + 证据 rail”。
- Feed 详情强调来源可信度、正文完整性、日报入选解释和后续动作。
- 移动端优先保留判断、证据和动作，复杂诊断下沉。

### 验收

- Playwright 成功访问全部目标路由，无导航错误。
- Figma 桌面 Redesign 节点可正常渲染。
- Figma 移动端关键流节点可正常渲染。
- Figma Baseline Feed Detail 节点可正常渲染。

### 边界

- 本轮没有修改业务代码。
- 本轮没有提交 Git。
- 当前仓库已有大量既有脏改动，本轮只新增 `docs/design/` 设计沉淀和全局 recent 指针。

### Redesign v0.2 修正

触发原因：

- Reise 指出 v0.1 更像复刻现状，仍有很多样式与信息暴露问题。
- 原 v0.1 只覆盖关键方向稿，没有形成所有页面都能开发落地的优化稿。

本轮修正：

- 新增 Figma 页面 `04B Redesign - All Pages IA`，覆盖 21 个路由。
- 新增 Figma 页面 `04C Redesign - Core Desktop Screens`，输出 8 张桌面核心模式屏。
- 新增 Figma 页面 `05B Redesign - Mobile Key Flows`，输出 5 张移动端关键流。
- 新增 Figma 页面 `06B Dev Handoff - Implementation Slices`，按 7 个实现切片交接。
- 新增 `briefs/full-page-redesign-v0.2.md`，明确本轮从“复刻”升级为“全页面信息暴露与布局优化”。
- 更新 `figma-links.md`、`handoff/design-code-map.md`、`README.md`。

核心设计判断：

- 全局 Shell 按“判断 / 加工 / 治理”重组，不再像普通工具列表。
- 每个页面首屏必须先暴露判断、状态或待处理动作。
- 信息详情必须保留 provenance 证据卡：来源、抓取、摘要、评分、入报/未入报依据。
- 信源、监控、规则、过滤池统一纳入“输入治理 / 误杀修复”工作流。
- 设置和模型用量从后台配置页转为治理中心。
- 移动端独立重排，禁止把桌面表格硬压缩到窄屏。

验证：

- Figma metadata 确认新增页面和节点存在。
- Figma screenshot 确认 `11:2`、`13:2`、`15:31`、`16:2` 可渲染。
- 截图证据已保存：
  - `screenshots/figma-redesign-v0.2-all-pages-ia.png`
  - `screenshots/figma-redesign-v0.2-desktop-insights.png`
  - `screenshots/figma-redesign-v0.2-mobile-feed-detail.png`
  - `screenshots/figma-redesign-v0.2-dev-handoff.png`

### Redesign v0.3 逐页修正

触发原因：

- Reise 反馈 v0.2 仍然像复刻和抽象模式稿，没有逐页考虑现有 UI 错误。
- 关键问题包括：`/feed` 右侧详情空白、`/feed/:id` 证据链和动作太弱、`/insights` 重复列表挤占判断、`/sources` 仍偏入口堆叠。

本轮动作：

- 新建 Figma 页面 `04D Redesign - Page by Page v0.3`。
- 逐页输出 22 张 1440 x 1000 实际页面稿，不再只用矩阵或模式卡。
- 新增 `briefs/page-by-page-redesign-v0.3.md`，记录每个路由的 Figma 节点和核心优化。
- 更新 `README.md`、`figma-links.md`、`memory.md`、`handoff/design-code-map.md`。

覆盖页面：

- `/login`、`/register`
- `/insights`
- `/feed`、`/feed/:id`
- `/daily/workbench`、`/daily/workflows`、`/daily/candidates`、`/daily/reports/latest`
- `/reports`
- `/podcast`、`/audio`
- `/sources`、`/monitor`
- `/rules`、`/filtered`
- `/export`、`/ai-usage`
- `/reader-lab`、`/reader-lab/setup`、`/reader-lab/compare`
- `/settings`

验证：

- Figma 统计确认 `04D Redesign - Page by Page v0.3` 下有 22 张 `v0.3 page / ...` frame。
- Figma screenshot 抽样确认以下节点可渲染：
  - `/insights` `21:56`
  - `/feed/:id` `21:246`
  - `/sources` `23:174`
- 截图证据已保存：
  - `screenshots/figma-redesign-v0.3-insights.png`
  - `screenshots/figma-redesign-v0.3-feed-detail.png`
  - `screenshots/figma-redesign-v0.3-sources.png`

开发判断：

- v0.3 之后，页面实现优先看逐页稿，不再从 Baseline 截图或 v0.2 模式屏直接开发。
- P0 开发应先做 `/feed`、`/feed/:id`、`/insights`。

### Figma 中文命名与当前入口清理

触发原因：

- Reise 指出 Figma 左侧仍显示英文页面名，且容易误点旧 Baseline 页面。
- 当前需求明确不需要移动端，应从本轮设计中去掉移动端入口。

本轮动作：

- 将 Figma 页面结构统一改为中文命名。
- 将当前主入口提升为 `01 最新设计｜桌面逐页重设计 v0.3`。
- 将旧 Baseline 改为 `99 归档｜当前版本截图基线`，明确只做旧版对照。
- 删除当前 Figma 文件中的移动端设计页：`05 Redesign - Mobile`、`05B Redesign - Mobile Key Flows`。
- 在最新设计页顶部新增 `说明｜最新设计入口`，明确开发不要再从旧基线进入。
- 将 22 张页面稿统一命名为 `页面稿｜中文页面名｜路由`。

验证：

- Figma 页面列表确认只有中文页面名和归档页。
- 当前最新设计页确认有 23 张 frame：1 张入口说明 + 22 张桌面页面稿。
- Figma 检查确认移动端页面列表为空。
- 新增截图证据：
  - `screenshots/figma-redesign-v0.3-latest-entry-guide.png`
  - `screenshots/figma-redesign-v0.3-insights-after-cleanup.png`

## 2026-07-03

### Redesign v0.4 高密度精修

触发原因：

- Reise 反馈 v0.3 信息密度不如原版，样式也没有原版好看。
- 新方向明确为：在原版高密度骨架上做样式升级和层级控噪，不继续摘要化。

本轮动作：

- 新建 Figma 页面 `01 最新设计｜高密度精修 v0.4`。
- 将 `01 最新设计｜桌面逐页重设计 v0.3` 归档为 `94 归档｜桌面逐页重设计 v0.3`。
- 输出 6 张核心桌面页：
  - `/insights` `42:2`
  - `/feed` `42:180`
  - `/feed/:id` `45:2`
  - `/daily/workbench` `45:132`
  - `/sources` `46:2`
  - `/settings` `46:189`
- 重新整理 Figma 页面顺序：当前设计、开发交接、设计系统在前，归档页在后。
- 保持移动端页面不恢复。

核心设计判断：

- 信息密度不再降低；保留原版指标、列表、表格、双列内容和真实样本。
- 通过 Tab、折叠、右侧 rail、chips、密度切换按钮控制页面整洁度。
- `/feed` 默认态必须有列表、详情预览和右侧证据 rail，不再留空白。
- `/feed/:id` 必须同时看到正文、证据、动作和入报解释。
- `/sources` 与 `/settings` 的低频配置进入折叠层，不从页面中删除。

验证：

- Figma metadata 确认 v0.4 页存在，包含 1 张入口说明和 6 张核心页面稿。
- Figma 检查确认移动端页面列表为空。
- 6 张核心页面截图均为 1440 x 1000，已保存：
  - `screenshots/figma-redesign-v0.4-insights.png`
  - `screenshots/figma-redesign-v0.4-feed.png`
  - `screenshots/figma-redesign-v0.4-feed-detail.png`
  - `screenshots/figma-redesign-v0.4-daily-workbench.png`
  - `screenshots/figma-redesign-v0.4-sources.png`
  - `screenshots/figma-redesign-v0.4-settings.png`
- 抽样视觉检查后修正 `/feed/:id` 右侧证据卡和底部动作裁切问题。

### Redesign v0.5 阅读优先全页面

触发原因：

- Reise 反馈 v0.4 比例仍不对：文章、正文和主内容没有足够突出，次级信息应该视觉弱化。
- Reise 提供三栏阅读器参考图，希望支持大信息量滑动切换，并指出 v0.4 只覆盖部分页面。

本轮动作：

- 新建 Figma 页面 `01 最新设计｜阅读优先全页面 v0.5`。
- 将 `01 最新设计｜高密度精修 v0.4` 归档为 `93 归档｜高密度精修 v0.4`。
- 按 `apps/web/src/App.tsx` 全路由输出 22 张桌面页面稿。
- 新增设计说明 `briefs/page-by-page-redesign-v0.5.md`。
- 更新 `README.md`、`figma-links.md`、`memory.md`、`handoff/design-code-map.md`、`handoff/figma-mcp-handoff.md`、`acceptance/ui-acceptance-checklist.md`。

核心设计判断：

- 阅读类页面采用参考图比例：左侧导航/分类约 15%，中间文章列表约 22%，右侧正文/主阅读区约 63%。
- `/feed` 和 `/feed/:id` 必须让正文成为最大视觉区域，AI 总结、进度、Ask AI 和动作入口弱化为辅助层。
- 治理类页面保留主表格或主队列，右侧只承载选中对象上下文，低频配置和日志折叠。
- 全路由页面稿都使用中文命名；本轮仍不恢复移动端。

验证：

- Figma metadata 确认 v0.5 页存在，包含 1 张入口说明和 22 张桌面页面稿。
- Figma MCP 抽样截图验证 `/feed`、`/feed/:id`、`/settings` 三页比例成立。
- `/feed` 与 `/feed/:id` 可同时看到左侧分类、中间文章流、右侧大正文和弱化 AI 辅助层。
- `/settings` 可看到主表格与右侧对象上下文，次级配置没有抢主视觉。

### Redesign v0.6 现有融合精修纠偏

触发原因：

- Reise 反馈 v0.5 与现有信息中枢差别过大，只是复刻参考图，没有与当前页面融合。
- v0.5 侧边栏错误地借用了参考阅读器的订阅分类心智，而不是信息中枢现有 `Sidebar.tsx` 的导航。
- v0.5 虽覆盖 22 个路由，但产品结构、页面功能和现有代码心智融合不足。

本轮动作：

- 新建 Figma 页面 `01 最新设计｜现有融合精修 v0.6`。
- 将 `01 最新设计｜阅读优先全页面 v0.5` 归档为 `92 归档｜阅读优先全页面 v0.5（方向错误）`。
- 按 `apps/web/src/App.tsx` 全路由重做 22 张桌面页面稿。
- 侧边栏恢复为当前产品导航：成长仪表板、日报、信息流、播客专栏、音频工坊、信源管理、网页监控、过滤策略、过滤池、导出、模型用量、阅读实验室、设置。
- 参考图只保留原则：文章/正文突出、次级信息弱化、大信息量靠滚动、折叠、Tab 和右侧 rail 承载。
- 清理 Figma 中残留的外部参考图来源文本 `BestBlogs.dev`。
- 新增 `briefs/page-by-page-redesign-v0.6.md`，并更新 README、Figma 链接、MCP handoff、设计到代码映射、项目记忆和验收清单。

验证：

- Figma MCP 校验 v0.6 页面包含 1 张说明 + 22 张桌面页面稿，`missing=[]`。
- Figma MCP 校验 `/feed` 侧边栏 13 个现有导航项齐全，`sidebarMissingInFeed=[]`。
- Figma MCP 校验外部参考图残留文本已清理，`residues=[]`。
- 抽样截图验证 `/feed`、`/feed/:id`、`/settings`：侧边栏为信息中枢真实导航，主内容突出，次级证据与配置弱化。
- v0.5 已在文档和 Figma 中标记为方向错误归档，不再作为当前开发入口。

## 2026-07-26 页面收口批次一：从视觉层转向字段语义层

变更：

- 确立本轮设计判据：**前 6 版 redesign 与 7 次移动端修补均停留在视觉层，而页面的核心问题是字段不诚实**。因此本轮改的是字段语义、数据来源与展示口径，不做整体视觉重做。
- Feed 桌面端自动选中首条。此前 1600px 宽屏下详情区（2/3 版面）在未选中时整片空白，与 `figma-redesign-v0.4-feed` 的三栏设计意图相悖。窄屏保持"列表 → 详情"导航模式不变。
- Feed 列表卡片补入决策字段（信号等级 / AI 评分 / 内容就绪）。默认 comfortable 视图此前只渲染 7 个字段，是三种视图中信息最少的一个，用户必须逐条点开才能判断是否值得读；而 `DenseCard` 早已展示这些数据，属展示层不一致而非数据缺失。
- 日报工作台区分"预计入报"与"已入报"。同名不同义（漏斗预测 vs 报告实际保存）是口径矛盾的表层成因，深层成因 `itemCount = newItems` 的 8 处写入点留待 `UI-007` 处理。
- 移除 6 个无行为分支的假开关，补上真实生效却无 UI 的 `requireChinese`。判据是"后端是否存在 `if (config.X === ...)` 行为分支"，只有类型定义、默认值与归一化不算生效。
- 内部处理状态（`本地兜底`）不再作为内容主题展示，后端过滤 + 前端历史数据兜底。
- 接回评分链路健康诊断与一键修复入口。

设计原则沉淀：

- **字段必须诚实**：给用户看的每个数字要能回答"它属于哪个时钟（实时/快照）、哪一层、分母是谁"。同名不同义比缺失更有害。
- **假开关比无效字段更糟**：提供选项却不改变行为，是在欺骗用户。上线前判据是"是否存在行为分支"。
- **默认视图必须是信息最完整的那个**：用户不该为了做筛选决策而逐条点开。
- **内部处理状态不是内容属性**：诊断用的标记（兜底、待补、失败原因）不能混进主题、标签这类内容字段。
- **诊断能力必须有界面出口**：后端算出的健康状态与修复建议，如果没有 UI 承载，等于不存在——本轮实测到评分模型熔断 8 天无人知晓，正是这条原则失守的代价。

验证：

- 桌面 1600px `/feed` 右侧不再空白（正文 3,222 → 13,653 字符）；移动 375px 仍停在列表页。
- 卡片实测显示「A级分析 / 58 分 / 全文」。
- 工作台不再同屏出现两个含义不同的"入报"数字；`本地兜底` 不再出现在页面文本中。
- 配置页只剩 `入报数量 / 最低精选分 / 单源上限 / 最新兜底 / 强制中文化` 五项真实生效配置。
- `/admin` → 评分 Skills 顶部显示熔断告警与修复按钮。
- 前后端单测全通过，全栈 10/10 healthy。

未完成（留待后续批次）：

- `UI-007` 数据写入侧统一 `savedItemCount`（口径矛盾的根治）。
- `UI-008` 首页双时钟重排与转化漏斗组件（参考图中 `94→45→42→38→17` 的分层转化展示）。
- `UI-009` 删除 Feed 4 个不可达 section 与死 helper。
- 设计 token 债务：`zinc-*` 2385 次 vs 语义 token `neutral-*` 62 次。本轮采用增量护栏思路（新增代码用语义 token），不做全局重刷。
