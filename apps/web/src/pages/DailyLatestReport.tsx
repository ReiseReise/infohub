import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, ArrowRight, Check, Copy, List, Loader2, MoreHorizontal, RefreshCw, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/use-auth';
import {
  buildDailyFinishedReaderNav, dailyReportReadingStats, dailyReportScopedPath,
  resolveDailyDraftMarkdown, resolveDailyReportLead, resolveDailyReportTitle,
  shouldRenderPublishedDailyReport, stripDailyFinishedReportFrontMatter,
} from '../lib/daily-reader';
import { DailyFinishedReportArticle } from '../features/daily/report-reader';
import { buildCoverageMarkdown, CoverageIndexSection, DailyEventRadarCard, shiftDateKey } from '../features/daily/coverage';
import { useKeyboardNavigation } from '../lib/use-keyboard-navigation';

const iconButton = 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-teal-600 disabled:opacity-30';

export function DailyLatestReport() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const date = params.get('date') || '';
  const sourceId = params.get('sourceId') || '';
  const { user } = useAuth();
  const reportQuery = useQuery({
    queryKey: ['daily-edition', user?.id, date, sourceId],
    queryFn: () => api.daily.latestReport({ ...(date ? { date } : {}), ...(sourceId ? { sourceId } : {}) }),
    enabled: Boolean(user),
    staleTime: 0,
    retry: false,
  });
  const data = reportQuery.data?.data || null;
  const loading = reportQuery.isPending;
  const error = reportQuery.error?.message || '';
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [tocOpen, setTocOpen] = useState(false);
  const [activeHeading, setActiveHeading] = useState('report-今日封面判断');
  const scrollRef = useRef<HTMLElement>(null);
  const published = shouldRenderPublishedDailyReport(data);
  const activeDate = data?.date || date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const fullMarkdown = published ? data?.markdown || '' : resolveDailyDraftMarkdown(data);
  const markdown = useMemo(() => stripDailyFinishedReportFrontMatter(fullMarkdown)
    .replace(/(?:^|\n)## (?:运行分析|生成口径)[\s\S]*?(?=\n## |$)/g, '')
    .replace(/(?:^|\n)## 信息雷达总览\n+今天共收集[\s\S]*?(?=\n## |$)/, ''), [fullMarkdown]);
  const nav = useMemo(() => published ? buildDailyFinishedReaderNav(data, markdown) : [], [data, markdown, published]);
  const stats = useMemo(() => dailyReportReadingStats(fullMarkdown), [fullMarkdown]);
  const scoped = (path: string, targetDate = activeDate) => dailyReportScopedPath(path, targetDate, sourceId);
  const goDate = (value: string) => {
    if (value) navigate(dailyReportScopedPath('/daily/reports/latest', value, sourceId));
  };

  const jump = (id: string) => {
    setTocOpen(false);
    setActiveHeading(id);
    const root = scrollRef.current;
    const target = root?.querySelector<HTMLElement>(`[id="${id}"]`);
    if (root && target) root.scrollTo({ top: root.scrollTop + target.getBoundingClientRect().top - root.getBoundingClientRect().top - 16, behavior: 'smooth' });
  };
  useKeyboardNavigation({
    onNext: () => { const i = nav.findIndex((item) => item.id === activeHeading); if (nav[i + 1]) jump(nav[i + 1].id); },
    onPrev: () => { const i = nav.findIndex((item) => item.id === activeHeading); if (nav[i - 1]) jump(nav[i - 1].id); },
  });
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !nav.length) return;
    root.scrollTo({ top: 0 });
    const update = () => {
      const top = root.getBoundingClientRect().top + 100;
      const current = nav.filter((item) => {
        const el = root.querySelector<HTMLElement>(`[id="${item.id}"]`);
        return el && el.getBoundingClientRect().top <= top;
      }).at(-1);
      const atEnd = root.scrollTop + root.clientHeight >= root.scrollHeight - 24;
      setActiveHeading(atEnd ? nav.at(-1)!.id : current?.id || nav[0].id);
    };
    root.addEventListener('scroll', update, { passive: true });
    update();
    return () => root.removeEventListener('scroll', update);
  }, [nav]);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyError('');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { setCopyError('复制失败，请检查浏览器剪贴板权限。'); }
  };
  const toc = (
    <nav aria-label="日报目录" className="space-y-1">
      {nav.map((item, i) => <a key={item.id} href={`#${item.id}`} aria-current={activeHeading === item.id ? 'location' : undefined}
        onClick={(event) => { event.preventDefault(); jump(item.id); }}
        className={`flex gap-3 border-l-2 px-3 py-2.5 text-[13px] leading-5 ${activeHeading === item.id ? 'border-teal-600 bg-teal-50 font-medium text-teal-900' : 'border-transparent text-zinc-500 hover:text-zinc-900'}`}>
        <span className="text-[11px] tabular-nums text-zinc-400">{String(i + 1).padStart(2, '0')}</span>
        <span className="min-w-0 break-words">{item.label === '今日封面判断' ? '本期导读' : item.label}</span>
      </a>)}
    </nav>
  );

  return (
    <div className="daily-edition flex h-[calc(100dvh-8.5rem)] min-h-[320px] flex-col bg-white md:h-dvh">
      <header className="z-20 flex shrink-0 flex-wrap items-center gap-1 border-b border-zinc-200 bg-white px-3 py-2 sm:px-6">
        <Link to={dailyReportScopedPath('/daily/reports/latest', '', sourceId)} className="mr-3 text-base font-semibold text-zinc-900">日报</Link>
        <button className={iconButton} title="上一期" aria-label="上一期" disabled={loading} onClick={() => goDate(data?.dateNavigation?.previousDate || shiftDateKey(activeDate, -1))}><ArrowLeft size={16}/></button>
        <input type="date" aria-label="日报日期" value={activeDate} onChange={(event) => goDate(event.target.value)} className="h-9 w-[136px] min-w-0 rounded-md border border-zinc-200 bg-white px-2 text-sm tabular-nums text-zinc-700"/>
        <button className={iconButton} title="下一期" aria-label="下一期" disabled={loading || !data?.dateNavigation?.nextDate} onClick={() => goDate(data?.dateNavigation?.nextDate || '')}><ArrowRight size={16}/></button>
        <div className="ml-auto flex items-center gap-1">
          <button className={`${iconButton} xl:hidden`} title="目录" aria-label="打开日报目录" onClick={() => setTocOpen(true)} disabled={!published}><List size={18}/></button>
          <button className={iconButton} title={copied ? '已复制' : '复制 Markdown'} aria-label={copied ? '已复制' : '复制 Markdown'} onClick={() => void copy(fullMarkdown)} disabled={!fullMarkdown}>{copied ? <Check size={17}/> : <Copy size={17}/>}</button>
          <button className={iconButton} title="刷新日报" aria-label="刷新日报" onClick={() => void reportQuery.refetch()} disabled={reportQuery.isFetching}><RefreshCw size={16} className={reportQuery.isFetching ? 'animate-spin' : ''}/></button>
          <details className="relative">
            <summary className={`${iconButton} cursor-pointer list-none`} title="日报工具" aria-label="日报工具"><MoreHorizontal size={20}/></summary>
            <div className="absolute right-0 top-11 z-30 w-48 rounded-md border border-zinc-200 bg-white p-1.5 text-sm shadow-lg">
              {[['运行与生成', '/daily/workbench'], ['节点与配置', '/daily/workflows'], ['候选与覆盖', '/daily/candidates']].map(([label, path]) => <Link key={path} to={scoped(path)} className="block rounded px-3 py-2 hover:bg-zinc-100">{label}</Link>)}
              {sourceId ? <Link className="block rounded px-3 py-2 hover:bg-zinc-100" to="/daily/reports/latest">全部来源日报</Link> : null}
              <button className="block w-full rounded px-3 py-2 text-left hover:bg-zinc-100 disabled:text-zinc-400" disabled={!data?.dateNavigation?.latestPublishedDate} onClick={() => goDate(data?.dateNavigation?.latestPublishedDate || '')}>最新已发布日报</button>
            </div>
          </details>
        </div>
      </header>
      {copyError ? <p role="alert" className="px-5 py-2 text-sm text-red-700">{copyError}</p> : null}
      {loading ? <div role="status" className="flex flex-1 items-center justify-center gap-2 text-sm text-zinc-500"><Loader2 size={18} className="animate-spin"/>正在读取日报</div>
        : error ? <div role="alert" className="m-auto max-w-lg p-8"><h1 className="text-xl font-semibold">日报无法加载</h1><p className="mt-3 text-sm text-red-700">{error}</p><button onClick={() => void reportQuery.refetch()} className="mt-4 text-sm text-teal-700">重新加载</button></div>
        : data ? <div className="mx-auto grid min-h-0 w-full max-w-[1260px] flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_224px]">
          <section ref={scrollRef} aria-label="日报正文" className="relative min-h-0 min-w-0 overflow-y-auto overscroll-contain pb-12">
            <div className="px-5 pt-7 sm:px-10 sm:pt-10">
              <header id="report-今日封面判断" className="mx-auto max-w-[800px] border-b border-zinc-200 pb-6">
                <p className="text-xs text-zinc-500"><span className="font-medium text-teal-700">{data.reportScope?.sourceName || 'AI 与科技'}</span><span className="mx-2">/</span>{activeDate}</p>
                <h1 className="mt-4 text-[26px] font-semibold leading-[1.4] text-zinc-950 sm:text-[32px]">{resolveDailyReportTitle(data)}</h1>
                {published ? <p className="mt-4 text-[16px] leading-8 text-zinc-600">{resolveDailyReportLead(data)}</p> : null}
                {published ? <p className="mt-4 text-xs text-zinc-400">约 {stats.minutes} 分钟 · 正文引用 {stats.articles} 篇文章</p> : null}
              </header>
            </div>
            {published ? <DailyFinishedReportArticle markdown={markdown}/> : <div className="mx-auto max-w-[880px] px-5 py-8 sm:px-10">
              <p className="border-l-2 border-amber-500 pl-4 text-sm leading-7 text-zinc-600">{data.missing ? '这一天还没有日报。' : data.qualityReasonLabel || '最终稿尚未通过发布检查，已保留事实草稿。'}</p>
              <div className="mt-5 flex gap-4 text-sm text-teal-700"><Link to={scoped('/daily/workbench')}>查看生成进度</Link><Link to={scoped('/daily/workflows')}>检查节点配置</Link></div>
              {markdown ? <details className="mt-6 border-t border-zinc-200 pt-4"><summary className="cursor-pointer text-sm text-zinc-600">本次事实草稿</summary><DailyFinishedReportArticle markdown={markdown} draft/></details> : null}
            </div>}
            {data.coverageItems?.length ? <details className="mx-5 border-t border-zinc-200 py-5 sm:mx-10"><summary className="cursor-pointer text-sm text-zinc-500">全部素材与收录范围 · {data.coverageItems.length} 篇</summary><div className="mt-5"><CoverageIndexSection items={data.coverageItems} summary={data.coverageSummary} onCopy={() => void copy(buildCoverageMarkdown(data.coverageItems || [], data.coverageSummary))} copied={copied} degraded={!published}/></div></details> : null}
          </section>
          <aside className="hidden min-h-0 overflow-y-auto border-l border-zinc-100 px-4 py-9 xl:block">
            <h2 className="mb-5 px-3 text-xs font-medium text-zinc-400">本期目录</h2>
            {published ? toc : <p className="px-3 text-sm text-zinc-500">正式稿发布后显示目录</p>}
            <details className="mt-8 border-t border-zinc-200 pt-4"><summary className="cursor-pointer px-3 text-xs text-zinc-400">收录范围与运行</summary><div className="mt-3 text-xs text-zinc-500"><DailyEventRadarCard metrics={data.eventMetrics || data.trendSummary?.eventMetrics} compact/><p className="mt-3 px-3">生成于 {data.generatedAt ? new Date(data.generatedAt).toLocaleString('zh-CN') : '未生成'}</p><Link className="mt-3 block px-3 text-teal-700" to={scoped('/daily/workbench')}>查看各节点运行</Link></div></details>
          </aside>
        </div> : null}
      <Dialog.Root open={tocOpen} onOpenChange={setTocOpen}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-40 bg-black/20"/><Dialog.Content className="fixed inset-y-0 right-0 z-50 w-[min(320px,90vw)] overflow-y-auto border-l border-zinc-200 bg-white p-5 shadow-xl"><div className="mb-5 flex items-center justify-between"><Dialog.Title className="text-base font-semibold">本期目录</Dialog.Title><Dialog.Close className={iconButton} aria-label="关闭目录"><X size={18}/></Dialog.Close></div><Dialog.Description className="sr-only">跳转到日报中的章节</Dialog.Description>{toc}</Dialog.Content></Dialog.Portal></Dialog.Root>
    </div>
  );
}
