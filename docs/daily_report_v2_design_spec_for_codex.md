# 日报系统 V2 优化设计与开发文档

> 适用对象：产品 / 前端 / 后端 / AI 工作流 / Codex 开发任务  
> 文档版本：v1.0  
> 目标：将当前“日报生成、候选池、未入报解释、运行统计、最终日报正文”混合展示的形态，重构为一套清晰的 **个性化过滤配置工作流 + 可执行子智能体分析 + 运行分析 + 高质量洞察日报** 的产品体系。

---

## 1. 项目背景与目标

当前系统已经具备以下能力：

- 每日内容流入统计，例如“今日新增、主流程可见、匹配范围、高分候选、最终入报”等。
- 候选池与未入报解释，例如“泛商业噪声”“未达到入报门槛”“TOP 入报理由”。
- 快速 / 完整日报生成模式。
- 工作流配置入口，例如最低精选分、入报条数、信源等级、关键词范围、强制中文化、Prompt 链路等。
- 日报正文输出，包括今日结论、关键进展、头部舆论 / 新闻焦点等。

但当前产品信息层级混在一起：

1. **候选池诊断、运行状态、最终日报正文混合在同一屏**，用户很难判断当前是在看系统运行结果，还是最终要阅读的高质量日报。
2. **“个性化配置工作流”的价值没有被产品化呈现**，目前更像参数面板，而不是可理解、可试运行、可评估的策略工作流。
3. **“子智能体”没有形成明确产品心智**，用户看不到每个智能体负责什么、输入什么、输出什么、是否可配置、是否可执行。
4. **“高质量日报”与“运行分析”混杂**，导致日报读起来不像给业务决策者看的洞察报告，而像系统调试页。
5. **当前的分类和标签存在 uncategorized 问题**，说明标签体系、中文化、标准化、主题归类仍需要进一步产品化。

### 1.1 V2 产品定位

V2 不再只是“自动生成日报”，而是：

> 一个可配置、可执行、可观测、可持续优化的日报智能工作台。

核心表达：

- 用户可以定义自己的日报过滤策略。
- 系统通过多个子智能体并行分析内容。
- 系统可以展示运行质量、过滤质量、生成质量。
- 最终产出是一份面向业务决策的高质量洞察日报。

### 1.2 V2 设计目标

| 目标 | 说明 |
|---|---|
| 信息分层清晰 | 工作流配置、候选池、运行分析、最终日报分离展示 |
| 个性化配置可见 | 用户能看到“为什么这些内容会入报”，也能调整过滤策略 |
| 子智能体可执行 | 每个 Agent 都有角色、输入、输出、状态、结果、配置入口 |
| 运行过程可观测 | 展示执行状态、耗时、Token、失败、重试、成功率、兜底情况 |
| 日报内容高质量 | 最终报告以洞察、趋势、风险、建议为中心，而不是堆条目 |
| 结果可评估迭代 | 通过命中率、误伤率、可读性、洞察密度等指标持续优化 |

---

## 2. 新的信息架构

建议将整个日报产品拆为 6 个主模块。

```text
日报智能平台
├── 工作台
│   ├── 今日概览
│   ├── 个性化配置工作流摘要
│   ├── 子智能体分析矩阵
│   ├── 高质量日报预览
│   └── 运行监控侧栏
│
├── 日报工作流
│   ├── 工作流元信息
│   ├── 流程编排
│   ├── 过滤与评分规则
│   ├── 子智能体编排
│   ├── Prompt / 模板链路
│   ├── 预览漏斗
│   └── 工作流效果评估
│
├── 候选池
│   ├── 全量候选
│   ├── 已入报
│   ├── 未入报
│   ├── 入报理由
│   ├── 未入报原因
│   ├── 人工复核
│   └── 兜底候选
│
├── 智能体中心
│   ├── Agent 列表
│   ├── Agent 配置
│   ├── Agent 运行记录
│   ├── Prompt 配置
│   └── 输出 Schema 管理
│
├── 运行监控
│   ├── 执行日志
│   ├── 任务状态
│   ├── 失败与重试
│   ├── Token 消耗
│   ├── 翻译质量
│   └── 系统健康
│
└── 高质量日报
    ├── 今日总览
    ├── 信息分析
    ├── 数据分析
    ├── 运行分析
    ├── 洞察与建议
    └── 附录条目
```
参考日报设计
![alt text](<ChatGPT Image 2026年6月9日 10_58_36 (1).png>) ![alt text](<ChatGPT Image 2026年6月9日 10_58_36 (2).png>) ![alt text](<ChatGPT Image 2026年6月9日 10_58_36 (3).png>)


### 2.1 核心分层原则

| 层级 | 用户问题 | 对应页面 / 模块 |
|---|---|---|
| 配置层 | 我想让系统按什么规则筛日报？ | 日报工作流 |
| 执行层 | 今天的内容如何被筛选、分析、生成？ | 工作台、运行监控 |
| 诊断层 | 哪些内容没入报？为什么？是否需要复核？ | 候选池 |
| 智能体层 | 哪些 Agent 参与分析？输出了什么？ | 智能体中心、工作台 Agent 矩阵 |
| 成果层 | 最终给我看的高质量日报是什么？ | 高质量日报 |

---

## 3. 核心业务流程

### 3.1 标准日报生成链路

```text
内容入口
  ↓
内容去噪 / 去重 / 来源标准化
  ↓
入报筛选
  ↓
中文化与术语标准化
  ↓
候选池生成
  ↓
子智能体并行分析
  ├── 信息分析 Agent
  ├── 数据分析 Agent
  ├── 运行分析 Agent
  └── 洞察提炼 Agent
  ↓
结果融合与置信度评估
  ↓
高质量日报生成
  ↓
人工预览 / 复核 / 导出
```

### 3.2 用户操作主路径

```text
用户进入工作台
  ↓
查看今日概览：内容流入、候选、入报、异常
  ↓
查看当前使用的日报工作流配置
  ↓
如需调整，进入“日报工作流”页面修改规则
  ↓
点击“预览候选池”确认过滤效果
  ↓
点击“试运行”查看漏斗与效果评估
  ↓
点击“运行日报”生成今日候选与 Agent 分析
  ↓
点击“生成高质量日报”
  ↓
进入“高质量日报”阅读与导出
```

---

## 4. 页面一：日报智能工作台

### 4.1 页面定位

工作台是日报系统的总控台，不再承载所有细节。它只回答 4 个问题：

1. 今天系统处理了多少内容？
2. 当前使用了什么个性化日报工作流？
3. 哪些子智能体参与了分析？
4. 最终高质量日报是否已经产出，核心洞察是什么？

### 4.2 页面结构

```text
日报智能工作台
├── 顶部操作区
├── 今日概览 KPI
├── 个性化配置工作流摘要
├── 子智能体分析矩阵
├── 高质量日报预览
└── 右侧运行监控
```

### 4.3 顶部操作区

#### UI 元素

