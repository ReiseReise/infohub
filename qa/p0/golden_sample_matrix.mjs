#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const CHECK_LABELS = {
  content_state: '正文状态',
  reader_render: '原文排版',
  summary_basis: '摘要依据',
  translation_action: '翻译动作',
  report_coverage: '日报引用',
  source_health: '来源健康',
  source_mapping: '来源映射',
  privacy_boundary: '隐私边界',
  noise_control: '噪声降级',
  page_layout: '页面无遮挡',
  code_format: '代码/列表格式',
  original_fetch: '原站补抓',
};

export const DEFAULT_SCENARIOS = [
  {
    id: 'full_readable_article',
    label: '全文可读文章',
    purpose: '验证长文阅读、摘要、翻译都基于真实正文，而不是 RSS 片段或索引摘要。',
    checks: ['content_state', 'reader_render', 'summary_basis', 'translation_action', 'report_coverage'],
    match: (item) => ['readableText', 'rawFeedHtml'].includes(resolveEvidenceLayer(item)),
  },
  {
    id: 'rss_longform_code',
    label: 'RSS 长文/代码文章',
    purpose: '验证 John D. Cook、Simon Willison、Daring Fireball 等长文源能保留段落、列表、代码块和链接格式。',
    checks: ['content_state', 'reader_render', 'code_format', 'translation_action', 'page_layout'],
    match: (item) => {
      const text = `${item.title || ''} ${item.sourceName || item.source?.name || ''} ${item.url || ''}`.toLowerCase();
      return /(john d\. cook|johndcook|simon willison|simonwillison|daring fireball|daringfireball|code|lean|python|typescript|编程|代码)/i.test(text)
        && ['readableText', 'rawFeedHtml'].includes(resolveEvidenceLayer(item));
    },
  },
  {
    id: 'index_summary',
    label: '索引源条目',
    purpose: '验证新闻室/目录页拆出的条目要么明确为索引摘要待补抓，要么已经补成原站正文，不能退回网页快照或假全文。',
    checks: ['content_state', 'original_fetch', 'translation_action', 'report_coverage', 'source_health'],
    match: (item) => resolveEvidenceLayer(item) === 'indexSummary' || isNewsIndexSourceItem(item),
  },
  {
    id: 'curated_summary',
    label: '榜单摘要条目',
    purpose: '验证 BestBlogs 等榜单源能保留发现价值，但不伪装成原文全文。',
    checks: ['content_state', 'original_fetch', 'translation_action', 'source_health'],
    match: (item) => resolveEvidenceLayer(item) === 'curatedSummary',
  },
  {
    id: 'snapshot_or_monitor',
    label: '网页快照/监控',
    purpose: '验证网页监控快照被降级展示，不进入普通长文阅读主路径。',
    checks: ['content_state', 'noise_control', 'source_health', 'report_coverage'],
    optionalWhenMissing: true,
    missingReason: '当前账号未启用网页快照/监控来源，该场景跳过，不影响 RSS 主链路验收。',
    match: (item) => resolveEvidenceLayer(item) === 'snapshotText',
  },
  {
    id: 'email_newsletter',
    label: '邮箱/newsletter',
    purpose: '验证邮箱入口默认按私密阅读材料处理，不误入公开日报主线，也不被网页补抓逻辑污染。',
    checks: ['content_state', 'privacy_boundary', 'summary_basis', 'report_coverage'],
    match: (item) => {
      const sourceType = String(item.sourceType || item.source?.sourceType || '').toLowerCase();
      const sourceName = String(item.sourceName || item.source?.name || '').toLowerCase();
      return sourceType === 'email' || sourceName.includes('email') || sourceName.includes('newsletter') || sourceName.includes('inbox');
    },
  },
  {
    id: 'snippet_or_title_only',
    label: '片段/标题兜底',
    purpose: '验证正文不足时页面给出明确补正文动作，而不是显示空摘要或假译文。',
    checks: ['content_state', 'original_fetch', 'translation_action', 'noise_control'],
    match: (item) => ['snippet', 'title'].includes(resolveEvidenceLayer(item)),
  },
  {
    id: 'translation_gap',
    label: '翻译缺口',
    purpose: '验证翻译页签始终有可执行动作：一键翻译、补抓后翻译或打开原文。',
    checks: ['translation_action', 'content_state', 'reader_render', 'page_layout'],
    match: (item) => ['translate', 'fetch_then_translate', 'retry_translation', 'open_original'].includes(resolveTranslationAction(item)),
  },
  {
    id: 'high_value_ai_signal',
    label: '高价值 AI 信号',
    purpose: '验证重大 AI/模型/Agent 新闻即使处理中也不会从 Feed 与日报候选中消失。',
    checks: ['report_coverage', 'summary_basis', 'translation_action', 'content_state'],
    match: (item) => {
      const text = `${item.title || ''} ${item.sourceName || item.source?.name || ''} ${item.category || ''}`.toLowerCase();
      return /(anthropic|claude|openai|gemini|agent|model|llm|模型|智能体)/i.test(text)
        && Number(item.aiScore ?? item.priorityScore ?? item.score ?? 0) >= 55;
    },
  },
  {
    id: 'official_source_config',
    label: '官方源配置一致性',
    purpose: '验证 OpenAI、Anthropic 等官方名义源不会实际指向社区或聚合站点。',
    checks: ['source_mapping', 'source_health', 'report_coverage'],
    match: (item) => Boolean(detectSourceMappingIssue(item)) || isOfficialSourceItem(item),
  },
  {
    id: 'domestic_cn_news',
    label: '中文产业资讯',
    purpose: '验证 36kr 等中文源不会因为短讯/泛商业噪声被包装成深读材料。',
    checks: ['noise_control', 'summary_basis', 'report_coverage', 'content_state'],
    match: (item) => {
      const text = `${item.title || ''} ${item.sourceName || item.source?.name || ''} ${item.sourceCategory || item.category || ''}`.toLowerCase();
      return /(36kr|36氪|国内|融资|产业|商业|公司|产品发布)/i.test(text);
    },
  },
  {
    id: 'low_quality_noise',
    label: '低质/噪声样本',
    purpose: '验证低质量来源、正文不足或泛商业噪声不会被包装成高质量阅读内容。',
    checks: ['noise_control', 'source_health', 'report_coverage', 'content_state'],
    match: (item) => {
      const score = Number(item.aiScore ?? item.priorityScore ?? item.score ?? 100);
      return score < 45 || ['snippet', 'title', 'snapshotText'].includes(resolveEvidenceLayer(item));
    },
  },
];

