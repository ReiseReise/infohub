import { type ComponentType } from 'react';
import {
  Brain,
  ChevronRight,
  FileAudio,
  Highlighter,
  Loader2,
  MessageCircle,
  Network,
  Play,
  Send,
  Sparkles,
} from 'lucide-react';
import { MarkdownContent } from '../../components/MarkdownContent';
import {
  formatAudioTime,
  type AudioWorkshopArtifacts,
} from '../../lib/audio-workshop';

export type AudioDetailTab = 'transcript' | 'minutes' | 'chapters' | 'mindmap' | 'highlights' | 'qa';

interface AudioResultPanelProps {
  detailTab: AudioDetailTab;
  onDetailTabChange: (tab: AudioDetailTab) => void;
  selectedTemplateName: string;
  summaryMarkdown: string;
  transcriptMarkdown: string;
  summaryFailed: boolean;
  transcriptFailed: boolean;
  failureEmptyText: string;
  artifacts: AudioWorkshopArtifacts;
  onSeek: (seconds?: number | null) => void;
  qaQuestion: string;
  onQaQuestionChange: (question: string) => void;
  qaLoadingKey: string;
  qaError: string;
  onAsk: (question: string, promptKey?: string) => void;
}

const DETAIL_TABS: Array<[AudioDetailTab, string, ComponentType<{ size?: number; className?: string }>]> = [
  ['transcript', '转写', FileAudio],
  ['minutes', 'AI纪要', Sparkles],
  ['chapters', '章节', ChevronRight],
  ['mindmap', '思维导图', Network],
  ['highlights', '高光时刻', Highlighter],
  ['qa', 'AI问答', MessageCircle],
];