| 元素 | 类型 | 说明 |
|---|---|---|
| 页面标题 | 文本 | 日报智能工作台 |
| 副标题 | 文本 | 个性化过滤配置、智能体协同分析与高质量日报生成的一体化平台 |
| 日期选择 | DatePicker | 默认今日，可切换历史日报 |
| 工作流选择 | Select | 默认工作流，例如“默认工作流（高价值优先）” |
| 运行日报 | Button | 触发当前日期的日报任务 |
| 预览候选池 | Button | 打开候选池预览页或抽屉 |
| 查看最新日报 | Button | 跳转最新已生成日报 |
| 生成高质量日报 | Primary Button | 当候选池与 Agent 分析完成后生成最终日报 |

#### 交互规则

- 如果当天没有运行记录：主按钮显示“运行日报”。
- 如果当天已经运行但未生成日报：主按钮显示“生成高质量日报”。
- 如果当天已生成日报：主按钮显示“查看高质量日报”，旁边显示“重新生成”。
- 运行中状态下按钮显示 Loading，并禁止重复触发。
- 切换工作流时，页面 KPI 与预览漏斗需要基于该工作流刷新。

### 4.4 今日概览 KPI

#### 设计目标

当前 KPI 数量较多，容易分散。V2 应按业务阶段分组。

#### KPI 分组

| 分组 | 指标 | 含义 |
|---|---|---|
| 内容流入 | 主流程可见、匹配范围、今日新增 | 原始内容进入主流程的情况 |
| 过滤后候选 | 高分候选、低分复核、候选总量 | 筛选后值得分析的内容 |
| 入报结果 | 最终入报、被过滤、入报率 | 最终日报采用情况 |
| 异常 / 待处理 | 最新兜底、翻译失败、待处理、低置信兜底 | 需要关注的质量问题 |

#### 前端组件建议

```tsx
<OverviewKpiGroup
  title="内容流入"
  icon="document"
  metrics={[
    { label: '主流程可见', value: 94, trend: 12, trendType: 'up' },
    { label: '匹配范围', value: 45, trend: 8, trendType: 'up' },
  ]}
  footer="新增 99 条"
/>
```

#### 数据字段

```ts
interface DailyOverviewMetrics {
  date: string;
  total_new: number;
  visible_count: number;
  matched_count: number;
  high_score_candidate_count: number;
  low_score_review_count: number;
  final_report_count: number;
  filtered_count: number;
  fallback_count: number;
  translation_failed_count: number;
  pending_count: number;
  low_confidence_fallback_count: number;
  trends?: Record<string, number>;
}
```

### 4.5 个性化配置工作流摘要

#### 设计目标

在首页上不展示完整配置，而是展示当前工作流的 5 个关键步骤，让用户理解系统是如何“从内容到日报”的。

#### 5 个步骤

| 步骤 | 名称 | 首页展示字段 |
|---|---|---|
| 1 | 内容入口 | 最低精选分、入报条数、信源等级 |
| 2 | 入报筛选 | 入报分类、关键词范围、是否要求中文化 |
| 3 | 中文化与标准化 | 翻译模式、术语标准化、去重合并策略 |
| 4 | 子智能体分析 | 启用智能体数、执行模式、结果融合策略 |
| 5 | 高质量日报生成 | 报告模板、包含模块、输出语言 |

#### 首页行为

- 点击任一步骤卡片，跳转到“日报工作流”页面并定位到对应配置区。
- 如果某步骤存在未配置项，状态 chip 显示“需配置”。
- 如果该步骤最近一次运行失败，状态 chip 显示“异常”，并在 Hover 时展示错误原因。

#### 前端组件建议

```tsx
<WorkflowStepSummary
  index={1}
  title="内容入口"
  status="configured"
  params={[
    ['最低精选分', '≥ 55'],
    ['入报条数', '≤ 18'],
    ['信源', 'T1 / T1.5 / T2 / S / A'],
  ]}
  onClick={() => navigate('/daily/workflows/default?section=entry')}
/>
```

### 4.6 子智能体分析矩阵

#### 设计目标

让用户明确：日报不是一个黑盒 Prompt，而是多个可配置、可执行、可观测的 Agent 协作结果。

#### Agent 卡片字段

| 字段 | 说明 |
|---|---|
| Agent 名称 | 例如 信息分析 Agent |
| Agent 状态 | 已启用 / 未启用 / 运行中 / 异常 |
| Agent 角色 | 该 Agent 负责什么 |
| 输入 | 接收什么数据 |
| 输出 | 产出什么结构化结果 |
| 今日输出 | 当日输出数量 |
| 操作 | 查看结果、配置、重跑 |

#### 默认 Agent

| Agent | 输入 | 输出 | 用途 |
|---|---|---|---|
| 信息分析 Agent | 过滤后候选内容 | 结构化信息、主题标签、实体、摘要 | 把内容规整成可分析信息 |
| 数据分析 Agent | 结构化信息与指标 | 趋势、分布、主题热度、来源统计 | 做数据化分析 |
| 运行分析 Agent | 运行日志、系统指标、候选漏斗 | 运行健康、失败原因、质量风险 | 解释系统运行表现 |
| 洞察提炼 Agent | 所有 Agent 输出 | 核心洞察、风险、机会、行动建议 | 生成日报中的高阶分析 |

#### 交互规则

- “查看结果”：打开 Agent 输出详情页或抽屉。
- “配置”：跳转智能体中心或工作流配置页。
- “重跑”：只重跑该 Agent，并更新融合结果。
- 如果 Agent 输出为空，需要展示原因：无输入、运行失败、Schema 校验失败、被禁用。

### 4.7 高质量日报预览

#### 设计目标

首页只展示最终日报的高价值摘要，不展示完整正文。让用户知道最终成果是否值得打开。

#### 内容组成

| 模块 | 说明 |
|---|---|
| 今日核心洞察 | 3 条最重要的结论 |
| 重点条目 TOP 5 | 按最终分排序的入报条目 |
| 报告元信息 | 字数、生成时间、最终分、可信度 |
| 操作 | 查看完整日报、下载 PDF、复制摘要 |

#### 关键规则

- 不在这里展示“泛商业噪声”“未达到入报门槛”等候选诊断内容。
- 候选诊断统一放到候选池页面。
- 预览里的内容必须来自最终日报，而不是原始候选条目。

### 4.8 右侧运行监控

#### 设计目标

让用户知道系统是否健康，但不要抢占最终日报的主视觉。

#### 展示字段

| 字段 | 示例 |
|---|---|
| 执行状态 | 已完成 / 运行中 / 部分失败 / 失败 |
| 完成时间 | 10:23:18 |
| 执行时长 | 18 分 42 秒 |
| Token 消耗 | 128,642 |
| 成功率 | 98.6% |
| 翻译失败 | 0 条 |
| 重试次数 | 3 次 |
| 触发来源 | 定时任务 / 手动触发 |
| 服务状态 | 向量引擎、模型服务、翻译服务 |