export const DEFAULT_SOURCE_KEYWORDS = [
  'Anthropic',
  'OpenAI',
  'Claude',
  'BestBlogs',
  'John D. Cook',
  'johndcook',
  'Simon Willison',
  'Daring Fireball',
  'TechCrunch AI',
  'The Verge AI',
  '36kr',
  'Email Inbox',
];

export function resolveEvidenceLayer(item) {
  const layer = item?.contentEvidence?.primaryLayer;
  if (layer) return layer;

  const readiness = item?.contentReadiness || {};
  if (readiness.kind === 'index_item') return 'indexSummary';
  if (readiness.kind === 'curated_summary' || readiness.kind === 'curated_index') return 'curatedSummary';
  if (readiness.kind === 'snapshot') return 'snapshotText';
  if (readiness.fullTextAvailable || readiness.status === 'full_text') return 'readableText';

  const sourceType = String(item?.sourceType || item?.source?.sourceType || '').toLowerCase();
  if (sourceType === 'curated_index') return 'curatedSummary';
  if (sourceType === 'webpage') return 'snapshotText';
  if (sourceType === 'email') return 'emailText';

  if (item?.snippet) return 'snippet';
  return 'title';
}

export function resolveEvidenceLabel(item) {
  return item?.contentEvidence?.primaryLabel
    || item?.contentReadiness?.label
    || ({
      readableText: '可读正文',
      rawFeedHtml: 'RSS 原文',
      indexSummary: '索引摘要',
      curatedSummary: '榜单摘要',
      snapshotText: '网页快照',
      emailText: '邮箱正文',
      snippet: '摘要片段',
      title: '仅标题',
    }[resolveEvidenceLayer(item)] || '未知');
}

