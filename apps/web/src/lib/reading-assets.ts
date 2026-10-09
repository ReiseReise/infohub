import type { ReadingAsset } from './api/contracts';

const ASSET_ORDER: Record<string, number> = {
  summary: 10,
  translation: 20,
  rewrite: 30,
  qa: 40,
  feedback: 50,
  report_reference: 60,
  transcript: 70,
  knowledge: 80,
};

export function getVisibleReadingAssets(assets?: ReadingAsset[] | null): ReadingAsset[] {
  return [...(assets || [])]
    .filter((asset) => asset.status !== 'missing')
    .sort((a, b) => {
      const byType = (ASSET_ORDER[a.type] ?? 999) - (ASSET_ORDER[b.type] ?? 999);
      if (byType !== 0) return byType;
      return promptOrder(a.promptKey) - promptOrder(b.promptKey);
    });
}

export function describeReadingAssetStatus(asset: Pick<ReadingAsset, 'status'>): string {
  switch (asset.status) {
    case 'ready':
      return '已生成';
    case 'pending':
      return '待生成';
    case 'failed':
      return '生成失败';
    case 'skipped':
      return '已跳过';
    default:
      return '未生成';
  }
}

export type ArticleAgentPromptKey = 'key_points' | 'evidence' | 'assumptions' | 'actions' | 'angles';

export type ArticleAgentPrompt = {
  key: ArticleAgentPromptKey;
  title: string;
  description: string;
  instruction: string;
};

export const ARTICLE_AGENT_PROMPTS: ArticleAgentPrompt[] = [
  {
    key: 'key_points',
    title: '总结要点',
    description: '提炼这篇文章最值得记住的 5 个要点。',
    instruction: '请用 5 条 bullet 总结这篇文章最值得关注的观点，每条都要说明为什么重要。',
  },
  {
    key: 'evidence',
    title: '证据清单',
    description: '列出文章支撑判断的事实、数据和链接。',
    instruction: '请拆出文章里的关键证据清单，区分事实、作者判断和需要进一步验证的信息。',
  },
  {
    key: 'assumptions',
    title: '前提拆解',
    description: '找出作者隐含假设和可能的反例。',
    instruction: '请分析这篇文章成立所依赖的前提、可能被忽略的反例，以及我阅读时需要警惕的偏差。',
  },
  {
    key: 'actions',
    title: '行动建议',
    description: '转成对个人决策、产品或研究有用的下一步。',
    instruction: '请把这篇文章转化为行动建议，分成“现在可做”“需要观察”“暂不行动”三类。',
  },
  {
    key: 'angles',
    title: '选题角度',
    description: '沉淀成可写作、可日报引用的角度。',
    instruction: '请给出 3 个可以延展成日报、文章或研究笔记的选题角度，并说明切入点。',
  },
];

function promptOrder(promptKey?: string | null): number {
  const index = ARTICLE_AGENT_PROMPTS.findIndex((entry) => entry.key === promptKey);
  return index >= 0 ? index : 999;
}

export function findArticleAgentAsset(assets: ReadingAsset[] | undefined | null, key: ArticleAgentPromptKey): ReadingAsset | null {
  return (assets || []).find((asset) => asset.type === 'qa' && asset.promptKey === key) || null;
}

export function formatArticleAssetReferenceLabel(input: { promptKey?: string | null; label?: string | null }): string {
  const prompt = ARTICLE_AGENT_PROMPTS.find((entry) => entry.key === input.promptKey);
  return (input.label || prompt?.title || '文章资产').trim();
}

export function buildArticleAgentPrompt(key: ArticleAgentPromptKey, title: string, context?: string | null): string {
  const prompt = ARTICLE_AGENT_PROMPTS.find((entry) => entry.key === key) || ARTICLE_AGENT_PROMPTS[0];
  const cleanedContext = (context || '').replace(/\s+/g, ' ').trim();
  return [
    `文章标题：${title}`,
    '',
    `任务：${prompt.title}`,
    prompt.instruction,
    '',
    cleanedContext ? `可用上下文：${cleanedContext.slice(0, 1200)}` : '可用上下文：当前页面的摘要、原文或翻译。',
  ].join('\n');
}
