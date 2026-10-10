export type AudioNoteCategory =
  | '推荐'
  | '自定义'
  | '会议'
  | '面试'
  | '电话'
  | '教育'
  | '采访'
  | '销售'
  | '医疗'
  | '法律'
  | '金融'
  | '新闻'
  | '演讲/讲座'
  | '发布会'
  | '旅行'
  | '个性化';

export interface AudioNoteTemplate {
  id: string;
  name: string;
  category: AudioNoteCategory;
  description: string;
  icon: string;
  recommended?: boolean;
}

export interface AudioChapter {
  id: string;
  title: string;
  summary: string;
  bullets: string[];
  timeLabel?: string | null;
  startSeconds?: number | null;
  endSeconds?: number | null;
  speakers?: string[];
  source: 'summary' | 'transcript' | 'summary+asr' | 'summary_timestamp+asr';
}

export interface AudioMindMapBranch {
  title: string;
  children: string[];
  chapterId?: string | null;
}

export interface AudioMindMap {
  root: string;
  branches: AudioMindMapBranch[];
}

export interface AudioHighlightMoment {
  id: string;
  timeLabel?: string | null;
  title: string;
  text: string;
  reason: string;
  startSeconds?: number | null;
  endSeconds?: number | null;
  speaker?: string | null;
  source?: 'asr' | 'summary' | string;
}

export type AudioQaSuggestionKind =
  | 'weekly_digest'
  | 'todo'
  | 'progress_blocker'
  | 'quote_check'
  | 'theme_conflict';

export interface AudioQaSuggestion {
  kind: AudioQaSuggestionKind;
  promptKey?: string;
  label: string;
  prompt: string;
  generated: false;
}

export interface AudioQaCitation {
  id: string;
  timeLabel: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
  speaker?: string | null;
}

export interface AudioQaAnswer {
  id: string;
  question: string;
  promptKey?: string | null;
  answer: string;
  citations: AudioQaCitation[];
  model?: string | null;
  createdAt?: string | null;
}

export interface AudioWorkshopArtifactsInput {
  title: string;
  summaryMarkdown: string;
  transcriptMarkdown: string;
  templateId?: string | null;
  durationSeconds?: number | null;
  persistedArtifacts?: unknown;
}

export interface AudioWorkshopArtifacts {
  template: AudioNoteTemplate;
  chapters: AudioChapter[];
  mindMap: AudioMindMap;
  highlights: AudioHighlightMoment[];
  qaSuggestions: AudioQaSuggestion[];
  qaAnswers: AudioQaAnswer[];
  readingHint: string;
}

export type AudioPlaybackSourceStatus = 'empty' | 'loading' | 'ready' | 'needs_signed_url' | 'failed';

export interface AudioPlaybackSourceInput {
  taskId?: string | null;
  audioUrl?: string | null;
  signedPlaybackUrl?: string | null;
  loading?: boolean;
  error?: string | null;
}

export interface AudioPlaybackSource {
  src: string;
  status: AudioPlaybackSourceStatus;
  message: string;
}

interface ParsedMarkdownSection {
  level: number;
  title: string;
  paragraphs: string[];
  bullets: string[];
}

interface PersistedAudioArtifacts {
  root: string;
  chapters: AudioChapter[];
  mindMap: AudioMindMap;
  highlights: AudioHighlightMoment[];
  qaSuggestions: AudioQaSuggestion[];
  qaAnswers: AudioQaAnswer[];
}

export const AUDIO_NOTE_CATEGORIES: AudioNoteCategory[] = [
  '推荐',
  '自定义',
  '会议',
  '面试',
  '电话',
  '教育',
  '采访',
  '销售',
  '医疗',
  '法律',
  '金融',
  '新闻',
  '演讲/讲座',
  '发布会',
  '旅行',
  '个性化',
];