export function isNewsIndexSourceItem(item) {
  const sourceType = String(item?.sourceType || item?.source?.sourceType || '').toLowerCase();
  const collector = String(item?.sourceCollectorType || item?.source?.collectorType || item?.collectorType || '').toLowerCase();
  const sourceName = String(item?.sourceName || item?.source?.name || '').toLowerCase();
  const hasOriginalUrl = Boolean(item?.originalUrl || item?.url);
  return sourceType === 'curated_index'
    && collector === 'webpage_index'
    && hasOriginalUrl
    && /(anthropic|openai|newsroom|platform releases|新闻室|官方)/i.test(sourceName);
}

export function isOfficialSourceItem(item) {
  const sourceName = String(item?.sourceName || item?.source?.name || '').toLowerCase();
  const sourceKind = String(item?.sourceKind || item?.source?.sourceKind || item?.source?.kind || '').toLowerCase();
  if (sourceKind === 'official') return true;
  return /(openai news|anthropic newsroom|claude platform releases|openai|anthropic)/i.test(sourceName)
    && !detectSourceMappingIssue(item);
}

export function resolveTranslationAction(item) {
  if (item?.translationAction) return item.translationAction;

  const status = String(item?.translationStatus || '').toLowerCase();
  if (['ready', 'completed', 'done', 'translated'].includes(status)) return 'ready';
  if (['failed', 'error'].includes(status)) return 'retry_translation';

  const basis = item?.contentEvidence?.translationBasis;
  if (basis?.reliableForFullTranslation === false) {
    return item?.originalUrl || item?.url ? 'fetch_then_translate' : 'open_original';
  }

  const readiness = item?.contentReadiness || {};
  if (readiness.fullTextAvailable || ['readableText', 'rawFeedHtml'].includes(resolveEvidenceLayer(item))) {
    return 'translate';
  }

  if (item?.originalUrl || item?.url) return 'fetch_then_translate';
  return 'none';
}

export function buildGoldenRow(item, scenario, baseWebUrl = 'http://localhost') {
  if (!item) {
    const optional = Boolean(scenario.optionalWhenMissing);
    return {
      scenarioId: scenario.id,
      scenario: scenario.label,
      status: optional ? 'skipped' : 'missing',
      purpose: scenario.purpose,
      itemId: '',
      title: optional ? '未启用该场景' : '未找到样本',
      sourceName: '',
      score: '',
      evidenceLayer: '',
      evidenceLabel: '',
      translationAction: '',
      acceptanceChecks: formatAcceptanceChecks(scenario.checks),
      feedUrl: '',
      issue: optional
        ? (scenario.missingReason || '当前账号未启用该场景，跳过验收。')
        : '当前数据集中没有命中该场景的样本，需要补源或补处理。',
    };
  }

  const itemId = String(item.id || item.itemId || '');
  const sourceId = item.sourceId ?? item.source?.id ?? '';
  const feedUrl = itemId
    ? `${baseWebUrl.replace(/\/$/, '')}/feed/${encodeURIComponent(itemId)}${sourceId ? `?sourceId=${encodeURIComponent(String(sourceId))}` : ''}`
    : '';
  const translationAction = resolveTranslationAction(item);
  const layer = resolveEvidenceLayer(item);
  const issue = buildRowIssue({ layer, translationAction, item });

  return {
    scenarioId: scenario.id,
    scenario: scenario.label,
    status: issue && isBlockingRowIssue(issue) ? 'review' : 'pass',
    purpose: scenario.purpose,
    itemId,
    title: item.title || item.displayTitle || '(无标题)',
    sourceName: item.sourceName || item.source?.name || '',
    score: item.aiScore ?? item.priorityScore ?? item.score ?? '',
    evidenceLayer: layer,
    evidenceLabel: resolveEvidenceLabel(item),
    translationAction,
    acceptanceChecks: formatAcceptanceChecks(scenario.checks),
    feedUrl,
    issue,
  };
}

