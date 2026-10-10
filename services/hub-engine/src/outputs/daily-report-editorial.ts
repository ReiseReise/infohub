import { findArticleAsset } from '../lib/article-assets.js';
import type {
  DailyReportCoverageItem,
  DailyReportCoverageStatus,
  DailyReportEditorialDigest,
  DailyReportEditorialFactBasis,
  DailyReportEditorialMaterial,
  DailyReportEditorialPlacement,
  DailyReportModuleEvidence,
  DailyReportModuleSection,
  DailyReportPriorityArticle,
  DailyReportSnapshot,
  DailyReportTrendSummary,
  TopItem,
} from './daily-report.js';

export interface DailyReportEditorialDependencies {
  displayTitle: (item: Pick<TopItem, 'displayTitle' | 'title'>) => string;
  normalizeCategory: (category?: string | null) => string;
  cleanInlineText: (value?: string | null, limit?: number) => string;
  humanizeSelectionReason: (
    reason?: string | null,
    item?: Pick<TopItem, 'title' | 'category'>,
  ) => string;
  buildTrendMarkdown: (snapshot: DailyReportSnapshot) => string[];
  buildReadingOrderMarkdown: (
    snapshot: DailyReportSnapshot,
    digest: Pick<DailyReportEditorialDigest, 'curated' | 'moreDynamics'>,
  ) => string;
  buildNextActionsMarkdown: (snapshot: DailyReportSnapshot) => string;
}

const DAILY_MODULE_DEFINITIONS: Array<{
  key: DailyReportModuleSection['key'];
  title: string;
  pattern: RegExp;
}> = [
  { key: 'models_labs', title: '模型与实验室', pattern: /(模型|实验室|claude|anthropic|openai|gpt|gemini|deepmind|opus|sonnet|haiku|fable|mythos|推理模型|多模态)/i },
  { key: 'agent_products', title: 'Agent/产品', pattern: /(agent|智能体|产品|工具|copilot|cursor|codex|workflow|工作流|automation|应用入口)/i },
  { key: 'infra_compute', title: '基础设施与算力', pattern: /(算力|芯片|gpu|nvidia|数据中心|infra|基础设施|推理云|云|服务器|存储|网络|kuikly)/i },
  { key: 'apps_business', title: '应用与商业化', pattern: /(商业|融资|收入|客户|落地|应用|公司|战略|产业|市场|销售|消费|企业)/i },
  { key: 'policy_safety', title: '政策安全', pattern: /(政策|监管|安全|治理|隐私|版权|合规|风险|标准|指数级)/i },
  { key: 'deep_reads', title: '深读博客', pattern: /(博客|blog|newsletter|长文|观点|访谈|反思|工程师|daringfireball|bestblogs|paul graham|simon willison)/i },
  { key: 'china_industry', title: '国内产业动态', pattern: /(国内|中国|腾讯|阿里|字节|百度|美团|36氪|智东西|得物|微信|上海|北京|深圳|杭州)/i },
];

const EDITORIAL_PLACEMENT_PRIORITY: DailyReportEditorialPlacement[] = [
  'featured',
  'deep_read',
  'module',
  'more_dynamics',
  'coverage_index',
];

export function isEditorialThemeLabelService(value?: string | null) {
  const label = String(value || '').trim();
  if (!label) return false;
  return !/(?:本地兜底|最新兜底|低置信兜底|待人工复核|fallback|summary_failed|translation_failed|评分失败|摘要失败|翻译失败|处理失败|uncategorized|未分类待治理|分类治理诊断)/i.test(label);
}

