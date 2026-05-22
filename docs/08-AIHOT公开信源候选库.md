---
title: AIHOT 公开信源候选库
type: source-candidates
status: draft
version: 0.1
updated: 2026-05-07
tags: [aihot, sources, candidates, governance]
---

# AIHOT 公开信源候选库

本清单只来自 AIHOT 公开页面与公开文章描述，用于丰富信息中枢 V3 的候选信源评估，不直接导入生产库。导入前必须逐条确认抓取方式、版权/平台风险、是否已有订阅、近 7 天有效内容密度。

## 分层规则

| AIHOT 分层 | V3 含义 | 默认 source_kind | 默认动作 |
|---|---|---|---|
| T1 | 官方、一手、官网或工程博客 | official / blog | 优先接入，允许进入主 Feed |
| T1.5 | 官方 X / 官方社媒 | x | PoC 接入，作为事件簇关联讨论 |
| T2 | KOL、媒体、公众号、综合站 | x / media / wechat | 候选池或选题池，不直接污染主 Feed |

## 一手 / 官方优先

| 名称 | kind | tier | 建议抓取 | 风险 | 备注 |
|---|---|---|---|---|---|
| OpenAI 官网动态 | official | T1 | RSS / Webpage | 低 | 可继续排除客户案例，保留产品/研究/工程更新 |
| Anthropic Newsroom | official | T1 | Webpage / RSS | 低 | 官方发布与企业合作信号 |
| Claude Blog | official | T1 | Webpage / RSS | 低 | Claude 产品与 Agent 能力更新 |
| Claude Code GitHub Releases | official | T1 | GitHub Releases RSS | 低 | 编码工具版本变更 |
| GitHub Blog | official | T1 | RSS | 低 | Copilot / Agent 工程方法 |
| Hugging Face Blog | blog | T1 | RSS | 低 | 开源模型与工程文章 |
| Google Blog AI | official | T1 | RSS | 低 | 容易有低 AI 含量 PR，需要预筛 |
| Google AI for Developers | official | T1 | RSS / X PoC | 中 | 开发者更新及时，但需去重 |
| xAI News | official | T1 | Webpage | 低 | 产品和 API 发布 |
| Apple Newsroom | official | T1 | RSS | 中 | AI 含量不稳定，必须预筛 |
| Apple Machine Learning Research | blog | T1 | RSS | 低 | 研究类高价值 |
| NVIDIA AI Blog | official | T1 | RSS | 低 | 基础设施、算力、部署信号 |
| Cursor Blog | official | T1 | RSS / Webpage | 低 | Coding Agent 与 IDE 方向 |
| Anthropic Transformer Circuits | blog | T1 | RSS / Webpage | 低 | 可解释性研究 |

## 综合 / 研究 / 媒体

| 名称 | kind | tier | 建议抓取 | 风险 | 备注 |
|---|---|---|---|---|---|
| IT之家 RSS | media | T2 | RSS | 中 | 量大、噪声高，适合资讯补充 |
| Hacker News 热门（buzzing.cc 中文翻译） | media | T2 | RSS | 中 | 适合发现开发者社区热点 |
| The Decoder AI News | media | T2 | RSS | 低 | 海外 AI 媒体 |
| Simon Willison 博客 | blog | T1 | RSS | 低 | AI 工程与软件实践 |
| Gary Marcus Substack | blog | T2 | RSS | 低 | AI 风险和批判视角 |
| Nathan Lambert Interconnects | blog | T1 | RSS | 低 | 开源模型与产业判断 |
| Hugging Face Daily Papers | blog | T1 | RSS / 页面 | 低 | 论文候选源 |

## X / KOL 候选

