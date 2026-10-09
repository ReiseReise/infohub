---
title: 信息中枢 v3 设计到代码映射
type: design-code-map
status: active
version: v0.6
updated: 2026-07-03
source_device: macpro-main
---

# 设计到代码映射

## Figma 文件

- URL: https://www.figma.com/design/nFZbnEWt6FLIHTMSNvcPCj
- 最新设计入口说明: https://www.figma.com/design/nFZbnEWt6FLIHTMSNvcPCj?node-id=57-3
- 最新现有融合精修全页面设计: https://www.figma.com/design/nFZbnEWt6FLIHTMSNvcPCj?node-id=57-2
- 开发交接切片: https://www.figma.com/design/nFZbnEWt6FLIHTMSNvcPCj?node-id=10-5
- 设计系统: https://www.figma.com/design/nFZbnEWt6FLIHTMSNvcPCj?node-id=3-4

说明：Figma 页面已统一中文命名；移动端页面已从当前文件结构删除，本轮只按桌面端开发。

## v0.6 优先级

v0.6 之后，开发以现有融合精修全页面稿为主。v0.5 标记为方向错误归档，不再作为参考；v0.4 只保留高密度控噪经验。

| 优先级 | Figma 节点 | 前端入口 | 原因 |
|---|---|---|---|
| P0 | `/feed` `57:256`, `/feed/:id` `57:388` | `features/feed/page.tsx`, `lib/feed-layout.ts`, `lib/feed-diagnostics.ts` | 保留现有信息流骨架、真实侧边栏和详情能力，突出列表与正文，证据 rail 弱化。 |
| P0 | `/insights` `57:138`, `/daily/workbench` `57:520` | `pages/Insights.tsx`, `pages/Daily.tsx`, `lib/insights-report-funnel.ts` | 保留成长仪表板和日报生产台的指标/候选/判断密度，低频诊断折叠。 |
| P1 | `/sources` `57:1254`, `/monitor` `57:1390`, `/settings` `57:2324` | `features/sources/page.tsx`, `pages/Monitor.tsx`, `features/settings/page.tsx` | 治理页以现有表格/队列为核心，右侧只放选中对象上下文。 |
| P1 | `/daily/workflows` `57:638`, `/daily/candidates` `57:752`, `/daily/reports/latest` `57:866`, `/reports` `57:946` | `pages/Daily.tsx`, `pages/Reports.tsx` | 日报生产和报告阅读统一成主内容 + 弱诊断模式。 |
| P2 | `/rules` `57:1526`, `/filtered` `57:1640`, `/export` `57:1754`, `/ai-usage` `57:1868` | `pages/Rules.tsx`, `pages/Filtered.tsx`, `pages/Export.tsx`, `pages/AiUsage.tsx` | 大信息量列表保留，日志和配置折叠。 |
| P2 | `/podcast` `57:1026`, `/audio` `57:1140`, `/reader-lab*` `57:1982/2096/2210` | `pages/PodcastHub.tsx`, `pages/AudioStudio.tsx`, `pages/ReaderLab.tsx` | 媒体与阅读实验并入内容加工链，按队列和结果浏览。 |

## 映射表

| Figma 区域 | 前端路由/组件 | 开发含义 |
|---|---|---|
| Desktop / Unified information cockpit | `apps/web/src/components/Layout.tsx`, `Sidebar.tsx`, `pages/Insights.tsx`, `pages/Daily.tsx` | 全局 Shell、顶部状态条、今日判断、加工漏斗和任务 rail |
| Sidebar redesign | `apps/web/src/components/Sidebar.tsx` | 从导航清单升级为信息加工工作区分组 |
| Top status strip | `Layout.tsx`, `GlobalUploadBanner.tsx` | 全局运行态、上传/队列/新鲜度提示 |
| Today judgment panel | `pages/Insights.tsx`, `pages/Daily.tsx` | 首页首屏主判断，而不是只看统计卡 |
| Processing funnel | `pages/Insights.tsx`, `pages/Daily.tsx`, `features/settings/page.tsx` | 采集、正文、评分、候选、日报链路可视化 |
| Work queue | `pages/Daily.tsx`, `features/feed/page.tsx`, `features/sources/page.tsx` | 待处理动作统一入口 |
| Evidence and provenance | `features/feed/page.tsx`, `lib/feed-diagnostics.ts`, `lib/feed-layout.ts` | 来源、正文、评分、日报入选/未入选解释 |
| Task rail | `features/settings/page.tsx`, `pages/AiUsage.tsx` | 页面级运行态、异常、修复建议 |

