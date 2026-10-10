import { Headphones, Pause, Play, RefreshCw, Trash2 } from 'lucide-react';
import type { SourceRecord } from '../../lib/api';
import {
  SOURCE_READING_TIER_OPTIONS,
  resolveSourceReadingTier,
  sourceReadingTierBadge,
  type SourceReadingTierValue,
} from '../../lib/source-reading-tier';
import {
  SOURCE_CONTENT_STRATEGY_OPTIONS,
  sourceHealthLabel,
  type SourceContentStrategy,
} from '../../lib/source-governance-ui';
import {
  SOURCE_GOVERNANCE_ROLE_OPTIONS,
  SOURCE_TOPIC_GROUP_OPTIONS,
  sourceGovernanceRoleLabel,
  sourceGovernanceStatusLabel,
  sourceTopicGroupLabel,
  type SourceGovernanceRole,
  type SourceTopicGroup,
} from '../../lib/source-governance-classification';
import {
  BROWSER_PROVIDER_OPTIONS,
  GROWTH_AXIS_OPTIONS,
  PROCESSING_PROFILE_OPTIONS,
  SOURCE_KIND_OPTIONS,
  SOURCE_TIER_OPTIONS,
  WEB_CAPTURE_MODE_OPTIONS,
  type BrowserAssistProvider,
  type GrowthAxis,
  type ProcessingProfile,
  type SourceKind,
  type SourceTier,
  type WebCaptureRenderMode,
} from './source-options';
import {
  buildSourceCardViewModel,
  formatSourceTime,
  sourcePercent,
  sourceQualityGrade,
  sourceStageStatusClass,
} from './source-card-model';

type SourcePatch = Partial<SourceRecord> & { config?: Record<string, unknown> };

interface SourceCardProps {
  source: SourceRecord;
  reprocessing: boolean;
  onOpenFeed: (source: SourceRecord, unreadOnly?: boolean) => void;
  onOpenRules: (sourceId: number) => void;
  onHealthAction: (source: SourceRecord, action: string) => void | Promise<void>;
  onStrategyUpdate: (source: SourceRecord, patch: SourcePatch, successMessage?: string) => void | Promise<void>;
  onWebCaptureConfig: (
    source: SourceRecord,
    patch: { renderMode?: WebCaptureRenderMode; browserProvider?: BrowserAssistProvider },
    successMessage: string,
  ) => void | Promise<void>;
  onToggleAxis: (source: SourceRecord, axis: GrowthAxis) => void | Promise<void>;
  onToggleAutoFetch: (source: SourceRecord) => void | Promise<void>;
  onToggleAutoTranscribe: (source: SourceRecord) => void | Promise<void>;
  onFetch: (sourceId: number) => void | Promise<void>;
  onReprocess: (source: SourceRecord) => void | Promise<void>;
  onToggleStatus: (sourceId: number, currentStatus: string) => void | Promise<void>;
  onDelete: (sourceId: number) => void | Promise<void>;
}

