import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { ArrowUpRight, CheckCircle2, Download, ExternalLink, FlaskConical, RefreshCw, ShieldAlert } from 'lucide-react';
import { api } from '../lib/api';
import type { DibaoStatusPayload, SourceRecord } from '../lib/api/contracts';
import { describeDibaoStatus, selectDibaoCompareSources } from '../lib/reader-lab';

function ReaderLabShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f7f6f1] px-4 py-4 text-zinc-900 md:px-6 md:py-6">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-4">
        <header className="rounded-[18px] border border-zinc-200 bg-white px-5 py-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-teal-700">Reader Lab</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">Dibao 阅读实验室</h1>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-600">
                侧车嵌入 Dibao，用同一批 RSS/OPML 对照抓取、排序和阅读质量；Dibao 保留原项目署名与许可证边界。
              </p>
            </div>
            <nav className="flex flex-wrap gap-2 text-sm">
              {[
                ['/reader-lab', '实验室'],
                ['/reader-lab/setup', '导入设置'],
                ['/reader-lab/compare', '质量对照'],
              ].map(([to, label]) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/reader-lab'}
                  className={({ isActive }) =>
                    `rounded-full border px-4 py-2 font-medium transition ${
                      isActive
                        ? 'border-zinc-900 bg-zinc-900 text-white'
                        : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900'
                    }`
                  }
                >
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

function StatusCard({ status, loading, onRefresh }: {
  status: DibaoStatusPayload | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const view = status ? describeDibaoStatus(status) : null;
  const ok = view?.tone === 'ok';

  return (
    <section className={`rounded-[18px] border bg-white p-5 shadow-sm ${ok ? 'border-teal-200' : 'border-amber-200'}`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex gap-3">
          <div className={`mt-0.5 rounded-full p-2 ${ok ? 'bg-teal-50 text-teal-700' : 'bg-amber-50 text-amber-700'}`}>
            {ok ? <CheckCircle2 size={20} /> : <ShieldAlert size={20} />}
          </div>
          <div>
            <h2 className="text-base font-semibold">{view?.title || '正在检查 Dibao'}</h2>
            <p className="mt-1 text-sm leading-6 text-zinc-600">
              {loading ? '正在读取侧车健康状态...' : view?.description || '等待状态返回。'}
            </p>
            {status && (
              <p className="mt-2 text-xs text-zinc-500">
                健康检查：{status.healthUrl} · {new Date(status.checkedAt).toLocaleString()}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:border-zinc-300"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          刷新状态
        </button>
      </div>
    </section>
  );
}

function useDibaoStatus() {
  const [status, setStatus] = useState<DibaoStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const payload = await api.integrations.dibaoStatus();
      setStatus(payload.data);
    } catch (err) {
      setError((err as Error).message || '读取 Dibao 状态失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return { status, loading, error, reload: load };
}

export function ReaderLab() {
  const { status, loading, error, reload } = useDibaoStatus();
  const publicUrl = status?.publicUrl || 'http://localhost:8082';

  return (
    <ReaderLabShell>
      <StatusCard status={status} loading={loading} onRefresh={reload} />
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <main className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-h-[680px] overflow-hidden rounded-[18px] border border-zinc-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3">
            <div>
              <h2 className="text-sm font-semibold">Dibao 实例</h2>
              <p className="text-xs text-zinc-500">如果 iframe 被浏览器策略拦截，使用右侧按钮在新窗口打开。</p>
            </div>
            <a
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              新窗口打开
              <ArrowUpRight size={15} />
            </a>
          </div>
          <iframe
            title="Dibao Reader Lab"
            src={publicUrl}
            className="hidden h-[720px] w-full border-0 lg:block"
          />
          <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 px-6 text-center lg:hidden">
            <FlaskConical className="text-teal-700" size={36} />
            <h3 className="text-lg font-semibold">移动端建议新窗口打开</h3>
            <p className="max-w-sm text-sm leading-6 text-zinc-600">
              Dibao 是完整阅读器，移动端嵌入会挤压正文。点击上方按钮打开独立页面更稳。
            </p>
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-[18px] border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold">使用顺序</h2>
            <ol className="mt-4 space-y-3 text-sm leading-6 text-zinc-600">
              <li>1. 先到“导入设置”下载信息中枢 OPML。</li>
              <li>2. 打开 Dibao，创建本地账号并导入 OPML。</li>
              <li>3. 在“质量对照”抽测同一批来源。</li>
            </ol>
            <Link
              to="/reader-lab/setup"
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-100"
            >
              进入导入设置
              <ExternalLink size={15} />
            </Link>
          </section>
          <section className="rounded-[18px] border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold">边界说明</h2>
            <p className="mt-3 text-sm leading-6 text-zinc-600">
              Dibao 采用 BUSL-1.1。这里是本地自托管侧车评估，不隐藏 Dibao 名称、版权或许可证，不把 Dibao 数据库并入信息中枢。
            </p>
          </section>
        </aside>
      </main>
    </ReaderLabShell>
  );
}

export function ReaderLabSetup() {
  const { status, loading, reload } = useDibaoStatus();
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');

  async function downloadOpml() {
    setDownloading(true);
    setDownloadError('');
    try {
      const opml = await api.integrations.dibaoOpml();
      const blob = new Blob([opml], { type: 'application/xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'infohub-dibao-sources.opml';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setDownloadError((err as Error).message || '下载 OPML 失败');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <ReaderLabShell>
      <StatusCard status={status} loading={loading} onRefresh={reload} />
      <main className="grid gap-4 lg:grid-cols-3">
        {[
          ['1', '下载 OPML', '导出当前用户启用的 RSS/Atom 源，网页监控和邮箱不会混入 Dibao。'],
          ['2', '导入 Dibao', '打开 Dibao 后进入订阅源导入，把 OPML 文件导入。'],
          ['3', '开始对照', '用同一批源观察 Dibao 的抓取、推荐、原文可读性。'],
        ].map(([step, title, copy]) => (
          <section key={step} className="rounded-[18px] border border-zinc-200 bg-white p-5 shadow-sm">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900 text-sm font-bold text-white">{step}</span>
            <h2 className="mt-4 text-lg font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600">{copy}</p>
          </section>
        ))}
      </main>
      <section className="rounded-[18px] border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">信息中枢 → Dibao OPML</h2>
            <p className="mt-1 text-sm text-zinc-600">只导出当前账号可见、启用中的 RSS/Atom 源；不导出邮箱正文、网页监控快照或私密内容。</p>
          </div>
          <button
            type="button"
            onClick={downloadOpml}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60"
            disabled={downloading}
          >
            <Download size={16} />
            {downloading ? '正在生成...' : '下载 OPML'}
          </button>
        </div>
        {downloadError && <p className="mt-3 text-sm text-rose-700">{downloadError}</p>}
      </section>
    </ReaderLabShell>
  );
}

function rate(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '暂无';
  return `${Math.round(value * 100)}%`;
}

export function ReaderLabCompare() {
  const { status, loading, reload } = useDibaoStatus();
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [sourcesError, setSourcesError] = useState('');

  useEffect(() => {
    api.sources.list({ sortBy: 'quality' })
      .then((payload) => setSources(payload.data || []))
      .catch((err) => setSourcesError((err as Error).message || '读取来源失败'));
  }, []);

  const selected = useMemo(() => selectDibaoCompareSources(sources, 7), [sources]);

  return (
    <ReaderLabShell>
      <StatusCard status={status} loading={loading} onRefresh={reload} />
      <section className="rounded-[18px] border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">同源质量对照</h2>
            <p className="mt-1 text-sm leading-6 text-zinc-600">
              先用信息中枢的来源健康做基线，再去 Dibao 查看同源抓取结果。若 Dibao 同源正常，问题更可能在信息中枢正文抽取/展示；若两边都差，优先治理源。
            </p>
          </div>
          <a
            href={status?.publicUrl || 'http://localhost:8082'}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:border-zinc-300"
          >
            打开 Dibao 对照
            <ArrowUpRight size={15} />
          </a>
        </div>
        {sourcesError && <p className="mt-4 text-sm text-rose-700">{sourcesError}</p>}
        <div className="mt-5 overflow-hidden rounded-2xl border border-zinc-200">
          <div className="grid grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr_1fr] bg-zinc-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 max-lg:hidden">
            <span>来源</span>
            <span>等级</span>
            <span>正文率</span>
            <span>AI 完成率</span>
            <span>对照重点</span>
          </div>
          <div className="divide-y divide-zinc-100">
            {selected.map((source) => (
              <div key={source.id} className="grid gap-3 px-4 py-4 text-sm lg:grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr_1fr] lg:items-center">
                <div>
                  <p className="font-semibold text-zinc-900">{source.name}</p>
                  <p className="mt-1 text-xs text-zinc-500">{source.category || '未分类'} · {source.itemCount || 0} 条</p>
                </div>
                <span className="w-fit rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700">{source.sourceTier || '未定级'}</span>
                <span>{rate(source.sourceQuality?.contentReadyRate)}</span>
                <span>{rate(source.sourceQuality?.aiReadyRate)}</span>
                <span className="text-zinc-600">抽 5 条看标题、正文、摘要、排序是否一致。</span>
              </div>
            ))}
            {selected.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-zinc-500">暂无可对照来源；请先导入或启用 RSS/Atom 源。</div>
            )}
          </div>
        </div>
      </section>
    </ReaderLabShell>
  );
}
