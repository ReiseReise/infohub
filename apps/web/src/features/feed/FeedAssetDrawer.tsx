import { ExternalLink, Loader2, RefreshCw, Settings2, Headphones } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FeedItemRecord } from '../../lib/api';
import {
  getReprocessStageActionState,
  getScoreBreakdownDiagnostic,
  type FeedReprocessStage,
  type NoticeTone,
} from '../../lib/feed-diagnostics';
import {
  feedReaderSideRailClassName,
  feedTranslationActionLabel,
  resolveFeedDetailToolActions,
  resolveFeedTranslationAction,
  shouldDisableFeedTranslationAction,
  shouldOfferFeedFullTranslation,
} from '../../lib/feed-layout';
import {
  READER_FONT_SIZE_OPTIONS,
  READER_LINE_HEIGHT_OPTIONS,
  READER_WIDTH_OPTIONS,
  type ReaderPreferences,
} from '../../lib/reader-preferences';
import { useFeedContext } from './FeedContext';

type FeedItem = FeedItemRecord;
type ReprocessStage = FeedReprocessStage;

const DETAIL_REPROCESS_ACTIONS: Array<{ stage: ReprocessStage; label: string; hint: string }> = [
  { stage: 'content', label: '补正文', hint: '重新抓取正文，不自动重写摘要' },
  { stage: 'quality', label: '重跑质检', hint: '重新判断噪声/可读性' },
  { stage: 'scoring', label: '重跑评分', hint: '只刷新 AI 评分' },
  { stage: 'summary', label: '重跑摘要', hint: '用当前内容依据重写摘要' },
  { stage: 'translation', label: '重跑翻译', hint: '重译摘要/正文' },
];

const FEEDBACK_ACTIONS: Array<{
  type: NonNullable<FeedItem['latestFeedbackType']>;
  label: string;
  activeClassName: string;
  idleClassName: string;
}> = [
  { type: 'must_read', label: '值得重点关注', activeClassName: 'bg-teal-600 text-white border-teal-600', idleClassName: 'border-teal-200 text-teal-700 hover:bg-teal-50' },
  { type: 'like', label: '更想看', activeClassName: 'bg-emerald-600 text-white border-emerald-600', idleClassName: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50' },
  { type: 'dislike', label: '少给我看', activeClassName: 'bg-amber-500 text-white border-amber-500', idleClassName: 'border-amber-200 text-amber-700 hover:bg-amber-50' },
  { type: 'not_for_me', label: '不符合口味', activeClassName: 'bg-rose-600 text-white border-rose-600', idleClassName: 'border-rose-200 text-rose-700 hover:bg-rose-50' },
];

const FEEDBACK_REASON_TAG_OPTIONS = [
  'AI行业', '模型能力', 'Agent', '产品落地', '应用案例', '资本市场', '监管政策', '头部舆论', '公司战略', '太泛', '标题党', '信息噪音',
] as const;

const SCORE_DIAGNOSTIC_CLASS_NAMES = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-rose-200 bg-rose-50 text-rose-800',
  neutral: 'border-zinc-200 bg-zinc-50 text-zinc-700',
} as const;

const DAILY_REPORT_DIAGNOSTIC_CLASS_NAMES = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-rose-200 bg-rose-50 text-rose-800',
  neutral: 'border-zinc-200 bg-zinc-50 text-zinc-700',
} as const;

const NOTICE_CLASS_NAMES: Record<NoticeTone, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-rose-200 bg-rose-50 text-rose-700',
};

function sourceKindLabel(kind?: string | null) {
  const labels: Record<string, string> = { official: '官方/一手', blog: '博客/研究', rss: 'RSS', x: 'X/KOL', wechat: '公众号', media: '媒体', api: 'API', webpage: '网页', podcast: '播客', other: '其他' };
  return kind ? labels[kind] || kind : '';
}

function eventEvidenceTypeLabel(type?: string | null) {
  if (type === 'first_party') return '官方一手';
  if (type === 'external_radar') return '外部雷达';
  return '本地来源';
}

