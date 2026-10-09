---
title: 信息中枢 v3 全页面重设计 Brief v0.2
type: design-brief
status: archived
version: v0.2
updated: 2026-07-02
source_device: macpro-main
---

# 信息中枢 v3 全页面重设计 Brief v0.2

> 归档说明：v0.2 只作为历史蓝图参考。当前设计真源是 Figma `01 最新设计｜桌面逐页重设计 v0.3`，本轮只按桌面端开发，不再使用 v0.2 移动端稿。

## 背景

v0.1 已完成现有页面 Baseline 复刻和少量方向稿，但还不足以指导整体开发：多数页面仍缺少逐页的信息暴露规则、布局取舍、行动入口和代码映射。

v0.2 的目标是把信息中枢从“多工具页面集合”重排为“信息加工控制台”，覆盖全部路由，并形成能直接指导开发的 Figma 与文档交接。

## 设计原则

- 判断优先：首屏先回答“今天/这条/这个源有什么值得判断”，再展示原始数据。
- 证据可追：高价值内容必须能看到来源、抓取、摘要、评分、入报/未入报依据。
- 动作可执行：异常、候选、规则、信源状态都必须有下一步动作。
- 信息延后：低频配置、原始 JSON、长日志、高级参数不进入首屏。
- 开发可落地：不新增业务大功能，不照搬绝对坐标，优先复用现有 React/Tailwind 页面结构。

## Figma 产出

- `04B Redesign - All Pages IA`：21 个路由的页面使命、首屏暴露、延后信息、主操作、代码映射。
- `04C Redesign - Core Desktop Screens`：8 张桌面核心模式屏。
- `06B Dev Handoff - Implementation Slices`：7 个开发实现切片和全局验收线。

## 全页面优化口径

| 页面组 | 覆盖路由 | 优化重点 |
|---|---|---|
| 入口与判断 | `/login`, `/register`, `/insights` | 减少说明噪音，突出系统状态、隐私边界、今日判断和待处理队列。 |
| 日报生产 | `/daily/workbench`, `/daily/workflows`, `/daily/candidates`, `/daily/reports/latest` | 把日报从结果页变成生产台，候选、排除、模块进度和最终报告可追溯。 |
| 信息加工 | `/feed`, `/feed/:id`, `/podcast`, `/audio` | 统一表达来源可信、摘要质量、正文状态、修复动作和入报路径。 |
| 输入治理 | `/sources`, `/monitor` | 从输入列表升级为信源/监控健康治理，暴露抓取质量、异常原因和修复入口。 |
| 规则回收 | `/rules`, `/filtered` | 让规则命中、误杀风险、恢复路径可解释。 |
| 治理交付 | `/export`, `/ai-usage`, `/settings`, `/reports` | 以健康、成本、权限、脱敏、交付对象组织，而不是堆配置项。 |
| 阅读实验 | `/reader-lab`, `/reader-lab/setup`, `/reader-lab/compare` | 让实验目标、样本、指标、推荐策略清晰，产物能回流信息加工链。 |

## 开发起点

优先从 `Global Shell` 开始，因为它决定所有页面的工作流心智：

- `components/Layout.tsx`
- `components/Sidebar.tsx`
- `components/GlobalUploadBanner.tsx`

随后进入 `Feed Workbench`：

- `features/feed/page.tsx`
- `lib/feed-layout.ts`
- `lib/feed-diagnostics.ts`

## 验证记录

- Figma metadata 已确认新页面和节点存在。
- Figma screenshot 已确认以下节点可渲染：
  - `11:2` 全页面 IA
  - `13:2` 桌面 `/insights`
  - `16:2` 开发交接
- 截图已保存到 `docs/design/screenshots/`。
