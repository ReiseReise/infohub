export const SOURCE_TOPIC_GROUP_VALUES = [
  'ai_frontier',
  'agents_products',
  'infrastructure',
  'engineering',
  'business_industry',
  'policy_safety',
  'research_deep',
  'society_culture',
  'tools_lifestyle',
  'other',
] as const;

export const SOURCE_GOVERNANCE_ROLE_VALUES = [
  'first_party',
  'professional_media',
  'personal_blog',
  'aggregator',
  'community_social',
  'monitor',
  'private_inbox',
  'audio_video',
  'other',
] as const;

export type SourceTopicGroupValue = typeof SOURCE_TOPIC_GROUP_VALUES[number];
export type SourceGovernanceRoleValue = typeof SOURCE_GOVERNANCE_ROLE_VALUES[number];
export type SourceClassificationSource = 'manual' | 'partial' | 'cold_start';

export interface SourceGovernanceClassificationInput {
  name?: string | null;
  category?: string | null;
  sourceType?: string | null;
  collectorType?: string | null;
  sourceKind?: string | null;
  sourceRole?: string | null;
  config?: unknown;
}

export interface SourceGovernanceClassification {
  topicGroup: SourceTopicGroupValue;
  topicGroupLabel: string;
  governanceRole: SourceGovernanceRoleValue;
  governanceRoleLabel: string;
  classificationSource: SourceClassificationSource;
  needsGovernanceReview: boolean;
  classificationReasons: string[];
}

const TOPIC_LABELS: Record<SourceTopicGroupValue, string> = {
  ai_frontier: 'AI 前沿',
  agents_products: 'Agent 与产品',
  infrastructure: '基础设施与算力',
  engineering: '技术工程',
  business_industry: '商业与产业',
  policy_safety: '政策与安全',
  research_deep: '研究与深读',
  society_culture: '社会与文化',
  tools_lifestyle: '工具与生活',
  other: '其他',
};

const ROLE_LABELS: Record<SourceGovernanceRoleValue, string> = {
  first_party: '官方一手',
  professional_media: '专业媒体',
  personal_blog: '个人博客',
  aggregator: '聚合发现',
  community_social: '社区与社交',
  monitor: '网页监控',
  private_inbox: '私密收件箱',
  audio_video: '播客与视频',
  other: '其他来源',
};

function getConfigObject(config: unknown): Record<string, unknown> {
  return config && typeof config === 'object' ? config as Record<string, unknown> : {};
}

function getConfiguredHost(config: unknown): string {
  const object = getConfigObject(config);
  for (const key of ['htmlUrl', 'url', 'endpoint', 'feedUrl']) {
    const candidate = object[key];
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    try {
      return new URL(candidate).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      continue;
    }
  }
  return '';
}

export function normalizeSourceTopicGroup(value: unknown): SourceTopicGroupValue | null {
  const normalized = String(value || '').trim().toLowerCase().replace(/-/g, '_');
  return (SOURCE_TOPIC_GROUP_VALUES as readonly string[]).includes(normalized)
    ? normalized as SourceTopicGroupValue
    : null;
}

export function normalizeSourceGovernanceRole(value: unknown): SourceGovernanceRoleValue | null {
  const normalized = String(value || '').trim().toLowerCase().replace(/-/g, '_');
  return (SOURCE_GOVERNANCE_ROLE_VALUES as readonly string[]).includes(normalized)
    ? normalized as SourceGovernanceRoleValue
    : null;
}

function inferTopicGroup(input: SourceGovernanceClassificationInput): { value: SourceTopicGroupValue; reason: string } {
  const text = `${input.name || ''} ${input.category || ''}`
    .replace(/高价值|浅阅读|扫读|探索池|暂停候选/gi, ' ')
    .toLowerCase();
  if (/policy|regulat|governance|law|legal|safety|security|alignment|政策|监管|法律|安全|治理|对齐/.test(text)) {
    return { value: 'policy_safety', reason: '名称或原分类命中政策、监管或安全' };
  }
  if (/chip|semiconductor|nvidia|compute|inference|cloud|infra|hardware|data.?center|芯片|算力|推理|云服务|硬件|数据中心|基础设施/.test(text)) {
    return { value: 'infrastructure', reason: '名称或原分类命中算力与基础设施' };
  }
  if (/agent|copilot|codex|claude code|product|app|workflow|智能体|产品|应用|工作流/.test(text)) {
    return { value: 'agents_products', reason: '名称或原分类命中 Agent、产品或应用' };
  }
  if (/openai|anthropic|deepmind|gemini|claude|gpt|llm|language model|foundation model|machine learning|artificial intelligence|\bai\b|大模型|模型|人工智能|机器学习/.test(text)) {
    return { value: 'ai_frontier', reason: '名称或原分类命中 AI 模型与实验室' };
  }
  if (/techcrunch|36kr|business|industry|startup|venture|capital|finance|investment|market|jobs?|hiring|商业|产业|创业|融资|资本|投资|财经|出海|交易|优惠|招聘|求职/.test(text)) {
    return { value: 'business_industry', reason: '名称或原分类命中商业、资本或产业' };
  }
  if (/research|paper|science|academic|newsletter|weekly|blog|read|研究|论文|科学|博客|深读|周刊|阅读/.test(text)) {
    return { value: 'research_deep', reason: '原分类更适合研究与深读' };
  }
  if (/\btech\b|code|developer|program|engineering|software|opensource|open source|代码|程序|开发|工程|软件|开源|技术/.test(text)) {
    return { value: 'engineering', reason: '名称或原分类命中工程与开发' };
  }
  if (/society|culture|news|life.?style|社会|文化|新闻|生活|人文/.test(text)) {
    return { value: 'society_culture', reason: '原分类更适合社会、文化或新闻' };
  }
  if (/tool|productivity|design|mac|app&|工具|效率|设计|软件推荐|生活方式/.test(text)) {
    return { value: 'tools_lifestyle', reason: '原分类更适合工具、效率与生活' };
  }
  return { value: 'other', reason: '当前信息不足，先放入其他' };
}