| 名称 | kind | tier | 建议抓取 | 风险 | 备注 |
|---|---|---|---|---|---|
| OpenAI | x | T1.5 | RSSHub / API PoC | 高 | 官方社媒，需遵守平台限制 |
| Claude | x | T1.5 | RSSHub / API PoC | 高 | 官方社媒 |
| Claude Devs | x | T1.5 | RSSHub / API PoC | 高 | Claude Code / 开发者更新 |
| xAI | x | T1.5 | RSSHub / API PoC | 高 | 官方社媒 |
| Perplexity | x | T1.5 | RSSHub / API PoC | 高 | API 和产品更新 |
| Tencent Hunyuan | x | T1.5 | RSSHub / API PoC | 高 | 国产模型进展 |
| Testing Catalog | x | T2 | RSSHub / API PoC | 高 | 产品爆料类，需复核 |
| Rohan Paul | x | T2 | RSSHub / API PoC | 高 | 海外 AI 资讯/KOL |
| Kim | x | T2 | RSSHub / API PoC | 高 | AI 工具与开源生态 |
| 宝玉 | x | T2 | RSSHub / API PoC | 高 | 中文 AI 工程与工具 |
| 歸藏 | x | T2 | RSSHub / API PoC | 高 | 工具体验和产品观察 |
| 阿易 AI Notes | x | T2 | RSSHub / API PoC | 高 | 中文 AI 工具/Agent 资讯 |
| 小互 | x | T2 | RSSHub / API PoC | 高 | 中文 AI 资讯/教程 |
| Berry Xia | x | T2 | RSSHub / API PoC | 高 | 产业与模型资讯 |
| 向阳乔木 | x | T2 | RSSHub / API PoC | 高 | 工具、设计、Agent 资讯 |
| 邵猛 | x | T2 | RSSHub / API PoC | 高 | 工具链、开发者工作流 |
| Ethan Mollick | x | T2 | RSSHub / API PoC | 高 | AI 采用与教育/工作流 |
| Deedy | x | T2 | RSSHub / API PoC | 高 | AI 行业观察 |
| Marc Andreessen | x | T2 | RSSHub / API PoC | 高 | 资本/叙事信号 |
| SemiAnalysis | x | T2 | RSSHub / API PoC | 高 | 算力与半导体 |

## 公众号候选

公众号只进入“选题池 / 公众号爆文”候选，不进入主 Feed。建议字段包括：发文日期、标题、阅读、点赞、转发、异常值、原文链接、账号名、是否原创。

| 名称 | kind | tier | 建议抓取 | 风险 | 备注 |
|---|---|---|---|---|---|
| 赛博禅心 | wechat | T2 | 第三方数据 / 手工候选 | 高 | 爆文选题信号 |
| 机器之心 | wechat | T2 | 公开文章 / RSS 替代 | 中 | AI 媒体 |
| AI寒武纪 | wechat | T2 | 第三方数据 / 手工候选 | 高 | 编程与模型资讯 |
| 锦技社 | wechat | T2 | 第三方数据 / 手工候选 | 高 | 产品/模型资讯 |
| 算力百科 | wechat | T2 | 第三方数据 / 手工候选 | 高 | 算力与硬件 |
| AGI Hunt | wechat | T2 | 第三方数据 / 手工候选 | 高 | 工具与测评 |
| 新智元 | wechat | T2 | 公开文章 / RSS 替代 | 中 | AI 媒体 |
| AGENT橘 | wechat | T2 | 第三方数据 / 手工候选 | 高 | Agent/工具实践 |
| 商汤科技 SenseTime | wechat | T1.5 | 官方公众号候选 | 中 | 官方发布补充 |
| 特工宇宙 | wechat | T2 | 第三方数据 / 手工候选 | 高 | AI 公司/实践叙事 |
| 01Founder | wechat | T2 | 第三方数据 / 手工候选 | 高 | 创业与行业观察 |
| 老金带你玩AI | wechat | T2 | 第三方数据 / 手工候选 | 高 | 模型对比与工具体验 |
| 小明AI+财研习社 | wechat | T2 | 第三方数据 / 手工候选 | 高 | 财研/AI 交叉 |
| 苍何 | wechat | T2 | 第三方数据 / 手工候选 | 高 | 多 Agent / 商业实践 |

## 导入前验收

1. 近 7 天至少抽样 50 条公开内容，对照现有 V3 信源去重。
2. 每个候选源记录抓取成功率、重复率、AI 相关率、精选命中率。
3. X 与公众号只做 PoC，默认 `autoFetchEnabled=false` 或独立候选池。
4. T1 源优先进入主 Feed；T1.5/T2 默认作为事件簇关联讨论和选题池。
5. 任何无法稳定抓取或有明显平台风控风险的源，不进入自动抓取。