export function describeReportItemValueService(item: TopItem, deps: DailyReportEditorialDependencies) {
  const reason = deps.humanizeSelectionReason(item.selectionReason, item);
  if (reason && !/直接相关|明确事实增量/.test(reason)) return reason;
  const category = deps.normalizeCategory(item.category);
  const title = deps.displayTitle(item);
  if (/模型|Agent|智能体|AI|产品|工具/.test(`${category} ${title}`)) {
    return '它提供了产品能力、模型能力或智能体落地的新证据，适合用来判断 AI 应用从概念走向工作流的速度。';
  }
  if (/资本|融资|公司|战略|产业|商业/.test(`${category} ${title}`)) {
    return '它反映了公司战略、资本投入或产业协同变化，能帮助判断哪些方向正在获得真实资源配置。';
  }
  if (/监管|政策|标准|安全|治理/.test(`${category} ${title}`)) {
    return '它提示监管、标准或安全边界正在变化，适合放进风险清单和后续观察框架。';
  }
  if (/研究|论文|技术|基础设施|算力|芯片/.test(`${category} ${title}`)) {
    return '它提供了技术路线或基础设施侧的信号，适合用于判断中长期能力曲线和供给约束。';
  }
  return '它具备可核对的事实增量，适合纳入今日信息判断。';
}

export function buildDailyReportTrendSummaryService(
  snapshot: DailyReportSnapshot,
  deps: DailyReportEditorialDependencies,
): DailyReportTrendSummary {
  const categories = snapshot.byCategory
    .filter((item) => {
      const category = deps.normalizeCategory(item.category);
      return !/未分类|分类治理|uncategorized/i.test(category);
    })
    .slice(0, 5)
    .map((item) => ({
      category: deps.normalizeCategory(item.category),
      count: Number(item.count || 0),
      baselineAvg: Number(item.baselineAvg || 0),
      delta: Number(item.delta || 0),
      direction: Number(item.delta || 0) > 0.5 ? 'up' as const : Number(item.delta || 0) < -0.5 ? 'down' as const : 'flat' as const,
    }));
  return {
    newItems: snapshot.newItems,
    totalItems: snapshot.totalItems,
    compareWindowDays: snapshot.compareWindowDays,
    categories,
    sources: snapshot.topSources.slice(0, 5),
    themes: snapshot.themeClusters.filter((item) => isEditorialThemeLabelService(item.label)).slice(0, 5),
    ...(snapshot.candidateFunnel ? { funnel: snapshot.candidateFunnel } : {}),
    ...(snapshot.eventMetrics ? { eventMetrics: snapshot.eventMetrics } : {}),
  };
}

function buildPriorityArticleFromTopItem(item: TopItem, deps: DailyReportEditorialDependencies): DailyReportPriorityArticle {
  const keyPoints = findArticleAsset(item.readingAssets, 'key_points');
  const evidence = findArticleAsset(item.readingAssets, 'evidence');
  const actions = findArticleAsset(item.readingAssets, 'actions');
  const baseReason = describeReportItemValueService(item, deps);
  const evidenceText = deps.cleanInlineText(evidence?.content || evidence?.preview || '', 90);
  const actionText = deps.cleanInlineText(actions?.content || actions?.preview || '', 80);
  const summary = [
    keyPoints?.content,
    keyPoints?.preview,
    item.reportSummary,
    item.aiSummary,
    item.snippet,
  ]
    .map((value) => deps.cleanInlineText(value || '', 150))
    .find(Boolean) || '';
  return {
    id: item.id,
    title: deps.displayTitle(item),
    url: item.url,
    sourceName: item.sourceName,
    category: deps.normalizeCategory(item.category),
    reason: [evidenceText || baseReason, actionText ? `建议：${actionText}` : ''].filter(Boolean).join(' '),
    summary,
    contentLength: item.contentLength,
    assetReferences: [keyPoints, evidence, actions]
      .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset))
      .map((asset) => ({
        promptKey: String(asset.promptKey || ''),
        label: asset.label,
        excerpt: deps.cleanInlineText(asset.content || asset.preview || '', 120),
      }))
      .filter((asset) => asset.promptKey && asset.excerpt),
  };
}

export function buildDailyReportPriorityArticlesService(
  snapshot: DailyReportSnapshot,
  deps: DailyReportEditorialDependencies,
): DailyReportPriorityArticle[] {
  return snapshot.topItems.slice(0, 12).map((item) => buildPriorityArticleFromTopItem(item, deps));
}