function inferGovernanceRole(input: SourceGovernanceClassificationInput): { value: SourceGovernanceRoleValue; reason: string } {
  const name = String(input.name || '').toLowerCase();
  const category = String(input.category || '').toLowerCase();
  const sourceKind = String(input.sourceKind || '').toLowerCase();
  const sourceRole = String(input.sourceRole || '').toLowerCase();
  const sourceType = String(input.sourceType || '').toLowerCase();
  const collector = String(input.collectorType || '').toLowerCase();
  const text = `${name} ${category}`;
  const configuredHost = getConfiguredHost(input.config);
  const knownFirstPartyDomains: Array<{ name: RegExp; domains: string[] }> = [
    { name: /^openai(?: news)?$/i, domains: ['openai.com'] },
    { name: /anthropic (?:newsroom|engineering)/i, domains: ['anthropic.com'] },
    { name: /^claude blog$/i, domains: ['claude.com', 'anthropic.com'] },
    { name: /^(google deepmind|deepmind)$/i, domains: ['deepmind.google', 'google.com'] },
    { name: /^nvidia$/i, domains: ['nvidia.com'] },
    { name: /^microsoft research$/i, domains: ['microsoft.com'] },
    { name: /^hugging face(?: blog)?$/i, domains: ['huggingface.co'] },
  ];
  const knownFirstParty = knownFirstPartyDomains.find((entry) => entry.name.test(String(input.name || '').trim()));

  if (sourceRole === 'monitor' || ['webpage', 'changedetection'].includes(collector)) {
    return { value: 'monitor', reason: '采集器用于网页监控' };
  }
  if (sourceRole === 'inbox' || sourceType === 'email' || /email|inbox|邮箱|邮件/.test(text)) {
    return { value: 'private_inbox', reason: '来源属于私密邮箱入口' };
  }
  if (sourceKind === 'podcast' || sourceType === 'audio' || ['podcast', 'youtube'].includes(collector)) {
    return { value: 'audio_video', reason: '来源为播客或视频' };
  }
  if (sourceKind === 'x' || sourceKind === 'wechat' || /twitter|mastodon|v2ex|forum|community|社区|论坛|公众号/.test(text)) {
    return { value: 'community_social', reason: '来源来自社区或社交网络' };
  }
  if (knownFirstParty && configuredHost && !knownFirstParty.domains.some((domain) => configuredHost === domain || configuredHost.endsWith(`.${domain}`))) {
    return { value: 'other', reason: '名称像官方来源，但订阅域名不匹配，需人工确认' };
  }
  if (sourceKind === 'official' || knownFirstParty || /newsroom|official (blog|news)|官方/.test(text)) {
    return { value: 'first_party', reason: '当前来源类型为官方一手' };
  }
  if (sourceType === 'curated_index' || collector === 'webpage_index' || /bestblogs|blogfinder|daily brief|榜单|聚合/.test(text)) {
    return { value: 'aggregator', reason: '来源为榜单或聚合发现入口' };
  }
  if (sourceKind === 'media' || /reuters|techcrunch|36kr|macrumors|媒体|财经|新闻/.test(text)) {
    return { value: 'professional_media', reason: '来源为专业媒体或资讯机构' };
  }
  if (sourceKind === 'blog' || /blog|blogs|newsletter|博客|周刊/.test(text)) {
    return { value: 'personal_blog', reason: '来源为个人博客或独立写作' };
  }
  return { value: 'other', reason: '当前来源角色需要人工确认' };
}

export function classifySourceGovernance(input: SourceGovernanceClassificationInput): SourceGovernanceClassification {
  const config = getConfigObject(input.config);
  const manualTopic = normalizeSourceTopicGroup(config.topicGroup);
  const manualRole = normalizeSourceGovernanceRole(config.governanceRole);
  const inferredTopic = inferTopicGroup(input);
  const inferredRole = inferGovernanceRole(input);
  const topicGroup = manualTopic || inferredTopic.value;
  const governanceRole = manualRole || inferredRole.value;
  const classificationSource: SourceClassificationSource = manualTopic && manualRole
    ? 'manual'
    : manualTopic || manualRole
      ? 'partial'
      : 'cold_start';

  return {
    topicGroup,
    topicGroupLabel: TOPIC_LABELS[topicGroup],
    governanceRole,
    governanceRoleLabel: ROLE_LABELS[governanceRole],
    classificationSource,
    needsGovernanceReview: classificationSource !== 'manual',
    classificationReasons: [
      manualTopic ? '主题方向已由人工确认' : inferredTopic.reason,
      manualRole ? '来源角色已由人工确认' : inferredRole.reason,
    ],
  };
}

export function isFirstPartySource(input: SourceGovernanceClassificationInput): boolean {
  return classifySourceGovernance(input).governanceRole === 'first_party';
}

export function sourceTopicGroupLabel(value: SourceTopicGroupValue): string {
  return TOPIC_LABELS[value];
}

export function sourceGovernanceRoleLabel(value: SourceGovernanceRoleValue): string {
  return ROLE_LABELS[value];
}
