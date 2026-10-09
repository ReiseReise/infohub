import type { SourceRecord } from './api/contracts';

export type DibaoStatusPayload = {
  available: boolean;
  publicUrl: string;
  healthUrl: string;
  message: string;
  version: string | null;
  checkedAt: string;
  error: string | null;
};

export type DibaoStatusView = {
  tone: 'ok' | 'warn';
  title: string;
  description: string;
};

type ComparableSource = Pick<SourceRecord, 'id' | 'name' | 'category' | 'sourceTier'> & {
  itemCount?: number | null;
  sourceQuality?: {
    contentReadyRate?: number | null;
    aiReadyRate?: number | null;
    qualityScore?: number | null;
  } | null;
};

const representativeNamePatterns = [
  /anthropic/i,
  /techcrunch/i,
  /verge/i,
  /daring\s*fireball/i,
  /bestblogs/i,
  /36kr|36氪/i,
];

export function describeDibaoStatus(status: DibaoStatusPayload): DibaoStatusView {
  if (status.available) {
    return {
      tone: 'ok',
      title: 'Dibao 已就绪',
      description: '可打开阅读实验室，并用同一批 OPML 做抓取质量对照。',
    };
  }

  return {
    tone: 'warn',
    title: 'Dibao 未就绪',
    description: status.message || '请先启动 dibao-reader 服务，再导入 OPML 开始对照。',
  };
}

function sourceCompareScore(source: ComparableSource): number {
  const name = source.name || '';
  const patternIndex = representativeNamePatterns.findIndex((pattern) => pattern.test(name));
  const patternScore = patternIndex >= 0 ? 1000 - patternIndex * 100 : 0;
  const tierScore = source.sourceTier === 'S' ? 120 : source.sourceTier === 'A' ? 90 : source.sourceTier === 'B' ? 55 : 20;
  const qualityScore = Number(source.sourceQuality?.contentReadyRate || 0) * 80
    + Number(source.sourceQuality?.aiReadyRate || 0) * 40
    + Number(source.itemCount || 0) / 10;
  return patternScore + tierScore + qualityScore;
}

export function selectDibaoCompareSources<T extends ComparableSource>(sources: T[], limit = 7): T[] {
  return [...sources]
    .filter((source) => Boolean(source.name))
    .sort((a, b) => {
      const diff = sourceCompareScore(b) - sourceCompareScore(a);
      if (diff !== 0) return diff;
      return String(a.name).localeCompare(String(b.name), 'zh-CN');
    })
    .slice(0, limit);
}
