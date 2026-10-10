import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, CheckCircle2, Copy, ListChecks } from 'lucide-react';
import type {
  DailyReportCoverageDiagnostics,
  DailyReportCoverageItem,
  DailyReportCoverageStatus,
  DailyReportLatestPayload,
} from '../../lib/api';
import { reportHeadingId, resolveDailyCoverageItemHref } from '../../lib/daily-reader';
import {
  DailyButtonLink as ButtonLink,
  DailyMiniMetric as MiniMetric,
  formatDailyNumber as formatNumber,
} from './ui';

export function shiftDateKey(dateKey: string, offset: number) {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateKey;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return dateKey;
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

const coverageStatusFilters: Array<{ key: DailyReportCoverageStatus | 'all'; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'selected', label: '已精选' },
  { key: 'review', label: '待复核' },
  { key: 'latestFallback', label: '最新兜底' },
  { key: 'excluded', label: '未入报' },
];

const coverageTone: Record<string, string> = {
  selected: 'bg-teal-50 text-teal-700',
  review: 'bg-amber-50 text-amber-700',
  latestFallback: 'bg-blue-50 text-blue-700',
  excluded: 'bg-zinc-100 text-zinc-600',
};

function coverageStatusLabel(status: DailyReportCoverageStatus, degraded = false) {
  if (!degraded) return coverageStatusFilters.find((item) => item.key === status)?.label || status;
  return {
    selected: '主候选',
    review: '待复核',
    latestFallback: '兜底候选',
    excluded: '未采用',
  }[status];
}

export function buildCoverageOverviewMarkdown(data?: DailyReportLatestPayload | null) {
  const summary = data?.coverageSummary;
  if (!summary || summary.total === 0) return '';
  return [
    '',
    '## 候选全池覆盖概览',
    '',
    data?.qualityStatus === 'degraded'
      ? `本次页面覆盖候选全池 ${summary.total} 条：主候选 ${summary.selected} 条，待复核 ${summary.review} 条，兜底候选 ${summary.latestFallback} 条，未采用 ${summary.excluded} 条。这些状态不代表编辑推荐。`
      : `本次日报页面覆盖候选全池 ${summary.total} 条：已精选 ${summary.selected} 条，待复核 ${summary.review} 条，最新兜底 ${summary.latestFallback} 条，未入报 ${summary.excluded} 条。`,
    '逐条摘要索引请在日报页面底部查看，或使用“复制全量索引”。',
  ].join('\n');
}

export function buildCoverageMarkdown(items: DailyReportCoverageItem[], summary?: DailyReportLatestPayload['coverageSummary'] | null, degraded = false) {
  if (items.length === 0) return '';
  const lines = [
    '## 候选全池摘要索引',
    '',
    summary
      ? (degraded
        ? `共覆盖 ${summary.total} 条：主候选 ${summary.selected} 条，待复核 ${summary.review} 条，兜底候选 ${summary.latestFallback} 条，未采用 ${summary.excluded} 条。`
        : `共覆盖 ${summary.total} 条：已精选 ${summary.selected} 条，待复核 ${summary.review} 条，最新兜底 ${summary.latestFallback} 条，未入报 ${summary.excluded} 条。`)
      : `共覆盖 ${items.length} 条。`,
  ];
  for (const filter of coverageStatusFilters.filter((item) => item.key !== 'all')) {
    const group = items.filter((item) => item.status === filter.key);
    if (!group.length) continue;
    lines.push('', `### ${coverageStatusLabel(filter.key as DailyReportCoverageStatus, degraded)}`, '');
    for (const item of group) {
      const title = item.url ? `[${item.title}](${item.url})` : item.title;
      lines.push(degraded
        ? `- ${title} · ${item.sourceName} · ${item.category}：${item.digest}`
        : `- ${title} · ${item.sourceName} · ${item.category}：${item.digest}（${item.reason}；${item.action}）`);
    }
  }
  return lines.join('\n');
}

