import { sql, type SQL } from 'drizzle-orm';
import { schema } from '../db/index.js';
import type { SourceReadingTierValue } from './source-reading-tier.js';

export function buildSourceReadingTierSql(): SQL<string> {
  const explicitTier = sql`lower(replace(coalesce(${schema.sources.config}->>'readingTier', ${schema.sources.config}->>'sourceReadingTier', ${schema.sources.config}->>'consumptionTier', ''), '-', '_'))`;
  const sourceTags = sql`lower(coalesce(${schema.sources.tags}::text, ''))`;
  const sourceTier = sql`upper(coalesce(${schema.sources.sourceTier}, ''))`;
  const sourceText = sql`lower(coalesce(${schema.sources.category}, '') || ' ' || coalesce(${schema.sources.name}, ''))`;
  const collectorType = sql`lower(coalesce(${schema.sources.collectorType}, ''))`;
  const sourceType = sql`lower(coalesce(${schema.sources.sourceType}, ''))`;

  return sql<string>`case
    when ${explicitTier} in ('high_value', 'core', 'deep', 'deep_read', 'high', '高价值', '深读') then 'high_value'
    when ${explicitTier} in ('light_reading', 'skim', 'light', 'brief', '浅阅读', '轻阅读') then 'light_reading'
    when ${explicitTier} in ('paused', 'disabled', 'pause', '低效', '暂停') then 'paused'
    when ${explicitTier} in ('explore', 'watch', 'trial', 'exploratory', '探索', '观察') then 'explore'
    when ${sourceTags} ~* '(高价值|深读|核心|deep|high[-_ ]?value)' then 'high_value'
    when ${sourceTags} ~* '(浅阅读|轻阅读|快扫|skim|brief|light)' then 'light_reading'
    when ${sourceTags} ~* '(暂停|低效|停用|paused|disabled)' then 'paused'
    when lower(coalesce(${schema.sources.status}, '')) = 'paused'
      or coalesce(${schema.sources.autoFetchEnabled}, true) = false then 'paused'
    when ${sourceTier} in ('S', 'A') then 'high_value'
    when ${sourceText} ~* '(浅阅读|轻阅读|quick|brief|daily|newsletter|周刊|日报)' then 'light_reading'
    when ${collectorType} in ('webpage', 'webpage_index', 'changedetection', 'custom')
      or ${sourceType} ~* '(monitor|webpage|curated_index)' then 'explore'
    when ${sourceTier} = 'B' then 'light_reading'
    when ${sourceTier} in ('C', 'D') then 'explore'
    else 'explore'
  end`;
}

export function buildSourceReadingTierCondition(readingTier: SourceReadingTierValue): SQL<unknown> {
  return sql`${buildSourceReadingTierSql()} = ${readingTier}`;
}
