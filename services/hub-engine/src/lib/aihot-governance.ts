export const SOURCE_KINDS = ['official', 'blog', 'rss', 'x', 'wechat', 'media', 'api', 'webpage', 'podcast', 'other'] as const;
export type SourceKind = typeof SOURCE_KINDS[number];

export const AIHOT_DAILY_BUCKET_LABELS = {
  model_releases: '模型发布/更新',
  product_updates: '产品发布/更新',
  industry: '行业动态',
  research: '论文研究',
  tips: '技巧与观点',
} as const;

export type AihotDailyBucket = keyof typeof AIHOT_DAILY_BUCKET_LABELS;

const OFFICIAL_HOST_PATTERNS = [
  /(^|\.)openai\.com$/i,
  /(^|\.)anthropic\.com$/i,
  /(^|\.)claude\.com$/i,
  /(^|\.)x\.ai$/i,
  /(^|\.)deepmind\.google$/i,
  /(^|\.)ai\.google$/i,
  /(^|\.)apple\.com$/i,
  /(^|\.)machinelearning\.apple\.com$/i,
  /(^|\.)nvidia\.com$/i,
  /(^|\.)github\.blog$/i,
  /(^|\.)cursor\.com$/i,
  /(^|\.)cloudflare\.com$/i,
];

const BLOG_HOST_PATTERNS = [
  /(^|\.)huggingface\.co$/i,
  /(^|\.)simonwillison\.net$/i,
  /(^|\.)interconnects\.ai$/i,
  /(^|\.)substack\.com$/i,
  /(^|\.)garymarcus\.substack\.com$/i,
];

const MEDIA_HOST_PATTERNS = [
  /(^|\.)ithome\.com$/i,
  /(^|\.)the-decoder\.com$/i,
  /(^|\.)buzzing\.cc$/i,
  /(^|\.)jiqizhixin\.com$/i,
];

function firstHostFromConfig(config?: unknown): string {
  const obj = config && typeof config === 'object' ? config as Record<string, unknown> : {};
  const candidates = [obj.url, obj.htmlUrl, obj.endpoint]
    .map((value) => typeof value === 'string' ? value : '')
    .filter(Boolean);
  for (const candidate of candidates) {
    try {
      return new URL(candidate).hostname.replace(/^www\./, '');
    } catch {
      continue;
    }
  }
  return '';
}

export function classifySourceKind(input: {
  name?: string | null;
  sourceType?: string | null;
  collectorType?: string | null;
  category?: string | null;
  config?: unknown;
}): SourceKind {
  const name = String(input.name || '').trim();
  const sourceType = String(input.sourceType || '').trim().toLowerCase();
  const collectorType = String(input.collectorType || '').trim().toLowerCase();
  const category = String(input.category || '').trim().toLowerCase();
  const config = input.config && typeof input.config === 'object' ? input.config as Record<string, unknown> : {};
  const route = String(config.route || '').trim().toLowerCase();
  const host = firstHostFromConfig(config);

  if (sourceType === 'wechat' || category.includes('公众号') || /mp\.weixin\.qq\.com/i.test(host)) return 'wechat';
  if (route.includes('/twitter/') || route.includes('/x/') || /^x[：:]/i.test(name) || /@\w+/.test(name)) return 'x';
  if (sourceType === 'audio' || sourceType === 'podcast' || collectorType === 'youtube') return 'podcast';
  if (collectorType === 'custom') return 'api';
  if (collectorType === 'changedetection' || collectorType === 'webpage') return 'webpage';
  if (OFFICIAL_HOST_PATTERNS.some((pattern) => pattern.test(host)) || /(官网|newsroom|official|github releases)/i.test(name)) return 'official';
  if (BLOG_HOST_PATTERNS.some((pattern) => pattern.test(host)) || /(blog|博客|substack|interconnects)/i.test(name)) return 'blog';
  if (MEDIA_HOST_PATTERNS.some((pattern) => pattern.test(host)) || /(it之家|the decoder|hacker news|媒体|资讯)/i.test(name)) return 'media';
  if (sourceType === 'rss' || sourceType === 'rsshub' || collectorType === 'rss' || collectorType === 'rsshub') return 'rss';
  return 'other';
}

export function normalizeAuthorityWeight(value: unknown, sourceTier?: string | null, sourceKind?: SourceKind | string | null): number {
  const raw = Number(value);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.min(2, Math.max(0.35, Number(raw.toFixed(2))));
  }

  const tier = String(sourceTier || '').trim().toUpperCase();
  const kind = String(sourceKind || '').trim().toLowerCase();
  let weight = 1;
  if (tier === 'T1' || tier === 'S') weight = 1.22;
  else if (tier === 'T1.5' || tier === 'A') weight = 1.08;
  else if (tier === 'T2' || tier === 'B') weight = 0.96;
  else if (tier === 'C') weight = 0.82;
  else if (tier === 'D') weight = 0.72;

  if (kind === 'official') weight += 0.06;
  else if (kind === 'blog') weight += 0.02;
  else if (kind === 'x' && tier !== 'T1.5') weight -= 0.02;
  else if (kind === 'wechat') weight -= 0.08;
  else if (kind === 'media') weight -= 0.03;

  return Math.min(2, Math.max(0.35, Number(weight.toFixed(2))));
}

export function classifyAihotDailyBucket(item: {
  title?: string | null;
  aiSummary?: string | null;
  aiTags?: string[] | null;
  category?: string | null;
}): AihotDailyBucket {
  const text = `${item.title || ''} ${item.aiSummary || ''} ${(item.aiTags || []).join(' ')} ${item.category || ''}`.toLowerCase();
  if (/(论文|paper|research|arxiv|benchmark|基准|数据集|dataset|训练|sft|rl|grpo|研究)/i.test(text)) return 'research';
  if (/(教程|技巧|实践|prompt|提示词|工作流|workflow|how to|指南|经验|观点|take|编码|code|developer|开发者)/i.test(text)) return 'tips';
  if (/(产品|app|api|connectors|mcp|agent api|上线|launch|release|功能|web|desktop|mobile|插件|工具|平台|copilot|assistant|workflow|saas)/i.test(text)
    && !/(模型发布|model release|gpt-\d|claude .*发布|gemini .*发布|deepseek .*发布|qwen .*发布|doubao .*发布)/i.test(text)) return 'product_updates';
  if (/(模型|model|llm|gpt|claude|gemini|deepseek|qwen|doubao|grok|mistral|发布|开源|preview|instant|opus|sonnet|推理|多模态|上下文)/i.test(text)) return 'model_releases';
  return 'industry';
}