function CoverageItemCard({ item, degraded = false }: { item: DailyReportCoverageItem; degraded?: boolean }) {
  const content = (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
        <span className={`rounded-full px-2 py-0.5 ${coverageTone[item.status] || 'bg-zinc-100 text-zinc-600'}`}>{degraded ? coverageStatusLabel(item.status, true) : item.statusLabel}</span>
        <span className="truncate">{item.sourceName}</span>
        <span className="truncate">{item.category}</span>
        {!degraded && item.score != null ? <span className="rounded-full bg-white px-2 py-0.5 text-teal-700">价值 {Math.round(item.score)}</span> : null}
        {item.translationStatusLabel ? <span className="rounded-full bg-white px-2 py-0.5 text-zinc-500">{item.translationStatusLabel}</span> : null}
      </div>
      <h3 className="mt-2 line-clamp-2 text-sm font-semibold leading-6 text-zinc-950">{item.title}</h3>
      <p className="mt-2 line-clamp-3 text-xs leading-5 text-zinc-600">{item.digest}</p>
      {!degraded ? <div className="mt-3 rounded-xl bg-white px-3 py-2 text-[11px] leading-5 text-zinc-500">
        <div><span className="font-medium text-zinc-700">去向解释：</span>{item.reason}</div>
        <div className="mt-1"><span className="font-medium text-zinc-700">建议动作：</span>{item.action}</div>
      </div> : null}
    </>
  );
  const href = resolveDailyCoverageItemHref(item);
  if (!href) return <article className="rounded-2xl border border-zinc-200 bg-zinc-50/80 px-4 py-4">{content}</article>;
  if (href.startsWith('/')) {
    return (
      <Link to={href} className="block rounded-2xl border border-zinc-200 bg-zinc-50/80 px-4 py-4 transition hover:border-teal-200 hover:bg-teal-50/40">
        {content}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className="block rounded-2xl border border-zinc-200 bg-zinc-50/80 px-4 py-4 transition hover:border-teal-200 hover:bg-teal-50/40">
      {content}
    </a>
  );
}

export function CoverageIndexSection({
  items,
  summary,
  onCopy,
  copied,
  degraded = false,
}: {
  items: DailyReportCoverageItem[];
  summary?: DailyReportLatestPayload['coverageSummary'] | null;
  onCopy: () => void;
  copied: boolean;
  degraded?: boolean;
}) {
  const [status, setStatus] = useState<DailyReportCoverageStatus | 'all'>('all');
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 12;
  const filtered = useMemo(() => items.filter((item) => status === 'all' || item.status === status), [items, status]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visible = expanded ? filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize) : filtered.slice(0, 6);

  if (!items.length || !summary) return null;
  return (
    <section id={reportHeadingId('附录：全池摘要索引')} className="rounded-3xl border border-zinc-200 bg-white px-5 py-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950"><ListChecks size={16} /> 候选全池摘要索引</div>
          <p className="mt-1 text-sm leading-6 text-zinc-500">{degraded ? '用于核对候选池的覆盖与摘要，不代表编辑推荐或行动建议。' : '所有进入日报候选全池的条目都在这里有摘要和去向解释；正文仍保持精选深读。'}</p>
        </div>
        <button onClick={onCopy} className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-50">
          <Copy size={14} /> {copied ? '已复制全量索引' : '复制全量索引'}
        </button>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <MiniMetric label="覆盖总数" value={formatNumber(summary.total)} />
        <MiniMetric label={degraded ? '主候选' : '已精选'} value={formatNumber(summary.selected)} />
        <MiniMetric label="待复核" value={formatNumber(summary.review)} />
        <MiniMetric label="最新兜底" value={formatNumber(summary.latestFallback)} />
        <MiniMetric label="未入报" value={formatNumber(summary.excluded)} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {coverageStatusFilters.map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => { setStatus(filter.key); setPage(1); }}
            className={`min-h-8 rounded-xl border px-3 py-1.5 text-xs ${status === filter.key ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'}`}
          >
            {filter.key === 'all' ? filter.label : coverageStatusLabel(filter.key, degraded)}
          </button>
        ))}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {visible.map((item) => <CoverageItemCard key={`${item.status}-${item.id}`} item={item} degraded={degraded} />)}
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-zinc-500">
          当前显示 {formatNumber(visible.length)} / {formatNumber(filtered.length)} 条
        </div>
        <div className="flex flex-wrap gap-2">
          {expanded ? (
            <>
              <button disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="min-h-8 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-600 disabled:opacity-40">上一页</button>
              <span className="inline-flex min-h-8 items-center rounded-xl bg-zinc-100 px-3 py-1.5 text-xs text-zinc-600">{currentPage} / {totalPages}</span>
              <button disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className="min-h-8 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-600 disabled:opacity-40">下一页</button>
              <button onClick={() => { setExpanded(false); setPage(1); }} className="min-h-8 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-600">收起</button>
            </>
          ) : (
            <button onClick={() => { setExpanded(true); setPage(1); }} className="min-h-8 rounded-xl bg-zinc-900 px-3 py-1.5 text-xs text-white">展开全池索引</button>
          )}
        </div>
      </div>
    </section>
  );
}