---

## 5. 页面二：个性化日报工作流配置

### 5.1 页面定位

该页面是 V2 的核心。它不是普通设置页，而是“日报策略编排器”。

它回答：

1. 日报从哪些内容入口取数据？
2. 如何筛选内容？
3. 如何进行中文化、去重、标准化？
4. 哪些 Agent 参与分析？它们如何协作？
5. 最终报告使用什么模板？
6. 当前工作流效果如何？

### 5.2 页面结构

```text
个性化日报工作流配置
├── 顶部操作区
├── 当前工作流元信息
├── 一、流程编排
├── 二、过滤与评分规则
├── 三、子智能体编排
├── 右侧：Prompt / 模板链路
├── 右侧：预览漏斗
└── 右侧：工作流效果评估
```

### 5.3 顶部操作区

| 操作 | 说明 |
|---|---|
| 日期选择 | 用于基于某天数据预览效果 |
| 工作流选择 | 切换不同工作流 |
| 预览候选池 | 使用当前配置模拟过滤结果 |
| 试运行 | 不保存或生成正式日报，仅运行一次模拟链路 |
| 另存为新版本 | 保存为 v2.1、v2.2 等 |
| 保存工作流 | 保存当前工作流配置 |

### 5.4 当前工作流元信息

#### 字段

```ts
interface WorkflowMetadata {
  id: string;
  name: string;
  version: string;
  description: string;
  target_audience: string[]; // 管理层、投资团队、产品决策层
  owner?: string;
  created_at: string;
  updated_at: string;
  is_default: boolean;
  status: 'draft' | 'active' | 'archived';
}
```

#### UI 要求

- 工作流名称可编辑。
- 版本可选择，但历史版本只读。
- 策略描述限制 80 字以内。
- 目标受众使用 Tag 组件。
- 保存时需要校验：名称不能为空、至少启用一个报告模板、至少启用信息分析 Agent。

### 5.5 一、流程编排

#### 设计目标

将日报生成链路抽象为 5 个可编辑步骤。

#### 步骤配置

```ts
interface WorkflowStepConfig {
  step_key: 'content_entry' | 'filtering' | 'normalization' | 'agent_analysis' | 'report_generation';
  step_name: string;
  enabled: boolean;
  order: number;
  params: Record<string, unknown>;
  status?: 'configured' | 'missing' | 'warning' | 'error';
}
```

#### 步骤一：内容入口

字段：

| 字段 | 类型 | 示例 | 说明 |
|---|---|---|---|
| source_count_min | number | 55 | 最少信源数或主流程可见门槛 |
| source_levels | multi-select | T1, T1.5, T2, S, A | 允许进入的信源等级 |
| include_categories | multi-select | AI, tech-cn, News | 允许进入的源分类 |
| exclude_sources | multi-select | 可选 | 排除信源 |
| freshness_window_hours | number | 36 | 内容时间窗口 |

#### 步骤二：入报筛选

字段：

| 字段 | 类型 | 示例 | 说明 |
|---|---|---|---|
| min_score | number | 85 | 最低入报分 |
| max_items | number | 6 | 最终入报条数上限 |
| per_source_limit | number | 2 | 每个信源最多入报数 |
| categories | multi-select | 公司动态、技术与产品 | 允许入报分类 |
| keywords | chips | AI、大模型、Agent | 关键词范围 |
| fallback_strategy | select | 语义相关补齐 | 候选不足时策略 |
| require_chinese_before_report | boolean | true | 入报前必须中文化 |

#### 步骤三：中文化与标准化

字段：

| 字段 | 类型 | 示例 |
|---|---|---|
| translation_mode | select | 精译模式 / 快速模式 |
| force_chinese | boolean | true |
| terminology_normalization | boolean | true |
| entity_normalization | boolean | true |
| dedup_strategy | select | 标题相似 + 语义相似 |
| merge_strategy | select | 同事件合并 |
| failed_translation_policy | select | 进入诊断池 / 保留英文不入报 / 重试 |

#### 步骤四：子智能体分析

字段：

| 字段 | 类型 | 示例 |
|---|---|---|
| enabled_agents | AgentConfig[] | 信息分析、数据分析、运行分析、洞察提炼 |
| execution_mode | select | parallel / sequential / hybrid |
| result_merge_strategy | select | weighted / latest / manual |
| retry_policy | object | maxRetries: 2 |
| schema_validation | boolean | true |

#### 步骤五：高质量日报生成

字段：

| 字段 | 类型 | 示例 |
|---|---|---|
| report_template_id | string | high_quality_v2 |
| sections | multi-select | 今日总览、信息分析、数据分析、运行分析、洞察建议、附录 |
| output_language | select | 中文 |
| tone | select | 决策简报 / 研究分析 / 管理层摘要 |
| include_source_links | boolean | true |
| include_run_analysis | boolean | true |
| export_formats | multi-select | HTML, PDF, Markdown |

### 5.6 二、过滤与评分规则

#### 设计目标

把影响入报质量的核心参数集中展示，并支持快速调参。

#### 字段定义

```ts
interface FilterRuleConfig {
  categories: string[];
  keyword_scope: {
    mode: 'custom_dictionary' | 'all_keywords' | 'workflow_keywords';
    keywords: string[];
    dictionary_id?: string;
  };
  source_levels: Array<'T1' | 'T1.5' | 'T2' | 'S' | 'A'>;
  min_selected_score: number;
  max_report_items: number;
  per_source_limit: number;
  force_chinese: boolean;
  fallback_strategy: 'none' | 'latest_visible' | 'semantic_related' | 'source_priority' | 'manual_review';
  dedup_enabled: boolean;
  low_confidence_policy: 'skip' | 'review' | 'fallback_pool';
}
```

#### 推荐默认值

```json
{
  "categories": ["公司动态", "市场与行业", "政策监管", "技术与产品", "资金与交易", "其他"],
  "keyword_scope": {
    "mode": "custom_dictionary",
    "keywords": ["AI", "大模型", "Agent", "AIGC", "算力", "芯片", "机器人", "API", "产品", "融资", "监管", "科技"]
  },
  "source_levels": ["T1", "T1.5", "T2", "A"],
  "min_selected_score": 85,
  "max_report_items": 6,
  "per_source_limit": 2,
  "force_chinese": true,
  "fallback_strategy": "semantic_related",
  "dedup_enabled": true,
  "low_confidence_policy": "review"
}
```

### 5.7 三、子智能体编排

#### Agent 配置结构

```ts
interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  icon?: string;
  role: 'information_analysis' | 'data_analysis' | 'run_analysis' | 'insight_synthesis' | 'custom';
  enabled: boolean;
  required: boolean;
  order: number;
  execution_mode: 'parallel' | 'sequential';
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  prompt_template_id: string;
  model_config?: {
    model?: string;
    temperature?: number;
    max_tokens?: number;
  };
}
```

#### 默认 Agent 详细说明

##### 5.7.1 信息分析 Agent

