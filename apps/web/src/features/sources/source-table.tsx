import type { SourceRecord } from '../../lib/api';
import {
  sourceGovernanceRoleLabel,
  sourceGovernanceStatusLabel,
  sourceTopicGroupLabel,
} from '../../lib/source-governance-classification';
import { sourceHealthLabel } from '../../lib/source-governance-ui';
import { sourceReadingTierBadge } from '../../lib/source-reading-tier';
import { SOURCE_TIER_OPTIONS } from './source-options';

function formatTimeLabel(value?: string | null) {
  if (!value) return '暂无更新';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '暂无更新';
  const diff = Date.now() - parsed.getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function percentLabel(value?: number | null) {
  if (value == null || Number.isNaN(Number(value))) return '0%';
  return `${Math.round(Number(value) * 100)}%`;
}

export function qualityGradeLabel(grade?: string | null) {
  switch (grade) {
    case 'excellent': return '优秀';
    case 'good': return '良好';
    case 'fair': return '待优化';
    case 'poor': return '需修复';
    case 'empty': return '暂无样本';
    default: return grade || '暂无样本';
  }
}

interface SourceTableProps {
  sources: SourceRecord[];
  selectedSourceIds: number[];
  reprocessingSourceId: number | null;
  onToggleAll: () => void;
  onToggleSelection: (sourceId: number) => void;
  onOpenFeed: (source: SourceRecord, unreadOnly?: boolean) => void;
  onToggleStatus: (sourceId: number, currentStatus: string) => void | Promise<void>;
  onOpenRules: (sourceId: number) => void;
  onReprocess: (source: SourceRecord) => void | Promise<void>;
}

export function SourceTable({
  sources,
  selectedSourceIds,
  reprocessingSourceId,
  onToggleAll,
  onToggleSelection,
  onOpenFeed,
  onToggleStatus,
  onOpenRules,
  onReprocess,
}: SourceTableProps) {
  return (
    <div className="overflow-hidden rounded-[24px] border border-zinc-200 bg-white shadow-[0_20px_56px_-48px_rgba(15,23,42,0.45)]">
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full min-w-[920px] text-left text-sm">
          <caption className="sr-only">RSS 信源健康、质量与处理状态</caption>
          <thead className="sticky top-0 z-10 bg-zinc-50 text-xs text-zinc-500">
            <tr>
              <th className="w-10 px-3 py-3"><input type="checkbox" aria-label="全选当前来源" checked={sources.length > 0 && sources.every((source) => selectedSourceIds.includes(source.id))} onChange={onToggleAll} /></th>
              <th className="px-3 py-3">信源</th>
              <th className="px-3 py-3">主题 / 角色</th>
              <th className="px-3 py-3">资讯 / 阅读</th>
              <th className="px-3 py-3">链路健康</th>
              <th className="hidden px-3 py-3">权威</th>
              <th className="px-3 py-3">未读</th>
              <th className="px-3 py-3">质量</th>
              <th className="hidden px-3 py-3">重复率</th>
              <th className="hidden px-3 py-3">健康</th>
              <th className="hidden px-3 py-3">最近抓取</th>
              <th className="sticky right-0 z-20 w-[190px] border-l border-zinc-100 bg-zinc-50 px-3 py-3 shadow-[-14px_0_24px_-20px_rgba(15,23,42,0.55)]">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {sources.map((source) => {
              const health = sourceHealthLabel(source);
              const readingTier = sourceReadingTierBadge(source);
              return (
                <tr key={source.id} className="group hover:bg-zinc-50/70">
                  <td className="px-3 py-3"><input type="checkbox" aria-label={`选择来源：${source.name}`} checked={selectedSourceIds.includes(source.id)} onChange={() => onToggleSelection(source.id)} /></td>
                  <td className="px-3 py-3">
                    <div className="max-w-[260px] truncate font-medium text-zinc-900">{source.name}</div>
                    <div className="max-w-[260px] truncate text-xs text-zinc-500">{source.sourceHost || source.category || '未分类'}</div>
                  </td>
                  <td className="px-3 py-3 text-zinc-600" title={(source.classificationReasons || []).join('；')}>
                    <div className="font-medium text-zinc-800">{sourceTopicGroupLabel(source)}</div>
                    <div className="mt-0.5 text-[11px] text-zinc-500">{sourceGovernanceRoleLabel(source)}</div>
                    <div className={`mt-1 text-[10px] ${source.needsGovernanceReview === false ? 'text-teal-700' : 'text-amber-700'}`}>{sourceGovernanceStatusLabel(source)}</div>
                  </td>
                  <td className="px-3 py-3 text-zinc-600">
                    <div>{SOURCE_TIER_OPTIONS.find((option) => option.value === source.sourceTier)?.label || source.sourceTier || '未分级'}</div>
                    <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] ${readingTier.className}`} title={readingTier.reason}>{readingTier.label}</span>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] ${health.className}`}>{health.label}</span>
                    {(source.sourceHealth?.healthReasons || source.healthReasons || []).slice(0, 1).map((reason) => (
                      <div key={reason} className="mt-1 max-w-[220px] truncate text-[11px] text-zinc-500" title={reason}>{reason}</div>
                    ))}
                  </td>
                  <td className="hidden px-3 py-3 text-zinc-600">{Number(source.authorityWeight ?? 1).toFixed(2)}</td>
                  <td className="px-3 py-3 font-medium text-zinc-900">{source.unreadCount ?? 0}</td>
                  <td className="px-3 py-3 text-zinc-600" title={`正文 ${percentLabel(source.sourceQuality?.contentReadyRate)} · AI ${percentLabel(source.sourceQuality?.aiReadyRate)} · 噪声 ${percentLabel(source.sourceQuality?.noiseRate)} · 入报 ${percentLabel(source.sourceQuality?.reportSelectedRate)}`}>
                    <div className="font-medium text-zinc-900">{source.sourceQuality?.qualityScore ?? 0}</div>
                    <div className="text-[11px] text-zinc-400">{qualityGradeLabel(source.sourceQuality?.grade)}</div>
                    <div className="mt-0.5 max-w-[180px] truncate text-[10px] text-zinc-400">
                      正文 {percentLabel(source.sourceQuality?.contentReadyRate)} · AI {percentLabel(source.sourceQuality?.aiReadyRate)} · 噪声 {percentLabel(source.sourceQuality?.noiseRate)}
                    </div>
                  </td>
                  <td className="hidden px-3 py-3 text-zinc-600">{percentLabel(source.duplicateContribution)}</td>
                  <td className="hidden px-3 py-3 text-zinc-600">{source.healthScore ?? 0}%</td>
                  <td className="hidden px-3 py-3 text-zinc-600">{formatTimeLabel(source.latestItemAt || source.lastFetchedAt)}</td>
                  <td className="sticky right-0 z-10 border-l border-zinc-100 bg-white px-3 py-3 shadow-[-14px_0_24px_-20px_rgba(15,23,42,0.45)] transition-colors group-hover:bg-zinc-50/70">
                    <div className="flex min-w-[120px] gap-2 whitespace-nowrap">
                      {source.status === 'active' ? (
                        <button onClick={() => onOpenFeed(source, true)} className="rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100">看未读</button>
                      ) : (
                        <button onClick={() => { void onToggleStatus(source.id, source.status); }} className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-100">恢复</button>
                      )}
                      <button onClick={() => onOpenRules(source.id)} className="rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100">策略</button>
                      {source.status === 'active' ? (
                        <button onClick={() => { void onReprocess(source); }} disabled={reprocessingSourceId === source.id} className="rounded-full border border-teal-200 px-2.5 py-1 text-xs text-teal-700 hover:bg-teal-50 disabled:opacity-50">
                          {reprocessingSourceId === source.id ? '修复中' : '修复'}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