function moduleKeyForItem(item: TopItem): DailyReportModuleSection['key'] {
  const titleText = [
    item.title,
    item.displayTitle,
    item.category,
  ].filter(Boolean).join(' ');
  const tagText = (item.aiTags || []).filter(Boolean).join(' ');
  const primaryText = `${titleText} ${tagText}`.trim();
  // Module routing must describe the article subject, not every incidental word
  // found in a full translation, author biography, footer or legal disclaimer.
  // The short AI summary and feed snippet are enough as secondary evidence.
  const secondaryText = [item.aiSummary, item.snippet]
    .filter(Boolean)
    .join(' ')
    .slice(0, 1_200);
  const evidenceText = `${primaryText} ${secondaryText}`;
  const sourceText = String(item.sourceName || '');

  // First pass: explicit title/tag evidence. Vendor names alone are not model
  // evidence, and generic words such as "risk" or "regulated" are not policy
  // evidence because they routinely appear in customer stories and footers.
  if (/(政策|政府监管|AI监管|人工智能监管|安全人工智能|AI安全|safe ai|青少年|teens?|隐私保护|版权|合规要求|风险治理|风险框架|scorecard|评分卡|安全标准)/i.test(titleText)) {
    return 'policy_safety';
  }
  if (/(开源(?:权重)?模型|open[- ]weights? model|open ai model|模型发布|发布.*模型|releases? .*model|foundation model|基础模型|推理模型|多模态模型|embedding|embed\b|rteb|benchmark|基准测试|introducing\s+(?:claude|gpt|gemini|kimi)|claude\s+(?:opus|sonnet|haiku|fable|mythos)\s*[\d.]*)/i.test(titleText)) {
    return 'models_labs';
  }
  if (/(算电|算力|推理芯片|inference chips?|gpu|数据中心|智算中心|服务器|存储|网络基础设施|电力成本|绿电|token产出|云基础设施)/i.test(titleText)) {
    return 'infra_compute';
  }
  if (/(机器人|robotic|robot\b|招聘|hiring|客户案例|customer story|商业化|融资|收入|市场|销售|消费|企业采用|应用落地|产业应用)/i.test(titleText)) {
    return 'apps_business';
  }
  if (/(agent|智能体|copilot|cursor|codex|workflow|工作流|automation|产品功能|product feature|game creation|mobile app|硬件键盘|keypad)/i.test(titleText)) {
    return 'agent_products';
  }
  if (/(博客|blog|newsletter|长文|观点|访谈|反思|工程师)/i.test(titleText)
    || /(daringfireball|bestblogs|paul graham|simon willison)/i.test(sourceText)) {
    return 'deep_reads';
  }

  // Second pass: concise article-level evidence. These expressions are more
  // specific so incidental legal wording cannot hijack the whole article.
  if (/(人工智能政策|AI政策|政府监管|监管机构|政策框架|安全人工智能|AI安全|青少年安全|家长控制|版权诉讼|隐私保护|风险治理|合规要求)/i.test(secondaryText)) {
    return 'policy_safety';
  }
  if (/(开源(?:权重)?模型|发布(?:了)?(?:新的)?模型|open[- ]weights? model|foundation model|基础模型|推理模型|多模态模型|embedding|rteb|benchmark|基准测试)/i.test(secondaryText)) {
    return 'models_labs';
  }
  if (/(算电|算力|推理芯片|inference chips?|gpu|数据中心|智算中心|电力成本|绿电|云基础设施)/i.test(secondaryText)) {
    return 'infra_compute';
  }
  if (/(汽车|automotive|客户|customer|交易生态|销售|招聘|hiring|融资|收入|商业化|市场|企业采用|应用落地)/i.test(secondaryText)) {
    return 'apps_business';
  }
  if (/(agent|智能体|copilot|cursor|codex|workflow|工作流|automation|产品功能)/i.test(secondaryText)) {
    return 'agent_products';
  }
  if (/(国内|中国|腾讯|阿里|字节|百度|美团|36氪|智东西|得物|微信|上海|北京|深圳|杭州)/i.test(evidenceText)) {
    return 'china_industry';
  }

  const fallbackText = `${primaryText} ${secondaryText}`;
  return DAILY_MODULE_DEFINITIONS.find((definition) => definition.pattern.test(fallbackText))?.key || 'apps_business';
}

