import type { SourceRecord } from './api/contracts';

export const SOURCE_READING_TIER_OPTIONS = [
  { value: 'high_value', label: '高价值' },
  { value: 'light_reading', label: '浅阅读' },
  { value: 'explore', label: '探索池' },
  { value: 'paused', label: '暂停候选' },
] as const;

export type SourceReadingTierValue = typeof SOURCE_READING_TIER_OPTIONS[number]['value'];

export interface SourceReadingTierResult {
  value: SourceReadingTierValue;
  label: string;
  reason: string;
  className: string;
}

function getConfigObject(config: unknown): Record<string, unknown> {
  return (config && typeof config === 'object') ? config as Record<string, unknown> : {};
}

function normalizeReadingTier(value: unknown): SourceReadingTierValue | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/-/g, '_');
  if (SOURCE_READING_TIER_OPTIONS.some((option) => option.value === normalized)) return normalized as SourceReadingTierValue;
  if (['core', 'deep', 'deep_read', 'high', '高价值', '深读'].includes(normalized)) return 'high_value';
  if (['skim', 'light', 'brief', '浅阅读', '轻阅读'].includes(normalized)) return 'light_reading';
  if (['watch', 'trial', 'exploratory', '探索', '观察'].includes(normalized)) return 'explore';
  if (['disabled', 'pause', 'paused', '低效', '暂停'].includes(normalized)) return 'paused';
  return null;
}

function normalizeTags(tags: unknown): string[] {
  if (Array.isArray(tags)) return tags.map((tag) => String(tag || '').trim()).filter(Boolean);
  if (typeof tags === 'string') return tags.split(/[,，\s]+/).map((tag) => tag.trim()).filter(Boolean);
  return [];
}

function readingTierClassName(value: SourceReadingTierValue): string {
  switch (value) {
    case 'high_value':
      return 'border-teal-200 bg-teal-50 text-teal-700';
    case 'light_reading':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'paused':
      return 'border-rose-200 bg-rose-50 text-rose-700';
    default:
      return 'border-sky-200 bg-sky-50 text-sky-700';
  }
}

function result(value: SourceReadingTierValue, reason: string): SourceReadingTierResult {
  const option = SOURCE_READING_TIER_OPTIONS.find((entry) => entry.value === value);
  return {
    value,
    label: option?.label || value,
    reason,
    className: readingTierClassName(value),
  };
}

export function resolveSourceReadingTier(source: Partial<SourceRecord>): SourceReadingTierResult {
  const apiValue = normalizeReadingTier(source.readingTier);
  if (apiValue) return result(apiValue, source.readingTierReason || '系统识别');

  const config = getConfigObject(source.config);
  const explicit = normalizeReadingTier(config.readingTier ?? config.sourceReadingTier ?? config.consumptionTier);
  if (explicit) return result(explicit, '人工标记');

  const tags = normalizeTags(source.tags);
  const tagText = tags.join(' ').toLowerCase();
  if (/高价值|深读|核心|deep|high[-_ ]?value/.test(tagText)) return result('high_value', '标签标记为高价值');
  if (/浅阅读|轻阅读|快扫|skim|brief|light/.test(tagText)) return result('light_reading', '标签标记为浅阅读');
  if (/暂停|低效|停用|paused|disabled/.test(tagText)) return result('paused', '标签标记为暂停候选');

  const status = String(source.status || '').toLowerCase();
  if (status === 'paused' || source.autoFetchEnabled === false) return result('paused', '已暂停或关闭自动抓取');

  const sourceTier = String(source.sourceTier || '').toUpperCase();
  if (['S', 'A'].includes(sourceTier)) return result('high_value', '系统建议：高权威来源优先深读');

  const category = String(source.category || '').toLowerCase();
  const name = String(source.name || '').toLowerCase();
  const text = `${category} ${name}`;
  if (/浅阅读|轻阅读|quick|brief|daily|newsletter|周刊|日报/.test(text)) return result('light_reading', '名称或分类适合快扫');

  const collectorType = String(source.collectorType || '').toLowerCase();
  const sourceType = String(source.sourceType || '').toLowerCase();
  if (['webpage', 'webpage_index', 'changedetection', 'custom'].includes(collectorType) || /monitor|webpage|curated_index/.test(sourceType)) {
    return result('explore', '索引/监控类来源需要观察');
  }

  if (sourceTier === 'B') return result('light_reading', '系统建议：常规资讯源适合快扫');
  if (['C', 'D'].includes(sourceTier)) return result('explore', '低等级来源待观察');
  return result('explore', '未人工标记，先进入探索池');
}

export function sourceReadingTierBadge(source: Partial<SourceRecord>): SourceReadingTierResult {
  return resolveSourceReadingTier(source);
}