export function buildRowIssue({ layer, translationAction, item }) {
  const sourceMappingIssue = detectSourceMappingIssue(item);
  if (sourceMappingIssue) return sourceMappingIssue;
  if (['snippet', 'title'].includes(layer)) {
    if (isExpectedShallowBrief(item)) {
      return '浅阅读短讯：保留为快扫/更多动态，不进入翻译和日报深读债务。';
    }
    return '正文不足，必须先补正文再用于翻译或日报精选。';
  }
  if (layer === 'snapshotText') return '这是网页快照，需要降级为监控材料，避免当作普通文章。';
  if (layer === 'indexSummary' && translationAction !== 'fetch_then_translate') {
    return '索引摘要需要优先补抓原站正文，当前翻译动作不够明确。';
  }
  if (layer === 'curatedSummary' && !['fetch_then_translate', 'open_original'].includes(translationAction)) {
    return '索引/榜单摘要需要优先补抓原站正文，当前翻译动作不够明确。';
  }
  if (translationAction === 'retry_translation') return '翻译失败，需要显示失败原因和重试入口。';
  if (item?.summaryStatus === 'failed') return '摘要失败，需要进入批量修复或文章资产生成。';
  return '';
}

export function isBlockingRowIssue(issue = '') {
  return !String(issue).startsWith('浅阅读短讯');
}

export function isExpectedShallowBrief(item) {
  const sourceName = String(item?.sourceName || item?.source?.name || '').toLowerCase();
  const url = String(item?.originalUrl || item?.url || '').toLowerCase();
  const tier = String(item?.sourceReadingTier || item?.readingTier || item?.source?.readingTier || '').toLowerCase();
  const tags = Array.isArray(item?.tags) ? item.tags.join(' ') : String(item?.tags || '');
  const category = String(item?.category || item?.sourceCategory || item?.source?.category || '').toLowerCase();
  const text = `${sourceName} ${url} ${tier} ${tags} ${category}`;
  const is36krFlash = sourceName.includes('36kr') || sourceName.includes('36氪') || url.includes('36kr.com/newsflashes/');
  const markedLight = /light_reading|浅阅读|轻阅读|快扫|brief|newsflash|快讯/.test(text);
  return is36krFlash || markedLight;
}

export function detectSourceMappingIssue(item) {
  const sourceName = String(item?.sourceName || item?.source?.name || '').toLowerCase();
  const rawUrl = item?.originalUrl || item?.url || '';
  if (!sourceName || !rawUrl) return '';

  const sourceType = String(item?.sourceType || item?.source?.sourceType || '').toLowerCase();
  const collector = String(item?.sourceCollectorType || item?.source?.collectorType || item?.collectorType || '').toLowerCase();
  if (sourceName.includes('bestblogs') && (sourceType === 'curated_index' || collector === 'webpage_index')) {
    return '';
  }

  let host = '';
  try {
    host = new URL(rawUrl).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }

  const expectations = [
    { keyword: 'openai', host: 'openai.com', label: 'OpenAI' },
    { keyword: 'anthropic', host: 'anthropic.com', label: 'Anthropic' },
    { keyword: 'john d. cook', host: 'johndcook.com', label: 'John D. Cook' },
    { keyword: 'johndcook', host: 'johndcook.com', label: 'John D. Cook' },
    { keyword: 'simon willison', host: 'simonwillison.net', label: 'Simon Willison' },
    { keyword: 'daring fireball', host: 'daringfireball.net', label: 'Daring Fireball' },
    { keyword: 'techcrunch', host: 'techcrunch.com', label: 'TechCrunch' },
    { keyword: 'the verge', host: 'theverge.com', label: 'The Verge' },
    { keyword: '36kr', host: '36kr.com', label: '36kr' },
    { keyword: 'bestblogs', host: 'bestblogs.dev', label: 'BestBlogs' },
  ];
  const expected = expectations.find((entry) => sourceName.includes(entry.keyword));
  if (!expected || host.endsWith(expected.host)) return '';
  return `来源映射异常：${expected.label} 源实际指向 ${host}，需要检查订阅 URL 或来源命名。`;
}