**职责**：将候选内容转为标准结构化信息。

输入：

```ts
interface InformationAgentInput {
  candidates: CandidateItem[];
  workflow_config: WorkflowConfig;
}
```

输出：

```ts
interface InformationAgentOutput {
  items: Array<{
    candidate_id: string;
    normalized_title: string;
    summary: string;
    entities: string[];
    topics: string[];
    category: string;
    source_level: string;
    importance_score: number;
    confidence: number;
  }>;
  topic_clusters: Array<{
    topic: string;
    count: number;
    related_candidate_ids: string[];
  }>;
}
```

##### 5.7.2 数据分析 Agent

**职责**：基于结构化信息做趋势、分布、排行、统计。

输出：

```ts
interface DataAgentOutput {
  source_distribution: Array<{ source_type: string; count: number; ratio: number }>;
  category_distribution: Array<{ category: string; count: number; ratio: number }>;
  hourly_trend: Array<{ hour: string; count: number }>;
  top_entities: Array<{ entity: string; count: number }>;
  top_topics: Array<{ topic: string; count: number }>;
  sentiment_distribution?: {
    positive: number;
    neutral: number;
    negative: number;
  };
}
```

##### 5.7.3 运行分析 Agent

**职责**：解释日报生成过程中的系统质量与风险。

输出：

```ts
interface RunAnalysisAgentOutput {
  health_score: number;
  warnings: Array<{
    type: 'translation' | 'fallback' | 'dedup' | 'low_confidence' | 'agent_failure' | 'source_gap';
    level: 'low' | 'medium' | 'high';
    message: string;
    affected_count?: number;
  }>;
  funnel: Array<{
    stage: string;
    input_count: number;
    output_count: number;
    conversion_rate: number;
  }>;
  token_usage: number;
  execution_time_ms: number;
}
```

##### 5.7.4 洞察提炼 Agent

**职责**：融合信息分析、数据分析、运行分析结果，输出最终日报洞察。

输出：

```ts
interface InsightSynthesisAgentOutput {
  core_insights: Array<{
    title: string;
    content: string;
    evidence_candidate_ids: string[];
    confidence: number;
    impact_level: 'high' | 'medium' | 'low';
  }>;
  opportunities: string[];
  risks: string[];
  recommended_actions: string[];
  executive_summary: string;
}
```

### 5.8 右侧：Prompt / 模板链路

#### 设计目标

把 Prompt 从隐性能力变成可理解的模板链路。

#### 模板链路

| 模板 | 用途 | 输入 | 输出 |
|---|---|---|---|
| 日报清洗 | 去噪、去重、摘要化 | 原始内容 | 清洗后候选 |
| 决策简报 | 提炼决策要点 | 高分候选 | 结论与建议 |
| 研究汇总 | 多维度研究分析 | 结构化信息 | 深度研究段落 |
| 阅读导航 | 生成目录和阅读顺序 | 报告章节 | 阅读导航 |
| 最终日报 | 生成正式中文日报 | 全部 Agent 输出 | 高质量日报 |

### 5.9 右侧：预览漏斗

#### 设计目标

在保存或运行前，用户能快速知道当前配置会造成多少内容流失。

#### 字段

```ts
interface WorkflowPreviewFunnel {
  date_range: string;
  stages: Array<{
    key: string;
    name: string;
    count: number;
    conversion_rate_from_previous?: number;
    conversion_rate_from_total?: number;
  }>;
  estimated_report_count: number;
  estimated_report_rate: number;
}
```

#### 示例

```json
{
  "stages": [
    { "key": "entry", "name": "内容入口", "count": 94 },
    { "key": "filtering", "name": "入报筛选后", "count": 45, "conversion_rate_from_total": 0.479 },
    { "key": "normalization", "name": "中文化与标准化后", "count": 42, "conversion_rate_from_total": 0.447 },
    { "key": "agent_analysis", "name": "子智能体分析后", "count": 38, "conversion_rate_from_total": 0.404 },
    { "key": "report", "name": "高质量日报输出", "count": 17, "conversion_rate_from_total": 0.181 }
  ],
  "estimated_report_count": 17,
  "estimated_report_rate": 0.181
}
```

### 5.10 右侧：工作流效果评估

#### 指标

| 指标 | 说明 |
|---|---|
| 命中率 | 最终入报条目被人工认可或后续阅读的比例 |
| 误伤率 | 被过滤但事后认为应入报的比例 |
| 可读性评分 | 最终日报语言、结构、重点清晰程度 |
| 洞察密度 | 每篇日报中有效洞察数量 |
| 平均耗时 | 近 30 天平均执行时间 |

#### 数据结构

```ts
interface WorkflowEvaluationMetrics {
  hit_rate: number;
  false_negative_rate: number;
  readability_score: number;
  insight_density: number;
  avg_execution_time_minutes: number;
  compared_to_previous?: Record<string, number>;
}
```

---

## 6. 页面三：高质量日报

### 6.1 页面定位

高质量日报页面是最终成果页，不是系统调试页。

它的核心用户可能是：

- 管理层
- 产品负责人
- 投资 / 战略团队
- 研究分析人员
- 业务运营负责人

所以页面应该更像“结构化情报报告”，而不是“候选池列表”。

### 6.2 页面结构

```text
高质量日报
├── 顶部报告摘要条
├── Tabs / 阅读锚点
│   ├── 今日总览
│   ├── 信息分析
│   ├── 数据分析
│   ├── 运行分析
│   ├── 洞察与建议
│   └── 附录条目
└── 右侧阅读导航
```

### 6.3 顶部报告摘要条

| 字段 | 示例 |
|---|---|
| 日期 | 2026-06-08 |
| 工作流 | 默认工作流 / 高价值优先 |
| 生成时间 | 10:23:18 |
| 样本量 | 4,286 条 |
| 来源数 | 89 个来源 |
| 最终入报数 | 99 条 |
| 整体可信度 | 82.4 / 100 |
| 操作 | 导出 PDF、分享、重新生成 |

### 6.4 今日总览

#### 内容要求

- 1 段简短概述。
- 4–6 条关键结论。
- 右侧关键指标速览。

#### 示例结构

```ts
interface ReportOverviewSection {
  summary: string;
  conclusions: string[];
  key_metrics: Array<{
    label: string;
    value: string | number;
    description?: string;
  }>;
}
```

### 6.5 信息分析

#### 内容模块

| 模块 | 说明 |
|---|---|
| 主要主题 TOP 5 | 从入报内容中提取的主题排行 |
| 高价值信号 TOP 5 | 最值得关注的新闻 / 文稿 / 信号 |
| 主题聚类 | 按主题展示信息分布 |
| 热点实体 TOP 5 | 公司、产品、机构、人物等实体 |

#### 入报条目不应只是堆列表

每个重点条目应包含：

```ts
interface ReportImportantItem {
  id: string;
  rank: number;
  title: string;
  summary: string;
  source_name: string;
  source_level: string;
  category: string;
  final_score: number;
  reason: string;
  insight?: string;
  source_url?: string;
}
```

