import type { SourceRecord } from './api';

export type SourceContentStrategy = 'feed_only' | 'smart' | 'full' | 'monitor_only';
export type SourceHealthFilter = 'all' | 'config_mismatch' | 'needs_fetch' | 'fetch_failing' | 'content_degraded' | 'ai_blocked' | 'report_gap' | 'watch';

export const SOURCE_CONTENT_STRATEGY_OPTIONS: Array<{ value: SourceContentStrategy; label: string }> = [
  { value: 'feed_only', label: '仅信任订阅正文' },
  { value: 'smart', label: '智能补全文' },
  { value: 'full', label: '优先补全原文' },
  { value: 'monitor_only', label: '仅监控不补正文' },
];

export const SOURCE_HEALTH_FILTER_OPTIONS: Array<{ value: SourceHealthFilter; label: string }> = [
  { value: 'all', label: '全部健康状态' },
  { value: 'config_mismatch', label: '配置错配' },
  { value: 'needs_fetch', label: '待首次抓取' },
  { value: 'fetch_failing', label: '抓取失败' },
  { value: 'content_degraded', label: '正文差' },
  { value: 'ai_blocked', label: 'AI卡住' },
  { value: 'report_gap', label: '影响日报' },
  { value: 'watch', label: '待观察' },
];

export function sourceHealthLabel(source: Pick<SourceRecord, 'sourceHealth' | 'healthStatus'>) {
  const status = source.sourceHealth?.healthStatus || source.healthStatus || 'watch';
  const label = source.sourceHealth?.healthLabel || SOURCE_HEALTH_FILTER_OPTIONS.find((option) => option.value === status)?.label || '待观察';
  const className = (() => {
    switch (status) {
      case 'healthy':
        return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'config_mismatch':
        return 'bg-rose-100 text-rose-700 border-rose-200';
      case 'needs_fetch':
        return 'bg-sky-100 text-sky-700 border-sky-200';
      case 'fetch_failing':
        return 'bg-rose-100 text-rose-700 border-rose-200';
      case 'content_degraded':
        return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'ai_blocked':
        return 'bg-violet-100 text-violet-700 border-violet-200';
      case 'report_gap':
        return 'bg-orange-100 text-orange-700 border-orange-200';
      default:
        return 'bg-zinc-100 text-zinc-600 border-zinc-200';
    }
  })();
  return { status, label, className };
}
