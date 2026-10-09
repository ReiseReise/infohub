import type { SourceRecord } from '../../lib/api';
import type { BrowserAssistProvider, WebCaptureRenderMode } from './source-options';

export function formatSourceTime(value?: string | null, options?: { absolute?: boolean }) {
  if (!value) return '暂无更新';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '暂无更新';
  if (options?.absolute) return parsed.toLocaleString('zh-CN');

  const diff = Date.now() - parsed.getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return `${Math.max(1, Math.floor(diff / 60000))} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export function sourcePercent(value?: number | null) {
  if (value == null || Number.isNaN(Number(value))) return '0%';
  return `${Math.round(Number(value) * 100)}%`;
}

export function sourceQualityGrade(grade?: string | null) {
  switch (grade) {
    case 'excellent': return '优秀';
    case 'good': return '良好';
    case 'fair': return '待优化';
    case 'poor': return '需修复';
    case 'empty': return '暂无样本';
    default: return grade || '暂无样本';
  }
}

export function sourceStageStatusClass(status?: string | null) {
  switch (status) {
    case 'healthy': return 'border-emerald-100 bg-emerald-50/60 text-emerald-800';
    case 'failing':
    case 'blocked': return 'border-rose-100 bg-rose-50/70 text-rose-800';
    case 'degraded':
    case 'stale': return 'border-amber-100 bg-amber-50/70 text-amber-800';
    case 'empty': return 'border-zinc-200 bg-zinc-50 text-zinc-600';
    default: return 'border-zinc-200 bg-white text-zinc-700';
  }
}

function schedule(source: SourceRecord) {
  const outcome = source.lastOutcome || '';
  if (!(source.autoFetchEnabled ?? true)) return { label: '已关闭自动抓取', className: 'bg-zinc-100 text-zinc-500' };
  if (source.status !== 'active') return { label: '信源未激活', className: 'bg-zinc-100 text-zinc-500' };
  if (outcome === 'error') return { label: '退避中', className: 'bg-red-100 text-red-700' };
  if (outcome === 'paused') return { label: '已暂停', className: 'bg-zinc-100 text-zinc-500' };
  if (outcome === 'scheduled') return { label: '已纳入调度', className: 'bg-sky-100 text-sky-700' };
  if (outcome === 'no_items' || outcome === 'all_duplicate') return { label: '低频巡检', className: 'bg-amber-100 text-amber-700' };
  if (outcome === 'ai_queued' || outcome === 'new_items') return { label: '活跃抓取', className: 'bg-emerald-100 text-emerald-700' };
  return { label: '混合调度中', className: 'bg-zinc-100 text-zinc-600' };
}

function freshness(source: SourceRecord) {
  switch (source.freshnessState) {
    case 'healthy': return { label: '新鲜', className: 'bg-emerald-100 text-emerald-700' };
    case 'due': return { label: '待补抓', className: 'bg-amber-100 text-amber-700' };
    case 'stale': return { label: '已过期', className: 'bg-red-100 text-red-700' };
    case 'paused': return { label: '已暂停', className: 'bg-zinc-100 text-zinc-500' };
    case 'error': return { label: '错误', className: 'bg-rose-100 text-rose-700' };
    default: return null;
  }
}

function sourceIssue(source: SourceRecord) {
  const detail = source.blockedReason || source.lastError || source.errorMessage;
  if (!detail) return null;
  const normalized = String(detail).toLowerCase();
  let label = '采集失败';
  if (normalized.includes('timed out') || normalized.includes('timeout')) label = '采集超时';
  else if (normalized.includes('non-whitespace') || normalized.includes('xml') || normalized.includes('rss')) label = '订阅格式异常';
  else if (normalized.includes('404') || normalized.includes('not found')) label = '链接不可访问';
  else if (normalized.includes('403') || normalized.includes('forbidden') || normalized.includes('unauthorized')) label = '访问受限';
  else if (normalized.includes('enotfound') || normalized.includes('getaddrinfo')) label = '域名不可达';
  return { label, detail: String(detail) };
}

export function buildSourceCardViewModel(source: SourceRecord) {
  const config = (source.config || {}) as Record<string, unknown>;
  return {
    initial: (source.sourceHost || source.name || '?').slice(0, 1).toUpperCase(),
    schedule: schedule(source),
    freshness: freshness(source),
    feedLabel: source.collectorType === 'rsshub' && typeof config.route === 'string'
      ? config.route
      : typeof config.url === 'string'
        ? config.url
        : typeof config.endpoint === 'string'
          ? config.endpoint
          : '',
    websiteLabel: typeof config.htmlUrl === 'string' ? config.htmlUrl : '',
    renderMode: (config.renderMode as WebCaptureRenderMode | undefined) || 'auto',
    browserProvider: (config.browserProvider as BrowserAssistProvider | undefined) || 'generic',
    issue: sourceIssue(source),
    stageHealth: source.sourceHealth?.stageHealth || source.stageHealth,
    healthReasons: source.sourceHealth?.healthReasons || source.healthReasons || [],
    recommendedActions: source.sourceHealth?.recommendedActions || source.recommendedActions || [],
  };
}