export function CoverageDiagnosticsCard({
  diagnostics,
  date,
  compact = false,
}: {
  diagnostics?: DailyReportCoverageDiagnostics | null;
  date: string;
  compact?: boolean;
}) {
  if (!diagnostics) return null;
  const hasDebt = diagnostics.unscored > 0
    || diagnostics.raw > 0
    || diagnostics.summaryFailed > 0
    || diagnostics.hotNotSelected > 0
    || diagnostics.hotNotSampled > 0;
  if (compact) {
    return (
      <div className={`rounded-xl border px-3 py-3 ${hasDebt ? 'border-amber-200 bg-amber-50/60' : 'border-teal-100 bg-teal-50/50'}`}>
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-900">
          {hasDebt ? <AlertTriangle size={14} className="text-amber-600" /> : <CheckCircle2 size={14} className="text-teal-600" />}
          数据覆盖诊断
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <MiniMetric label="今日抓取" value={formatNumber(diagnostics.totalFetched)} />
          <MiniMetric label="最终入报" value={formatNumber(diagnostics.finalCandidates)} />
          <MiniMetric label="未评分" value={formatNumber(diagnostics.unscored)} />
          <MiniMetric label="摘要失败" value={formatNumber(diagnostics.summaryFailed)} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <MiniMetric label="热点未采样" value={formatNumber(diagnostics.hotNotSampled)} />
          <MiniMetric label="热点未入报" value={formatNumber(diagnostics.hotNotSelected)} />
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <ButtonLink to={`/sources?health=ai_blocked`}>看 AI 卡住来源</ButtonLink>
          <ButtonLink to={`/daily/workbench?date=${encodeURIComponent(date)}`}>去工作台补处理</ButtonLink>
        </div>
      </div>
    );
  }
  return (
    <section className={`rounded-3xl border px-5 py-5 ${hasDebt ? 'border-amber-200 bg-amber-50/60' : 'border-teal-100 bg-teal-50/50'}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950">
            {hasDebt ? <AlertTriangle size={16} className="text-amber-600" /> : <CheckCircle2 size={16} className="text-teal-600" />}
            数据覆盖诊断
          </div>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-zinc-600">
            用来判断“抓到了但没进日报”的断点。热点命中包含 Claude、Anthropic、OpenAI、Gemini、新模型、Agent 等关键词。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink to={`/sources?health=ai_blocked`}>看 AI 卡住来源</ButtonLink>
          <ButtonLink to={`/sources?health=content_degraded`}>看正文差来源</ButtonLink>
          <ButtonLink to={`/daily/workbench?date=${encodeURIComponent(date)}`}>去工作台补处理</ButtonLink>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <MiniMetric label="今日抓取" value={formatNumber(diagnostics.totalFetched)} />
        <MiniMetric label="候选采样" value={formatNumber(diagnostics.sampledCandidates)} />
        <MiniMetric label="最终入报" value={formatNumber(diagnostics.finalCandidates)} />
        <MiniMetric label="未评分" value={formatNumber(diagnostics.unscored)} />
        <MiniMetric label="摘要失败" value={formatNumber(diagnostics.summaryFailed)} />
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <MiniMetric label="热点命中" value={formatNumber(diagnostics.hotSignals)} />
        <MiniMetric label="热点未评分" value={formatNumber(diagnostics.hotUnscored)} />
        <MiniMetric label="热点未采样" value={formatNumber(diagnostics.hotNotSampled)} />
        <MiniMetric label="热点未入报" value={formatNumber(diagnostics.hotNotSelected)} />
      </div>
    </section>
  );
}

export function DailyEventRadarCard({ metrics, compact = false }: {
  metrics?: DailyReportLatestPayload['eventMetrics'];
  compact?: boolean;
}) {
  if (!metrics) return null;
  const firstPartyShare = Math.round(Number(metrics.firstPartyEventShare || 0) * 100);
  return (
    <section className={compact
      ? 'mt-3 border-y border-zinc-200 px-1 py-4'
      : 'rounded-2xl border border-zinc-200 bg-white px-4 py-4 shadow-[0_16px_50px_-45px_rgba(15,23,42,0.5)]'}>
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950">
        <Activity size={16} /> 事件雷达
      </div>
      <p className="mt-2 text-xs leading-5 text-zinc-500">按独立事件计数，不把同一新闻的多篇转载重复放大。</p>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <div className="text-[11px] text-zinc-400">本地独立事件</div>
          <div className="mt-0.5 text-lg font-semibold text-zinc-950">{formatNumber(metrics.independentEventCount)}</div>
        </div>
        <div>
          <div className="text-[11px] text-zinc-400">多源验证</div>
          <div className="mt-0.5 text-lg font-semibold text-zinc-950">{formatNumber(metrics.multiSourceEventCount)}</div>
        </div>
        <div>
          <div className="text-[11px] text-zinc-400">一手来源事件</div>
          <div className="mt-0.5 text-sm font-semibold text-zinc-800">{formatNumber(metrics.firstPartyEventCount)} · {firstPartyShare}%</div>
        </div>
        <div>
          <div className="text-[11px] text-zinc-400">模型 / 产品事件</div>
          <div className="mt-0.5 text-sm font-semibold text-zinc-800">{formatNumber(metrics.modelProductEventCount)}</div>
        </div>
      </div>
      {(metrics.externalRadarItemCount > 0 || metrics.aihotLocalMissCount > 0 || metrics.unverifiableRadarItemCount > 0) ? (
        <div className="mt-3 border-t border-zinc-100 pt-3 text-xs leading-5 text-zinc-600">
          外部雷达可核对 {formatNumber(metrics.externalRadarEventCount)} 个事件；AI HOT 命中但本地遗漏 {formatNumber(metrics.aihotLocalMissCount)} 个。
          {metrics.unverifiableRadarItemCount > 0 ? ` 另有 ${formatNumber(metrics.unverifiableRadarItemCount)} 条缺原始链接，未计入证据。` : ''}
        </div>
      ) : null}
    </section>
  );
}