function Metric({ label, value, hint, accent = false }: { label: string; value: string | number; hint?: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border px-3 py-2 ${accent ? 'border-teal-100 bg-teal-50/60' : 'border-zinc-200 bg-zinc-50/60'}`}>
      <div className={`text-[10px] tracking-[0.2em] ${accent ? 'text-teal-700/70' : 'text-zinc-500'}`}>{label}</div>
      <div className="mt-1 text-xl font-semibold text-zinc-900">{value}</div>
      {hint ? <div className={`text-[11px] ${accent ? 'text-teal-700' : 'text-zinc-500'}`}>{hint}</div> : null}
    </div>
  );
}

export function SourceCard({
  source,
  reprocessing,
  onOpenFeed,
  onOpenRules,
  onHealthAction,
  onStrategyUpdate,
  onWebCaptureConfig,
  onToggleAxis,
  onToggleAutoFetch,
  onToggleAutoTranscribe,
  onFetch,
  onReprocess,
  onToggleStatus,
  onDelete,
}: SourceCardProps) {
  const view = buildSourceCardViewModel(source);
  const health = sourceHealthLabel(source);
  const readingTier = sourceReadingTierBadge(source);

  return (
    <div className="rounded-[26px] border border-zinc-200 bg-white p-4 shadow-[0_20px_56px_-48px_rgba(15,23,42,0.45)] transition-colors hover:border-zinc-300">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 gap-4">
          {source.iconUrl ? (
            <img src={source.iconUrl} alt="" className="mt-0.5 h-12 w-12 rounded-2xl border border-zinc-200 object-cover" />
          ) : (
            <div className="mt-0.5 flex h-12 w-12 items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-50 text-sm font-semibold text-zinc-500">
              {view.initial}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold text-zinc-900">{source.name}</span>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-500">{source.collectorType}</span>
              {source.sourceTier ? <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] text-sky-700">{SOURCE_TIER_OPTIONS.find((option) => option.value === source.sourceTier)?.label || source.sourceTier}</span> : null}
              <span className={`rounded-full border px-2 py-0.5 text-[10px] ${readingTier.className}`} title={readingTier.reason}>{readingTier.label}</span>
              {source.processingProfile ? <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] text-violet-700">{PROCESSING_PROFILE_OPTIONS.find((option) => option.value === source.processingProfile)?.label || source.processingProfile}</span> : null}
              {source.contentStrategy ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700">{SOURCE_CONTENT_STRATEGY_OPTIONS.find((option) => option.value === source.contentStrategy)?.label || source.contentStrategy}</span> : null}
              <span className={`rounded-full px-2 py-0.5 text-[10px] ${view.schedule.className}`}>{view.schedule.label}</span>
              {view.freshness ? <span className={`rounded-full px-2 py-0.5 text-[10px] ${view.freshness.className}`}>{view.freshness.label}</span> : null}
              <span className={`rounded-full border px-2 py-0.5 text-[10px] ${health.className}`}>{health.label}</span>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
              {source.sourceHost ? <span>{source.sourceHost}</span> : null}
              <span className="font-medium text-emerald-700">{sourceTopicGroupLabel(source)}</span>
              <span className="font-medium text-violet-700">{sourceGovernanceRoleLabel(source)}</span>
              <span className={source.needsGovernanceReview === false ? 'text-teal-700' : 'text-amber-700'} title={(source.classificationReasons || []).join('；')}>
                {sourceGovernanceStatusLabel(source)}
              </span>
              <span>权威 {Number(source.authorityWeight ?? 1).toFixed(2)}</span>
              <span>健康 {source.healthScore ?? 0}%</span>
              <span>可信 {source.trustScore ?? 0}</span>
              <span>噪音 {source.noiseScore ?? 0}</span>
              <span>周期 {source.fetchInterval ?? 60} 分钟</span>
            </div>

            <div className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-3">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-zinc-900">全链路诊断</div>
                  <div className="mt-1 text-xs leading-5 text-zinc-600">
                    {view.healthReasons.length > 0 ? view.healthReasons.slice(0, 2).join(' ') : '当前没有明显抓取、正文、AI 或日报覆盖异常。'}
                  </div>
                </div>
                {view.recommendedActions.length > 0 ? (
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    {view.recommendedActions.slice(0, 4).map((action) => (
                      <button
                        key={`${source.id}-${action.action}`}
                        type="button"
                        onClick={() => void onHealthAction(source, action.action)}
                        disabled={reprocessing}
                        className="min-h-9 rounded-full border border-teal-200 bg-white px-3 py-2 text-xs text-teal-700 hover:bg-teal-50 disabled:opacity-50"
                        title={action.reason}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {view.stageHealth ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-5">
                  {([
                    ['fetch', '抓取'],
                    ['content', '正文'],
                    ['display', '展示'],
                    ['ai', 'AI'],
                    ['report', '日报'],
                  ] as const).map(([key, label]) => {
                    const stage = view.stageHealth?.[key];
                    return (
                      <div key={key} className={`rounded-xl border px-3 py-2 ${sourceStageStatusClass(stage?.status)}`}>
                        <div className="text-[10px] tracking-[0.18em] opacity-70">{label}</div>
                        <div className="mt-1 text-sm font-semibold">{stage?.label || '暂无记录'}</div>
                        <div className="mt-1 line-clamp-2 text-[11px] leading-4 opacity-80" title={stage?.latestIssue || stage?.summary || ''}>
                          {key === 'ai'
                            ? `今日 ${source.aiProcessedToday ?? 0}/${source.aiDailyBudget ?? 0}，剩余 ${source.aiBudgetRemaining ?? 0}`
                            : stage?.latestIssue || stage?.summary || '没有可用诊断。'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-6">
              <button type="button" onClick={() => onOpenFeed(source, true)} className="rounded-2xl border border-teal-100 bg-teal-50/70 px-3 py-2 text-left hover:bg-teal-50">
                <div className="text-[10px] tracking-[0.2em] text-teal-700/70">未读</div>
                <div className="mt-1 text-xl font-semibold text-zinc-900">{source.unreadCount ?? 0}</div>
              </button>
              <Metric label="可读条目" value={source.entryCount ?? 0} />
              <Metric label="收藏" value={source.favoriteCount ?? 0} />
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50/60 px-3 py-2">
                <div className="text-[10px] tracking-[0.2em] text-zinc-500">最近更新</div>
                <div className="mt-1 text-sm font-semibold text-zinc-900">{formatSourceTime(source.latestItemAt || source.lastFetchedAt)}</div>
              </div>
              <Metric label="精选率" value={sourcePercent(source.selectedHitRate)} />
              <Metric label="重复率" value={sourcePercent(source.duplicateContribution)} />
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Metric label="质量分" value={source.sourceQuality?.qualityScore ?? 0} hint={sourceQualityGrade(source.sourceQuality?.grade)} accent />
              <Metric label="正文率" value={sourcePercent(source.sourceQuality?.contentReadyRate)} hint={`ready ${source.sourceQuality?.contentReady ?? 0}`} />
              <Metric label="AI完成率" value={sourcePercent(source.sourceQuality?.aiReadyRate)} hint="评/摘/译" />
              <Metric label="噪声率" value={sourcePercent(source.sourceQuality?.noiseRate)} hint={`filtered ${source.sourceQuality?.filtered ?? 0}`} />
              <Metric label="日报入选率" value={sourcePercent(source.sourceQuality?.reportSelectedRate)} hint={`selected ${source.sourceQuality?.reportSelected ?? 0}`} />
            </div>

            {source.latestItemTitle ? (
              <div className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50/70 px-3 py-3">
                <div className="text-[10px] tracking-[0.2em] text-zinc-500">最新条目</div>
                <div className="mt-1 text-sm font-medium leading-6 text-zinc-900">{source.latestItemTitle}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                  <span>{formatSourceTime(source.latestItemAt, { absolute: true })}</span>
                  {source.latestItemUrl ? (
                    <a href={source.latestItemUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center rounded-full border border-teal-100 bg-white px-3 py-2 text-xs text-teal-700 hover:bg-teal-50 hover:text-teal-800">
                      打开原文
                    </a>
                  ) : null}
                </div>
              </div>
            ) : null}

            {(view.feedLabel || view.websiteLabel || source.lastFetchEngine || view.issue || source.lastChangeSummary || source.staleReason) ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                {view.websiteLabel ? <span className="max-w-[18rem] truncate">站点: {view.websiteLabel}</span> : null}
                {view.feedLabel ? <span className="max-w-[20rem] truncate">订阅: {view.feedLabel}</span> : null}
                {source.lastFetchEngine ? <span>引擎: {source.lastFetchEngine}</span> : null}
                {source.lastChangeSummary ? <span className="max-w-[20rem] truncate">变化: {source.lastChangeSummary}</span> : null}
                {source.staleReason ? <span className="max-w-[18rem] truncate text-amber-600">过期: {source.staleReason}</span> : null}
                {view.issue ? <span className="max-w-[18rem] truncate text-rose-600" title={`原始错误：${view.issue.detail}`}>异常: {view.issue.label}</span> : null}
              </div>
            ) : null}

            <div className="mt-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                <span>单源质检覆盖在过滤策略台编辑</span>
                <button type="button" onClick={() => onOpenRules(source.id)} className="min-h-9 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100">
                  打开过滤策略
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <select value={source.topicGroup || 'other'} onChange={(event) => void onStrategyUpdate(source, { topicGroup: event.target.value as SourceTopicGroup }, `已确认「${source.name}」的主题方向`)} className="rounded-xl border border-emerald-200 bg-emerald-50/50 px-3 py-2 text-[11px] text-emerald-800" title="主题方向：这个来源主要讲什么">
                  {SOURCE_TOPIC_GROUP_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <select value={source.governanceRole || 'other'} onChange={(event) => void onStrategyUpdate(source, { governanceRole: event.target.value as SourceGovernanceRole }, `已确认「${source.name}」的来源角色`)} className="rounded-xl border border-violet-200 bg-violet-50/50 px-3 py-2 text-[11px] text-violet-800" title="来源角色：它是官方、媒体、博客、聚合还是社区">
                  {SOURCE_GOVERNANCE_ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <select value={source.sourceTier || 'B'} onChange={(event) => void onStrategyUpdate(source, { sourceTier: event.target.value as SourceTier }, `已更新「${source.name}」的资讯等级`)} className="rounded-xl border border-zinc-200 px-3 py-2 text-[11px] text-zinc-700">
                  {SOURCE_TIER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <select value={source.processingProfile || 'brief'} onChange={(event) => void onStrategyUpdate(source, { processingProfile: event.target.value as ProcessingProfile }, `已更新「${source.name}」的处理档位`)} className="rounded-xl border border-zinc-200 px-3 py-2 text-[11px] text-zinc-700">
                  {PROCESSING_PROFILE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <select value={(source.contentStrategy as SourceContentStrategy) || 'smart'} onChange={(event) => void onStrategyUpdate(source, { contentStrategy: event.target.value as SourceContentStrategy }, `已更新「${source.name}」的正文策略`)} className="rounded-xl border border-zinc-200 px-3 py-2 text-[11px] text-zinc-700">
                  {SOURCE_CONTENT_STRATEGY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <select value={(source.sourceKind as SourceKind) || 'rss'} onChange={(event) => void onStrategyUpdate(source, { sourceKind: event.target.value as SourceKind }, `已更新「${source.name}」的信源类型`)} className="rounded-xl border border-zinc-200 px-3 py-2 text-[11px] text-zinc-700">
                  {SOURCE_KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <select value={resolveSourceReadingTier(source).value} onChange={(event) => void onStrategyUpdate(source, { readingTier: event.target.value as SourceReadingTierValue }, `已更新「${source.name}」的阅读层级`)} className="rounded-xl border border-zinc-200 px-3 py-2 text-[11px] text-zinc-700">
                  {SOURCE_READING_TIER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <label className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-[11px] text-zinc-700">
                  权威
                  <input type="number" min={0.35} max={2} step={0.01} value={Number(source.authorityWeight ?? 1)} onChange={(event) => void onStrategyUpdate(source, { authorityWeight: Number(event.target.value || 1) }, `已更新「${source.name}」的权威权重`)} className="w-16 bg-transparent outline-none" />
                </label>
                {source.collectorType === 'webpage' ? (
                  <>
                    <select value={view.renderMode} onChange={(event) => void onWebCaptureConfig(source, { renderMode: event.target.value as WebCaptureRenderMode }, `已更新「${source.name}」的网页抓取策略`)} className="rounded-xl border border-zinc-200 px-3 py-2 text-[11px] text-zinc-700">
                      {WEB_CAPTURE_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                    <select value={view.browserProvider} onChange={(event) => void onWebCaptureConfig(source, { browserProvider: event.target.value as BrowserAssistProvider }, `已更新「${source.name}」的 Browser Assist Provider`)} className="rounded-xl border border-zinc-200 px-3 py-2 text-[11px] text-zinc-700">
                      {BROWSER_PROVIDER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {GROWTH_AXIS_OPTIONS.map((axis) => {
                  const active = source.growthAxes?.includes(axis);
                  return (
                    <button key={axis} type="button" onClick={() => void onToggleAxis(source, axis)} className={`min-h-9 rounded-full border px-3 py-2 text-xs transition-colors ${active ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50'}`}>
                      {axis}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-start gap-1.5 xl:flex-col xl:items-stretch">
          <button onClick={() => onOpenFeed(source, true)} className="min-h-9 whitespace-nowrap rounded-xl border border-zinc-200 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-50" title="查看该来源的阅读流">查看 Feed</button>
          <button onClick={() => void onToggleAutoFetch(source)} className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-2.5 text-xs hover:bg-zinc-100 xl:w-9 xl:px-0 ${(source.autoFetchEnabled ?? true) ? 'text-emerald-600' : 'text-zinc-400'}`} title={(source.autoFetchEnabled ?? true) ? '关闭自动抓取' : '开启自动抓取'}>
            {(source.autoFetchEnabled ?? true) ? <Pause size={14} /> : <Play size={14} />}
            <span className="xl:sr-only">自动抓取</span>
          </button>
          <button onClick={() => void onToggleAutoTranscribe(source)} className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-2.5 text-xs hover:bg-zinc-100 xl:w-9 xl:px-0 ${source.autoTranscribe ? 'text-sky-600' : 'text-zinc-400'}`} title={source.autoTranscribe ? '关闭自动转写' : '开启自动转写'}>
            <Headphones size={14} />
            <span className="xl:sr-only">自动转写</span>
          </button>
          <button onClick={() => void onFetch(source.id)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-2.5 text-xs text-zinc-500 hover:bg-zinc-100 xl:w-9 xl:px-0" title="立即采集">
            <RefreshCw size={14} className="text-zinc-400" />
            <span className="xl:sr-only">立即采集</span>
          </button>
          <button onClick={() => void onReprocess(source)} disabled={reprocessing} className="min-h-9 whitespace-nowrap rounded-xl border border-teal-200 px-3 py-2 text-xs text-teal-700 hover:bg-teal-50 disabled:opacity-50" title="批量重试正文、质检、评分、摘要和翻译">
            {reprocessing ? '修复中' : '批量修复'}
          </button>
          <button onClick={() => void onToggleStatus(source.id, source.status)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-2.5 text-xs text-zinc-500 hover:bg-zinc-100 xl:w-9 xl:px-0" title={source.status === 'active' ? '暂停信源' : '恢复信源'}>
            {source.status === 'active' ? <Pause size={14} className="text-zinc-400" /> : <Play size={14} className="text-zinc-400" />}
            <span className="xl:sr-only">{source.status === 'active' ? '暂停信源' : '恢复信源'}</span>
          </button>
          <button onClick={() => void onDelete(source.id)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-2.5 text-xs text-zinc-500 hover:bg-red-50 xl:w-9 xl:px-0" title="删除信源">
            <Trash2 size={14} className="text-zinc-300 hover:text-red-500" />
            <span className="xl:sr-only">删除信源</span>
          </button>
        </div>
      </div>
    </div>
  );
}
