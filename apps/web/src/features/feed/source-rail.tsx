import type { SourceRecord } from '../../lib/api';
import { resolveFeedSourceRailBadges } from '../../lib/feed-layout';
import { sourceReadingTierBadge } from '../../lib/source-reading-tier';
import { timeAgo } from './presentation';

type SourceGroupKey = 'ai' | 'business' | 'podcast' | 'monitor' | 'other';

const SOURCE_GROUP_LABELS: Record<SourceGroupKey, string> = {
  ai: 'AI',
  business: '商业',
  podcast: '播客',
  monitor: '监控',
  other: '其他',
};

function sourceGroupKey(source: SourceRecord): SourceGroupKey {
  const category = (source.category || '').toLowerCase();
  const kind = (source.sourceKind || '').toLowerCase();
  const collector = (source.collectorType || '').toLowerCase();
  const profile = (source.processingProfile || '').toLowerCase();
  const axes = (source.growthAxes || []).join(' ').toLowerCase();
  const text = `${category} ${kind} ${collector} ${profile} ${axes}`;

  if (/podcast|audio|播客|音频/.test(text)) return 'podcast';
  if (/monitor|changedetection|监控|网页变更/.test(text)) return 'monitor';
  if (/ai|aigc|人工智能|模型|agent|技术能力/.test(text)) return 'ai';
  if (/business|商业|财经|资本|融资|公司|产品|市场/.test(text)) return 'business';
  return 'other';
}

function sourceQualityLabel(source: SourceRecord) {
  const quality = source.sourceQuality;
  if (!quality) {
    if (source.freshnessState === 'error') return { label: '异常' };
    if (source.freshnessState === 'stale') return { label: '过期' };
    return { label: '待评估' };
  }
  switch (quality.grade) {
    case 'excellent':
      return { label: '优质' };
    case 'good':
      return { label: '稳定' };
    case 'fair':
      return { label: '一般' };
    case 'poor':
      return { label: '需治理' };
    default:
      return { label: '待评估' };
  }
}

function groupSources(sources: SourceRecord[]): Record<SourceGroupKey, SourceRecord[]> {
  const groups: Record<SourceGroupKey, SourceRecord[]> = {
    ai: [],
    business: [],
    podcast: [],
    monitor: [],
    other: [],
  };
  sources.forEach((source) => groups[sourceGroupKey(source)].push(source));
  return groups;
}

interface FeedSourceRailProps {
  sources: SourceRecord[];
  selectedSourceId: string;
  unreadTotal: number;
  mobileOpen: boolean;
  desktopCollapsed: boolean;
  onCloseMobile: () => void;
  onSelectAll: () => void;
  onSelectSource: (source: SourceRecord) => void;
}

export function FeedSourceRail({
  sources,
  selectedSourceId,
  unreadTotal,
  mobileOpen,
  desktopCollapsed,
  onCloseMobile,
  onSelectAll,
  onSelectSource,
}: FeedSourceRailProps) {
  const groupedSources = groupSources(sources);

  return (
    <aside
      data-feed-source-pane
      className={`${mobileOpen ? 'flex' : 'hidden'} order-first min-h-[360px] min-w-0 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_18px_55px_-48px_rgba(15,23,42,0.45)] ${desktopCollapsed ? 'xl:hidden' : 'xl:flex'} xl:order-none xl:min-h-0`}
    >
      <div className="shrink-0 border-b border-zinc-100 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-400">Sources</div>
            <div className="mt-0.5 text-sm font-semibold text-zinc-900">订阅源</div>
          </div>
          <button
            type="button"
            onClick={onCloseMobile}
            className="rounded-lg border border-zinc-200 px-2 py-1 text-xs text-zinc-500 xl:hidden"
          >
            收起
          </button>
        </div>
        <button
          type="button"
          onClick={onSelectAll}
          className={`mt-3 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition-colors ${selectedSourceId ? 'border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50' : 'bg-zinc-900 text-white'}`}
        >
          <span>全部来源</span>
          <span>{unreadTotal}</span>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {(Object.keys(SOURCE_GROUP_LABELS) as SourceGroupKey[]).map((groupKey) => {
          const group = groupedSources[groupKey];
          if (!group.length) return null;
          return (
            <div key={groupKey} className="mb-4 last:mb-0">
              <div className="mb-1.5 flex items-center justify-between px-1 text-[11px] font-semibold text-zinc-500">
                <span>{SOURCE_GROUP_LABELS[groupKey]}</span>
                <span>{group.reduce((sum, source) => sum + (source.unreadCount || 0), 0)}</span>
              </div>
              <div className="space-y-1">
                {group.slice(0, 18).map((source) => {
                  const quality = sourceQualityLabel(source);
                  const readingTier = sourceReadingTierBadge(source);
                  const sourceBadges = resolveFeedSourceRailBadges({
                    readingTierLabel: readingTier.label,
                    readingTierReason: readingTier.reason,
                    readingTierClassName: readingTier.className,
                  });
                  const active = String(source.id) === selectedSourceId;
                  return (
                    <button
                      key={source.id}
                      type="button"
                      onClick={() => onSelectSource(source)}
                      className={`w-full rounded-xl px-2.5 py-2 text-left transition-colors ${active ? 'bg-teal-50 text-teal-950 ring-1 ring-teal-100' : 'text-zinc-700 hover:bg-zinc-50'}`}
                    >
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-medium">{source.name}</span>
                        <span className="shrink-0 text-xs text-zinc-400">{source.unreadCount || 0}</span>
                      </div>
                      <div className="mt-1 flex min-w-0 items-center gap-1.5">
                        {sourceBadges.map((badge) => (
                          <span key={badge.label} className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] ${badge.className}`} title={badge.title}>
                            {badge.label}
                          </span>
                        ))}
                        <span className="min-w-0 truncate text-[10px] text-zinc-400">
                          {quality.label}
                          {source.latestItemAt ? ` · ${timeAgo(source.latestItemAt)}` : ''}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