### 6.6 数据分析

#### 内容模块

| 模块 | 说明 |
|---|---|
| 信息趋势 | 按小时 / 日期展示信息量变化 |
| 来源分布 | 新闻媒体、官方渠道、研究机构、海外媒体等 |
| 主题分布 | AI 应用、算力、芯片、投融资、政策等 |
| 情绪与重要性 | 正 / 中 / 负，重要性高 / 中 / 低 |

#### 图表要求

- 图表要小而清晰，不要占满页面。
- 每个图表需要一句自动解释，例如“中午 12 点达到信息峰值，主要由产品发布与投融资新闻驱动”。
- 数据图表和文字洞察要成对出现。

### 6.7 运行分析

#### 设计原则

运行分析可以保留在最终日报中，但应作为“质量说明”，不能占据主导。

#### 内容模块

| 模块 | 说明 |
|---|---|
| 报告生成质量 | 可信度评分、可读性、结构完整性 |
| 过滤转化 | 原始样本 → 最终入报的转化情况 |
| Token 消耗 | 成本指标 |
| 异常 / 失败 | 翻译失败、Agent 失败、重试次数 |
| 风险提示 | 数据覆盖不完整、来源偏差、低置信内容 |

### 6.8 洞察与建议

这是高质量日报的核心价值模块。

#### 内容模块

| 模块 | 说明 |
|---|---|
| 核心洞察 | 从当天信息中总结出的结构性判断 |
| 机会信号 | 值得跟进的市场、产品、投资、合作机会 |
| 风险信号 | 供应链、监管、竞争、舆情等风险 |
| 建议行动 | 面向用户业务的后续动作 |

#### 输出结构

```ts
interface InsightAndRecommendationSection {
  core_insights: string[];
  opportunities: string[];
  risks: string[];
  recommended_actions: Array<{
    action: string;
    priority: 'P0' | 'P1' | 'P2';
    owner_suggestion?: string;
    related_items?: string[];
  }>;
}
```

### 6.9 附录条目

附录用于承接完整入报条目，不影响主报告阅读。

字段：

- 标题
- 来源
- 时间
- 分类
- 评分
- 入报原因
- 原文链接
- 摘要
- 相关洞察

---

## 7. 候选池页面优化建议

### 7.1 页面定位

候选池是诊断页，不是日报页。

它回答：

1. 哪些内容进入了主流程？
2. 哪些内容入报？为什么？
3. 哪些内容没入报？为什么？
4. 哪些内容需要人工复核？
5. 兜底内容是否合理？

### 7.2 建议标签页

```text
候选池
├── 全量候选
├── 已入报
├── 未入报
├── 待复核
├── 兜底候选
└── 噪声样例
```

### 7.3 未入报原因标准化

当前“泛商业噪声”“未达到入报门槛”等方向是对的，但建议结构化。

```ts
type ExclusionReasonCode =
  | 'score_below_threshold'
  | 'category_not_allowed'
  | 'keyword_not_matched'
  | 'source_level_not_allowed'
  | 'duplicate_content'
  | 'business_noise'
  | 'translation_failed'
  | 'low_confidence'
  | 'not_chinese'
  | 'manual_excluded';
```

#### 未入报解释结构

```ts
interface CandidateExclusionReason {
  code: ExclusionReasonCode;
  label: string;
  detail: string;
  fix_action?: 'rerank' | 'translate' | 'manual_review' | 'update_workflow' | 'ignore';
}
```

### 7.4 操作建议

| 操作 | 说明 |
|---|---|
| 重跑评分 | 对单条内容重新评分 |
| 强制入报 | 人工将条目加入最终日报 |
| 标记噪声 | 加入噪声样例库 |
| 调整分类 | 将 uncategorized 改为标准分类 |
| 反馈给工作流 | 将本次判断作为工作流优化样本 |

---

## 8. 关键数据模型

### 8.1 WorkflowConfig

```ts
interface WorkflowConfig {
  id: string;
  name: string;
  version: string;
  description: string;
  target_audience: string[];
  status: 'draft' | 'active' | 'archived';
  is_default: boolean;
  entry: ContentEntryConfig;
  filter: FilterRuleConfig;
  normalization: NormalizationConfig;
  agents: AgentDefinition[];
  report: ReportGenerationConfig;
  created_at: string;
  updated_at: string;
}
```

### 8.2 CandidateItem

```ts
interface CandidateItem {
  id: string;
  date: string;
  title: string;
  normalized_title?: string;
  summary?: string;
  original_url?: string;
  source_name: string;
  source_domain?: string;
  source_level: 'T1' | 'T1.5' | 'T2' | 'S' | 'A' | 'unknown';
  category: string;
  tags: string[];
  language: 'zh' | 'en' | 'other';
  translated: boolean;
  ai_score: number;
  final_score?: number;
  confidence?: number;
  status: 'raw' | 'candidate' | 'selected' | 'filtered' | 'review' | 'fallback';
  inclusion_reason?: string;
  exclusion_reasons?: CandidateExclusionReason[];
  created_at: string;
  updated_at: string;
}
```

### 8.3 DailyRun

```ts
interface DailyRun {
  id: string;
  date: string;
  workflow_id: string;
  workflow_version: string;
  status: 'pending' | 'running' | 'completed' | 'partial_failed' | 'failed' | 'cancelled';
  trigger_source: 'scheduled' | 'manual' | 'retry';
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
  metrics: DailyOverviewMetrics;
  funnel: WorkflowPreviewFunnel;
  errors?: RunError[];
}
```

### 8.4 AgentRun

```ts
interface AgentRun {
  id: string;
  daily_run_id: string;
  agent_id: string;
  agent_name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
  input_count?: number;
  output_count?: number;
  token_usage?: number;
  error_message?: string;
  output_ref?: string;
}
```

### 8.5 DailyReport

```ts
interface DailyReport {
  id: string;
  date: string;
  workflow_id: string;
  workflow_version: string;
  daily_run_id: string;
  title: string;
  status: 'draft' | 'generated' | 'reviewed' | 'published' | 'failed';
  language: 'zh' | 'en';
  word_count: number;
  confidence_score: number;
  generated_at: string;
  sections: ReportSection[];
  important_items: ReportImportantItem[];
  export_urls?: {
    pdf?: string;
    markdown?: string;
    html?: string;
  };
}
```

### 8.6 ReportSection

```ts
interface ReportSection {
  key: 'overview' | 'information_analysis' | 'data_analysis' | 'run_analysis' | 'insights' | 'appendix';
  title: string;
  order: number;
  content: unknown;
  generated_by_agent_ids?: string[];
  confidence?: number;
}
```

---

## 9. API 设计建议

以下接口命名可按现有项目风格调整。

### 9.1 工作台

```http
GET /api/daily/workbench?date=2026-06-08&workflowId=default
```

返回：