function compactNarrativeSentence(input: string | null | undefined, maxLength = 92) {
  const text = String(input || '')
    .replace(/\s+/g, ' ')
    .replace(/^(?:标题|摘要|发生了什么|为什么重要|核心信息是)\s*[:：]\s*/g, '')
    .trim();
  if (!text) return '提供了可核对的事实增量。';
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength);
  const lastStop = Math.max(slice.lastIndexOf('。'), slice.lastIndexOf('；'), slice.lastIndexOf('，'));
  return `${(lastStop >= 24 ? slice.slice(0, lastStop) : slice).trim()}...`;
}

function buildModuleEditorialTitle(title: string, articles: Array<unknown>) {
  const countLabel = articles.length > 1 ? `${articles.length} 条信号` : '单篇观察';
  if (/模型|实验室/.test(title)) return `模型发布与实验室动向：${countLabel}`;
  if (/Agent|产品/.test(title)) return `Agent 与产品入口：${countLabel}`;
  if (/基础设施|算力/.test(title)) return `算力与基础设施：${countLabel}`;
  if (/商业/.test(title)) return `应用落地与商业化：${countLabel}`;
  if (/政策|安全/.test(title)) return `政策、安全与治理边界：${countLabel}`;
  if (/深读/.test(title)) return `深读与方法论：${countLabel}`;
  if (/国内/.test(title)) return `国内产业动态：${countLabel}`;
  return `${title}：${countLabel}`;
}

function markdownArticleLink(article: { id?: string; itemId?: string; title: string; url?: string }) {
  const itemId = article.id || article.itemId;
  return itemId ? `[${article.title}](/feed/${encodeURIComponent(itemId)})` : (article.url ? `[${article.title}](${article.url})` : article.title);
}

function buildModuleNarrativeMarkdown(
  title: string,
  evidence: DailyReportModuleEvidence[],
  signals: string[],
  actions: string[],
) {
  const lead = evidence[0];
  const primary = evidence.filter((item) => item.role === 'primary').slice(0, 4);
  const secondary = evidence.filter((item) => item.role === 'supporting').slice(0, 4);
  const evidenceBullets = primary.map((item) => (
    `- ${markdownArticleLink(item)}：${compactNarrativeSentence(item.fact)}`
  ));
  const signalBullets = (signals.slice(0, 3).length ? signals.slice(0, 3) : ['暂时还没有足够强的共同信号，需要继续看后续材料是否重复出现。'])
    .map((signal) => `- ${compactNarrativeSentence(signal, 110)}`);
  const actionBullets = (actions.slice(0, 2).length ? actions.slice(0, 2) : ['先读原文，再决定是否跟踪。'])
    .map((action) => `- ${action}`);
  const secondaryBullets = secondary
    .map((item) => `- ${markdownArticleLink(item)}：作为补充证据，用于校验这条趋势是不是孤立快讯。`);
  return [
    `### ${buildModuleEditorialTitle(title, evidence)}`,
    '',
    `本模块用于判断 ${title} 是否已经形成连续信号。${lead ? '头部证据已列在“发生了什么”的第一条，先核对事实增量再判断趋势。' : '当前没有足够强的头部证据。'}`,
    '',
    '#### 发生了什么',
    ...(evidenceBullets.length ? evidenceBullets : ['- 当前素材不足，无法形成稳定证据链。']),
    '',
    '#### 为什么重要',
    ...signalBullets,
    '',
    secondaryBullets.length ? '#### 补充阅读' : '#### 建议动作',
    ...(secondaryBullets.length ? secondaryBullets : []),
    ...(secondaryBullets.length ? ['', '#### 建议动作'] : []),
    ...actionBullets,
  ].join('\n');
}

function resolveEditorialMaterialFact(
  item: TopItem | undefined,
  article: DailyReportPriorityArticle,
  deps: DailyReportEditorialDependencies,
) {
  const keyPoints = item ? findArticleAsset(item.readingAssets, 'key_points') : null;
  const candidates: Array<{ value: string | null | undefined; basis: DailyReportEditorialFactBasis }> = [
    { value: keyPoints?.content || keyPoints?.preview, basis: 'article_asset' },
    { value: item?.reportSummary, basis: 'report_summary' },
    { value: item?.aiSummary, basis: 'ai_summary' },
    { value: item?.snippet, basis: 'snippet' },
    { value: article.summary, basis: 'module_summary' },
    { value: article.title, basis: 'title' },
  ];
  const resolved = candidates.find((candidate) => deps.cleanInlineText(candidate.value || '', 220));
  return {
    fact: deps.cleanInlineText(resolved?.value || article.title, 220),
    factBasis: resolved?.basis || 'title' as DailyReportEditorialFactBasis,
  };
}