export function FeedAssetDrawer() {
  const navigate = useNavigate();
  const ctx = useFeedContext();
  const {
    selectedItem, stageReprocessing, stageNotice, feedbackNotice, feedbackSubmittingType,
    selectedFeedbackTags, setSelectedFeedbackTags, scoreBreakdown, breakdownLoading,
    preferenceSummary, readerPreferences, updateReaderPreference,
    audioSubmittingId, aiReprocessingId, enrichingId,
    handleStartAudio, handleReprocessAi, handleReprocessStage, handleTranslateFull,
    handleEnrich, handleFeedback,
  } = ctx;

  const stageNoticeMessage = typeof stageNotice === 'string' ? stageNotice : stageNotice?.message;
  const stageNoticeTone: NoticeTone = typeof stageNotice === 'string' || !stageNotice ? 'success' : stageNotice.tone;
  const feedbackNoticeMessage = typeof feedbackNotice === 'string' ? feedbackNotice : feedbackNotice?.message;
  const feedbackNoticeTone: NoticeTone = typeof feedbackNotice === 'string' || !feedbackNotice ? 'success' : feedbackNotice.tone;

  const scoreDiagnostic = useMemo(() => getScoreBreakdownDiagnostic({
    aiScore: scoreBreakdown?.aiScore ?? selectedItem?.aiScore,
    breakdowns: scoreBreakdown?.breakdowns,
  }), [scoreBreakdown, selectedItem?.aiScore]);

  const skippedReprocessActions = useMemo(() => {
    if (!selectedItem) return [];
    return DETAIL_REPROCESS_ACTIONS.map((action) => ({
      action, state: getReprocessStageActionState(action.stage, selectedItem),
    })).filter((entry) => entry.state.disabled && entry.state.reason);
  }, [selectedItem]);

  if (!selectedItem) return null;

  const relatedEventItems = selectedItem.eventContext?.relatedItems || [];
  const translationAction = resolveFeedTranslationAction(selectedItem);
  const feedDetailActionInput = {
    hasUrl: Boolean(selectedItem.url),
    hasOriginalUrl: Boolean(selectedItem.originalUrl),
    hasCurationUrl: Boolean(selectedItem.curationUrl && selectedItem.curationUrl !== (selectedItem.originalUrl || selectedItem.url)),
    hasAudio: selectedItem.mediaType === 'audio' || Boolean(selectedItem.mediaUrl),
    hasAudioTask: Boolean(selectedItem.audioTaskId),
    needsFullTranslation: translationAction === 'translate' || translationAction === 'fetch_then_translate' || shouldOfferFeedFullTranslation(selectedItem),
    canReprocessAi: true,
    canEnrichContent: true,
  };
  const toolActionKeys = resolveFeedDetailToolActions(feedDetailActionInput);
  const baseClassName = 'inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700 transition-colors hover:border-teal-200 hover:bg-teal-50 hover:text-teal-800 disabled:opacity-50';

  return (
    <aside
      data-feed-reader-side-rail
      className={feedReaderSideRailClassName}
      style={{ '--reader-width': `${readerPreferences.width}px` } as React.CSSProperties}
    >
      <details data-feed-reader-preferences className="min-w-0 overflow-hidden rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-zinc-800">
          <Settings2 size={15} /> 阅读设置
          <span className="ml-auto text-xs font-normal text-zinc-500">{readerPreferences.width}px · {readerPreferences.fontSize}px</span>
        </summary>
        <div className="mt-3 grid gap-3 text-xs text-zinc-600 sm:grid-cols-2 min-[2100px]:grid-cols-1">
          <label className="grid gap-1.5"><span>正文宽度</span><select value={readerPreferences.width} onChange={(e) => updateReaderPreference('width', Number(e.target.value) as ReaderPreferences['width'])} className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-sm text-zinc-800">{READER_WIDTH_OPTIONS.map((v) => <option key={v} value={v}>{v}px</option>)}</select></label>
          <label className="grid gap-1.5"><span>正文字号</span><select value={readerPreferences.fontSize} onChange={(e) => updateReaderPreference('fontSize', Number(e.target.value) as ReaderPreferences['fontSize'])} className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-sm text-zinc-800">{READER_FONT_SIZE_OPTIONS.map((v) => <option key={v} value={v}>{v}px</option>)}</select></label>
          <label className="grid gap-1.5"><span>行高</span><select value={readerPreferences.lineHeight} onChange={(e) => updateReaderPreference('lineHeight', Number(e.target.value) as ReaderPreferences['lineHeight'])} className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-sm text-zinc-800">{READER_LINE_HEIGHT_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
          <label className="grid gap-1.5"><span>字体</span><select value={readerPreferences.fontFamily} onChange={(e) => updateReaderPreference('fontFamily', e.target.value as ReaderPreferences['fontFamily'])} className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-sm text-zinc-800"><option value="sans">无衬线</option><option value="serif">衬线</option></select></label>
        </div>
      </details>

      <details data-feed-diagnostics className="min-w-0 scroll-mb-32 overflow-hidden rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
        <summary className="cursor-pointer text-sm font-semibold text-zinc-800">
          低频工具与诊断 <span className="ml-2 text-xs font-normal text-zinc-500">扩展内容、补抓、评分拆解、日报解释默认收起</span>
        </summary>

        {(selectedItem.curationSource || selectedItem.originalUrl || selectedItem.curationUrl) && (
          <details className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50/70 px-4 py-3">
            <summary className="cursor-pointer text-xs font-semibold text-zinc-800">文章来源 <span className="ml-2 font-normal text-zinc-500">发现源、原站链接和榜单来源默认收起</span></summary>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-600">
              {selectedItem.curationSource && <span className="rounded-full bg-white px-2.5 py-1">发现源：{selectedItem.curationSource}</span>}
              {selectedItem.originalUrl ? <a href={selectedItem.originalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-1 font-medium text-teal-800 hover:text-teal-950">原站链接 <ExternalLink size={12} /></a> : <span className="rounded-full bg-white px-2.5 py-1 text-amber-700">原站链接待解析</span>}
              {selectedItem.curationUrl && <a href={selectedItem.curationUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-1 font-medium text-zinc-700 hover:text-zinc-950">榜单来源 <ExternalLink size={12} /></a>}
            </div>
          </details>
        )}

        {toolActionKeys.length > 0 && (
          <details data-feed-reader-tools className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50/70 px-4 py-3">
            <summary className="cursor-pointer text-xs font-semibold text-zinc-800">更多工具 <span className="ml-2 font-normal text-zinc-500">补抓正文、重跑 AI、榜单来源和音频动作放这里</span></summary>
            <div className="mt-3 flex flex-wrap gap-2">
              {toolActionKeys.map((action) => {
                if (action === 'open_curation' && selectedItem.curationUrl) return <a key={action} href={selectedItem.curationUrl} target="_blank" rel="noopener noreferrer" className={baseClassName}>榜单来源 <ExternalLink size={12} /></a>;
                if (action === 'transcribe_audio') return <button key={action} type="button" onClick={() => { void handleStartAudio(selectedItem); }} disabled={audioSubmittingId === selectedItem.id} className={baseClassName}>{audioSubmittingId === selectedItem.id ? <Loader2 size={12} className="animate-spin" /> : <Headphones size={12} />}{selectedItem.audioTaskId ? '重新转写' : '播客转写'}</button>;
                if (action === 'open_audio_task' && selectedItem.audioTaskId) return <button key={action} type="button" onClick={() => navigate(`/audio?taskId=${selectedItem.audioTaskId}`)} className={baseClassName}>查看音频任务</button>;
                if (action === 'full_translation') return <button key={action} type="button" onClick={() => { void handleTranslateFull(selectedItem); }} disabled={shouldDisableFeedTranslationAction(stageReprocessing, selectedItem.id)} className={baseClassName}>{stageReprocessing?.itemId === selectedItem.id && stageReprocessing.stage === 'translation' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}{feedTranslationActionLabel(translationAction) || '精译全文'}</button>;
                if (action === 'reprocess_ai') return <button key={action} type="button" onClick={() => { void handleReprocessAi(selectedItem); }} disabled={aiReprocessingId === selectedItem.id} className={baseClassName}>{aiReprocessingId === selectedItem.id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}重跑 AI</button>;
                if (action === 'enrich_content') return <button key={action} type="button" onClick={() => { void handleEnrich(selectedItem); }} disabled={enrichingId === selectedItem.id} className={baseClassName}>{enrichingId === selectedItem.id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}补抓正文</button>;
                return null;
              })}
            </div>
          </details>
        )}

        {selectedItem.dailyReportDiagnostic && (
          <details className={`mt-3 rounded-2xl border px-4 py-3 text-sm ${DAILY_REPORT_DIAGNOSTIC_CLASS_NAMES[selectedItem.dailyReportDiagnostic.tone] || DAILY_REPORT_DIAGNOSTIC_CLASS_NAMES.neutral}`}>
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.18em] opacity-75">日报解释 <span className="ml-2 rounded-full bg-white/65 px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal text-zinc-800">{selectedItem.dailyReportDiagnostic.label}</span></summary>
            <div className="mt-2 text-sm leading-6 font-medium">{selectedItem.dailyReportDiagnostic.reason}</div>
            {selectedItem.dailyReportDiagnostic.detail && selectedItem.dailyReportDiagnostic.detail !== selectedItem.dailyReportDiagnostic.reason && <div className="mt-1 text-xs leading-5 opacity-90">{selectedItem.dailyReportDiagnostic.detail}</div>}
            <div className="mt-2 text-xs leading-5 opacity-90">下一步：{selectedItem.dailyReportDiagnostic.action}</div>
            {(selectedItem.dailyReportDiagnostic.diagnosticBasisLabel || selectedItem.dailyReportDiagnostic.snapshotGeneratedAt) && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] leading-5 opacity-75">
                {selectedItem.dailyReportDiagnostic.diagnosticBasisLabel && <span>{selectedItem.dailyReportDiagnostic.diagnosticBasisLabel}</span>}
                {selectedItem.dailyReportDiagnostic.snapshotGeneratedAt && <span>{new Date(selectedItem.dailyReportDiagnostic.snapshotGeneratedAt).toLocaleString('zh-CN')}</span>}
              </div>
            )}
          </details>
        )}

        <details data-feed-stage-repair open={Boolean(stageNoticeMessage) || Boolean(stageReprocessing)} className="mt-3 min-w-0 overflow-hidden rounded-2xl border border-zinc-200 bg-white px-4 py-3">
          <summary className="cursor-pointer text-xs font-semibold text-zinc-800">阶段修复 <span className="ml-2 font-normal text-zinc-500">按阶段单独补正文、评分、摘要或翻译</span></summary>
          <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 text-[11px] leading-5 text-zinc-500">对当前条目单独重跑一个阶段，结果会回写到详情和列表。</div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:min-w-0 lg:flex-1 lg:justify-end">
              {DETAIL_REPROCESS_ACTIONS.map((action) => {
                const busy = stageReprocessing?.itemId === selectedItem.id && stageReprocessing.stage === action.stage;
                const actionState = getReprocessStageActionState(action.stage, selectedItem);
                return (
                  <button key={action.stage} type="button" title={actionState.reason ? `${action.hint}；${actionState.reason}` : action.hint} onClick={() => { void handleReprocessStage(selectedItem, action.stage); }} disabled={Boolean(stageReprocessing) || actionState.disabled} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50">
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} {action.label}
                  </button>
                );
              })}
            </div>
          </div>
          {skippedReprocessActions.length > 0 && <div className="mt-3 space-y-1 text-[11px] leading-5 text-zinc-500">{skippedReprocessActions.map((entry) => <div key={entry.action.stage}>{entry.action.label}已按策略跳过：{entry.state.reason}</div>)}</div>}
          {stageNoticeMessage && <div className={`mt-3 rounded-xl border px-3 py-2 text-xs leading-5 ${NOTICE_CLASS_NAMES[stageNoticeTone]}`}>{stageNoticeMessage}</div>}
        </details>

        {selectedItem.eventContext && (selectedItem.eventContext.internalSourceCount > 1 || selectedItem.eventContext.externalSourceCount > 0) && (
          <details className="mt-4 rounded-2xl border border-teal-100 bg-teal-50/50 px-4 py-4">
            <summary className="cursor-pointer text-xs font-semibold text-teal-900">多源印证 <span className="ml-2 font-normal text-teal-800">本地 {selectedItem.eventContext.internalSourceCount} 个来源{selectedItem.eventContext.firstPartyCount > 0 ? ` · 一手 ${selectedItem.eventContext.firstPartyCount}` : ''}{selectedItem.eventContext.externalSourceCount > 0 ? ` · 外部雷达 ${selectedItem.eventContext.externalSourceCount}` : ''}</span></summary>
            <div className="mt-2 text-xs leading-5 text-teal-800">{selectedItem.eventContext.leadReason}{selectedItem.eventContext.externalSourceCount > 0 ? ' 外部雷达数量只用于发现线索，不等同于本地已核验来源。' : ''}</div>
            {relatedEventItems.length > 0 && (
              <div className="mt-3 space-y-2">
                {relatedEventItems.slice(0, 8).map((entry) => (
                  <div key={entry.id} className="flex items-center gap-2 rounded-xl border border-teal-100 bg-white/80 px-3 py-2 hover:bg-white">
                    <button type="button" onClick={() => navigate(`/feed/${entry.id}`)} className="min-w-0 flex-1 text-left">
                      <div className="line-clamp-1 text-sm font-medium text-zinc-900">{entry.title}</div>
                      <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-zinc-500"><span>{entry.sourceName || '未知来源'}</span><span>{eventEvidenceTypeLabel(entry.evidenceType)}</span>{entry.sourceKind && <span>{sourceKindLabel(entry.sourceKind)}</span>}</div>
                    </button>
                    {(entry.originalUrl || entry.url) ? <a href={entry.originalUrl || entry.url} target="_blank" rel="noreferrer" aria-label="打开该证据原文" title="打开该证据原文" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50"><ExternalLink size={14} /></a> : null}
                  </div>
                ))}
              </div>
            )}
          </details>
        )}

        <details data-feed-feedback open={Boolean(feedbackNoticeMessage) || Boolean(feedbackSubmittingType)} className="mt-4 min-w-0 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50/80 px-4 py-4">
          <summary className="cursor-pointer text-xs font-semibold text-zinc-800">人类反馈 <span className="ml-2 font-normal text-zinc-500">偏好反馈、标签和画像状态默认收起</span></summary>
          <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="text-xs text-zinc-500">直接告诉系统这条是否更符合你的精选口味。当前偏好会用于后续评分技能和偏好画像。</div>
            {selectedItem.latestFeedbackType && <div className="text-xs text-zinc-500">最近反馈：<span className="ml-1 font-medium text-zinc-800">{FEEDBACK_ACTIONS.find((a) => a.type === selectedItem.latestFeedbackType)?.label || selectedItem.latestFeedbackType}</span></div>}
          </div>
          <div className="mt-3 grid gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-xs text-zinc-600 sm:grid-cols-3">
            <div>累计反馈：<span className="font-medium text-zinc-900">{preferenceSummary?.totalFeedback ?? 0}</span></div>
            <div>正向/负向：<span className="font-medium text-zinc-900">{preferenceSummary?.positiveCount ?? 0} / {preferenceSummary?.negativeCount ?? 0}</span></div>
            <div>画像状态：<span className="ml-1 font-medium text-zinc-900">{preferenceSummary?.lastFeedbackAt ? '已参与偏好画像' : '尚未形成反馈画像'}</span></div>
          </div>
          {feedbackNoticeMessage && <div className={`mt-3 rounded-xl border px-3 py-2 text-xs leading-5 ${NOTICE_CLASS_NAMES[feedbackNoticeTone]}`}>{feedbackNoticeMessage}</div>}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {FEEDBACK_ACTIONS.map((action) => {
              const active = selectedItem.latestFeedbackType === action.type;
              const busy = feedbackSubmittingType === action.type;
              return <button key={action.type} onClick={() => { void handleFeedback(selectedItem, action.type, selectedFeedbackTags); }} disabled={Boolean(feedbackSubmittingType)} className={`min-h-9 rounded-full border px-3 py-2 text-xs transition-colors disabled:opacity-50 ${active ? action.activeClassName : action.idleClassName}`}>{busy ? '提交中...' : action.label}</button>;
            })}
          </div>
          <div className="mt-3">
            <div className="text-[11px] font-medium text-zinc-500">可选标签（0-3 个）</div>
            <div className="mt-2 grid grid-cols-2 gap-2 pb-8 sm:flex sm:flex-wrap">
              {FEEDBACK_REASON_TAG_OPTIONS.map((tag) => {
                const active = selectedFeedbackTags.includes(tag);
                const disabled = !active && selectedFeedbackTags.length >= 3;
                return <button key={tag} type="button" disabled={disabled} onClick={() => setSelectedFeedbackTags((prev) => prev.includes(tag) ? prev.filter((e) => e !== tag) : [...prev, tag].slice(0, 3))} className={`min-h-9 rounded-full border px-3 py-2 text-[11px] transition-colors disabled:opacity-40 ${active ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'}`}>{tag}</button>;
              })}
            </div>
            <div className="mt-2 text-[11px] text-zinc-500">标签是可选的。它们会进入偏好画像，并帮助评分 Skills 更快对齐你的精选口味。</div>
          </div>
        </details>

        <details data-feed-score-breakdown className="mt-4 min-w-0 overflow-hidden rounded-2xl border border-zinc-200 bg-white px-4 py-4">
          <summary className="cursor-pointer text-xs font-semibold text-zinc-800">评分拆解 <span className="ml-2 font-normal text-zinc-500">总分 {scoreBreakdown?.aiScore ?? selectedItem.aiScore ?? '—'}，Skill 级理由默认收起</span></summary>
          <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 text-xs text-zinc-500">总分来自评分技能组聚合，再叠加规则过滤与优先级逻辑。</div>
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-zinc-500">
              <button type="button" onClick={() => navigate('/settings?tab=models&ai=skills')} className="min-h-8 rounded-full border border-zinc-200 px-3 py-1 text-zinc-600 hover:bg-zinc-50">去 AI 中心管理 Skills</button>
            </div>
          </div>
          {breakdownLoading ? <div className="mt-3 text-sm text-zinc-400">评分拆解加载中...</div> : (
            <>
              <div className={`mt-3 rounded-xl border px-3 py-2 text-xs leading-5 ${SCORE_DIAGNOSTIC_CLASS_NAMES[scoreDiagnostic.tone]}`}><span className="font-semibold">{scoreDiagnostic.title}</span><span> · {scoreDiagnostic.description}</span></div>
              {scoreBreakdown?.breakdowns?.length ? (
                <div className="mt-3 grid min-w-0 grid-cols-1 gap-3">
                  {scoreBreakdown.breakdowns.map((entry) => (
                    <div key={entry.id} data-feed-score-card className="min-w-0 overflow-hidden rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-3">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0 break-words text-sm font-medium text-zinc-800">{entry.skillName || '默认评分'}</div><div className="shrink-0 text-xs text-zinc-500">分数 {entry.score ?? '—'} · 置信 {entry.confidence != null ? Number(entry.confidence).toFixed(2) : '—'}</div></div>
                      <div className="mt-1 text-xs text-zinc-500">决策：{entry.decision || '—'}{entry.skillWeight != null ? ` · 权重 ${entry.skillWeight}` : ''}</div>
                      {entry.reasons.length > 0 && <ul className="mt-2 space-y-1 text-xs text-zinc-600">{entry.reasons.slice(0, 4).map((reason) => <li key={reason} className="break-words leading-5">• {reason}</li>)}</ul>}
                      {(entry.matchedSignals.length > 0 || entry.riskFlags.length > 0) && <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">{entry.matchedSignals.slice(0, 4).map((tag) => <span key={tag} className="break-words rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">{tag}</span>)}{entry.riskFlags.slice(0, 3).map((tag) => <span key={tag} className="break-words rounded-full bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700">{tag}</span>)}</div>}
                    </div>
                  ))}
                </div>
              ) : <div className="mt-3 rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-3 text-sm text-zinc-600">{scoreDiagnostic.kind === 'legacy_single_score' ? '当前只有总分，没有 Skill 级理由。点击"重跑评分"可以补齐拆解。' : '评分完成前，这里不会显示 Skill 拆解。'}</div>}
            </>
          )}
        </details>

        {((selectedItem.isFiltered || selectedItem.filterReason) || (selectedItem.contentError || selectedItem.summaryReason || selectedItem.translationReason || selectedItem.blockedReason)) && (
          <details className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
            <summary className="cursor-pointer text-xs font-semibold text-zinc-800">抓取与系统诊断 <span className="ml-2 font-normal text-zinc-500">过滤原因、正文错误、摘要/翻译原因默认收起</span></summary>
            {(selectedItem.isFiltered || selectedItem.filterReason) && <div className={`mt-3 rounded-xl px-4 py-3 text-sm ${selectedItem.isFiltered ? 'border border-amber-200 bg-amber-50 text-amber-800' : 'border border-zinc-200 bg-white text-zinc-700'}`}>{selectedItem.isFiltered ? '该条目当前被规则过滤。' : '该条目保留了规则诊断。'}原因：{selectedItem.filterReason || '未提供'}。{selectedItem.contentStatus !== 'ready' ? ' 当前正文不完整，建议复核。' : ''}</div>}
            {(selectedItem.contentError || selectedItem.summaryReason || selectedItem.translationReason || selectedItem.blockedReason) && <div className="mt-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700">{selectedItem.contentError ? `正文诊断：${selectedItem.contentError}` : ''}{selectedItem.contentError && (selectedItem.summaryReason || selectedItem.translationReason || selectedItem.blockedReason) ? '；' : ''}{selectedItem.summaryReason ? `摘要诊断：${selectedItem.summaryReason}` : ''}{(selectedItem.contentError || selectedItem.summaryReason) && (selectedItem.translationReason || selectedItem.blockedReason) ? '；' : ''}{selectedItem.translationReason ? `翻译诊断：${selectedItem.translationReason}` : ''}{(selectedItem.contentError || selectedItem.summaryReason || selectedItem.translationReason) && selectedItem.blockedReason ? '；' : ''}{selectedItem.blockedReason ? `抓取阻断：${selectedItem.blockedReason}` : ''}</div>}
          </details>
        )}
      </details>
    </aside>
  );
}