export function selectGoldenRows(items, scenarios = DEFAULT_SCENARIOS, options = {}) {
  const baseWebUrl = options.baseWebUrl || 'http://localhost';
  const used = new Set();

  return scenarios.map((scenario) => {
    const item = items
      .filter((candidate) => {
        const id = String(candidate.id || candidate.itemId || '');
        if (id && used.has(id)) return false;
        return scenario.match(candidate);
      })
      .sort((a, b) => scoreGoldenCandidate(b, scenario) - scoreGoldenCandidate(a, scenario))[0];
    if (item?.id || item?.itemId) used.add(String(item.id || item.itemId));
    return buildGoldenRow(item, scenario, baseWebUrl);
  });
}

export function scoreGoldenCandidate(item, scenario) {
  let score = 0;
  const haystack = `${item.title || ''} ${item.sourceName || item.source?.name || ''} ${item.category || ''}`.toLowerCase();
  const sourceName = String(item.sourceName || item.source?.name || '').toLowerCase();
  const numericScore = Number(item.aiScore ?? item.priorityScore ?? item.score ?? 0);
  const layer = resolveEvidenceLayer(item);
  const action = resolveTranslationAction(item);

  if (DEFAULT_SOURCE_KEYWORDS.some((keyword) => haystack.includes(keyword.toLowerCase()))) score += 30;
  if (/(anthropic|claude|openai|gemini|agent|model|llm|模型|智能体)/i.test(haystack)) score += 15;
  if (numericScore >= 70) score += 8;
  else if (numericScore >= 55) score += 4;

  if (sourceName.includes('v2ex') && scenario.id !== 'low_quality_noise') score -= 35;

  if (scenario.id === 'translation_gap') {
    if (action === 'fetch_then_translate') score += 30;
    if (action === 'retry_translation') score += 20;
    if (action === 'translate') score += 8;
    if (['snippet', 'title', 'indexSummary', 'curatedSummary'].includes(layer)) score += 10;
  }

  if (scenario.id === 'index_summary') {
    if (resolveEvidenceLayer(item) === 'indexSummary') score += 35;
    if (isNewsIndexSourceItem(item)) score += 30;
    if (sourceName.includes('anthropic') || sourceName.includes('openai')) score += 12;
  }

  if (scenario.id === 'rss_longform_code') {
    if (sourceName.includes('john') || sourceName.includes('simon') || sourceName.includes('daring')) score += 30;
    if (/(code|lean|python|typescript|编程|代码)/i.test(haystack)) score += 12;
  }

  if (scenario.id === 'email_newsletter') {
    if (String(item.sourceType || '').toLowerCase() === 'email') score += 30;
    if (sourceName.includes('email') || sourceName.includes('inbox') || sourceName.includes('newsletter')) score += 20;
  }

  if (scenario.id === 'official_source_config') {
    if (detectSourceMappingIssue(item)) score += 60;
    if (isOfficialSourceItem(item)) score += 35;
  }

  if (scenario.id === 'domestic_cn_news') {
    if (sourceName.includes('36kr') || sourceName.includes('36氪')) score += 35;
    if (/(国内|融资|产业|商业|公司|产品发布)/i.test(haystack)) score += 12;
  }

  if (scenario.id === 'low_quality_noise') {
    if (numericScore < 45) score += 25;
    if (['snippet', 'title', 'snapshotText'].includes(layer)) score += 18;
    if (sourceName.includes('v2ex') || sourceName.includes('36kr')) score += 10;
  }

  return score;
}

