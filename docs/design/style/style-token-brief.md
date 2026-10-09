---
title: 信息中枢 v3 Style Token Brief
type: style-token-brief
status: active
version: v0.1
updated: 2026-07-02
source_device: macpro-main
---

# Style Token Brief

## 视觉方向

信息中枢 v3 的视觉方向是“信息加工控制台”：像一个安静但可靠的编辑工作台，同时具备系统运行态的可见性。

## 字体

- 当前 Web 端使用 Tailwind 默认 sans 字体栈。
- Figma 当前可用字体以 Inter 为主，因此 v0.1 使用 Inter 近似表达。
- 后续如果要更贴近 macOS/Web 系统字体，可在 Figma 安装并切换到 SF Pro / PingFang SC 组合。

## 色彩

核心色：

- Ink: `#111827`
- Text: `#3F3F46`
- Muted: `#71717A`
- Surface: `#FFFFFF`
- Canvas: `#F7F6F2`
- Teal Core: `#0F766E`
- Signal Blue: `#2563EB`
- Review Amber: `#B45309`
- Risk Red: `#DC2626`
- Success Green: `#16A34A`

使用原则：

- 白色用于内容面板，不做嵌套卡片堆叠。
- Teal 只用于当前主线、可信状态和关键动作。
- Amber 用于复核、待解释、候选但未确定。
- Red 用于抓取失败、权限失败、模型异常、误杀风险。
- Blue 用于系统性信号、信息加工阶段和可继续处理状态。

## 密度

- 桌面端保持高密度，但通过分区、标题、状态条和 rail 降低扫描成本。
- 移动端减少并列信息，采用判断优先、证据下沉、动作固定的结构。

## 圆角

- 普通面板：12-14px。
- 小 chip / badge：999px。
- 按钮：8-10px。
- 不使用过度圆润的 SaaS 营销风。

## 组件语气

- `Source trust badge`：表达来源可信度和抓取健康。
- `Freshness strip`：表达全局新鲜度和更新时间。
- `Processing funnel`：表达采集、正文、评分、候选、日报的加工进度。
- `Evidence card`：表达原文、摘要、评分、入报原因、未入报原因。
- `Task rail`：表达页面级任务状态和修复入口。
- `Action chip`：用于补正文、重跑评分、加入日报、恢复过滤等轻动作。