export function buildDailyReportModuleSectionsService(
  snapshot: DailyReportSnapshot,
  deps: DailyReportEditorialDependencies,
): DailyReportModuleSection[] {
  const uniqueItems = [...snapshot.topItems, ...snapshot.highScoreItems]
    .filter((item, index, array) => item?.id && array.findIndex((entry) => entry.id === item.id) === index);
  const groups = new Map<DailyReportModuleSection['key'], TopItem[]>();
  for (const item of uniqueItems) {
    const key = moduleKeyForItem(item);
    const group = groups.get(key) || [];
    if (group.length < 8) group.push(item);
    groups.set(key, group);
  }

  return DAILY_MODULE_DEFINITIONS
    .map((definition): DailyReportModuleSection | null => {
      const items = groups.get(definition.key) || [];
      if (items.length === 0) return null;
      const articles = items.map((item) => buildPriorityArticleFromTopItem(item, deps));
      const evidence = items.map((item, index): DailyReportModuleEvidence => {
        const article = articles[index];
        const resolved = resolveEditorialMaterialFact(item, article, deps);
        return {
          itemId: item.id,
          title: article.title,
          url: article.url,
          sourceName: article.sourceName,
          fact: resolved.fact,
          factBasis: resolved.factBasis,
          role: index < 4 ? 'primary' : 'supporting',
        };
      });
      const strongest = articles[0];
      const signals = evidence.length > 1
        ? evidence.slice(0, 4).map((item) => compactNarrativeSentence(item.fact, 120))
        : [];
      const actions = evidence.length > 1
        ? [
          `先读本模块前 ${Math.min(3, articles.length)} 篇，核对不同来源是否指向同一变化。`,
          '只把有原文链接和明确证据的条目沉淀进长期专题。',
        ]
        : [
          '这是单篇观察，先核对原文，等待第二个独立来源再判断是否构成趋势。',
        ];
      return {
        key: definition.key,
        title: definition.title,
        editorialTitle: buildModuleEditorialTitle(definition.title, articles),
        conclusion: articles.length > 1
          ? `${definition.title}今天有 ${articles.length} 条可读材料，核心先看 ${strongest?.title || '头部条目'}。`
          : `${definition.title}今天只有 1 条可读材料，它是单篇观察，尚不足以形成趋势判断。`,
        narrativeMarkdown: buildModuleNarrativeMarkdown(definition.title, evidence, signals, actions),
        priorityArticles: articles,
        primaryLinks: articles.slice(0, 4),
        secondaryLinks: articles.slice(4, 8),
        evidence,
        signals,
        noise: articles
          .filter((article) => /泛|行情|公告|待补|摘要不足|噪声/.test(`${article.summary} ${article.reason}`))
          .slice(0, 3)
          .map((article) => article.title),
        actions,
        coverageCount: articles.length,
        evidenceCount: articles.length,
      } satisfies DailyReportModuleSection;
    })
    .filter((section): section is DailyReportModuleSection => Boolean(section));
}

export function uniqueDailyReportArticlesService(snapshot: DailyReportSnapshot, deps: DailyReportEditorialDependencies) {
  return [...snapshot.topItems, ...snapshot.highScoreItems]
    .filter((item, index, array) => item?.id && array.findIndex((entry) => entry.id === item.id) === index)
    .map((item) => buildPriorityArticleFromTopItem(item, deps));
}

export function uniqueDailyReportPriorityArticlesService(articles: DailyReportPriorityArticle[]) {
  return articles.filter((article, index, array) => article?.id && array.findIndex((entry) => entry.id === article.id) === index);
}

export function isValidReportArticleUrlService(value?: string | null) {
  return /^https?:\/\/[^\s]+$/i.test(String(value || '').trim());
}

