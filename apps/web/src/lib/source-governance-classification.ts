import type { SourceRecord } from './api/contracts';

export const SOURCE_TOPIC_GROUP_OPTIONS = [
  { value: 'ai_frontier', label: 'AI 前沿' },
  { value: 'agents_products', label: 'Agent 与产品' },
  { value: 'infrastructure', label: '基础设施与算力' },
  { value: 'engineering', label: '技术工程' },
  { value: 'business_industry', label: '商业与产业' },
  { value: 'policy_safety', label: '政策与安全' },
  { value: 'research_deep', label: '研究与深读' },
  { value: 'society_culture', label: '社会与文化' },
  { value: 'tools_lifestyle', label: '工具与生活' },
  { value: 'other', label: '其他' },
] as const;

export const SOURCE_GOVERNANCE_ROLE_OPTIONS = [
  { value: 'first_party', label: '官方一手' },
  { value: 'professional_media', label: '专业媒体' },
  { value: 'personal_blog', label: '个人博客' },
  { value: 'aggregator', label: '聚合发现' },
  { value: 'community_social', label: '社区与社交' },
  { value: 'monitor', label: '网页监控' },
  { value: 'private_inbox', label: '私密收件箱' },
  { value: 'audio_video', label: '播客与视频' },
  { value: 'other', label: '其他来源' },
] as const;

export const SOURCE_GOVERNANCE_STATUS_OPTIONS = [
  { value: 'all', label: '全部治理状态' },
  { value: 'pending', label: '待人工确认' },
  { value: 'manual', label: '已人工确认' },
] as const;

export type SourceTopicGroup = typeof SOURCE_TOPIC_GROUP_OPTIONS[number]['value'];
export type SourceGovernanceRole = typeof SOURCE_GOVERNANCE_ROLE_OPTIONS[number]['value'];
export type SourceGovernanceStatus = typeof SOURCE_GOVERNANCE_STATUS_OPTIONS[number]['value'];

function optionLabel<T extends readonly { value: string; label: string }[]>(options: T, value?: string | null) {
  return options.find((option) => option.value === value)?.label || value || '待分类';
}

export function sourceTopicGroupLabel(source: Pick<SourceRecord, 'topicGroup' | 'topicGroupLabel'>) {
  return source.topicGroupLabel || optionLabel(SOURCE_TOPIC_GROUP_OPTIONS, source.topicGroup);
}

export function sourceGovernanceRoleLabel(source: Pick<SourceRecord, 'governanceRole' | 'governanceRoleLabel'>) {
  return source.governanceRoleLabel || optionLabel(SOURCE_GOVERNANCE_ROLE_OPTIONS, source.governanceRole);
}

export function sourceGovernanceStatusLabel(source: Pick<SourceRecord, 'classificationSource' | 'needsGovernanceReview'>) {
  if (source.needsGovernanceReview === false || source.classificationSource === 'manual') return '人工确认';
  if (source.classificationSource === 'partial') return '部分确认';
  return '系统预分类';
}
