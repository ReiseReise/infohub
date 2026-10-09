import type { ReadingAsset } from './reading-context.js';

export type ArticleAssetType = 'qa' | 'rewrite';
export type ArticleAssetPromptKey = 'key_points' | 'evidence' | 'assumptions' | 'actions' | 'angles' | 'rewrite';
export type ArticleAssetBasis = 'summary' | 'translation' | 'content' | 'snippet' | 'title';

export type ArticleAssetGenerationRequest = {
  assetType: ArticleAssetType;
  promptKey: ArticleAssetPromptKey;
  force: boolean;
};

export type ArticleAssetSource = {
  basis: ArticleAssetBasis;
  text: string;
  canGenerate: boolean;
  reason?: string | null;
};

export type ItemReadingAssetRecord = {
  id: number;
  itemId: string;
  assetType: string;
  promptKey: string;
  label: string;
  status: string;
  basis?: string | null;
  content?: string | null;
  preview?: string | null;
  source?: string | null;
  provider?: string | null;
  modelName?: string | null;
  modelConfigId?: string | null;
  promptTemplateId?: string | null;
  metadata?: unknown;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  errorReason?: string | null;
};

export const ARTICLE_ASSET_PROMPTS: Array<{
  key: Exclude<ArticleAssetPromptKey, 'rewrite'>;
  title: string;
  description: string;
  instruction: string;
}> = [
  {
    key: 'key_points',
    title: '总结要点',
    description: '提炼这篇文章最值得记住的 3-5 个要点。',
    instruction: '请用 3-5 条 bullet 总结这篇文章的核心要点。每条必须包含明确事实，不要写空泛评价。',
  },
  {
    key: 'evidence',
    title: '证据清单',
    description: '列出支撑判断的关键事实、数据、引用或案例。',
    instruction: '请列出文章中最能支撑判断的证据清单。优先保留数据、产品细节、原话、案例和时间线。',
  },
  {
    key: 'assumptions',
    title: '前提拆解',
    description: '拆出作者判断背后的隐含前提和可能风险。',
    instruction: '请拆解这篇文章成立所依赖的关键前提，并指出哪些前提需要继续验证。',
  },
  {
    key: 'actions',
    title: '行动建议',
    description: '转成 Reise 可以采取的阅读、研究或产品动作。',
    instruction: '请把文章内容转成面向个人决策和长期成长的行动建议。输出 3-5 条，避免泛泛而谈。',
  },
  {
    key: 'angles',
    title: '选题角度',
    description: '提炼可用于写作、播客、日报或研究的选题入口。',
    instruction: '请提炼这篇文章可延展成内容创作、研究笔记或日报主线的选题角度，并说明每个角度为什么值得写。',
  },
];

const PROMPT_BY_KEY = new Map(ARTICLE_ASSET_PROMPTS.map((prompt) => [prompt.key, prompt]));

