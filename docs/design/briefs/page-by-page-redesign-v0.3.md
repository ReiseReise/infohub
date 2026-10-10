---
title: 信息中枢 v3 逐页重设计说明 v0.3
type: design-brief
status: archived
version: v0.3
updated: 2026-07-02
source_device: macpro-main
---

# 信息中枢 v3 逐页重设计说明 v0.3

> 归档说明：v0.3 只作为结构参考。当前设计真源是 Figma `01 最新设计｜高密度精修 v0.4`，详见 `page-by-page-redesign-v0.4.md`。

## 为什么补 v0.3

v0.2 解决了全局信息架构和开发切片，但仍偏蓝图化。v0.3 改为逐页输出实际 1440 x 1000 页面稿，避免把 Baseline 里的 UI 问题继续带入开发。

## 设计真源

- Figma 页面：`01 最新设计｜桌面逐页重设计 v0.3`
- Figma 入口说明：`https://www.figma.com/design/nFZbnEWt6FLIHTMSNvcPCj?node-id=29-2`
- Figma 页面 URL：`https://www.figma.com/design/nFZbnEWt6FLIHTMSNvcPCj?node-id=20-2`
- 覆盖数量：22 张页面稿，包含登录/注册、21 个业务路由和 `/reports` 归档页。
- 本轮口径：只做桌面端；移动端页面已从当前 Figma 结构删除。

## 逐页覆盖

| 路由 | Figma node | 核心优化 |
|---|---:|---|
| `/login` | `21:2` | 从普通表单改为产品信任入口，说明“判断、证据、本地优先”。 |
| `/register` | `21:28` | 保留最小注册表单，弱化营销内容，强化内部账号边界。 |
| `/insights` | `21:56` | 删除重复长列表心智，首屏改为今日判断、处理漏斗、下一步队列。 |
| `/feed` | `21:151` | 修正半屏空白详情问题，改为今日队列、来源健康、预览证据、修复 rail。 |
| `/feed/:id` | `21:246` | 详情页先给一句判断、provenance 证据卡、动作组和入报解释，再进入阅读区。 |
| `/daily/workbench` | `22:2` | 从彩色统计卡堆叠改为日报生产台，直接回答能不能生成和先修什么。 |
| `/daily/workflows` | `22:97` | 从说明页改为链路状态页，展示每一步输入、输出、失败点和重跑动作。 |
| `/daily/candidates` | `22:188` | 候选页改为编辑台，每条候选都解释入报/排除理由。 |
| `/daily/reports/latest` | `22:279` | 最新日报先给结论、证据索引和导出动作，长文下沉到阅读区。 |
| `/reports` | `22:342` | 历史报告按主题、质量、证据完整度、导出状态组织。 |
| `/podcast` | `23:2` | 播客页并入内容加工链，突出转写、摘要、入库、入报候选。 |
| `/audio` | `23:88` | 音频上传后直接进入转写、摘要、结构化和入库流程。 |
| `/sources` | `23:174` | 信源页从入口列表改为输入质量治理台，健康、价值、失败、修复同屏。 |
| `/monitor` | `23:265` | 监控页先回答有没有变化、是否重要、是否转信息流。 |
| `/rules` | `23:351` | 规则页加入模拟命中、误杀风险和样本复核，不只是规则列表。 |
| `/filtered` | `23:437` | 过滤池从垃圾桶改成误杀修复队列，按恢复价值排序。 |
| `/export` | `24:2` | 导出页按交付对象、脱敏状态和格式目标组织。 |
| `/ai-usage` | `24:88` | 模型用量和质量关联，展示失败率、任务价值和预算建议。 |
| `/reader-lab` | `24:174` | 阅读实验首页先给当前推荐策略、样本和指标结果。 |
| `/reader-lab/setup` | `24:260` | 设置页改为实验向导，高级 prompt 和参数下沉。 |
| `/reader-lab/compare` | `24:341` | 对比页先给推荐结论，再并排展示策略差异。 |
| `/settings` | `24:428` | 设置页改为系统治理中心，健康、连接、高风险边界和诊断建议同屏。 |

## 明确修正的 Baseline 问题

- `/feed`：原右侧详情空白占据半屏，v0.3 改为预览证据与修复 rail。
- `/feed/:id`：原证据链和操作入口过弱，v0.3 上移判断、来源、加工状态、入报解释。
- `/insights`：原重复内容列表挤占首屏，v0.3 改为判断和待处理优先。
- `/sources`：原页面偏入口堆叠，v0.3 强化输入健康和修复动作。
- `/daily/workbench`：原彩色卡片过多但决策不清，v0.3 改为生产判断、候选概览、处理债务。
- `/settings`、`/ai-usage`：原来偏后台数据页，v0.3 合并到治理中心语义。

## 验证

- Figma 页面列表已统一中文命名，当前入口为 `01 最新设计｜桌面逐页重设计 v0.3`。
- Figma 统计确认当前页有 23 张 frame：1 张 `说明｜最新设计入口` + 22 张 `页面稿｜中文页面名｜路由`。
- Figma 检查确认当前文件已删除移动端设计页，不再保留 `05 Redesign - Mobile` 或 `05B Redesign - Mobile Key Flows`。
- 已抽样渲染：
  - `29:2` 最新设计入口说明
  - `21:56` `/insights`
  - `21:246` `/feed/:id`
  - `23:174` `/sources`
- 截图证据：
  - `screenshots/figma-redesign-v0.3-insights.png`
  - `screenshots/figma-redesign-v0.3-feed-detail.png`
  - `screenshots/figma-redesign-v0.3-sources.png`
  - `screenshots/figma-redesign-v0.3-latest-entry-guide.png`
  - `screenshots/figma-redesign-v0.3-insights-after-cleanup.png`

## 开发使用

开发时优先读取本文件和 `handoff/design-code-map.md`：

1. 先实现 `Global Shell`，因为所有 v0.3 页面都依赖新的导航分组和顶部状态。
2. 再实现 `/feed` 与 `/feed/:id`，这是现有 UI 问题最明显、收益最高的页面组。
3. 再实现日报生产链路、输入治理、规则回收、治理中心和阅读实验。
