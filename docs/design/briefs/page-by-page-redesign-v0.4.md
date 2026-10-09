---
title: 信息中枢 v3 高密度精修说明 v0.4
type: design-brief
status: archived
version: v0.4
updated: 2026-07-03
source_device: macpro-main
---

# 信息中枢 v3 高密度精修说明 v0.4

> 归档说明：v0.4 只作为“高密度控噪”的局部参考。当前设计真源是 Figma `01 最新设计｜阅读优先全页面 v0.5`，详见 `page-by-page-redesign-v0.5.md`。

## 为什么补 v0.4

v0.3 修正了部分结构问题，但过度摘要化，牺牲了原版的信息密度和真实内容样本。v0.4 改为以原版页面为基底：保留指标、双列内容、表格、真实条目和多模块并列，同时通过 Tab、折叠区、右侧 rail、chips 和密度切换控制噪音。

## 设计真源

- Figma 页面：`01 最新设计｜高密度精修 v0.4`
- Figma 页面 URL：`https://www.figma.com/design/nFZbnEWt6FLIHTMSNvcPCj?node-id=41-2`
- 入口说明：`https://www.figma.com/design/nFZbnEWt6FLIHTMSNvcPCj?node-id=41-3`
- 本轮范围：桌面端 6 张核心页；移动端不恢复。

## 覆盖页面

| 路由 | Figma node | 核心优化 |
|---|---:|---|
| `/insights` | `42:2` | 恢复原版双列内容密度，保留指标卡、关注轴 Tab、真实内容卡和右侧任务 rail。 |
| `/feed` | `42:180` | 保留高密度列表，右侧固定显示选中条目的证据、动作和修复入口，避免半屏空白。 |
| `/feed/:id` | `45:2` | 保留正文阅读量，上方增加判断条，右侧 provenance 证据卡和动作组不裁切。 |
| `/daily/workbench` | `45:132` | 保留日报生产全链路、候选表和债务状态，用折叠工作流承载诊断。 |
| `/sources` | `46:2` | 保留信源表格密度，右侧显示选中信源健康、贡献解释和折叠高级配置。 |
| `/settings` | `46:189` | 将后台配置升级为治理中心，保留指标、Tab、折叠高级配置和危险动作 rail。 |

## v0.4 设计原则

- 信息量保留：不再把页面压缩成摘要看板，首屏必须保留可扫描的真实列表、表格或内容样本。
- 层级控噪：默认层展示指标、判断和主内容；折叠层放日志、JSON、低频配置；详情层放证据和动作。
- 右侧 rail 不留空：详情、证据、修复、任务和风险都进入 rail，避免原版空白详情和 v0.3 空页面感。
- 样式升级不换心智：保留信息中枢原有工作台气质，只提升卡片层级、状态色、分隔、按钮和徽章。

## 截图证据

- `screenshots/figma-redesign-v0.4-insights.png`
- `screenshots/figma-redesign-v0.4-feed.png`
- `screenshots/figma-redesign-v0.4-feed-detail.png`
- `screenshots/figma-redesign-v0.4-daily-workbench.png`
- `screenshots/figma-redesign-v0.4-sources.png`
- `screenshots/figma-redesign-v0.4-settings.png`

## 开发使用

开发时以 v0.4 为视觉与结构主参考，v0.3 只作为“哪些结构问题要避免”的归档参考。建议顺序：

1. 先实现全局 Shell、顶部状态条、导航分组和密度切换占位。
2. 再实现 `/feed` 与 `/feed/:id`，优先修复列表/详情空白、证据链和动作分散。
3. 再实现 `/insights`、`/daily/workbench`、`/sources`、`/settings` 的 Tab、折叠和右侧 rail。
