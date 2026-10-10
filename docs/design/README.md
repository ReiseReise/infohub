---
title: 信息中枢 v3 设计沉淀
type: project-design-index
status: active
version: v0.6
updated: 2026-07-03
source_device: macpro-main
---

# 信息中枢 v3 设计沉淀

本目录保存信息中枢 v3 的项目级设计沉淀。中枢方法论不放在这里，本目录只保存本项目自己的页面基线、Figma 文件、重设计方向、验收证据和后续开发交接。

## 本轮目标

- 以 Figma `01 最新设计｜现有融合精修 v0.6` 为当前设计真源。
- 先保留现有页面事实基线到归档页，再基于现有功能做逐页重设计。
- 不新增大功能，优先在现有 `Sidebar.tsx`、`App.tsx`、Feed/日报/信源/设置等真实页面骨架上做样式升级、信息层级控制和桌面端开发可落地性。
- 本轮不做移动端；旧移动端页面已从 Figma 当前结构删除，只保留历史日志。

## Figma

- 文件名：AIReise 信息中枢 v3 - 全页面复制与重设计 v0.1
- 文件 URL：https://www.figma.com/design/nFZbnEWt6FLIHTMSNvcPCj
- 关键节点见：`figma-links.md`

## 当前交付

- Baseline：旧页面截图已归档到 Figma `99 归档｜当前版本截图基线`，只作为问题对照，不作为开发参考。
- Redesign v0.2：全页面 IA 矩阵、桌面核心模式屏和开发交接切片已归档为参考蓝图。
- Redesign v0.3：已归档为结构参考，不再作为当前主入口。
- Redesign v0.4：已归档为高密度控噪参考。
- Redesign v0.5：已归档为方向错误样本；问题是过度复刻外部阅读器参考图，导致侧边栏和现有产品心智脱节。
- Redesign v0.6：已完成 22 张桌面全路由页面稿，保留信息中枢真实侧边栏、路由和页面功能，只吸收“主内容突出、次级信息弱化、大信息量靠滚动/折叠/rail 承载”的原则。
- Design Kit：已建立 InfoHub Design Kit v0.1，包括颜色、基础组件语气和状态表达。
- Handoff：当前以 v0.6 全路由页面稿 + 7 个实现切片开发，不再从 Baseline、v0.3、v0.4、v0.5 或移动端稿进入。

## 当前入口

- 最新设计说明：`briefs/page-by-page-redesign-v0.6.md`
- Figma v0.6 入口说明：`https://www.figma.com/design/nFZbnEWt6FLIHTMSNvcPCj?node-id=57-3`
- Figma v0.6 页面：`https://www.figma.com/design/nFZbnEWt6FLIHTMSNvcPCj?node-id=57-2`
- 开发映射：`handoff/design-code-map.md`
- Figma 链接索引：`figma-links.md`

## 本地证据

截图证据位于：

- `docs/design/screenshots/`

本轮截图来源：

- 前端：`http://127.0.0.1:5173`
- 后端：本地 Docker 信息中枢 v3 服务
- 登录态：本地 acceptance admin 会话，仅用于截图，不写入凭据和 token。

## 使用方式

后续开发从 `handoff/design-code-map.md` 进入，优先看 Figma v0.6 现有融合精修稿。推荐先做 `/feed`、`/feed/:id`，因为这两处最能验证“真实信息中枢侧边栏 + 高密度文章流 + 正文主舞台 + 证据 rail 弱化”的融合比例。每次实现一个页面组后，把验收截图补到 `screenshots/`，并在 `log.md` 追加记录。
