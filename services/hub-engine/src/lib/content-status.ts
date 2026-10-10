import { plainTextLength } from './content-extractor.js';

export type ItemContentStatus = 'ready' | 'degraded' | 'missing';
export type ItemContentBasis = 'content' | 'snippet' | 'title';
export type ItemReadabilityStatus = 'ready' | 'missing';

export function classifyCollectedContentStatus(input: {
  content?: string | null;
  snippet?: string | null;
}): ItemContentStatus {
  const contentLen = plainTextLength(input.content || '');
  const snippetLen = plainTextLength(input.snippet || '');
  if (contentLen >= 180) return 'ready';
  if (contentLen >= 24 || snippetLen >= 24) return 'degraded';
  return 'missing';
}

export function classifyContentBasisFromLengths(input: {
  contentLength?: number | null;
  snippetLength?: number | null;
}): ItemContentBasis {
  if (Number(input.contentLength || 0) >= 180) return 'content';
  if (Number(input.snippetLength || 0) >= 24) return 'snippet';
  return 'title';
}

export function classifyCollectedReadabilityState(input: {
  readabilityContent?: string | null;
  contentStatus?: ItemContentStatus | null;
}): { readabilityStatus: ItemReadabilityStatus; readabilityReason: string | null } {
  const readabilityLen = plainTextLength(input.readabilityContent || '');
  if (readabilityLen >= 180) {
    return { readabilityStatus: 'ready', readabilityReason: null };
  }
  if (input.contentStatus === 'ready' || input.contentStatus === 'degraded') {
    return { readabilityStatus: 'missing', readabilityReason: 'readability_not_available' };
  }
  return { readabilityStatus: 'missing', readabilityReason: null };
}

export function contentStatusMessage(status: ItemContentStatus): string | null {
  if (status === 'missing') return '采集阶段未获得正文缓存';
  if (status === 'degraded') return '采集阶段仅获得摘要片段，建议补抓正文';
  return null;
}