export function AudioResultPanel({
  detailTab,
  onDetailTabChange,
  selectedTemplateName,
  summaryMarkdown,
  transcriptMarkdown,
  summaryFailed,
  transcriptFailed,
  failureEmptyText,
  artifacts,
  onSeek,
  qaQuestion,
  onQaQuestionChange,
  qaLoadingKey,
  qaError,
  onAsk,
}: AudioResultPanelProps) {
  return (
    <>
      <div data-audio-detail-tabs className="sticky top-0 z-20 flex flex-wrap gap-2 border-b border-zinc-100 bg-white/95 px-4 py-3 backdrop-blur">
        {DETAIL_TABS.map(([key, label, TabIcon]) => (
          <button
            key={key}
            onClick={() => onDetailTabChange(key)}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 py-2 text-xs transition-colors ${
              detailTab === key
                ? 'bg-zinc-900 text-white'
                : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
            }`}
          >
            <TabIcon size={14} />
            {label}
          </button>
        ))}
      </div>

      <div className="px-5 py-6">
        {detailTab === 'minutes' && (
          <div className="mx-auto max-w-[860px]">
            <div className="mb-5 rounded-[24px] border border-blue-100 bg-blue-50/70 px-5 py-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-blue-700">
                <Sparkles size={16} /> AI纪要
              </div>
              <p className="mt-2 text-sm leading-6 text-blue-900/80">按「{selectedTemplateName}」组织当前结果。模板切换会改变阅读结构；如需重新生成内容，请使用右侧工具里的重跑。</p>
            </div>
            <MarkdownContent
              content={summaryMarkdown}
              empty={summaryFailed ? failureEmptyText : '暂无 AI 纪要，请先完成转写并重跑总结。'}
            />
          </div>
        )}

        {detailTab === 'transcript' && (
          <div className="mx-auto max-w-[860px]">
            <MarkdownContent
              content={transcriptMarkdown}
              empty={transcriptFailed ? failureEmptyText : '暂无转写内容'}
            />
          </div>
        )}

        {detailTab === 'chapters' && (
          <div className="mx-auto max-w-[900px] space-y-4">
            {artifacts.chapters.map((chapter, index) => {
              const canSeek = typeof chapter.startSeconds === 'number';
              return (
                <article
                  key={chapter.id}
                  className={`overflow-hidden rounded-[24px] border border-zinc-200 bg-[#fffdfa] transition-colors ${
                    canSeek ? 'hover:border-teal-200 hover:bg-teal-50/30' : ''
                  }`}
                >
                  <button
                    type="button"
                    disabled={!canSeek}
                    onClick={() => onSeek(chapter.startSeconds)}
                    className={`block w-full px-5 py-4 text-left ${canSeek ? '' : 'cursor-default'}`}
                    title={canSeek ? `从 ${chapter.timeLabel || '当前章节'} 开始播放` : '这个历史章节没有时间轴'}
                  >
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 rounded-full bg-zinc-900 px-2.5 py-1 text-xs font-semibold text-white">{String(index + 1).padStart(2, '0')}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-semibold text-zinc-900">{chapter.title}</h3>
                          {chapter.timeLabel && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">
                              {canSeek && <Play size={10} />}
                              {chapter.timeLabel}
                              {chapter.endSeconds != null && ` - ${formatAudioTime(chapter.endSeconds)}`}
                            </span>
                          )}
                          {chapter.speakers && chapter.speakers.length > 0 && (
                            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">
                              {chapter.speakers.length} 位发言人
                            </span>
                          )}
                        </div>
                        <p className="mt-2 line-clamp-4 text-sm leading-7 text-zinc-700 sm:line-clamp-none">{chapter.summary}</p>
                        {chapter.bullets.length > 0 && (
                          <ul className="mt-3 hidden space-y-2 text-sm leading-6 text-zinc-700 sm:block">
                            {chapter.bullets.map((bullet) => <li key={bullet}>• {bullet}</li>)}
                          </ul>
                        )}
                      </div>
                    </div>
                  </button>
                  {chapter.bullets.length > 0 && (
                    <details className="border-t border-zinc-100 px-5 py-3 text-sm text-zinc-700 sm:hidden">
                      <summary className="cursor-pointer select-none font-medium text-zinc-600">查看 {chapter.bullets.length} 条要点</summary>
                      <ul className="mt-3 space-y-2 leading-6">
                        {chapter.bullets.map((bullet) => <li key={bullet}>• {bullet}</li>)}
                      </ul>
                    </details>
                  )}
                </article>
              );
            })}
          </div>
        )}

        {detailTab === 'mindmap' && (
          <div className="mx-auto max-w-[940px] overflow-x-auto rounded-[28px] bg-white px-3 py-8">
            <div className="flex min-w-[760px] items-center gap-8">
              <div className="max-w-[260px] shrink-0 rounded-[28px] bg-zinc-800 px-6 py-4 text-lg font-semibold leading-8 text-white shadow-sm">
                {artifacts.mindMap.root}
              </div>
              <div className="grid flex-1 grid-cols-1 gap-4">
                {artifacts.mindMap.branches.map((branch, index) => {
                  const chapter = branch.chapterId
                    ? artifacts.chapters.find((item) => item.id === branch.chapterId)
                    : artifacts.chapters[index];
                  const canSeek = typeof chapter?.startSeconds === 'number';
                  return (
                    <div key={`${branch.title}-${index}`} className="grid grid-cols-[180px_minmax(0,1fr)] items-center gap-4">
                      <button
                        type="button"
                        disabled={!canSeek}
                        onClick={() => onSeek(chapter?.startSeconds)}
                        className={`rounded-2xl border-2 border-blue-400 bg-white px-4 py-2 text-center text-sm font-semibold text-zinc-800 ${canSeek ? 'hover:bg-blue-50' : 'cursor-default'}`}
                      >
                        {branch.title}
                      </button>
                      <div className="flex flex-wrap gap-2">
                        {branch.children.map((child) => (
                          <span key={child} className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs leading-5 text-zinc-600">
                            {child}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {detailTab === 'highlights' && (
          <div className="mx-auto max-w-[860px] space-y-3">
            {artifacts.highlights.map((moment) => {
              const canSeek = typeof moment.startSeconds === 'number';
              return (
                <button
                  key={moment.id}
                  type="button"
                  disabled={!canSeek}
                  onClick={() => onSeek(moment.startSeconds)}
                  className={`block w-full rounded-[24px] border border-amber-100 bg-amber-50/60 px-5 py-4 text-left transition-colors ${canSeek ? 'hover:border-amber-200 hover:bg-amber-50' : 'cursor-default'}`}
                  title={canSeek ? `从 ${moment.timeLabel || '这个片段'} 开始播放` : '这个历史高光没有时间轴'}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Highlighter size={16} className="text-amber-600" />
                    <h3 className="font-semibold text-zinc-900">{moment.title}</h3>
                    {moment.timeLabel && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs text-amber-700">
                        {canSeek && <Play size={10} />} {moment.timeLabel}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm leading-7 text-zinc-800">{moment.text}</p>
                  <p className="mt-2 text-xs leading-5 text-amber-800">{moment.reason}</p>
                </button>
              );
            })}
          </div>
        )}

        {detailTab === 'qa' && (
          <div className="mx-auto max-w-[860px]">
            <div className="rounded-[28px] border border-zinc-200 bg-zinc-50 px-5 py-5">
              <div className="flex items-center gap-2">
                <Brain size={18} className="text-zinc-700" />
                <h3 className="text-lg font-semibold text-zinc-900">AI 问答</h3>
              </div>
              <p className="mt-2 text-sm leading-6 text-zinc-500">回答只使用当前纪要和 ASR 时间轴；每条引用都可点击回听。</p>

              {artifacts.qaAnswers.length > 0 && (
                <div className="mt-5 space-y-4">
                  {[...artifacts.qaAnswers].reverse().map((answer) => (
                    <article key={answer.id} className="rounded-2xl border border-zinc-200 bg-white px-4 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h4 className="font-semibold text-zinc-900">{answer.question}</h4>
                        {answer.model && <span className="text-xs text-zinc-400">{answer.model}</span>}
                      </div>
                      <div className="mt-3 text-sm leading-7 text-zinc-700">
                        <MarkdownContent content={answer.answer} empty="暂无回答" />
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {answer.citations.map((citation) => (
                          <button
                            key={citation.id}
                            type="button"
                            onClick={() => onSeek(citation.startSeconds)}
                            className="rounded-xl border border-teal-100 bg-teal-50/60 px-3 py-2 text-left hover:bg-teal-50"
                            title={`回听 ${citation.timeLabel}`}
                          >
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700">
                              <Play size={10} /> {citation.timeLabel}
                              {citation.speaker ? ` · ${citation.speaker}` : ''}
                            </span>
                            <span className="mt-1 line-clamp-2 block text-xs leading-5 text-zinc-600">{citation.text}</span>
                          </button>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              )}

              <div className="mt-4 space-y-3">
                {artifacts.qaSuggestions.map((suggestion) => (
                  <button
                    key={suggestion.kind}
                    type="button"
                    disabled={Boolean(qaLoadingKey)}
                    className="flex w-full items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-left hover:bg-zinc-50 disabled:opacity-50"
                    onClick={() => onAsk(suggestion.prompt, suggestion.promptKey)}
                  >
                    <span>
                      <span className="block font-medium text-zinc-900">{suggestion.label}</span>
                      <span className="mt-1 block text-xs leading-5 text-zinc-500">{suggestion.prompt}</span>
                    </span>
                    {qaLoadingKey === (suggestion.promptKey || 'custom')
                      ? <Loader2 size={16} className="shrink-0 animate-spin text-teal-600" />
                      : <ChevronRight size={16} className="shrink-0 text-zinc-400" />}
                  </button>
                ))}
              </div>

              <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-3">
                <textarea
                  value={qaQuestion}
                  onChange={(event) => onQaQuestionChange(event.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="例如：他们对 AI 基础设施的核心判断是什么？"
                  className="w-full resize-none border-0 bg-transparent text-sm leading-6 text-zinc-800 outline-none placeholder:text-zinc-400"
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-xs text-zinc-400">{qaQuestion.length}/500</span>
                  <button
                    type="button"
                    disabled={qaQuestion.trim().length < 2 || Boolean(qaLoadingKey)}
                    onClick={() => onAsk(qaQuestion)}
                    className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-40"
                  >
                    {qaLoadingKey === 'custom' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    提问
                  </button>
                </div>
              </div>

              {qaError && (
                <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm leading-6 text-red-700">
                  {qaError}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