```ts
interface DailyWorkbenchResponse {
  date: string;
  workflow: WorkflowConfig;
  overview_metrics: DailyOverviewMetrics;
  workflow_summary: WorkflowStepConfig[];
  agent_summaries: AgentSummary[];
  report_preview?: DailyReportPreview;
  run_monitor: RunMonitorSummary;
}
```

### 9.2 工作流列表

```http
GET /api/daily/workflows
```

### 9.3 工作流详情

```http
GET /api/daily/workflows/:workflowId
```

### 9.4 保存工作流

```http
PUT /api/daily/workflows/:workflowId
Content-Type: application/json
```

Body：

```ts
WorkflowConfig
```

### 9.5 另存为新版本

```http
POST /api/daily/workflows/:workflowId/versions
```

Body：

```ts
{
  "new_version": "v2.1",
  "change_note": "提高入报最低分，启用竞争情报 Agent"
}
```

### 9.6 预览漏斗

```http
POST /api/daily/workflows/:workflowId/preview-funnel
```

Body：

```ts
{
  "date": "2026-06-08",
  "config_override": Partial<WorkflowConfig>
}
```

### 9.7 试运行

```http
POST /api/daily/workflows/:workflowId/dry-run
```

### 9.8 正式运行日报

```http
POST /api/daily/runs
```

Body：

```ts
{
  "date": "2026-06-08",
  "workflow_id": "default",
  "mode": "normal" | "quick" | "complete",
  "force": false
}
```

### 9.9 获取运行详情

```http
GET /api/daily/runs/:runId
```

### 9.10 获取候选池

```http
GET /api/daily/runs/:runId/candidates?status=selected|filtered|review|fallback&reason=business_noise&page=1&pageSize=20
```

### 9.11 单条候选重跑评分

```http
POST /api/daily/candidates/:candidateId/rerank
```

### 9.12 强制入报 / 移出日报

```http
POST /api/daily/candidates/:candidateId/include
POST /api/daily/candidates/:candidateId/exclude
```

### 9.13 获取 Agent 运行结果

```http
GET /api/daily/runs/:runId/agents
GET /api/daily/runs/:runId/agents/:agentId/output
```

### 9.14 重跑单个 Agent

```http
POST /api/daily/runs/:runId/agents/:agentId/rerun
```

### 9.15 生成高质量日报

```http
POST /api/daily/reports/generate
```

Body：

```ts
{
  "date": "2026-06-08",
  "workflow_id": "default",
  "daily_run_id": "run_123",
  "template_id": "high_quality_v2"
}
```

### 9.16 获取日报

```http
GET /api/daily/reports/:reportId
GET /api/daily/reports/latest?date=2026-06-08&workflowId=default
```

### 9.17 导出日报

```http
POST /api/daily/reports/:reportId/export
```

Body：

```ts
{
  "format": "pdf" | "markdown" | "html"
}
```

---

## 10. 前端组件拆分建议

### 10.1 页面级组件

```text
DailyWorkbenchPage
WorkflowConfigPage
CandidatePoolPage
AgentCenterPage
RunMonitorPage
HighQualityReportPage
```

### 10.2 工作台组件

```text
WorkbenchHeader
DailyOverviewKpiSection
OverviewKpiGroupCard
WorkflowSummaryFlow
WorkflowStepSummaryCard
AgentMatrixSection
AgentSummaryCard
ReportPreviewSection
CoreInsightPreviewCard
TopReportItemsList
RunMonitorPanel
```

### 10.3 工作流配置组件

```text
WorkflowConfigHeader
WorkflowMetadataCard
WorkflowStepBuilder
WorkflowStepConfigCard
FilterRuleEditor
KeywordScopeEditor
SourceLevelSelector
AgentOrchestrationEditor
AgentConfigCard
TemplateChainPanel
PreviewFunnelCard
WorkflowEvaluationCard
```

### 10.4 高质量日报组件

```text
ReportHeader
ReportSummaryStrip
ReportTabs
ReportOverviewSection
InformationAnalysisSection
DataAnalysisSection
RunAnalysisSection
InsightsRecommendationSection
ReportAppendixSection
ReadingNavigationPanel
```

### 10.5 候选池组件

```text
CandidatePoolHeader
CandidateStatusTabs
CandidateFilterBar
CandidateCard
CandidateReasonBadge
CandidateActionMenu
CandidateReasonDrawer
ManualReviewPanel
```

---

## 11. 状态设计

### 11.1 DailyRun 状态

```text
pending      等待执行
running      正在执行
completed    全部完成
partial_failed 部分失败，但可继续生成日报
failed       失败，不可生成日报
cancelled    用户取消
```

### 11.2 页面状态

| 状态 | UI 表现 |
|---|---|
| 无今日数据 | 展示 EmptyState，引导“运行日报” |
| 正在运行 | 展示进度、步骤状态、禁用重复按钮 |
| 部分失败 | 展示可生成日报但有风险提示 |
| 已完成未生成日报 | 引导“生成高质量日报” |
| 已生成日报 | 展示日报预览和“查看完整日报” |
| 配置未保存 | 顶部显示“有未保存修改”，离开前确认 |

### 11.3 Agent 状态

```text
disabled     未启用
pending      待执行
running      执行中
completed    已完成
failed       执行失败
skipped      被跳过
schema_error 输出格式错误
```

---

## 12. 评分与过滤逻辑建议

### 12.1 候选入报伪代码

```ts
function selectReportCandidates(
  items: CandidateItem[],
  config: FilterRuleConfig
): CandidateItem[] {
  const filtered = items
    .filter(item => config.source_levels.includes(item.source_level))
    .filter(item => config.categories.includes(item.category))
    .filter(item => item.ai_score >= config.min_selected_score)
    .filter(item => matchKeywordScope(item, config.keyword_scope))
    .filter(item => config.force_chinese ? item.language === 'zh' || item.translated : true)
    .filter(item => !isDuplicate(item));

  const sorted = filtered.sort((a, b) => {
    const scoreA = computeFinalScore(a, config);
    const scoreB = computeFinalScore(b, config);
    return scoreB - scoreA;
  });

  return applyPerSourceLimit(sorted, config.per_source_limit)
    .slice(0, config.max_report_items);
}
```

### 12.2 最终分建议

```ts
final_score =
  ai_score * 0.45 +
  source_weight * 0.20 +
  keyword_relevance * 0.15 +
  freshness_score * 0.10 +
  novelty_score * 0.10
```

### 12.3 source_weight 示例

| 信源等级 | 权重分 |
|---|---:|
| T1 | 100 |
| T1.5 | 90 |
| T2 | 75 |
| S | 65 |
| A | 60 |
| unknown | 40 |

### 12.4 兜底策略

| 策略 | 说明 |
|---|---|
| none | 不兜底 |
| latest_visible | 使用最新可见内容补齐 |
| semantic_related | 使用语义相关内容补齐 |
| source_priority | 优先高信源内容补齐 |
| manual_review | 候选不足时进入人工复核 |