## v0.2 实现切片

| 切片 | 覆盖路由 | 主要代码入口 | 设计目标 |
|---|---|---|---|
| 1. Global Shell | 全登录后页面 | `components/Layout.tsx`, `components/Sidebar.tsx`, `components/GlobalUploadBanner.tsx` | 导航按“判断 / 加工 / 治理”重组，顶部状态条持续暴露采集、清洗、候选、异常。 |
| 2. Feed Workbench | `/feed`, `/feed/:id` | `features/feed/page.tsx`, `lib/feed-layout.ts`, `lib/feed-diagnostics.ts` | 信息流从列表变分拣台，详情页先给判断摘要、证据链和修复动作。 |
| 3. Daily Production | `/daily/workbench`, `/daily/workflows`, `/daily/candidates`, `/daily/reports/latest` | `pages/Daily.tsx`, `lib/insights-report-funnel.ts`, `lib/insights-repair-actions.ts` | 日报从结果页改为生产台，入报和未入报都可解释。 |
| 4. Input Governance | `/sources`, `/monitor` | `features/sources/page.tsx`, `pages/Monitor.tsx`, `lib/sources-view.ts` | 信源与监控围绕输入健康、抓取质量、异常修复组织。 |
| 5. Rules & Recovery | `/rules`, `/filtered` | `pages/Rules.tsx`, `pages/Filtered.tsx` | 规则支持模拟命中与误杀风险，过滤池按可恢复价值排序。 |
| 6. Governance Center | `/settings`, `/ai-usage`, `/export`, `/reports` | `features/settings/page.tsx`, `pages/AiUsage.tsx`, `pages/Export.tsx`, `pages/Reports.tsx` | 设置和用量围绕健康、成本、权限、交付治理表达。 |
| 7. Media & Reader Lab | `/podcast`, `/audio`, `/reader-lab`, `/reader-lab/setup`, `/reader-lab/compare` | `pages/PodcastHub.tsx`, `pages/AudioStudio.tsx`, `pages/ReaderLab.tsx` | 媒体与阅读实验统一进内容加工链，产物可进入信息流或日报。 |

## v0.2 全局验收线

- 首屏必须先给判断、状态或待处理动作，不能只堆原始列表。
- 但不能为了“干净”删除核心列表、正文、表格和真实内容样本；阅读类页面必须让文章/正文成为最大视觉区域。
- 每个异常必须给原因、影响和下一步动作。
- 每个高价值内容必须能追溯来源和加工状态。
- Figma 是结构与视觉真源，代码实现复用现有 React/Tailwind 组件，不照搬绝对坐标。

## 开发优先级建议

1. 先改 Global Shell，解决导航、顶部运行态、页面任务反馈的共同底座。
2. 再改 Feed Workbench，优先落 `/feed` 和 `/feed/:id` 的现有融合比例、正文主舞台、证据链、详情预览和修复动作。
3. 再改 Daily Production，把候选解释、未入报原因和生成链路做成可用工作台。
4. 再改 Input Governance 和 Rules & Recovery，减少抓取失败、误杀和规则不可解释。
5. 最后收口 Governance Center、Media & Reader Lab、Export / Reports。

## 不直接做的事

- 不照搬 Figma 的绝对坐标实现。
- 不为了设计稿新增业务路由。
- 不把 Baseline 截图当成可编辑组件源。
