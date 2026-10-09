---
title: 信息中枢 v3 UI 验收清单
type: ui-acceptance-checklist
status: active
version: v0.6
updated: 2026-07-03
source_device: macpro-main
---

# UI 验收清单

## Baseline

- [x] `/login` 已截图并上传 Figma。
- [x] `/register` 已截图并上传 Figma。
- [x] 13 个侧边栏主入口已截图并上传 Figma。
- [x] Daily 子页面已截图并上传 Figma。
- [x] Reader Lab 子页面已截图并上传 Figma。
- [x] `/feed/:id` 使用真实样本截图并上传 Figma。
- [x] 旧移动端截图基线已退出当前验收口径。

## Redesign v0.1

- [x] Figma 文件包含封面和 sitemap。
- [x] Figma 文件包含 Baseline 区。
- [x] Figma 文件包含审计矩阵。
- [x] Figma 文件包含 Design Kit。
- [x] Figma 文件包含桌面端优化稿。
- [x] Figma 当前结构已移除移动端设计页。
- [x] Figma 文件包含 Handoff。

## 视觉验证

- [x] Desktop Redesign 节点可渲染。
- [x] 最新设计入口说明节点可渲染。
- [x] Baseline Feed Detail 节点可渲染。
- [x] 本地截图文件存在。
- [x] v0.4 6 张核心桌面页已渲染并保存截图。
- [x] v0.4 `/feed` 默认态有列表、详情预览和右侧证据 rail，不再出现半屏空白。
- [x] v0.4 `/feed/:id` 右侧证据卡和动作组已修正，不再裁切主要内容。
- [x] v0.4 `/insights` 保留原版双列内容密度。
- [x] v0.5 已建立 `01 最新设计｜阅读优先全页面 v0.5`。
- [x] v0.5 覆盖 `App.tsx` 全部 22 张桌面路由页面稿。
- [x] v0.5 `/feed` 与 `/feed/:id` 已按左侧导航/分类、中间文章列表、右侧大正文的阅读器比例重排。
- [x] v0.5 `/settings` 抽样验证为主表格 + 右侧对象上下文，不再让次级配置抢主视觉。
- [x] v0.5 已标记为方向错误归档，不作为当前开发参考。
- [x] v0.6 已建立 `01 最新设计｜现有融合精修 v0.6`。
- [x] v0.6 覆盖 `App.tsx` 全部 22 张桌面路由页面稿，Figma MCP 校验 `missing=[]`。
- [x] v0.6 侧边栏已恢复为现有 `Sidebar.tsx` 导航，不复制参考图里的订阅分类侧边栏。
- [x] v0.6 `/feed`、`/feed/:id`、`/settings` 已通过 Figma MCP 抽样截图检查。
- [x] v0.6 已清理残留的 `BestBlogs.dev` 参考图来源文本。

## 后续开发验收

- [ ] 全局 Shell 与现有路由兼容。
- [ ] 侧边栏分组在桌面端宽度下信息层级清楚。
- [ ] Feed 详情页在桌面端无空白半屏、无文字重叠，且正文区域是最大视觉区域。
- [ ] Feed 详情页能解释入报/未入报原因。
- [ ] Sources 页面能展示来源可信度和修复动作。
- [ ] Daily / Insights 能表达加工漏斗和待处理队列。
- [ ] Settings / AI Usage 能降低后台信息噪音并保留诊断能力。