### 12.5 uncategorized 修复策略

当前系统中 `uncategorized` 占比偏高，建议新增标准化归类步骤：

1. 优先使用现有 feed 分类。
2. 若 feed 分类为空，使用关键词分类。
3. 若关键词分类不确定，调用分类 Agent。
4. 若分类置信度低于阈值，进入“待复核”。
5. 不建议直接把大量内容以 `uncategorized` 入报。

标准分类建议：

```ts
const DAILY_REPORT_CATEGORIES = [
  '公司动态',
  '市场与行业',
  '政策监管',
  '技术与产品',
  '资金与交易',
  '研究与数据',
  '竞争情报',
  '风险事件',
  '其他'
];
```

---

## 13. 视觉与交互规范

### 13.1 设计原则

| 原则 | 说明 |
|---|---|
| 层次清晰 | 首页不堆所有内容，只展示关键摘要 |
| 结果与过程分离 | 运行指标在运行监控，最终洞察在高质量日报 |
| 参数可解释 | 每个筛选参数要解释影响范围 |
| Agent 可理解 | 每个 Agent 都要展示输入、输出、状态、操作 |
| 异常可处理 | 每类异常都要给出下一步动作 |

### 13.2 颜色建议

| 用途 | 建议 |
|---|---|
| 主操作 | 蓝色 |
| 成功 / 已启用 | 绿色 |
| 洞察 / 智能体 | 紫色或蓝紫色 |
| 需要关注 | 琥珀色 |
| 失败 / 风险 | 红色 |
| 普通信息 | 中性色 |

### 13.3 信息密度

- 首页控制在 4 个主区块 + 右侧监控。
- 候选卡片不要放在首页主区域。
- 最终日报页面要更偏阅读，而不是表格管理。
- 配置页允许更高信息密度，但需要按“一、二、三、四、五、六”分组。

---

## 14. 开发实施拆分

### Phase 1：信息架构与路由重构

目标：先把页面边界拆清楚。

任务：

- 新增 / 调整路由：
  - `/daily/workbench`
  - `/daily/workflows`
  - `/daily/candidates`
  - `/daily/agents`
  - `/daily/runs`
  - `/daily/reports/:reportId`
- 左侧导航新增或调整对应入口。
- 将当前混在日报页面中的内容拆分到对应页面。
- 保留旧页面入口，但加 redirect 或兼容层。

验收：

- 工作台不再直接展示大量候选卡片。
- 候选池内容进入候选池页面。
- 最终日报内容进入高质量日报页面。

### Phase 2：工作台首页改造

任务：

- 实现顶部控制区。
- 实现今日概览 KPI 分组。
- 实现 5 步工作流摘要。
- 实现子智能体分析矩阵。
- 实现高质量日报预览。
- 实现右侧运行监控。

验收：

- 用户 10 秒内能理解当天日报状态。
- 用户能一键进入工作流配置、候选池、最终日报。
- 运行指标和最终日报预览视觉上明显分离。

### Phase 3：个性化工作流配置页

任务：

- 实现工作流元信息编辑。
- 实现流程编排 5 步卡片。
- 实现过滤与评分规则编辑。
- 实现 Agent 编排卡片。
- 实现 Prompt / 模板链路展示。
- 实现预览漏斗。
- 实现工作流效果评估。
- 实现保存、另存版本、试运行。

验收：

- 用户可以完成一套工作流从配置到保存。
- 修改最低分、分类、关键词、Agent 后，预览漏斗会变化。
- 保存时有校验和错误提示。

### Phase 4：高质量日报页面

任务：

- 实现报告摘要条。
- 实现今日总览、信息分析、数据分析、运行分析、洞察建议、附录条目。
- 实现右侧阅读导航。
- 实现导出 PDF / 分享 / 重新生成操作入口。

验收：

- 页面读起来像正式报告。
- 洞察与建议明显优先于原始条目。
- 运行分析只是质量说明，不喧宾夺主。

### Phase 5：候选池诊断优化

任务：

- 标准化未入报原因。
- 支持按原因筛选。
- 支持重跑评分、强制入报、标记噪声、调整分类。
- 修复 uncategorized 过高的问题。

验收：

- 每条未入报内容都有标准原因 code。
- 用户可以对关键条目进行人工干预。
- 候选池成为诊断和优化工作流的入口。

### Phase 6：Agent 结果与运行监控

任务：

- 建立 AgentRun 数据结构。
- 展示 Agent 输入、输出、状态、耗时、Token。
- 支持单个 Agent 重跑。
- 运行监控页展示任务日志、失败重试、服务健康。

验收：

- 用户能知道每个 Agent 是否真的执行。
- Agent 异常可定位、可重跑。
- 日报生成链路具备可观测性。

---

## 15. 验收标准

### 15.1 产品验收

| 验收项 | 标准 |
|---|---|
| 首页信息分层 | KPI、工作流、Agent、日报预览、运行监控分区明确 |
| 工作流可配置 | 过滤、中文化、Agent、模板均可编辑 |
| 候选池可诊断 | 每条未入报内容有标准原因 |
| Agent 可执行 | 可看到 Agent 状态、输入输出、结果和重跑入口 |
| 最终日报高质量 | 有总览、信息分析、数据分析、运行分析、洞察建议 |
| 运行可观测 | 有耗时、Token、成功率、失败、重试、服务健康 |

### 15.2 技术验收

| 验收项 | 标准 |
|---|---|
| TypeScript 类型 | 核心数据结构有类型定义 |
| 接口错误处理 | 所有 API 有 loading / error / empty 状态 |
| 状态一致性 | run、candidate、agent、report 状态能互相对应 |
| 可扩展性 | 新增 Agent 不需要重写页面结构 |
| 向后兼容 | 旧日报数据可展示，缺失字段有 fallback |
| 性能 | 首页首屏不加载完整候选池，只加载摘要 |

---

## 16. 测试用例

### 16.1 工作台

1. 当天无日报运行记录：显示空状态与“运行日报”。
2. 当天运行中：按钮 Loading，右侧监控显示执行中。
3. 当天运行失败：显示失败原因与重试入口。
4. 当天已完成但未生成日报：显示“生成高质量日报”。
5. 当天已生成日报：显示日报预览和“查看完整日报”。
6. 切换日期后，所有指标刷新。
7. 切换工作流后，工作流摘要和预览变化。

### 16.2 工作流配置

1. 修改最低精选分，预览漏斗变化。
2. 关闭强制中文化，提示可能影响最终日报质量。
3. 关闭必选 Agent，保存时报错。
4. 新增自定义 Agent，能保存并显示在 Agent 编排中。
5. 点击试运行，生成 dry-run 结果，不覆盖正式日报。
6. 另存为新版本后，版本号增加，旧版本只读。

### 16.3 候选池

1. 过滤状态为 selected，只展示已入报。
2. 过滤 reason=business_noise，只展示泛商业噪声。
3. 对单条内容点击重跑评分，分数刷新。
4. 对单条内容强制入报，状态变 selected。
5. 调整分类后，uncategorized 数量减少。

