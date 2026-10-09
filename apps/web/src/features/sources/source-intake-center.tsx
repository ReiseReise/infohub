import type { FormEvent } from 'react';
import { Compass, Upload, X } from 'lucide-react';
import type { DiscoveryCandidate, SubscriptionPackageMeta } from '../../lib/api';
import { ReferenceSourceCatalog } from './reference-source-catalog';
import { discoveryReasonLabel } from './source-intake-model';

export type DiscoverMode = 'search' | 'rss' | 'rsshub';

interface EmailIntakeState {
  tab: 'paste' | 'eml';
  sourceLabel: string;
  subject: string;
  from: string;
  body: string;
  files: File[];
  importing: boolean;
  inboxSourceId: number | null;
}

interface EmailIntakeActions {
  setTab: (value: 'paste' | 'eml') => void;
  setSourceLabel: (value: string) => void;
  setSubject: (value: string) => void;
  setFrom: (value: string) => void;
  setBody: (value: string) => void;
  setFiles: (files: File[]) => void;
  importPaste: () => void;
  importEml: () => void;
  openInbox: (sourceId: number) => void;
}

interface PackageIntakeState {
  packages: SubscriptionPackageMeta[];
  importingSlug: string | null;
}

interface DiscoveryState {
  mode: DiscoverMode;
  query: string;
  category: string;
  loading: boolean;
  error: string | null;
  results: DiscoveryCandidate[];
  subscribingKey: string | null;
}

interface DiscoveryActions {
  setMode: (value: DiscoverMode) => void;
  setQuery: (value: string) => void;
  setCategory: (value: string) => void;
  submit: (event: FormEvent) => void;
  subscribe: (candidate: DiscoveryCandidate) => void;
}

interface SourceIntakeCenterProps {
  open: boolean;
  onClose: () => void;
  onSourcesChanged: () => void | Promise<void>;
  email: EmailIntakeState;
  emailActions: EmailIntakeActions;
  packages: PackageIntakeState;
  onImportPackage: (pkg: SubscriptionPackageMeta) => void;
  discovery: DiscoveryState;
  discoveryActions: DiscoveryActions;
}