export function summarizeRows(rows) {
  const summary = {
    total: rows.length,
    pass: 0,
    review: 0,
    missing: 0,
    skipped: 0,
    byLayer: {},
    byTranslationAction: {},
  };

  for (const row of rows) {
    summary[row.status] = (summary[row.status] || 0) + 1;
    if (row.evidenceLayer) summary.byLayer[row.evidenceLayer] = (summary.byLayer[row.evidenceLayer] || 0) + 1;
    if (row.translationAction) {
      summary.byTranslationAction[row.translationAction] = (summary.byTranslationAction[row.translationAction] || 0) + 1;
    }
  }

  return summary;
}

export function renderGoldenMarkdown({ rows, generatedAt, apiBaseUrl, itemCount }) {
  const summary = summarizeRows(rows);
  const lines = [
    '# 信息中枢 V3 黄金样本验收矩阵',
    '',
    `- 生成时间：${generatedAt}`,
    `- API：${apiBaseUrl || 'fixture'}`,
    `- 输入条目数：${itemCount}`,
    `- 样本场景：${summary.total} 个，正常 ${summary.pass} 个，需复核 ${summary.review} 个，缺样本 ${summary.missing} 个，未启用 ${summary.skipped} 个`,
    '',
    '## 样本矩阵',
    '',
    '| 场景 | 状态 | 样本 | 来源 | 分数 | 内容依据 | 翻译动作 | 固定验收 | 验收重点 |',
    '| --- | --- | --- | --- | ---: | --- | --- | --- | --- |',
  ];

  for (const row of rows) {
    const title = row.feedUrl ? `[${escapeCell(row.title)}](${row.feedUrl})` : escapeCell(row.title);
    lines.push([
      escapeCell(row.scenario),
      statusLabel(row.status),
      title,
      escapeCell(row.sourceName || '-'),
      escapeCell(String(row.score || '-')),
      escapeCell(row.evidenceLabel || row.evidenceLayer || '-'),
      escapeCell(actionLabel(row.translationAction)),
      escapeCell(row.acceptanceChecks || '-'),
      escapeCell(row.issue || row.purpose),
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }

  lines.push(
    '',
    '## 本次自动诊断',
    '',
    ...buildMarkdownDiagnostics(rows).map((item) => `- ${item}`),
    '',
    '## 分层统计',
    '',
    '- 内容依据：' + inlineMap(summary.byLayer),
    '- 翻译动作：' + inlineMap(summary.byTranslationAction),
    '',
    '## 使用方式',
    '',
    '```bash',
    'node qa/p0/golden_sample_matrix.mjs \\',
    '  --api http://127.0.0.1:3001/api \\',
    '  --output docs/22-信息中枢V3黄金样本验收矩阵.md',
    '```',
    '',
    '默认会优先读取 `INFOHUB_TOKEN`，其次读取 `/private/tmp/infohub_login.json` 的 `accessToken`；验收重点：每次改 Feed 正文、翻译、日报候选、来源健康后，都刷新这份矩阵，确认黄金样本没有退化。',
    '',
  );

  return lines.join('\n');
}

export function buildMarkdownDiagnostics(rows) {
  const diagnostics = [];
  const missing = rows.filter((row) => row.status === 'missing').map((row) => row.scenario);
  const mapping = rows.filter((row) => row.issue.includes('来源映射异常'));
  const contentDebt = rows.filter((row) => row.issue.includes('正文不足'));
  const shallowBriefs = rows.filter((row) => row.issue.includes('浅阅读短讯'));

  if (missing.length > 0) {
    diagnostics.push(`黄金样本缺口：${missing.join('、')}，需要补对应来源或确认 API 字段是否已暴露。`);
  }
  if (mapping.length > 0) {
    diagnostics.push(`来源映射异常：${mapping.map((row) => `${row.sourceName} / ${row.title}`).join('；')}。`);
  }
  if (contentDebt.length > 0) {
    diagnostics.push(`正文债务：${contentDebt.length} 个样本只有片段/标题，必须先补正文再进入翻译和日报深读。`);
  }
  if (shallowBriefs.length > 0) {
    diagnostics.push(`浅阅读短讯：${shallowBriefs.length} 个样本只适合快扫或日报“更多动态”，不计入正文补抓债务。`);
  }
  if (diagnostics.length === 0) diagnostics.push('未发现阻塞级样本问题；继续做页面与日报体验验收。');
  return diagnostics;
}

function statusLabel(status) {
  if (status === 'pass') return '通过';
  if (status === 'review') return '需复核';
  if (status === 'skipped') return '未启用';
  return '缺样本';
}

function actionLabel(action) {
  return ({
    ready: '已有译文',
    translate: '一键翻译',
    fetch_then_translate: '补正文后翻译',
    retry_translation: '重试翻译',
    open_original: '打开原文',
    none: '无动作',
  }[action] || action || '-');
}

export function formatAcceptanceChecks(checks = []) {
  return checks.map((check) => CHECK_LABELS[check] || check).join('、');
}

function inlineMap(value) {
  const entries = Object.entries(value || {});
  if (entries.length === 0) return '无';
  return entries.map(([key, count]) => `${key} ${count}`).join('；');
}

function escapeCell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n+/g, ' ')
    .trim();
}