function normalizeText(value?: string | null): string {
  return (value || '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export function previewText(value?: string | null, max = 180): string | null {
  const text = normalizeText(value).replace(/\s+/g, ' ');
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function textLength(value?: string | null): number {
  return normalizeText(value).replace(/\s+/g, ' ').length;
}

export function normalizeArticleAssetGenerationRequest(input: unknown): ArticleAssetGenerationRequest {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const assetType = String(body.type || body.assetType || 'qa').trim() as ArticleAssetType;
  const promptKey = String(body.promptKey || '').trim() as ArticleAssetPromptKey;
  if (assetType !== 'qa' && assetType !== 'rewrite') {
    throw new Error('不支持的文章资产类型');
  }
  if (assetType === 'qa' && !PROMPT_BY_KEY.has(promptKey as Exclude<ArticleAssetPromptKey, 'rewrite'>)) {
    throw new Error('不支持的文章问题');
  }
  if (assetType === 'rewrite' && promptKey !== 'rewrite') {
    throw new Error('重写资产只能使用 rewrite prompt');
  }
  return {
    assetType,
    promptKey,
    force: body.force === true,
  };
}

export function resolveArticleAssetPromptLabel(promptKey: ArticleAssetPromptKey): string {
  if (promptKey === 'rewrite') return '重写';
  return PROMPT_BY_KEY.get(promptKey as Exclude<ArticleAssetPromptKey, 'rewrite'>)?.title || promptKey;
}

export function resolveArticleAssetSource(input: {
  title?: string | null;
  aiSummary?: string | null;
  aiTranslation?: string | null;
  content?: string | null;
  snippet?: string | null;
}): ArticleAssetSource {
  const candidates: Array<{ basis: ArticleAssetBasis; text?: string | null; minLength: number }> = [
    { basis: 'summary', text: input.aiSummary, minLength: 24 },
    { basis: 'translation', text: input.aiTranslation, minLength: 60 },
    { basis: 'content', text: input.content, minLength: 80 },
    { basis: 'snippet', text: input.snippet, minLength: 60 },
    { basis: 'title', text: input.title, minLength: 60 },
  ];
  for (const candidate of candidates) {
    const text = normalizeText(candidate.text);
    if (textLength(text) >= candidate.minLength) {
      return { basis: candidate.basis, text, canGenerate: true };
    }
  }
  return {
    basis: 'title',
    text: normalizeText(input.title),
    canGenerate: false,
    reason: '当前条目内容太短，无法生成可信的文章资产。请先补抓正文或生成摘要。',
  };
}

export function buildArticleAssetPrompt(input: {
  promptKey: ArticleAssetPromptKey;
  title: string;
  url?: string | null;
  sourceName?: string | null;
  source: ArticleAssetSource;
}): string {
  const prompt = input.promptKey === 'rewrite'
    ? {
      title: '重写',
      instruction: '请把这篇文章重写成适合 Reise 长期阅读和复盘的中文笔记。保留事实、链接线索和关键判断，不要编造。',
    }
    : PROMPT_BY_KEY.get(input.promptKey as Exclude<ArticleAssetPromptKey, 'rewrite'>);
  if (!prompt) throw new Error('不支持的文章问题');

  return [
    `任务：${prompt.title}`,
    '',
    '你是信息中枢的 Article Agent。请只基于给定文章内容作答，不要引入外部事实，不要编造链接、数据或引语。',
    '输出要求：使用简体中文；结构清晰；直接给结论；如果证据不足，请明确说明“不足以判断”。',
    '',
    `具体要求：${prompt.instruction}`,
    '',
    `标题：${input.title}`,
    input.sourceName ? `来源：${input.sourceName}` : '',
    input.url ? `链接：${input.url}` : '',
    `内容依据：${input.source.basis}`,
    '',
    '文章内容：',
    input.source.text.slice(0, 6000),
  ].filter(Boolean).join('\n');
}

export function buildReadingAssetRecords(rows: ItemReadingAssetRecord[]): ReadingAsset[] {
  return rows.map((row) => ({
    id: row.id,
    type: row.assetType === 'rewrite' ? 'rewrite' : 'qa',
    label: row.label || resolveArticleAssetPromptLabel(row.promptKey as ArticleAssetPromptKey),
    status: row.status === 'ready' || row.status === 'failed' || row.status === 'pending' || row.status === 'skipped'
      ? row.status
      : 'pending',
    basis: row.basis || null,
    model: row.modelName || null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    preview: row.preview || previewText(row.content),
    content: row.content || null,
    source: row.source === 'human' || row.source === 'system' || row.source === 'report' ? row.source : 'ai',
    promptKey: row.promptKey,
    errorReason: row.errorReason || null,
  }));
}

export function findArticleAsset(assets: ReadingAsset[] | undefined, promptKey: ArticleAssetPromptKey): ReadingAsset | null {
  return (assets || []).find((asset) => asset.type === 'qa' && asset.promptKey === promptKey && asset.status === 'ready' && asset.content) || null;
}
