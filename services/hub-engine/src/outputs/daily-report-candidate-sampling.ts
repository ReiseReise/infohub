import { classifyAihotDailyBucket } from '../lib/aihot-governance.js';
import { isFirstPartySource } from '../lib/source-governance-classification.js';
import {
  isWebpageSnapshotDailyCandidate,
  type DailyReportCandidateFunnel,
} from './daily-report-workflow.js';

export type DailyReportCandidateSampleItem = {
  id: string;
  title: string;
  sourceName?: string | null;
  sourceType?: string | null;
  category?: string | null;
  aiScore?: number | null;
  priorityScore?: number | null;
  processingStatus?: string | null;
  summaryStatus?: string | null;
  contentStatus?: string | null;
  fetchedAt?: string | Date | null;
  aiSummary?: string | null;
  aiTranslation?: string | null;
  snippet?: string | null;
  sourceTier?: string | null;
  sourceReadingTier?: string | null;
  sourceKind?: string | null;
  sourceRole?: string | null;
  sourceCollectorType?: string | null;
  sourceConfig?: unknown;
};

const HOT_SIGNAL_PATTERN = /(claude|anthropic|openai|gpt-?5|gemini|deepmind|fable\s*5|mythos|opus|sonnet|haiku|agent|智能体|新模型|模型发布|大模型|推理模型|多模态模型|api|codex|cursor)/i;
const DIRECT_HOT_SIGNAL_PATTERN = /(claude|anthropic|openai|gpt|gemini|deepmind|fable|mythos|opus|sonnet|haiku|智能体|新模型|模型发布|大模型|推理模型|多模态模型|codex|cursor)/i;
const SUPPORTING_HOT_SIGNAL_PATTERN = /(智能体|新模型|模型发布|大模型|推理模型|多模态模型|agent|api|codex|cursor)/i;
const MARKET_NOISE_PATTERN = /(恒指|a股|港股|美股|沪深|科创50|创业板|开盘|收盘|盘中|午间休盘|日内|涨超|跌超|涨幅|跌幅|指数|股价|股票|主力资金|融资余额|成交额|公告|注册资本|增资|新公司|黄金|现货|期货|逆回购|央行公开市场)/i;

function sampleText(item: DailyReportCandidateSampleItem) {
  return [
    item.title,
    item.sourceName || '',
    item.category || '',
    item.aiSummary || '',
    item.aiTranslation || '',
    item.snippet || '',
  ].join('\n');
}

function isSnapshot(item: DailyReportCandidateSampleItem) {
  return isWebpageSnapshotDailyCandidate({
    title: item.title,
    sourceName: item.sourceName ?? '',
    sourceType: item.sourceType ?? null,
    snippet: item.snippet ?? null,
    aiSummary: item.aiSummary ?? null,
  });
}

function isFirstPartyCandidate(item: DailyReportCandidateSampleItem) {
  return isFirstPartySource({
    name: item.sourceName,
    category: item.category,
    sourceType: item.sourceType,
    collectorType: item.sourceCollectorType,
    sourceKind: item.sourceKind,
    sourceRole: item.sourceRole,
    config: item.sourceConfig,
  });
}

export function normalizeDailyReportCandidateFunnelForSnapshot(
  funnel: DailyReportCandidateFunnel,
  fullDayNewItems: number,
  mainVisibleItems: number,
): DailyReportCandidateFunnel {
  return {
    ...funnel,
    todayNew: fullDayNewItems,
    mainVisible: mainVisibleItems,
  };
}

export function countMainVisibleItemsForReportFunnel(
  rows: Array<{ isFiltered: boolean | null; filterBucket: string | null }>,
) {
  return rows.filter((row) => row.isFiltered === false && row.filterBucket === 'main').length;
}

export function isDailyReportHotSignal(item: DailyReportCandidateSampleItem) {
  const text = sampleText(item);
  if (!HOT_SIGNAL_PATTERN.test(text)) return false;
  const titleContext = [item.title, item.sourceName || '', item.category || ''].join('\n');
  const titleLooksMarketNoise = MARKET_NOISE_PATTERN.test(item.title || '');
  const directTitleSignal = DIRECT_HOT_SIGNAL_PATTERN.test(titleContext);
  if (titleLooksMarketNoise && !directTitleSignal) return false;
  const marketNoise = MARKET_NOISE_PATTERN.test(text);
  const directAiSignal = directTitleSignal || SUPPORTING_HOT_SIGNAL_PATTERN.test(text);
  return directAiSignal || !marketNoise;
}