export const AUDIO_NOTE_TEMPLATES: AudioNoteTemplate[] = [
  { id: 'visual_report', name: '可视化报告', category: '推荐', icon: '📊', recommended: true, description: '把纪要渲染成结构化报告，适合复盘、评审和对外沉淀。' },
  { id: 'meeting_minutes', name: '会议纪要', category: '会议', icon: '🗓️', recommended: true, description: '总结议题、决策、风险和行动项，适合正式会议。' },
  { id: 'image_text_minutes', name: '图文纪要', category: '会议', icon: '🖼️', description: '适合包含图片、白板或多模态材料的会议。' },
  { id: 'daily_note', name: '日常记录', category: '推荐', icon: '📝', description: '分段整理口述内容，保留自然表达和关键片段。' },
  { id: 'brainstorm', name: '头脑风暴会', category: '会议', icon: '🧠', description: '聚合问题、点子、分歧、待验证假设和下一步实验。' },
  { id: 'team_weekly', name: '团队周会', category: '会议', icon: '👥', description: '适合周会、同步会，突出进展、阻碍和责任人。' },
  { id: 'daily_standup', name: '每日站会', category: '会议', icon: '🕘', description: '简短记录昨天、今天、阻碍和需要协作的事项。' },
  { id: 'executive_meeting', name: '高管会议纪要', category: '会议', icon: '📋', description: '适合重要会议，强调战略判断、风险和决策依据。' },
  { id: 'project_progress', name: '项目进度会', category: '会议', icon: '📈', description: '跟踪里程碑、风险、依赖和负责人。' },
  { id: 'requirement_review', name: '需求评审', category: '会议', icon: '📋', description: '沉淀需求背景、决策、范围变更和验收标准。' },
  { id: 'briefing', name: '汇报会', category: '发布会', icon: '📈', description: '适合项目回顾、阶段汇报和业务复盘。' },
  { id: 'expert_discussion', name: '专家讨论', category: '采访', icon: '💡', description: '适合访谈和咨询，保留观点、证据和建议。' },
  { id: 'decisions_actions', name: '议题/决策/行动', category: '推荐', icon: '🗳️', description: '直接抽取议题、结论、行动项和责任链。' },
  { id: 'generic', name: '通用', category: '自定义', icon: '🗒️', description: '适合临时录音和普通材料整理。' },
  { id: 'follow_up_tasks', name: '跟踪任务', category: '个性化', icon: '⏰', description: '把录音转成待办、追踪点和提醒清单。' },
  { id: 'layered_structure', name: '分层结构', category: '个性化', icon: '🗂️', description: '先分层，再展开证据、风险和行动。' },
  { id: 'action_record', name: '行动记录', category: '个性化', icon: '✅', description: '把讨论结果转成可执行清单。' },
  { id: 'narrative_minutes', name: '叙述式会议纪要', category: '个性化', icon: '📝', description: '用连贯叙述保留背景、转折和结论。' },
];