export function SourceIntakeCenter({
  open,
  onClose,
  onSourcesChanged,
  email,
  emailActions,
  packages,
  onImportPackage,
  discovery,
  discoveryActions,
}: SourceIntakeCenterProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="关闭接入中心"
        onClick={onClose}
        className="absolute inset-0 bg-black/25"
      />
      <aside
        className="relative z-10 flex h-full w-full max-w-3xl flex-col border-l border-zinc-200 bg-zinc-50 shadow-2xl"
        aria-modal="true"
        role="dialog"
        aria-label="信源接入中心"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-5 py-4">
          <div>
            <div className="text-[11px] tracking-[0.22em] text-teal-700/70">低频工具</div>
            <h2 className="mt-1 text-lg font-semibold text-zinc-900">信源接入中心</h2>
            <p className="mt-1 text-xs text-zinc-500">邮箱、订阅包与新来源发现集中在这里，不占用日常治理首屏。</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100" title="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <ReferenceSourceCatalog onChanged={onSourcesChanged} />

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-2xl border border-zinc-200 bg-white p-4">
              <div className="text-[11px] tracking-[0.22em] text-zinc-500">外部入口</div>
              <h2 className="mt-1 text-sm font-semibold text-zinc-900">邮箱投递</h2>
              <p className="mt-1 text-sm leading-6 text-zinc-600">
                适合手动转发 Newsletter、邮件简报和重要通知。系统只记录标题、来源和 hash 日志；完整正文进入你的私有 Feed，不默认进入日报主线。
              </p>
              <div className="mt-3 flex rounded-xl bg-zinc-100 p-1 text-xs">
                <button
                  type="button"
                  onClick={() => emailActions.setTab('paste')}
                  className={`flex-1 rounded-lg px-3 py-2 font-medium ${email.tab === 'paste' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'}`}
                >
                  粘贴导入
                </button>
                <button
                  type="button"
                  onClick={() => emailActions.setTab('eml')}
                  className={`flex-1 rounded-lg px-3 py-2 font-medium ${email.tab === 'eml' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'}`}
                >
                  上传 .eml
                </button>
              </div>
              <div className="mt-3 space-y-2">
                <input
                  value={email.sourceLabel}
                  onChange={(event) => emailActions.setSourceLabel(event.target.value)}
                  placeholder="来源标签，如 AI Newsletter"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                />
                {email.tab === 'paste' ? (
                  <>
                    <div className="grid gap-2 md:grid-cols-2">
                      <input
                        value={email.subject}
                        onChange={(event) => emailActions.setSubject(event.target.value)}
                        placeholder="邮件标题"
                        className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                      />
                      <input
                        value={email.from}
                        onChange={(event) => emailActions.setFrom(event.target.value)}
                        placeholder="发件人（可选）"
                        className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                      />
                    </div>
                    <textarea
                      value={email.body}
                      onChange={(event) => emailActions.setBody(event.target.value)}
                      placeholder="粘贴邮件正文或 newsletter 内容..."
                      rows={5}
                      className="w-full resize-y rounded-lg border border-zinc-200 px-3 py-2 text-sm leading-6"
                    />
                    <button
                      type="button"
                      onClick={emailActions.importPaste}
                      disabled={email.importing}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white hover:bg-zinc-800 disabled:opacity-50"
                    >
                      <Upload size={14} />
                      {email.importing ? '导入中...' : '导入邮件'}
                    </button>
                  </>
                ) : (
                  <>
                    <input
                      type="file"
                      accept=".eml,message/rfc822,text/plain"
                      multiple
                      onChange={(event) => emailActions.setFiles(Array.from(event.target.files || []))}
                      className="block w-full rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-3 text-sm text-zinc-600"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={emailActions.importEml}
                        disabled={email.importing || email.files.length === 0}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white hover:bg-zinc-800 disabled:opacity-50"
                      >
                        <Upload size={14} />
                        {email.importing ? '上传中...' : `上传 ${email.files.length || 0} 封`}
                      </button>
                      {email.files.length > 0 ? (
                        <span className="text-xs text-zinc-500">
                          {email.files.map((file) => file.name).slice(0, 2).join('、')}
                          {email.files.length > 2 ? ` 等 ${email.files.length} 个` : ''}
                        </span>
                      ) : null}
                    </div>
                  </>
                )}
                {email.inboxSourceId ? (
                  <button
                    type="button"
                    onClick={() => emailActions.openInbox(email.inboxSourceId as number)}
                    className="text-xs font-medium text-teal-700 hover:text-teal-900"
                  >
                    查看 Email Inbox →
                  </button>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl border border-teal-100 bg-teal-50/55 p-4">
              <div className="text-[11px] tracking-[0.22em] text-teal-700/80">精选榜单</div>
              <h2 className="mt-1 text-sm font-semibold text-zinc-900">BestBlogs Daily Brief</h2>
              <p className="mt-1 text-sm leading-6 text-zinc-600">
                榜单页会被拆成多条文章卡片；先保留榜单摘要，原文正文后续可补抓。运行 seed 脚本后可在这里按“精选榜单页”过滤和治理。
              </p>
            </div>
          </div>

          {packages.packages.length > 0 ? (
            <div className="grid gap-3">
              {packages.packages.map((pkg) => (
                <div key={pkg.slug} className="rounded-xl border border-amber-200 bg-[linear-gradient(135deg,_rgba(254,243,199,0.55),_rgba(255,255,255,0.96))] p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-[11px] tracking-[0.22em] text-amber-700/80">内置信源包</div>
                      <h2 className="mt-1 text-base font-semibold text-zinc-900">{pkg.title}</h2>
                      <p className="mt-1 text-sm text-zinc-600">{pkg.description}</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        内置 {pkg.sourceCount} 个源
                        {pkg.tierSummary ? ` · ${Object.entries(pkg.tierSummary).map(([tier, count]) => `${tier} ${count}`).join(' / ')}` : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => onImportPackage(pkg)}
                      disabled={packages.importingSlug === pkg.slug}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-amber-900 hover:bg-amber-50 disabled:opacity-50"
                    >
                      <Upload size={14} />
                      {packages.importingSlug === pkg.slug ? '导入中...' : '导入订阅包'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="rounded-xl border border-zinc-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-800">
                  <Compass size={14} /> 快速发现订阅
                </h2>
                <p className="mt-0.5 text-xs text-zinc-500">关键词/URL 探测 → 预览候选 → 一键订阅</p>
              </div>
              <input
                value={discovery.category}
                onChange={(event) => discoveryActions.setCategory(event.target.value)}
                placeholder="默认分类"
                className="w-36 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs"
              />
            </div>

            <form onSubmit={discoveryActions.submit} className="space-y-2">
              <div className="flex w-fit rounded-lg bg-zinc-100 p-0.5">
                {(['search', 'rss', 'rsshub'] as DiscoverMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => discoveryActions.setMode(mode)}
                    className={`min-h-9 rounded-md px-3 py-2 text-xs transition-colors ${discovery.mode === mode ? 'bg-white font-medium shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
                  >
                    {mode === 'search' ? '搜索' : mode === 'rss' ? 'RSS URL' : 'RSSHub 路由'}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={discovery.query}
                  onChange={(event) => discoveryActions.setQuery(event.target.value)}
                  placeholder={discovery.mode === 'rsshub' ? 'rsshub://github/trending/daily' : '关键词、站点 URL 或 RSS 链接'}
                  className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  disabled={discovery.loading}
                  className="rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                  {discovery.loading ? '发现中...' : '发现'}
                </button>
              </div>
            </form>

            {discovery.error ? <p className="mt-2 text-xs text-red-600">{discovery.error}</p> : null}

            {discovery.results.length > 0 ? (
              <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                {discovery.results.map((candidate) => (
                  <div key={candidate.discoveryKey} className="rounded-xl border border-zinc-200 bg-zinc-50/60 px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-3">
                          {candidate.iconUrl ? (
                            <img src={candidate.iconUrl} alt="" className="mt-0.5 h-8 w-8 rounded-lg border border-zinc-200 bg-white object-cover" />
                          ) : (
                            <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-[11px] font-semibold uppercase text-zinc-500">
                              {(candidate.sourceHost || candidate.title || '?').slice(0, 1)}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-medium text-zinc-800">{candidate.title}</p>
                              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">{candidate.collectorType}</span>
                              <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-700">{Math.round(candidate.confidence * 100)}% 命中</span>
                              <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-700">{discoveryReasonLabel(candidate.reason)}</span>
                              {candidate.alreadySubscribed ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700">已订阅</span> : null}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                              {candidate.sourceHost ? <span>{candidate.sourceHost}</span> : null}
                              {candidate.latestPublishedAt ? <span>最近更新 {new Date(candidate.latestPublishedAt).toLocaleString()}</span> : null}
                              {candidate.sampleCount > 0 ? <span>预览 {candidate.sampleCount} 条</span> : null}
                            </div>
                            {candidate.description ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">{candidate.description}</p> : null}
                            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                              {candidate.websiteUrl ? (
                                <a href={candidate.websiteUrl} target="_blank" rel="noreferrer" className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-zinc-600 hover:bg-zinc-100">站点</a>
                              ) : null}
                              {candidate.feedUrl ? (
                                <a href={candidate.feedUrl} target="_blank" rel="noreferrer" className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-zinc-600 hover:bg-zinc-100">Feed</a>
                              ) : null}
                            </div>
                            {candidate.sampleItems.length > 0 ? (
                              <div className="mt-2 space-y-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-2">
                                {candidate.sampleItems.slice(0, 3).map((sample, index) => (
                                  <div key={`${candidate.discoveryKey}-${index}`} className="flex items-start justify-between gap-3 text-[11px] text-zinc-500">
                                    <span className="min-w-0 flex-1 truncate">{sample.title}</span>
                                    {sample.publishedAt ? <span className="shrink-0 text-zinc-400">{new Date(sample.publishedAt).toLocaleDateString()}</span> : null}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => discoveryActions.subscribe(candidate)}
                        disabled={Boolean(candidate.alreadySubscribed) || discovery.subscribingKey === candidate.discoveryKey}
                        className="shrink-0 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs hover:bg-zinc-50 disabled:opacity-40"
                      >
                        {discovery.subscribingKey === candidate.discoveryKey ? '订阅中...' : candidate.alreadySubscribed ? '已订阅' : '订阅'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  );
}
