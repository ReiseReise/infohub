import type { FeedItemRecord } from '../../lib/api';
import { isUsableDisplaySummary, isUsableDisplayTranslation } from '../../lib/readable-content';

export function normalizeAiSummary(raw?: string | null): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const normalized = fenced?.[1]?.trim() || trimmed;

  try {
    const parsed = JSON.parse(normalized) as { summary?: string; one_sentence?: string };
    return (parsed.summary || parsed.one_sentence || normalized).trim();
  } catch {
    return normalized;
  }
}
export function cleanFeedPreviewText(raw?: string | null): string {
  const normalized = (raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const cleaned = normalized
    .replace(/\s*(?:-->|->|=>|>{2,}|[-_=*~]{4,})\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '';
  if (/您提供的.*摘要内容为空|请补充需要改写的摘要文本|作为(?:一个)?AI|As an AI language model/i.test(cleaned)) return '';
  if (/(?:->\s*){4,}|>{8,}|[-_=*]{12,}/.test(cleaned)) return '';

  const readableChars = (cleaned.match(/[\p{L}\p{N}]/gu) || []).length;
  const noisySymbols = (cleaned.match(/[>→<|_=*~^#`\\]/g) || []).length;
  if (readableChars < 10 || noisySymbols > readableChars / 2) return '';

  return cleaned;
}

export function getFeedListPreview(item: FeedItemRecord): { text: string; className: string } | null {
  const summaryPreview = cleanFeedPreviewText(normalizeAiSummary(item.aiSummary));
  if (summaryPreview && isUsableDisplaySummary(summaryPreview)) return { text: summaryPreview, className: 'text-zinc-500' };

  const snippetPreview = cleanFeedPreviewText(item.snippet);
  if (snippetPreview) return { text: snippetPreview, className: 'text-zinc-400' };

  if (normalizeAiSummary(item.aiSummary) || item.snippet) {
    return {
      text: '预览片段含抓取噪声，打开详情查看原文依据。',
      className: 'rounded-xl border border-amber-100 bg-amber-50 px-2.5 py-2 text-amber-700',
    };
  }

  return null;
}

export function asValidDate(date?: string | null): Date | null {
  if (!date) return null;
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function timeAgo(date?: string | null) {
  const parsed = asValidDate(date);
  if (!parsed) return '';
  const diff = Date.now() - parsed.getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return `${Math.max(1, Math.floor(diff / 60000))}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(hours / 24)}天前`;
}

export function formatAbsoluteTime(date?: string | null) {
  const parsed = asValidDate(date);
  return parsed ? parsed.toLocaleString('zh-CN') : '';
}

export function getPrimaryTimeLabel(item?: FeedItemRecord | null) {
  if (!item) return '';
  const publishedAt = asValidDate(item.publishedAt);
  const fetchedAt = asValidDate(item.fetchedAt);
  return publishedAt ? `发布 ${timeAgo(item.publishedAt)}` : fetchedAt ? `抓取 ${timeAgo(item.fetchedAt)}` : '';
}

export function getPreferredReaderSourceText(item?: FeedItemRecord | null): string {
  if (!item) return '';
  return item.readabilityContent || item.content || item.snippet || '';
}

export function sourceTierBadge(item?: FeedItemRecord | null) {
  switch (item?.sourceTier) {
    case 'S':
      return { label: 'S级信号', className: 'bg-rose-100 text-rose-700' };
    case 'A':
      return { label: 'A级分析', className: 'bg-sky-100 text-sky-700' };
    case 'C':
      return { label: 'C级观察', className: 'bg-amber-100 text-amber-700' };
    case 'D':
      return { label: 'D级哨兵', className: 'bg-zinc-100 text-zinc-500' };
    default:
      return { label: 'B级资讯', className: 'bg-emerald-100 text-emerald-700' };
  }
}

export function getAiStatusMeta(item?: FeedItemRecord | null) {
  if (!item) return { label: 'AI未处理', className: 'bg-zinc-100 text-zinc-600' };
  if (item.isFiltered) return { label: '规则过滤', className: 'bg-amber-100 text-amber-700' };
  if (item.translationStatus === 'failed') return { label: '翻译失败', className: 'bg-rose-100 text-rose-700' };
  if (item.summaryStatus === 'failed') return { label: '摘要失败', className: 'bg-orange-100 text-orange-700' };
  if (item.processingStatus === 'score_failed') return { label: '评分失败', className: 'bg-red-100 text-red-700' };
  if ((item.translationStatus === 'ready' || item.aiTranslation?.trim())
    && isUsableDisplayTranslation(item.aiTranslation, getPreferredReaderSourceText(item))) {
    return { label: '已翻译', className: 'bg-emerald-100 text-emerald-700' };
  }
  const summary = normalizeAiSummary(item.aiSummary);
  if ((item.summaryStatus === 'ready' || summary) && isUsableDisplaySummary(summary)) {
    return { label: '已摘要', className: 'bg-sky-100 text-sky-700' };
  }
  if (item.translationStatus === 'ready' || item.summaryStatus === 'ready') return { label: '需重跑', className: 'bg-orange-100 text-orange-700' };
  if (item.aiScore != null) return { label: '已评分', className: 'bg-indigo-100 text-indigo-700' };
  if (item.contentStatus === 'fetching') return { label: '补抓正文中', className: 'bg-cyan-100 text-cyan-700' };
  return { label: '待处理', className: 'bg-zinc-100 text-zinc-600' };
}

export function getContentReadinessMeta(item: FeedItemRecord) {
  const label = item.contentReadiness?.label
    ? item.contentReadiness.status === 'full_text'
      ? '全文'
      : item.contentReadiness.label
    : '';
  return {
    label,
    className: item.contentReadiness?.status === 'full_text'
      ? 'bg-emerald-50 text-emerald-700'
      : 'bg-zinc-100 text-zinc-600',
  };
}