export function getAudioTemplate(templateId?: string | null): AudioNoteTemplate {
  return AUDIO_NOTE_TEMPLATES.find((template) => template.id === templateId)
    || AUDIO_NOTE_TEMPLATES.find((template) => template.id === 'meeting_minutes')
    || AUDIO_NOTE_TEMPLATES[0];
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function resolveAudioPlaybackSource(input: AudioPlaybackSourceInput): AudioPlaybackSource {
  const audioUrl = (input.audioUrl || '').trim();
  const signedPlaybackUrl = (input.signedPlaybackUrl || '').trim();

  if (!audioUrl) {
    return {
      src: '',
      status: 'empty',
      message: '音频文件仍在准备中，完成下载或上传后会显示播放器。',
    };
  }

  if (input.loading) {
    return {
      src: '',
      status: 'loading',
      message: '正在获取临时播放地址...',
    };
  }

  if (input.error) {
    return {
      src: '',
      status: 'failed',
      message: input.error,
    };
  }

  if (signedPlaybackUrl) {
    return {
      src: signedPlaybackUrl,
      status: 'ready',
      message: '',
    };
  }

  if (isHttpUrl(audioUrl)) {
    return {
      src: audioUrl,
      status: 'ready',
      message: '',
    };
  }

  return {
    src: '',
    status: 'needs_signed_url',
    message: '音频文件已在存储中，需要先获取临时播放地址。',
  };
}

function normalizeInlineText(value: string): string {
  return value
    .replace(/[`*_>#]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const TRANSCRIPT_SECTION_PATTERN = /逐字稿|完整转写|全文转写|原始转写|转写原文|全文记录|transcript/i;

function isAudioStructureNoise(value: string): boolean {
  const raw = String(value || '').trim();
  if (!raw) return true;
  if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(raw)) return true;
  if (/^\|?(?:\s*:?-{3,}:?\s*\|)+$/.test(raw)) return true;
  if (raw.split('|').length >= 3 && (raw.startsWith('|') || raw.endsWith('|'))) return true;
  return /^<\/?(?:table|thead|tbody|tr|th|td)\b/i.test(raw);
}

function isAudioInsightText(value: string, maxLength = 500): boolean {
  const raw = String(value || '').trim();
  const text = normalizeInlineText(raw);
  if (!text || text.length < 6 || text.length > maxLength) return false;
  if (isAudioStructureNoise(raw) || TRANSCRIPT_SECTION_PATTERN.test(text)) return false;
  return text.replace(/[^0-9A-Za-z\u4e00-\u9fff]/g, '').length >= 4;
}

function insightTextArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
      .map((item) => normalizeInlineText(String(item || '')))
      .filter((item) => isAudioInsightText(item))
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function textArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => normalizeInlineText(String(item || ''))).filter(Boolean)
    : [];
}

export function formatAudioTime(seconds?: number | null): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function qaKindFromKey(key: string): AudioQaSuggestionKind {
  if (key === 'actions') return 'todo';
  if (key === 'risks') return 'progress_blocker';
  if (key === 'quotes') return 'quote_check';
  if (key === 'summary') return 'weekly_digest';
  return 'theme_conflict';
}

function parsePersistedAudioArtifacts(value: unknown): PersistedAudioArtifacts | null {
  if (!isRecord(value) || value.schema !== 'audio_artifacts_v1' || value.version !== 1) return null;

  const rawChapters = Array.isArray(value.chapters) ? value.chapters : [];
  const chapters = rawChapters.flatMap((raw, index): AudioChapter[] => {
    if (!isRecord(raw)) return [];
    const title = normalizeInlineText(String(raw.title || ''));
    const summary = normalizeInlineText(String(raw.summary || ''));
    if ((!title && !summary) || TRANSCRIPT_SECTION_PATTERN.test(title)) return [];
    const startSeconds = optionalNumber(raw.start);
    const endSeconds = optionalNumber(raw.end);
    const source = ['summary', 'transcript', 'summary+asr', 'summary_timestamp+asr'].includes(String(raw.source || ''))
      ? String(raw.source) as AudioChapter['source']
      : 'summary';
    return [{
      id: String(raw.id || `chapter-${index + 1}`),
      title: title || `章节 ${index + 1}`,
      summary: summary || '这一章节暂无摘要，可回听对应片段。',
      bullets: insightTextArray(raw.bullets).slice(0, 8),
      timeLabel: formatAudioTime(startSeconds),
      startSeconds,
      endSeconds,
      speakers: textArray(raw.speakers),
      source,
    }];
  });
  if (chapters.length === 0) return null;

  const rawMindMap = isRecord(value.mind_map) ? value.mind_map : {};
  const rawBranches = Array.isArray(rawMindMap.branches) ? rawMindMap.branches : [];
  const branches = rawBranches.flatMap((raw): AudioMindMapBranch[] => {
    if (!isRecord(raw)) return [];
    const title = normalizeInlineText(String(raw.title || ''));
    if (!title || TRANSCRIPT_SECTION_PATTERN.test(title)) return [];
    return [{
      title,
      children: insightTextArray(raw.children).slice(0, 6),
      chapterId: raw.chapter_id ? String(raw.chapter_id) : null,
    }];
  });

  const rawHighlights = Array.isArray(value.highlights) ? value.highlights : [];
  const highlights = rawHighlights.flatMap((raw, index): AudioHighlightMoment[] => {
    if (!isRecord(raw)) return [];
    const text = normalizeInlineText(String(raw.text || ''));
    if (!isAudioInsightText(text, 260)) return [];
    const startSeconds = optionalNumber(raw.start);
    return [{
      id: String(raw.id || `highlight-${index + 1}`),
      title: normalizeInlineText(String(raw.title || '')) || '关键片段',
      text,
      reason: normalizeInlineText(String(raw.reason || '')) || '来自已保存的听记资产。',
      timeLabel: formatAudioTime(startSeconds),
      startSeconds,
      endSeconds: optionalNumber(raw.end),
      speaker: raw.speaker ? normalizeInlineText(String(raw.speaker)) : null,
      source: raw.source ? String(raw.source) : undefined,
    }];
  });

  const rawQa = isRecord(value.qa) && Array.isArray(value.qa.suggestions) ? value.qa.suggestions : [];
  const qaSuggestions = rawQa.flatMap((raw): AudioQaSuggestion[] => {
    if (!isRecord(raw)) return [];
    const key = String(raw.key || '');
    const label = normalizeInlineText(String(raw.label || ''));
    const prompt = normalizeInlineText(String(raw.prompt || ''));
    if (!label || !prompt) return [];
    return [{ kind: qaKindFromKey(key), promptKey: key, label, prompt, generated: false }];
  });

  const rawAnswers = isRecord(value.qa) && Array.isArray(value.qa.answers) ? value.qa.answers : [];
  const qaAnswers = rawAnswers.flatMap((raw, answerIndex): AudioQaAnswer[] => {
    if (!isRecord(raw)) return [];
    const answer = String(raw.answer || '').trim();
    const question = normalizeInlineText(String(raw.question || ''));
    if (!answer || !question) return [];
    const rawCitations = Array.isArray(raw.citations) ? raw.citations : [];
    const citations = rawCitations.flatMap((citation, index): AudioQaCitation[] => {
      if (!isRecord(citation)) return [];
      const startSeconds = optionalNumber(citation.start);
      const endSeconds = optionalNumber(citation.end);
      const text = normalizeInlineText(String(citation.text || ''));
      if (startSeconds === null || endSeconds === null || !text) return [];
      return [{
        id: String(citation.id || `citation-${index + 1}`),
        timeLabel: normalizeInlineText(String(citation.time_label || ''))
          || `${formatAudioTime(startSeconds)}-${formatAudioTime(endSeconds)}`,
        startSeconds,
        endSeconds,
        text,
        speaker: citation.speaker ? normalizeInlineText(String(citation.speaker)) : null,
      }];
    });
    if (citations.length === 0) return [];
    return [{
      id: String(raw.id || `qa-${answerIndex + 1}`),
      question,
      promptKey: raw.prompt_key ? String(raw.prompt_key) : null,
      answer,
      citations,
      model: raw.model ? String(raw.model) : null,
      createdAt: raw.created_at ? String(raw.created_at) : null,
    }];
  });

  const root = normalizeInlineText(String(rawMindMap.root || '')) || chapters[0].title;
  return {
    root,
    chapters,
    mindMap: {
      root,
      branches: branches.length > 0 ? branches : buildMindMap(root, chapters).branches,
    },
    highlights: highlights.length > 0 ? highlights : buildHighlights(chapters, []),
    qaSuggestions,
    qaAnswers,
  };
}

function splitSentences(value: string): string[] {
  return value
    .split(/(?<=[。！？!?；;])\s+|\n+/)
    .map(normalizeInlineText)
    .filter((item) => item.length > 0);
}

function parseMarkdownSections(markdown: string): { root?: string; sections: ParsedMarkdownSection[] } {
  const lines = String(markdown || '').split(/\r?\n/);
  const sections: ParsedMarkdownSection[] = [];
  let root: string | undefined;
  let current: ParsedMarkdownSection | null = null;
  let skipTranscriptSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const title = normalizeInlineText(heading[2]);
      skipTranscriptSection = TRANSCRIPT_SECTION_PATTERN.test(title);
      if (skipTranscriptSection) {
        current = null;
        continue;
      }
      if (level === 1 && !root) {
        root = title;
        current = null;
        continue;
      }
      current = { level, title, paragraphs: [], bullets: [] };
      sections.push(current);
      continue;
    }

    if (skipTranscriptSection || isAudioStructureNoise(line)) continue;

    if (!current) {
      current = { level: 2, title: '内容总结', paragraphs: [], bullets: [] };
      sections.push(current);
    }

    const bullet = /^[-*]\s+(.+)$|^\d+[.)、]\s+(.+)$/.exec(line);
    const content = normalizeInlineText(bullet ? bullet[1] || bullet[2] || line : line);
    if (!isAudioInsightText(content)) continue;
    if (bullet) {
      current.bullets.push(content);
    } else {
      current.paragraphs.push(content);
    }
  }

  return {
    root,
    sections: sections.filter((section) => section.title || section.paragraphs.length || section.bullets.length),
  };
}

function parseTranscriptMoments(transcriptMarkdown: string): Array<{ timeLabel: string | null; text: string }> {
  return String(transcriptMarkdown || '')
    .split(/\r?\n+/)
    .map((rawLine) => {
      const line = rawLine.trim();
      if (!line) return null;
      const match = /^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*(.+)$/.exec(line);
      const text = normalizeInlineText(match ? match[2] : line);
      if (!isAudioInsightText(text)) return null;
      return {
        timeLabel: match ? match[1] : null,
        text,
      };
    })
    .filter((item): item is { timeLabel: string | null; text: string } => Boolean(item && item.text.length > 0));
}

function buildChaptersFromSummary(
  sections: ParsedMarkdownSection[],
  transcriptMoments: Array<{ timeLabel: string | null; text: string }>,
): AudioChapter[] {
  return sections.slice(0, 12).map((section, index) => {
    const summary = section.paragraphs[0] || section.bullets[0] || '这一段暂无正文摘要，可查看转写稿补充上下文。';
    return {
      id: `chapter-${index + 1}`,
      title: section.title || `章节 ${index + 1}`,
      summary,
      bullets: section.bullets.slice(0, 6),
      timeLabel: transcriptMoments[index]?.timeLabel || null,
      source: 'summary',
    };
  });
}

function buildChaptersFromTranscript(
  title: string,
  transcriptMoments: Array<{ timeLabel: string | null; text: string }>,
): AudioChapter[] {
  const chunks: Array<{ timeLabel: string | null; lines: string[] }> = [];
  transcriptMoments.forEach((moment, index) => {
    const chunkIndex = Math.floor(index / 5);
    if (!chunks[chunkIndex]) chunks[chunkIndex] = { timeLabel: moment.timeLabel, lines: [] };
    chunks[chunkIndex].lines.push(moment.text);
  });

  if (chunks.length === 0) {
    return [{
      id: 'chapter-1',
      title: title || '录音内容',
      summary: '当前没有足够的纪要或转写内容生成章节。',
      bullets: [],
      timeLabel: null,
      source: 'transcript',
    }];
  }

  return chunks.slice(0, 10).map((chunk, index) => ({
    id: `chapter-${index + 1}`,
    title: index === 0 ? '开场与核心问题' : `片段 ${index + 1}`,
    summary: chunk.lines[0] || '这一段暂无可读摘要。',
    bullets: chunk.lines.slice(1, 5),
    timeLabel: chunk.timeLabel,
    source: 'transcript',
  }));
}

function buildMindMap(root: string, chapters: AudioChapter[]): AudioMindMap {
  return {
    root,
    branches: chapters.slice(0, 8).map((chapter) => ({
      title: chapter.title,
      children: (chapter.bullets.length ? chapter.bullets : splitSentences(chapter.summary)).slice(0, 5),
    })),
  };
}

function buildHighlights(
  chapters: AudioChapter[],
  transcriptMoments: Array<{ timeLabel: string | null; text: string }>,
): AudioHighlightMoment[] {
  const keyword = /(行动|建议|决定|问题|关键|风险|确认|为什么|核心|需要|争议|证据|结论)/;
  const transcriptHighlights = transcriptMoments
    .filter((moment) => keyword.test(moment.text) && isAudioInsightText(moment.text, 260))
    .slice(0, 6)
    .map((moment, index) => ({
      id: `highlight-${index + 1}`,
      timeLabel: moment.timeLabel,
      title: index === 0 ? '关键开场' : '关键片段',
      text: moment.text,
      reason: '命中了问题、决策、行动或风险类表达，适合回听确认。',
    }));

  if (transcriptHighlights.length > 0) return transcriptHighlights;

  return chapters.slice(0, 5).map((chapter, index) => ({
    id: `highlight-${index + 1}`,
    timeLabel: chapter.timeLabel,
    title: chapter.title,
    text: chapter.summary,
    reason: '来自纪要章节摘要，适合快速复盘。',
  }));
}

function buildQaSuggestions(title: string): AudioQaSuggestion[] {
  const safeTitle = title || '这段听记';
  return [
    {
      kind: 'weekly_digest',
      label: '查看我的专属听记周报',
      prompt: `基于《${safeTitle}》和本周听记，帮我提炼本周最重要的变化、主题和行动建议。`,
      generated: false,
    },
    {
      kind: 'todo',
      label: '整理本周的待办事项',
      prompt: `请从《${safeTitle}》中提取明确行动项，按负责人、截止时间、依赖和风险整理。`,
      generated: false,
    },
    {
      kind: 'progress_blocker',
      label: '回顾本周的工作进展与阻碍',
      prompt: `请基于《${safeTitle}》分析已经推进的事项、卡点、阻碍来源和下一步建议。`,
      generated: false,
    },
    {
      kind: 'quote_check',
      label: '定位关键原话和争议句',
      prompt: `请从《${safeTitle}》里找出最值得回听确认的原话、争议句和证据不足的判断。`,
      generated: false,
    },
    {
      kind: 'theme_conflict',
      label: '分析主题冲突和隐藏假设',
      prompt: `请分析《${safeTitle}》里不同观点之间的冲突、隐含假设和需要补证的地方。`,
      generated: false,
    },
  ];
}

export function buildAudioWorkshopArtifacts(input: AudioWorkshopArtifactsInput): AudioWorkshopArtifacts {
  const template = getAudioTemplate(input.templateId);
  const persisted = parsePersistedAudioArtifacts(input.persistedArtifacts);
  if (persisted) {
    return {
      template,
      chapters: persisted.chapters,
      mindMap: persisted.mindMap,
      highlights: persisted.highlights,
      qaSuggestions: persisted.qaSuggestions.length > 0
        ? persisted.qaSuggestions
        : buildQaSuggestions(persisted.root),
      qaAnswers: persisted.qaAnswers,
      readingHint: `当前使用「${template.name}」查看已保存的章节、高光和思维导图；点击带时间的内容可直接回听。`,
    };
  }
  const parsedSummary = parseMarkdownSections(input.summaryMarkdown);
  const transcriptMoments = parseTranscriptMoments(input.transcriptMarkdown);
  const chapters = parsedSummary.sections.length > 0
    ? buildChaptersFromSummary(parsedSummary.sections, transcriptMoments)
    : buildChaptersFromTranscript(input.title, transcriptMoments);
  const root = parsedSummary.root || input.title || '录音工作坊';

  return {
    template,
    chapters,
    mindMap: buildMindMap(root, chapters),
    highlights: buildHighlights(chapters, transcriptMoments),
    qaSuggestions: buildQaSuggestions(root),
    qaAnswers: [],
    readingHint: parsedSummary.sections.length > 0
      ? `当前使用「${template.name}」视图组织 AI 纪要，可切换模板查看不同结构。`
      : '当前结果基于转写稿自动整理；建议先生成 AI 纪要，再查看章节和思维导图。',
  };
}
