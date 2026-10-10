export const SOURCE_READING_TIER_VALUES = ['high_value', 'light_reading', 'explore', 'paused'] as const;

export type SourceReadingTierValue = typeof SOURCE_READING_TIER_VALUES[number];

export interface SourceReadingTierInput {
  name?: string | null;
  sourceTier?: string | null;
  collectorType?: string | null;
  sourceType?: string | null;
  sourceKind?: string | null;
  category?: string | null;
  status?: string | null;
  autoFetchEnabled?: boolean | null;
  tags?: unknown;
  config?: unknown;
}

export interface SourceReadingTierResult {
  value: SourceReadingTierValue;
  label: string;
  reason: string;
}

const LABELS: Record<SourceReadingTierValue, string> = {
  high_value: '高价值',
  light_reading: '浅阅读',
  explore: '探索池',
  paused: '暂停候选',
};

function getConfigObject(config: unknown): Record<string, unknown> {
  return (config && typeof config === 'object') ? config as Record<string, unknown> : {};
}

function normalizeReadingTier(value: unknown): SourceReadingTierValue | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/-/g, '_');
  if ((SOURCE_READING_TIER_VALUES as readonly string[]).includes(normalized)) {
    return normalized as SourceReadingTierValue;
  }
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

function result(value: SourceReadingTierValue, reason: string): SourceReadingTierResult {
  return { value, label: LABELS[value], reason };
}

export function resolveSourceReadingTier(input: SourceReadingTierInput): SourceReadingTierResult {
  const config = getConfigObject(input.config);
  const explicit = normalizeReadingTier(config.readingTier ?? config.sourceReadingTier ?? config.consumptionTier);
  if (explicit) return result(explicit, '人工标记');

  const tags = normalizeTags(input.tags);
  const tagText = tags.join(' ').toLowerCase();
  if (/高价值|深读|核心|deep|high[-_ ]?value/.test(tagText)) return result('high_value', '标签标记为高价值');
  if (/浅阅读|轻阅读|快扫|skim|brief|light/.test(tagText)) return result('light_reading', '标签标记为浅阅读');
  if (/暂停|低效|停用|paused|disabled/.test(tagText)) return result('paused', '标签标记为暂停候选');

  const status = String(input.status || '').toLowerCase();
  if (status === 'paused' || input.autoFetchEnabled === false) return result('paused', '已暂停或关闭自动抓取');

  const sourceTier = String(input.sourceTier || '').toUpperCase();
  if (['S', 'A'].includes(sourceTier)) return result('high_value', '系统建议：高权威来源优先深读');

  const category = String(input.category || '').toLowerCase();
  const name = String(input.name || '').toLowerCase();
  const text = `${category} ${name}`;
  if (/浅阅读|轻阅读|quick|brief|daily|newsletter|周刊|日报/.test(text)) return result('light_reading', '名称或分类适合快扫');

  const collectorType = String(input.collectorType || '').toLowerCase();
  const sourceType = String(input.sourceType || '').toLowerCase();
  if (['webpage', 'webpage_index', 'changedetection', 'custom'].includes(collectorType) || /monitor|webpage|curated_index/.test(sourceType)) {
    return result('explore', '索引/监控类来源需要观察');
  }

  if (sourceTier === 'B') return result('light_reading', '系统建议：常规资讯源适合快扫');
  if (['C', 'D'].includes(sourceTier)) return result('explore', '低等级来源待观察');
  return result('explore', '未人工标记，先进入探索池');
}

export function normalizeSourceReadingTier(value: unknown): SourceReadingTierValue | null {
  return normalizeReadingTier(value);
}