export function buildDailyReportSupplementalArticlesService(
  snapshot: DailyReportSnapshot,
  coverageItems: DailyReportCoverageItem[] = [],
  targetDistinctLinks = 25,
  deps: DailyReportEditorialDependencies,
) {
  const baseArticles = uniqueDailyReportPriorityArticlesService([
    ...uniqueDailyReportArticlesService(snapshot, deps),
    ...(snapshot.moduleSections || []).flatMap((section) => section.priorityArticles),
  ]);
  const seenIds = new Set(baseArticles.map((article) => article.id));
  const seenUrls = new Set(
    baseArticles
      .map((article) => article.url?.trim())
      .filter((url): url is string => isValidReportArticleUrlService(url)),
  );
  if (seenUrls.size >= targetDistinctLinks) return [];

  const statusRank: Record<DailyReportCoverageStatus, number> = {
    review: 0,
    latestFallback: 1,
    selected: 2,
    excluded: 3,
  };
  const eligible = coverageItems
    .filter((item) => item.status === 'review' || item.status === 'latestFallback')
    .filter((item) => isValidReportArticleUrlService(item.url))
    .sort((left, right) => (
      statusRank[left.status] - statusRank[right.status]
      || (right.score ?? -1) - (left.score ?? -1)
    ));
  const supplements: DailyReportPriorityArticle[] = [];
  for (const item of eligible) {
    const url = item.url.trim();
    if (seenIds.has(item.id) || seenUrls.has(url)) continue;
    seenIds.add(item.id);
    seenUrls.add(url);
    supplements.push({
      id: item.id,
      title: item.title,
      url,
      sourceName: item.sourceName,
      category: item.category,
      reason: item.reason,
      summary: item.digest,
    });
    if (seenUrls.size >= targetDistinctLinks) break;
  }
  return supplements;
}

function isDeepReadArticle(article: DailyReportPriorityArticle) {
  if (!Number.isFinite(article.contentLength) || Number(article.contentLength) < 800) return false;
  return /(blog|博客|newsletter|周刊|weekly|长文|研究|论文|深读|观点|方法论|工程师|bestblogs|simon|paul graham|aigc weekly)/i
    .test(`${article.title} ${article.sourceName} ${article.category} ${article.summary}`);
}

