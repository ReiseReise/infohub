---
title: 信息中枢 v3 Figma 链接
type: figma-links
status: active
version: v0.6
updated: 2026-07-03
source_device: macpro-main
---

# Figma 链接

## 文件

- Figma fileKey: `nFZbnEWt6FLIHTMSNvcPCj`
- Figma URL: https://www.figma.com/design/nFZbnEWt6FLIHTMSNvcPCj
- 文件名：AIReise 信息中枢 v3 - 全页面复制与重设计 v0.1

## 页面结构

- `00 封面与站点地图`
- `01 最新设计｜现有融合精修 v0.6`
- `02 开发交接｜实现切片`
- `03 设计系统｜桌面组件与状态`
- `90 归档｜页面审计记录`
- `92 归档｜阅读优先全页面 v0.5（方向错误）`
- `93 归档｜高密度精修 v0.4`
- `94 归档｜桌面逐页重设计 v0.3`
- `95 归档｜桌面模式屏 v0.2`
- `96 归档｜全页面信息架构 v0.2`
- `97 归档｜交接草稿 v0.1`
- `98 归档｜桌面方向稿 v0.1`
- `99 归档｜当前版本截图基线`

说明：

- 当前主设计入口是 `01 最新设计｜现有融合精修 v0.6`。
- `92 归档｜阅读优先全页面 v0.5（方向错误）` 只作为反例保留：它过度复刻外部阅读器参考图，不作为开发参考。
- `93 归档｜高密度精修 v0.4` 只作为高密度控噪参考，不作为当前开发参考。
- `94 归档｜桌面逐页重设计 v0.3` 只作为结构参考，不作为当前开发参考。
- `99 归档｜当前版本截图基线` 只是旧页面截图，不作为开发参考。
- 移动端页面已从 Figma 删除，本轮只保留桌面设计。

## 关键节点

- v0.6 最新设计入口说明: https://www.figma.com/design/nFZbnEWt6FLIHTMSNvcPCj?node-id=57-3
- v0.6 现有融合精修全页面: https://www.figma.com/design/nFZbnEWt6FLIHTMSNvcPCj?node-id=57-2
- v0.6 `/feed`: https://www.figma.com/design/nFZbnEWt6FLIHTMSNvcPCj?node-id=57-256
- v0.6 `/feed/:id`: https://www.figma.com/design/nFZbnEWt6FLIHTMSNvcPCj?node-id=57-388
- v0.6 `/insights`: https://www.figma.com/design/nFZbnEWt6FLIHTMSNvcPCj?node-id=57-138
- v0.6 `/daily/workbench`: https://www.figma.com/design/nFZbnEWt6FLIHTMSNvcPCj?node-id=57-520
- v0.6 `/sources`: https://www.figma.com/design/nFZbnEWt6FLIHTMSNvcPCj?node-id=57-1254
- v0.6 `/settings`: https://www.figma.com/design/nFZbnEWt6FLIHTMSNvcPCj?node-id=57-2324

## v0.6 现有融合精修覆盖

- Figma 页面：`01 最新设计｜现有融合精修 v0.6`
- 覆盖：22 张 1440 x 1000 桌面页面稿，对齐 `apps/web/src/App.tsx` 全路由。
- Figma 图层命名：`页面稿｜中文页面名｜现有融合精修｜路由`。
- 详细节点清单见：`briefs/page-by-page-redesign-v0.6.md`
- 这版以现有信息中枢为母版：侧边栏来自 `Sidebar.tsx`，页面覆盖来自 `App.tsx`，只吸收参考图的主次比例，不复制订阅分类、RSS 示例内容或外部阅读器心智。

## v0.5 阅读优先全页面覆盖

- Figma 页面：`92 归档｜阅读优先全页面 v0.5（方向错误）`
- 覆盖：22 张 1440 x 1000 桌面页面稿，对齐 `apps/web/src/App.tsx` 全路由。
- Figma 图层命名：`页面稿｜中文页面名｜阅读优先全页面｜路由`。
- 详细节点清单见：`briefs/page-by-page-redesign-v0.5.md`
- 归档原因：过度复刻参考阅读器图片，导致侧边栏和现有产品结构脱节；不作为当前开发入口。

## v0.4 高密度精修覆盖

- Figma 页面：`93 归档｜高密度精修 v0.4`
- 覆盖：6 张核心 1440 x 1000 桌面页面稿。
- Figma 图层命名：`页面稿｜中文页面名｜高密度精修｜路由`。
- 详细节点清单见：`briefs/page-by-page-redesign-v0.4.md`
- 这版以原版页面为基底，保留双列列表、表格、指标和真实内容样本，通过 Tab、折叠、右侧 rail、chips 和密度切换控噪。当前仅作为参考，不作为开发入口。

## v0.3 桌面逐页重设计覆盖

- Figma 页面：`94 归档｜桌面逐页重设计 v0.3`
- 覆盖：22 张 1440 x 1000 实际页面稿。
- 用途：结构参考，不作为当前开发入口。

## v0.2 Redesign 覆盖

- 全页面 IA 矩阵覆盖 21 个路由：使命、首屏信息暴露、延后信息、主操作、代码映射。
- 桌面核心屏覆盖 8 个可复用页面模式：仪表板、信息流、详情、日报、输入治理、规则过滤、治理中心、媒体阅读实验。
- 移动端已从当前 Figma 文件移除，v0.2 移动流只保留为历史截图证据，不再作为当前设计入口。
- 开发交接页按 7 个实现切片组织：Global Shell、Feed Workbench、Daily Production、Input Governance、Rules & Recovery、Governance Center、Media & Reader Lab。

## 当前截图证据

- `screenshots/figma-redesign-v0.3-insights.png`
- `screenshots/figma-redesign-v0.3-feed-detail.png`
- `screenshots/figma-redesign-v0.3-sources.png`
- `screenshots/figma-redesign-v0.3-latest-entry-guide.png`
- `screenshots/figma-redesign-v0.3-insights-after-cleanup.png`
- `screenshots/figma-redesign-v0.4-insights.png`
- `screenshots/figma-redesign-v0.4-feed.png`
- `screenshots/figma-redesign-v0.4-feed-detail.png`
- `screenshots/figma-redesign-v0.4-daily-workbench.png`
- `screenshots/figma-redesign-v0.4-sources.png`
- `screenshots/figma-redesign-v0.4-settings.png`

历史 v0.2 截图仍保留在 `screenshots/`，但不作为当前开发入口。

## Baseline 覆盖

桌面路由：

- `/login`
- `/register`
- `/insights`
- `/daily/workbench`
- `/daily/workflows`
- `/daily/candidates`
- `/daily/reports/latest`
- `/feed`
- `/feed/:id`
- `/podcast`
- `/audio`
- `/sources`
- `/monitor`
- `/rules`
- `/filtered`
- `/export`
- `/ai-usage`
- `/reader-lab`
- `/reader-lab/setup`
- `/reader-lab/compare`
- `/settings`

移动端截图基线已不作为本轮设计参考。

## 边界

- Baseline 当前以截图形式保存事实基线，不作为最终可编辑组件库。
- Redesign v0.3 已提供逐页面开发参考；后续开发仍需按真实数据和响应式状态做组件级细化。
- 不在 Figma 或本目录记录登录密码、JWT、API key。