function rankDailyReportSampleItem(item: DailyReportCandidateSampleItem): number {
  const text = sampleText(item);
  const hotBoost = isDailyReportHotSignal(item) ? 120 : 0;
  const readyBoost = item.contentStatus === 'ready' ? 12 : item.contentStatus === 'degraded' ? 4 : 0;
  const processingDebtBoost = ['raw', 'scored', 'summary_failed', 'score_failed'].includes(item.processingStatus || '') ? 18 : 0;
  const scoreBoost = item.aiScore != null ? Math.max(0, Math.min(100, item.aiScore)) : 0;
  const priorityBoost = item.priorityScore != null ? Math.max(0, Math.min(1, item.priorityScore)) * 40 : 0;
  const categoryBoost = /(AI|tech|Product|效率|工具|研报|数据)/i.test(item.category || '') ? 10 : 0;
  const firstPartyBoost = isFirstPartyCandidate(item) ? 32 : 0;
  const marketPenalty = MARKET_NOISE_PATTERN.test(text) && !isDailyReportHotSignal(item) ? 55 : 0;
  const snapshotPenalty = isSnapshot(item) ? 320 : 0;
  return hotBoost + readyBoost + processingDebtBoost + scoreBoost + priorityBoost + categoryBoost + firstPartyBoost - marketPenalty - snapshotPenalty;
}

export function buildDailyReportCandidateSampleOrder<T extends DailyReportCandidateSampleItem>(items: T[], limit: number): T[] {
  const safeLimit = Math.max(0, limit);
  if (safeLimit === 0) return [];
  const ranked = [...items].sort((left, right) => {
    const rankDiff = rankDailyReportSampleItem(right) - rankDailyReportSampleItem(left);
    if (rankDiff !== 0) return rankDiff;
    const fetchedDiff = String(right.fetchedAt || '').localeCompare(String(left.fetchedAt || ''));
    if (fetchedDiff !== 0) return fetchedDiff;
    return String(left.id).localeCompare(String(right.id));
  });
  const selected: T[] = [];
  const selectedIds = new Set<string>();
  const add = (item: T) => {
    if (selected.length >= safeLimit || selectedIds.has(item.id)) return false;
    selected.push(item);
    selectedIds.add(item.id);
    return true;
  };
  const laneLimit = Math.max(1, Math.ceil(safeLimit * 0.25));

  const firstPartyLimit = Math.min(4, Math.max(1, Math.ceil(safeLimit * 0.2)));
  let firstPartyCount = 0;
  for (const item of ranked) {
    if (firstPartyCount >= firstPartyLimit) break;
    if (!isSnapshot(item) && isFirstPartyCandidate(item) && add(item)) firstPartyCount += 1;
  }

  let hotCount = 0;
  for (const item of ranked) {
    if (hotCount >= laneLimit) break;
    if (!isSnapshot(item) && isDailyReportHotSignal(item) && add(item)) hotCount += 1;
  }

  let highValueCount = 0;
  for (const item of ranked) {
    if (highValueCount >= laneLimit) break;
    if (!isSnapshot(item) && item.sourceReadingTier === 'high_value' && add(item)) highValueCount += 1;
  }

  const representedTopics = new Set<string>();
  const topicLimit = Math.min(5, safeLimit, Math.max(4, Math.ceil(safeLimit * 0.2)));
  for (const item of ranked) {
    if (representedTopics.size >= topicLimit) break;
    if (isSnapshot(item)) continue;
    const topic = classifyAihotDailyBucket(item);
    if (representedTopics.has(topic)) continue;
    representedTopics.add(topic);
    add(item);
  }

  const representedSources = new Set(selected.map((item) => String(item.sourceName || '').trim().toLowerCase()).filter(Boolean));
  const sourceLimit = Math.max(3, Math.ceil(safeLimit * 0.25));
  for (const item of ranked) {
    if (representedSources.size >= sourceLimit) break;
    if (isSnapshot(item)) continue;
    const source = String(item.sourceName || '').trim().toLowerCase();
    if (!source || representedSources.has(source)) continue;
    representedSources.add(source);
    add(item);
  }

  for (const item of ranked) {
    if (selected.length >= safeLimit) break;
    add(item);
  }
  return selected;
}