function isEditoriallyUsefulDynamic(article: DailyReportPriorityArticle) {
  const title = String(article.title || '').trim();
  const source = String(article.sourceName || '').trim();
  const category = String(article.category || '').trim();
  const summary = String(article.summary || '').trim();
  if (!title || !summary || /^\s*(?:!\[|!A\b|<img\b)/i.test(summary)) return false;

  const directTechnologySignal = /(?:\bAI\b|artificial intelligence|人工智能|\bLLM\b|大模型|模型|\bAgent\b|智能体|OpenAI|Anthropic|Claude|GPT|Gemini|Kimi|NVIDIA|\bGPU\b|芯片|semiconductor|data cent(?:er|re)|算力|robot|机器人|software|developer|programming|compiler|database|browser|web search|搜索引擎|API|WASM|WebAssembly|\bGo\b|Rust|Python|代码|编程|开源)/i;
  const specialistSource = /(?:Simon Willison|Daring Fireball|TonyBai|John D\. Cook|Hugging Face|OpenAI|Anthropic|NVIDIA|BestBlogs|Paul Graham)/i;
  const editorialCategory = /(?:模型|实验室|Agent|产品|基础设施|算力|应用|商业化|政策安全|深读|博客|软件|开发|开源)/i;
  const promotionNoise = /(?:Disrupt|conference|summit|session|register|tickets?|sponsored|pre-seed|demo day|报名|门票|峰会|活动预告)/i;
  const marketNoise = /(?:\bstocks?\b|\bshares?\b|\bIPO\b|\bNYSE\b|\bNasdaq\b|Morning Bid|earnings|profit jumps?|Obamacare|股价|股票|上市|行情|收盘|开盘|募资)/i;
  const titleHasSignal = directTechnologySignal.test(title);

  if (promotionNoise.test(`${title} ${summary}`)) return false;
  if (marketNoise.test(title) && !titleHasSignal) return false;
  return titleHasSignal || specialistSource.test(source) || editorialCategory.test(category);
}

function buildCoverJudgement(
  snapshot: DailyReportSnapshot,
  modules: DailyReportModuleSection[],
  curated: DailyReportPriorityArticle[],
  deps: DailyReportEditorialDependencies,
) {
  const normalizeModuleTitle = (value?: string | null) => String(value || '')
    .replace(/[:：].*$/, '')
    .replace(/\s+\d+\s*条.*$/, '')
    .trim();
  const moduleTitles = modules
    .map((module) => normalizeModuleTitle(module.title))
    .filter((title, index, array) => title && array.indexOf(title) === index);
  const genericTheme = /^(?:blogs?|ai|tech|technology|news|新闻|技术动态|行业动态|产品发布\/?更新|未分类|分类治理诊断项)$/i;
  const meaningfulTheme = snapshot.themeClusters
    .map((cluster) => String(cluster.label || '').trim())
    .find((label) => isEditorialThemeLabelService(label) && !genericTheme.test(label));
  const primary = moduleTitles[0]
    || normalizeModuleTitle(deps.normalizeCategory(snapshot.byCategory.find((entry) => !genericTheme.test(entry.category))?.category))
    || meaningfulTheme
    || 'AI 信息面';
  const secondary = moduleTitles.find((title) => title !== primary);
  const title = secondary
    ? `${primary}居前，${secondary}形成第二主线`
    : meaningfulTheme && meaningfulTheme !== primary
      ? `${primary}居前，${meaningfulTheme}提供关键旁证`
      : `${primary}成为今日主线`;
  const evidenceLabel = [primary, secondary, meaningfulTheme]
    .filter((label, index, array): label is string => Boolean(label) && array.indexOf(label) === index)
    .slice(0, 3)
    .join('、');
  const leadTitle = deps.cleanInlineText(curated[0]?.title || snapshot.topItems[0]?.title || '', 80);
  const selectedCount = new Set(snapshot.topItems.map((item) => item.id)).size;
  const summary = selectedCount < 3
    ? `今日新增 ${snapshot.newItems} 条，但正式精选只有 ${selectedCount} 篇。当前证据集中在 ${evidenceLabel || 'AI 产品与技术变化'}，样本不足以构成趋势${leadTitle ? `；先核验《${leadTitle}》的事实增量` : ''}。`
    : `今日新增 ${snapshot.newItems} 条，正式精选 ${selectedCount} 篇，${evidenceLabel || 'AI 产品与技术变化'}构成主要信息增量。先看${primary}的事实变化${secondary ? `，再对照${secondary}` : ''}，判断这些证据是否来自同一条连续主线。`;
  return { title, summary };
}

function buildRadarOverviewDigestMarkdown(snapshot: DailyReportSnapshot, deps: DailyReportEditorialDependencies) {
  return [
    '## 信息雷达总览',
    '',
    ...deps.buildTrendMarkdown(snapshot),
  ].join('\n');
}

function buildDailyReportEditorialMaterials(input: {
  snapshot: DailyReportSnapshot;
  moduleNarratives: DailyReportModuleSection[];
  allArticles: DailyReportPriorityArticle[];
  curated: DailyReportPriorityArticle[];
  moreDynamics: DailyReportPriorityArticle[];
  deepReads: DailyReportPriorityArticle[];
  deps: DailyReportEditorialDependencies;
}) {
  const sourceItems = new Map(
    [...input.snapshot.topItems, ...input.snapshot.highScoreItems]
      .filter((item) => item?.id)
      .map((item) => [item.id, item] as const),
  );
  const moduleThemeByItemId = new Map<string, string>();
  for (const section of input.moduleNarratives) {
    for (const article of section.priorityArticles) {
      if (!moduleThemeByItemId.has(article.id)) moduleThemeByItemId.set(article.id, section.title);
    }
  }
  const placementsByItemId = new Map<string, Set<DailyReportEditorialPlacement>>();
  const addPlacement = (articles: DailyReportPriorityArticle[], placement: DailyReportEditorialPlacement) => {
    for (const article of articles) {
      const placements = placementsByItemId.get(article.id) || new Set<DailyReportEditorialPlacement>();
      placements.add(placement);
      placementsByItemId.set(article.id, placements);
    }
  };
  addPlacement(input.curated, 'featured');
  addPlacement(input.deepReads, 'deep_read');
  addPlacement(input.moduleNarratives.flatMap((section) => section.priorityArticles), 'module');
  addPlacement(input.moreDynamics, 'more_dynamics');

  return input.allArticles.map((article): DailyReportEditorialMaterial => {
    const item = sourceItems.get(article.id);
    const placements = placementsByItemId.get(article.id) || new Set<DailyReportEditorialPlacement>();
    if (placements.size === 0) placements.add('coverage_index');
    const orderedPlacements = EDITORIAL_PLACEMENT_PRIORITY.filter((placement) => placements.has(placement));
    const { fact, factBasis } = resolveEditorialMaterialFact(item, article, input.deps);
    return {
      itemId: article.id,
      title: article.title,
      fact,
      factBasis,
      evidenceUrl: article.url || item?.url || '',
      sourceName: article.sourceName || item?.sourceName || '未知来源',
      theme: moduleThemeByItemId.get(article.id) || input.deps.normalizeCategory(article.category || item?.category),
      recommendedPlacement: orderedPlacements[0] || 'coverage_index',
      placements: orderedPlacements.length ? orderedPlacements : ['coverage_index'],
      reason: input.deps.cleanInlineText(article.reason || input.deps.humanizeSelectionReason(item?.selectionReason, item), 180),
      ...(item?.selectionMode ? { selectionMode: item.selectionMode } : {}),
      score: item?.aiScore ?? null,
    };
  });
}

export function buildDailyReportEditorialDigestService(
  snapshot: DailyReportSnapshot,
  deps: DailyReportEditorialDependencies,
): DailyReportEditorialDigest {
  const moduleNarratives = snapshot.moduleSections || buildDailyReportModuleSectionsService(snapshot, deps);
  const moduleReferences = moduleNarratives
    .flatMap((section) => section.priorityArticles)
    .filter((article, index, array) => array.findIndex((entry) => entry.id === article.id) === index);
  const baseArticles = uniqueDailyReportPriorityArticlesService([
    ...uniqueDailyReportArticlesService(snapshot, deps),
    ...moduleReferences,
  ]);
  const baseIds = new Set(baseArticles.map((article) => article.id));
  const supplementalArticles = uniqueDailyReportPriorityArticlesService(snapshot.editorialSupplementArticles || [])
    .filter((article) => !baseIds.has(article.id) && isValidReportArticleUrlService(article.url));
  const allArticles = uniqueDailyReportPriorityArticlesService([...baseArticles, ...supplementalArticles]);
  const selectedIds = new Set(snapshot.topItems.map((item) => item.id));
  const curated = baseArticles.filter((article) => selectedIds.has(article.id)).slice(0, 12);
  const curatedIds = new Set(curated.map((article) => article.id));
  const moreDynamics = allArticles
    .filter((article) => !curatedIds.has(article.id))
    .filter((article) => isEditoriallyUsefulDynamic(article))
    .slice(0, 20);
  const deepReads = allArticles
    .filter((article) => isDeepReadArticle(article))
    .slice(0, 10);
  const coverJudgement = buildCoverJudgement(snapshot, moduleNarratives, curated, deps);
  const materials = buildDailyReportEditorialMaterials({
    snapshot,
    moduleNarratives,
    allArticles,
    curated,
    moreDynamics,
    deepReads,
    deps,
  });
  const digestCore = {
    coverJudgement,
    radarOverview: { markdown: buildRadarOverviewDigestMarkdown(snapshot, deps) },
    tableOfContents: ['今日封面判断', '信息雷达总览', '今日精选', '模块日报', '更多动态', '重点研究/深读', '阅读顺序', '下一步行动', '附录：全池摘要索引'],
    curated,
    moduleReferences,
    moreDynamics,
    deepReads,
    moduleNarratives,
    materials,
  };
  return {
    ...digestCore,
    readingOrder: { markdown: deps.buildReadingOrderMarkdown(snapshot, digestCore) },
    nextActions: { markdown: deps.buildNextActionsMarkdown(snapshot) },
  };
}