async function requestJson(url, options = {}) {
  const resp = await fetch(url, options);
  const text = await resp.text();
  const data = text ? JSON.parse(text) : {};
  if (!resp.ok) {
    throw new Error(`${options.method || 'GET'} ${url} -> ${resp.status}: ${data.error || data.message || text}`);
  }
  return data;
}

async function resolveToken(apiBaseUrl) {
  if (process.env.INFOHUB_TOKEN) return process.env.INFOHUB_TOKEN;
  const loginJsonToken = await resolveTokenFromLoginJson();
  if (loginJsonToken) return loginJsonToken;
  if (!process.env.INFOHUB_EMAIL || !process.env.INFOHUB_PASSWORD) return '';
  const login = await requestJson(`${apiBaseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: process.env.INFOHUB_EMAIL,
      password: process.env.INFOHUB_PASSWORD,
    }),
  });
  return login.accessToken || '';
}

export async function resolveTokenFromLoginJson(path = process.env.INFOHUB_LOGIN_JSON || '/private/tmp/infohub_login.json') {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8'));
    return typeof raw.accessToken === 'string' ? raw.accessToken.trim() : '';
  } catch {
    return '';
  }
}

export function resolveTokensFromEnv(env = process.env) {
  const values = [
    env.INFOHUB_TOKEN,
    env.INFOHUB_TOKENS,
  ].filter(Boolean);
  const seen = new Set();
  const tokens = [];
  for (const value of values) {
    for (const token of String(value).replace(/\\n/g, '\n').split(/[,\s]+/).map((item) => item.trim()).filter(Boolean)) {
      if (seen.has(token)) continue;
      seen.add(token);
      tokens.push(token);
    }
  }
  return tokens;
}

async function fetchItems(apiBaseUrl, limit) {
  const tokens = resolveTokensFromEnv();
  if (tokens.length === 0) {
    const loginToken = await resolveToken(apiBaseUrl);
    if (loginToken) tokens.push(loginToken);
  }

  const itemGroups = await Promise.all((tokens.length > 0 ? tokens : ['']).map(async (token) => {
    const headers = token ? { authorization: `Bearer ${token}` } : {};
    return fetchItemsForToken(apiBaseUrl, limit, headers);
  }));

  return dedupeItems(itemGroups.flat());
}

async function fetchItemsForToken(apiBaseUrl, limit, headers) {
  const data = await requestJson(`${apiBaseUrl}/items?limit=${limit}`, {
    headers,
  });
  const latest = data.items || data.data?.items || data.data || [];
  const sources = await fetchSources(apiBaseUrl, headers);
  const focusedSources = selectFocusedSources(sources);
  const focusedGroups = await Promise.all(focusedSources.map(async (source) => {
    const scoped = await requestJson(`${apiBaseUrl}/items?limit=30&sourceId=${encodeURIComponent(String(source.id))}`, {
      headers,
    });
    return scoped.items || scoped.data?.items || scoped.data || [];
  }));

  return dedupeItems([...latest, ...focusedGroups.flat()]);
}

async function fetchSources(apiBaseUrl, headers) {
  const data = await requestJson(`${apiBaseUrl}/sources?limit=1000`, {
    headers,
  });
  return data.sources || data.data?.sources || data.data || [];
}

export function selectFocusedSources(sources, keywords = DEFAULT_SOURCE_KEYWORDS) {
  return sources.filter((source) => {
    const haystack = `${source.name || ''} ${source.url || ''} ${source.feedUrl || ''} ${source.category || ''} ${source.sourceType || ''} ${source.collectorType || ''}`.toLowerCase();
    const sourceType = String(source.sourceType || '').toLowerCase();
    return keywords.some((keyword) => haystack.includes(keyword.toLowerCase()))
      || ['curated_index', 'webpage', 'email'].includes(sourceType);
  }).slice(0, 24);
}

export function dedupeItems(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = String(item.id || item.itemId || item.guid || item.url || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function parseArgs(argv) {
  const args = {
    apiBaseUrl: process.env.INFOHUB_API_URL || process.env.HUB_ENGINE_URL || 'http://127.0.0.1:3001/api',
    webBaseUrl: process.env.INFOHUB_WEB_URL || 'http://localhost',
    output: process.env.INFOHUB_GOLDEN_OUTPUT || 'docs/22-信息中枢V3黄金样本验收矩阵.md',
    fixture: '',
    limit: Number(process.env.INFOHUB_GOLDEN_LIMIT || 500),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--api') args.apiBaseUrl = argv[++i];
    else if (arg === '--web') args.webBaseUrl = argv[++i];
    else if (arg === '--output') args.output = argv[++i];
    else if (arg === '--fixture') args.fixture = argv[++i];
    else if (arg === '--limit') args.limit = Number(argv[++i]);
  }

  args.apiBaseUrl = args.apiBaseUrl.replace(/\/$/, '').endsWith('/api')
    ? args.apiBaseUrl.replace(/\/$/, '')
    : `${args.apiBaseUrl.replace(/\/$/, '')}/api`;
  return args;
}

async function loadFixture(path) {
  const raw = JSON.parse(await readFile(path, 'utf8'));
  return raw.items || raw.data?.items || raw.data || raw;
}

export async function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const items = args.fixture
    ? await loadFixture(args.fixture)
    : await fetchItems(args.apiBaseUrl, args.limit);
  const rows = selectGoldenRows(items, DEFAULT_SCENARIOS, { baseWebUrl: args.webBaseUrl });
  const markdown = renderGoldenMarkdown({
    rows,
    generatedAt: new Date().toISOString(),
    apiBaseUrl: args.fixture ? 'fixture' : args.apiBaseUrl,
    itemCount: items.length,
  });
  await writeFile(args.output, markdown, 'utf8');
  console.log(JSON.stringify({ output: args.output, summary: summarizeRows(rows) }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runCli().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