### 16.4 高质量日报

1. 报告不存在时展示空状态。
2. 报告生成中时展示进度。
3. 报告已生成时展示完整结构。
4. 点击右侧阅读导航可定位到对应章节。
5. 导出 PDF 成功后返回下载链接。
6. 重新生成后报告版本更新。

### 16.5 Agent

1. Agent 执行成功，显示输出数量。
2. Agent 执行失败，显示错误与重跑按钮。
3. Agent 输出 Schema 错误，进入 schema_error 状态。
4. 重跑单个 Agent 后，融合结果更新。

---

## 17. Codex 开发提示词

以下内容可以直接复制给 Codex 作为开发任务起点。

```text
你需要在现有日报系统中实现 V2 信息架构与页面改造。请先阅读当前代码结构，找到现有日报页面、候选池、工作流配置、日报生成、运行统计相关组件和 API。不要大规模重写无关代码，优先复用现有 UI 组件、接口封装、状态管理、样式系统。

目标：把当前混合展示的日报页面重构为 6 个模块：工作台、日报工作流、候选池、智能体中心、运行监控、高质量日报。

第一优先级实现 3 个核心页面：
1. /daily/workbench：日报智能工作台
2. /daily/workflows：个性化日报工作流配置
3. /daily/reports/:reportId：高质量日报

工作台必须包含：
- 顶部控制区：日期、工作流选择、运行日报、预览候选池、查看最新日报、生成高质量日报
- 今日概览 KPI 分组：内容流入、过滤后候选、入报结果、异常/待处理
- 个性化配置工作流 5 步摘要：内容入口、入报筛选、中文化与标准化、子智能体分析、高质量日报生成
- 子智能体分析矩阵：信息分析Agent、数据分析Agent、运行分析Agent、洞察提炼Agent
- 高质量日报预览：今日核心洞察、重点条目 TOP 5
- 右侧运行监控：执行状态、耗时、Token、成功率、翻译失败、重试次数、服务状态

工作流配置页必须包含：
- 当前工作流元信息
- 流程编排 5 步卡片
- 过滤与评分规则编辑：入报分类、关键词范围、信源等级、最低精选分、入报条数上限、每信源上限、强制中文化、兜底策略
- 子智能体编排：Agent 开关、顺序、输入、输出、配置入口
- Prompt / 模板链路
- 预览漏斗
- 工作流效果评估
- 保存、另存为新版本、试运行、预览候选池

高质量日报页必须包含：
- 报告摘要条：日期、工作流、生成时间、样本量、最终入报数、可信度评分
- 今日总览
- 信息分析
- 数据分析
- 运行分析
- 洞察与建议
- 附录条目
- 右侧阅读导航
- 导出 PDF、分享、重新生成

关键要求：
- 首页不要展示大量候选卡片，只展示摘要和入口。
- 候选池诊断从首页拆出去。
- 最终日报要像正式业务报告，不要像系统调试页。
- Agent 要作为可执行、可配置、可观测的子模块呈现。
- 所有新数据结构使用 TypeScript 类型定义。
- 如果后端接口暂时缺失，请先实现 mock adapter 或兼容层，保持页面可运行。
- 所有 API 调用要有 loading、empty、error 状态。
- 保留现有数据字段的兼容逻辑，例如 uncategorized、skipped、pending、fallback 等。

请按以下顺序提交：
1. 类型定义与 mock/adapter 层
2. 工作台页面
3. 工作流配置页面
4. 高质量日报页面
5. 候选池与 Agent 状态兼容
6. 测试与样式 polish
```

---

## 18. Codex 执行时的代码搜索建议

让 Codex 先在仓库里搜索以下关键词，定位现有实现：

```text
日报
daily
report
candidate
候选
workflow
工作流
agent
智能体
run
运行
fallback
兜底
uncategorized
skipped
pending
score
精选分
```

然后让它输出：

```text
1. 当前相关页面路径
2. 当前相关组件
3. 当前 API / server action
4. 当前数据结构
5. 可以复用的 UI 组件
6. 需要新增的组件
7. 需要迁移的旧逻辑
```

---

## 19. 开发注意事项

### 19.1 不建议一次性做的事

- 不要直接重写全部日报逻辑。
- 不要把所有数据都塞到首页。
- 不要把 Agent 输出和最终报告正文混在一起。
- 不要把候选池当成日报正文。
- 不要让 `uncategorized` 作为主要入报分类长期存在。

### 19.2 建议优先做的事

- 先完成信息架构拆分。
- 先用 mock/adapter 跑通页面。
- 再接真实后端字段。
- 再补交互和状态。
- 最后优化生成逻辑和评估指标。

### 19.3 向后兼容

如果旧数据没有以下字段，需要 fallback：

| 新字段 | fallback |
|---|---|
| workflow_id | default |
| workflow_version | v1.0 |
| final_score | ai_score |
| normalized_title | title |
| category | uncategorized |
| confidence_score | 0 |
| agent_outputs | 空数组 |
| report_sections | 从旧日报正文解析或只展示正文 |

---

## 20. 最小可行版本范围

如果开发时间有限，建议 MVP 只做：

1. 新工作台首页。
2. 工作流配置页的静态 + 保存能力。
3. 高质量日报页的结构化展示。
4. 候选池保留现有逻辑，只调整入口。
5. Agent 矩阵先展示状态与结果数量，重跑功能延后。

MVP 不强制实现：

- 拖拽 Agent 排序。
- 完整 PDF 排版。
- 历史版本对比。
- 自动学习反馈。
- 完整智能体中心。

---

## 21. 未来增强方向

| 方向 | 说明 |
|---|---|
| 多工作流画像 | 不同团队使用不同日报策略 |
| 人工反馈学习 | 用户强制入报 / 排除反哺评分模型 |
| 智能体市场 | 允许新增行业分析、竞品分析、政策分析 Agent |
| 报告模板中心 | 管理层日报、投资日报、产品日报、研究日报 |
| 标签体系治理 | 统一分类、主题、实体、行业、信源等级 |
| 质量评分闭环 | 用阅读率、收藏、人工评分衡量日报质量 |
| 多语言报告 | 中英双语、只输出中文、原文保留 |

---

## 22. 结论

本次 V2 改造的关键不是增加更多卡片，而是重建用户心智：

```text
我配置日报策略 → 系统按策略过滤 → 多个智能体分析 → 系统解释运行质量 → 输出高质量洞察日报。
```

因此，需要明确拆开：

- 工作流配置：用户控制系统如何筛选和分析。
- 候选池：解释内容为什么入报或未入报。
- Agent 矩阵：展示 AI 分析能力如何协作。
- 运行监控：展示系统执行是否可靠。
- 高质量日报：展示最终可阅读、可决策、可导出的成果。

这套结构能让你的产品从“日报生成工具”升级为“可配置的情报分析工作台”。
