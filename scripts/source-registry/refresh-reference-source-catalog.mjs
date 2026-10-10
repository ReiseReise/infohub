#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { writeReferenceSourceReviewCsv } from './build-reference-source-review.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT_PATH = path.join(ROOT, 'docs/source-registry/reference-source-catalog.json');

const QMREADER_API = 'https://rss.qiaomu.ai/api/sources';
const QMREADER_SOURCE_CONFIG = 'https://raw.githubusercontent.com/joeseesun/qmreader/main/lib/sources.js';
const FOLLOW_BUILDERS_CONFIG = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/config/default-sources.json';
const AIHOT_ITEMS_API = 'https://aihot.virxact.com/api/public/items';

const FETCH_HEADERS = {
  accept: 'application/json,text/plain,*/*',
  'user-agent': 'InfoHub-V3-Source-Registry/1.0',
};
const execFileAsync = promisify(execFile);

const RECOMMENDED_KEYS = new Set([
  'follow_builders:podcast:no-priors',
  'follow_builders:podcast:training-data',
  'follow_builders:blog:anthropic-engineering',
  'follow_builders:blog:claude-blog',
  'aihot:channel:selected',
  'origin12:ai-news',
  'origin12:the-batch',
  'origin12:research-radar',
  'origin12:model-reality',
  'origin12:semianalysis',
]);

const QMREADER_HIGH_VALUE_IDS = new Set([
  'interconnects',
  'paulgraham',
  'oneusefulthing',
  'simonwillison',
  'dwarkesh',
  'gwern',
  'geoffreylitt',
  'construction-physics',
  'antirez',
  'james-clear',
]);

const AIHOT_CHANNELS = [
  ['selected', 'AI HOT 精选雷达', 'https://aihot.virxact.com/feed.xml', '精选池'],
  ['all', 'AI HOT 公开全池', 'https://aihot.virxact.com/feed/all.xml', '公开全池'],
  ['daily', 'AI HOT 每日摘要', 'https://aihot.virxact.com/feed/daily.xml', '每日摘要'],
  ['ai-models', 'AI HOT 模型', 'https://aihot.virxact.com/feed/category/ai-models.xml', '模型'],
  ['ai-products', 'AI HOT 产品', 'https://aihot.virxact.com/feed/category/ai-products.xml', '产品'],
  ['industry', 'AI HOT 产业', 'https://aihot.virxact.com/feed/category/industry.xml', '产业'],
  ['paper', 'AI HOT 论文', 'https://aihot.virxact.com/feed/category/paper.xml', '论文'],
  ['tip', 'AI HOT 技巧', 'https://aihot.virxact.com/feed/category/tip.xml', '技巧'],
];

function origin12Entries(observedAt) {
  const shared = {
    provider: 'origin12',
    providerLabel: '源头信息员',
    feedUrl: null,
    feedCandidates: [],
    sourceTier: 'A',
    readingTier: 'high_value',
    recommended: true,
    defaultEnabled: false,
    importMode: 'adapter_required',
    providerEnabled: true,
    providerStatus: 'shadow_ready',
    observationStatus: 'current',
    firstObservedAt: observedAt,
    lastObservedAt: observedAt,
    provenance: {
      sourceUrl: 'https://news.smol.ai/',
      observedAt,
      attributionRequired: true,
    },
  };
  return [
    {
      ...shared,
      key: 'origin12:ai-news',
      name: 'AI News 雷达',
      providerSourceId: 'ai-news',
      channel: 'radar',
      siteUrl: 'https://news.smol.ai/',
      category: 'AI Radar',
      sourceKind: 'media',
      refreshMinutes: 360,
      logicalSites: [{ name: 'AI News', url: 'https://news.smol.ai/', required: true }],
      description: '工作日 AI 社区雷达，每期一条，只作发现线索。',
      notes: '索引/发现材料，不替代公告、论文或开发者原帖。',
    },
    {
      ...shared,
      key: 'origin12:the-batch',
      name: 'The Batch 周报',
      providerSourceId: 'the-batch',
      channel: 'weekly',
      siteUrl: 'https://www.deeplearning.ai/the-batch/',
      category: 'AI Analysis',
      sourceKind: 'media',
      refreshMinutes: 720,
      logicalSites: [{ name: 'The Batch', url: 'https://www.deeplearning.ai/the-batch/', required: true }],
      description: 'DeepLearning.AI 每周简报，每期一条并保留原始链接。',
      notes: '编辑分析材料，不冒充被引用的原始证据。',
      provenance: { ...shared.provenance, sourceUrl: 'https://www.deeplearning.ai/the-batch/' },
    },
    {
      ...shared,
      key: 'origin12:research-radar',
      name: '论文雷达',
      providerSourceId: 'research-radar',
      channel: 'research_radar',
      siteUrl: 'https://huggingface.co/papers',
      category: 'AI Research',
      sourceKind: 'research',
      refreshMinutes: 360,
      logicalSites: [
        { name: 'Hugging Face Papers', url: 'https://huggingface.co/papers', required: true },
        { name: 'alphaXiv', url: 'https://alphaxiv.org/', required: true },
        { name: 'arXiv', url: 'https://arxiv.org/', required: true },
      ],
      description: '合并社区筛选结果，并以 arXiv ID、摘要和版本作为原始证据。',
      notes: '不灌入完整 cs.AI 列表、不下载 PDF；摘要明确标记为非全文。',
      provenance: { ...shared.provenance, sourceUrl: 'https://huggingface.co/papers' },
    },
    {
      ...shared,
      key: 'origin12:model-reality',
      name: '模型现实监测',
      providerSourceId: 'model-reality',
      channel: 'model_reality',
      siteUrl: 'https://arena.ai/leaderboard/text/english',
      category: 'AI Models',
      sourceKind: 'benchmark',
      refreshMinutes: 1440,
      logicalSites: [
        { name: 'Arena', url: 'https://arena.ai/leaderboard/text/english', required: true },
        { name: 'Artificial Analysis', url: 'https://artificialanalysis.ai/leaderboards/models', required: true },
        { name: 'OpenRouter', url: 'https://openrouter.ai/rankings', required: true },
      ],
      description: '联合用户偏好、独立评测与公开 most-popular 排序，只报告显著变化。',
      notes: '不使用需 Key 的精确日用量数据集；首次只建立基线。',
      provenance: { ...shared.provenance, sourceUrl: 'https://arena.ai/leaderboard/text/english' },
    },
    {
      ...shared,
      key: 'origin12:semianalysis',
      name: 'SemiAnalysis',
      providerSourceId: 'semianalysis',
      channel: 'infrastructure',
      siteUrl: 'https://semianalysis.com/',
      category: 'AI Infrastructure',
      sourceKind: 'analysis',
      refreshMinutes: 720,
      logicalSites: [{ name: 'SemiAnalysis', url: 'https://semianalysis.com/', required: true }],
      description: '芯片、网络、电力和数据中心等 AI 上游产业分析。',
      notes: '只保留公开标题、链接和摘要，绝不绕过付费墙。',
      provenance: { ...shared.provenance, sourceUrl: 'https://semianalysis.com/' },
    },
  ];
}

function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'source';
}

async function fetchText(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: FETCH_HEADERS,
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`${url} returned ${response.status}`);
      return response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }

  try {
    const { stdout } = await execFileAsync('curl', ['-fsSL', '-A', FETCH_HEADERS['user-agent'], url], {
      maxBuffer: 25 * 1024 * 1024,
      timeout: 60_000,
    });
    return stdout;
  } catch (curlError) {
    throw new AggregateError([lastError, curlError], `Unable to fetch ${url}`);
  }
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

function extractObjectBlocks(sourceText, declaration = 'const SOURCES = [') {
  const declarationIndex = sourceText.indexOf(declaration);
  if (declarationIndex < 0) return [];
  const arrayStart = sourceText.indexOf('[', declarationIndex);
  if (arrayStart < 0) return [];

  const blocks = [];
  let objectStart = -1;
  let objectDepth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = arrayStart + 1; index < sourceText.length; index += 1) {
    const char = sourceText[index];
    const next = sourceText[index + 1];

    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') {
      if (objectDepth === 0) objectStart = index;
      objectDepth += 1;
      continue;
    }
    if (char === '}') {
      objectDepth -= 1;
      if (objectDepth === 0 && objectStart >= 0) {
        blocks.push(sourceText.slice(objectStart, index + 1));
        objectStart = -1;
      }
      continue;
    }
    if (char === ']' && objectDepth === 0) break;
  }
  return blocks;
}

function stringProperty(block, property) {
  const match = block.match(new RegExp(`\\b${property}\\s*:\\s*(['\"])([\\s\\S]*?)\\1`));
  return match?.[2]?.replace(/\\(['"\\])/g, '$1').trim() || '';
}

function booleanProperty(block, property, fallback = false) {
  const match = block.match(new RegExp(`\\b${property}\\s*:\\s*(true|false)`));
  return match ? match[1] === 'true' : fallback;
}

function stringArrayProperty(block, property) {
  const match = block.match(new RegExp(`\\b${property}\\s*:\\s*\\[([\\s\\S]*?)\\]`));
  if (!match) return [];
  return Array.from(match[1].matchAll(/(['"])(.*?)\1/g))
    .map((entry) => entry[2].replace(/\\(['"\\])/g, '$1').trim())
    .filter(Boolean);
}

function parseQmreaderSourceConfig(sourceText) {
  return extractObjectBlocks(sourceText).map((block) => ({
    id: stringProperty(block, 'id'),
    name: stringProperty(block, 'name'),
    category: stringProperty(block, 'category'),
    siteUrl: stringProperty(block, 'siteUrl'),
    description: stringProperty(block, 'description'),
    note: stringProperty(block, 'note'),
    enabled: booleanProperty(block, 'enabled', true),
    manual: booleanProperty(block, 'manual', false),
    feeds: stringArrayProperty(block, 'feeds'),
  })).filter((source) => source.id && source.name);
}

function directFeedUrl(candidates) {
  return candidates.find((candidate) => (
    /^https?:\/\//i.test(candidate)
    && !candidate.includes('{rsshub}')
    && !candidate.startsWith('sitemap:')
    && !candidate.startsWith('wpjson:')
  )) || null;
}

function qmreaderSourceEntry(source, live, observedAt) {
  const category = live?.category || source.category || 'article';
  const providerEnabled = live?.enabled ?? source.enabled;
  const feedUrl = directFeedUrl(source.feeds);
  const highValue = QMREADER_HIGH_VALUE_IDS.has(source.id);
  const key = `qmreader:${source.id}`;
  const channel = category === 'podcast' ? 'podcast' : category === 'news' ? 'news' : 'blog';
  const adapterRequired = source.manual || !feedUrl;

  return {
    key,
    name: live?.name || source.name,
    provider: 'qmreader',
    providerLabel: 'QMReader',
    providerSourceId: source.id,
    channel,
    feedUrl,
    feedCandidates: source.feeds,
    siteUrl: live?.siteUrl || source.siteUrl || null,
    category: category === 'podcast' ? 'AI Podcast' : category === 'news' ? 'AI News' : 'AI',
    sourceKind: category === 'podcast' ? 'podcast' : category === 'news' ? 'media' : 'blog',
    sourceTier: highValue ? 'A' : providerEnabled ? 'B' : 'C',
    readingTier: highValue ? 'high_value' : providerEnabled ? 'light_reading' : 'explore',
    recommended: RECOMMENDED_KEYS.has(key),
    defaultEnabled: false,
    importMode: adapterRequired ? 'adapter_required' : category === 'podcast' ? 'podcast' : 'rss',
    providerEnabled: Boolean(providerEnabled),
    providerStatus: live?.status || (providerEnabled ? 'unknown' : 'disabled'),
    description: live?.description || source.description || '',
    notes: live?.note || source.note || (adapterRequired ? '已记录，需专用采集适配后才能导入。' : ''),
    provenance: {
      sourceUrl: QMREADER_SOURCE_CONFIG,
      observedAt,
      license: 'MIT',
    },
  };
}

export function followBuildersXSelectedEntry(observedAt) {
  return {
    key: 'follow_builders:feed:x-selected', name: 'Follow Builders X 精选',
    provider: 'follow_builders', providerLabel: 'Follow Builders', providerSourceId: 'x-selected',
    channel: 'x', sourceKind: 'x', sourceTier: 'B', readingTier: 'explore', category: 'AI Social',
    feedUrl: 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-x.json',
    feedCandidates: [], siteUrl: 'https://github.com/zarazhangrui/follow-builders',
    recommended: false, defaultEnabled: false, importMode: 'adapter_required',
    providerEnabled: true, providerStatus: 'adapter_ready', observationStatus: 'current',
    firstObservedAt: observedAt, lastObservedAt: observedAt,
    description: '固定 5 个账号的公开帖文：karpathy、swyx、bcherny、trq212、steipete。',
    notes: '每 6 小时检查每日公开快照；超过 48 小时拒收；过滤短闲聊及缺引用上下文，保留原文归因。不代表完整时间线或事实核验。',
    provenance: {
      sourceUrl: 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-x.json',
      observedAt, attributionRequired: true,
      license: 'README states MIT; public posts retain original author attribution',
    },
  };
}

function followBuildersEntries(config, observedAt) {
  const podcastEntries = (config.podcasts || []).map((source) => {
    const key = `follow_builders:podcast:${slugify(source.name)}`;
    return {
      key,
      name: source.name,
      provider: 'follow_builders',
      providerLabel: 'Follow Builders',
      providerSourceId: slugify(source.name),
      channel: 'podcast',
      feedUrl: source.rssUrl || null,
      feedCandidates: source.rssUrl ? [source.rssUrl] : [],
      siteUrl: source.url || null,
      category: 'AI Podcast',
      sourceKind: 'podcast',
      sourceTier: ['No Priors', 'Training Data', 'Latent Space'].includes(source.name) ? 'A' : 'B',
      readingTier: ['No Priors', 'Training Data', 'Latent Space'].includes(source.name) ? 'high_value' : 'light_reading',
      recommended: RECOMMENDED_KEYS.has(key),
      defaultEnabled: false,
      importMode: source.rssUrl ? 'podcast' : 'adapter_required',
      providerEnabled: true,
      providerStatus: 'configured',
      description: '长访谈和播客转写候选源。',
      notes: source.name === 'Latent Space' ? '当前系统已有同名来源，导入时会自动去重。' : '',
      provenance: {
        sourceUrl: FOLLOW_BUILDERS_CONFIG,
        observedAt,
        license: 'README states MIT; repository license file should be rechecked before copying code',
      },
    };
  });

  const blogEntries = (config.blogs || []).map((source) => {
    const key = `follow_builders:blog:${slugify(source.name)}`;
    return {
      key,
      name: source.name,
      provider: 'follow_builders',
      providerLabel: 'Follow Builders',
      providerSourceId: slugify(source.name),
      channel: 'webpage_index',
      feedUrl: null,
      feedCandidates: [],
      siteUrl: source.indexUrl || null,
      category: 'AI',
      sourceKind: 'official',
      sourceTier: 'S',
      readingTier: 'high_value',
      recommended: RECOMMENDED_KEYS.has(key),
      defaultEnabled: false,
      importMode: 'adapter_required',
      providerEnabled: true,
      providerStatus: 'configured',
      description: '官方技术文章索引。',
      notes: '需专用索引解析器，不使用通用网页快照冒充单篇文章。',
      provenance: {
        sourceUrl: FOLLOW_BUILDERS_CONFIG,
        observedAt,
        license: 'README states MIT; repository license file should be rechecked before copying code',
      },
    };
  });

  const xEntries = (config.x_accounts || []).map((source) => ({
    key: `follow_builders:x:${String(source.handle || '').toLowerCase()}`,
    name: source.name,
    provider: 'follow_builders',
    providerLabel: 'Follow Builders',
    providerSourceId: String(source.handle || '').toLowerCase(),
    channel: 'x',
    feedUrl: null,
    feedCandidates: [],
    siteUrl: source.handle ? `https://x.com/${source.handle}` : null,
    category: 'AI Social',
    sourceKind: 'x',
    sourceTier: 'B',
    readingTier: 'explore',
    recommended: false,
    defaultEnabled: false,
    importMode: 'adapter_required',
    providerEnabled: true,
    providerStatus: 'configured',
    description: 'X 账号信号，默认不进入 RSS 主链路。',
    notes: '容易引入离题、重复与上下文缺失，等待独立社媒适配器。',
    provenance: {
      sourceUrl: FOLLOW_BUILDERS_CONFIG,
      observedAt,
      license: 'README states MIT; repository license file should be rechecked before copying code',
    },
  }));

  return [...podcastEntries, ...blogEntries, ...xEntries, followBuildersXSelectedEntry(observedAt)];
}

function inferAihotChannel(name) {
  if (name.startsWith('X：')) return 'x';
  if (name.startsWith('公众号：')) return 'wechat';
  if (/RSS/i.test(name)) return 'rss_observed';
  if (/Hacker News/i.test(name)) return 'community';
  return 'media_observed';
}

async function fetchAihotSources() {
  const labels = new Map();
  let cursor = '';
  let itemCount = 0;
  let pageCount = 0;

  do {
    const url = new URL(AIHOT_ITEMS_API);
    url.searchParams.set('mode', 'all');
    url.searchParams.set('take', '100');
    if (cursor) url.searchParams.set('cursor', cursor);
    const payload = await fetchJson(url);
    for (const item of payload.items || []) {
      const source = String(item.source || '').trim();
      if (source) labels.set(source, (labels.get(source) || 0) + 1);
    }
    itemCount += Number(payload.items?.length || 0);
    cursor = payload.hasNext && payload.nextCursor ? String(payload.nextCursor) : '';
    pageCount += 1;
    if (pageCount > 100) throw new Error('AI HOT pagination exceeded safety limit');
  } while (cursor);

  return { labels, itemCount, pageCount };
}

function aihotEntries(snapshot, observedAt) {
  const channels = AIHOT_CHANNELS.map(([id, name, feedUrl, description]) => {
    const key = `aihot:channel:${id}`;
    return {
      key,
      name,
      provider: 'aihot',
      providerLabel: 'AI HOT',
      providerSourceId: id,
      channel: 'radar_feed',
      feedUrl,
      feedCandidates: [feedUrl],
      siteUrl: 'https://aihot.virxact.com/',
      category: 'AI Radar',
      sourceKind: 'media',
      sourceTier: id === 'selected' ? 'A' : 'B',
      readingTier: id === 'selected' ? 'light_reading' : 'explore',
      recommended: RECOMMENDED_KEYS.has(key),
      defaultEnabled: false,
      importMode: 'adapter_required',
      providerEnabled: true,
      providerStatus: 'public_feed',
      description: `${description}，保留 AI HOT 归因和 canonical 链接。`,
      notes: '需先接入雷达适配器，避免将聚合页当作原始文章。',
      provenance: {
        sourceUrl: 'https://aihot.virxact.com/agent',
        observedAt,
        attributionRequired: true,
      },
    };
  });

  const observed = Array.from(snapshot.labels.entries())
    .sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
    .map(([name, observedItemCount]) => ({
      key: `aihot:observed:${slugify(name)}`,
      name,
      provider: 'aihot',
      providerLabel: 'AI HOT',
      providerSourceId: slugify(name),
      channel: inferAihotChannel(name),
      feedUrl: null,
      feedCandidates: [],
      siteUrl: null,
      category: 'AI Radar Source',
      sourceKind: inferAihotChannel(name) === 'x' ? 'x' : inferAihotChannel(name) === 'wechat' ? 'wechat' : 'media',
      sourceTier: 'B',
      readingTier: 'explore',
      recommended: false,
      defaultEnabled: false,
      importMode: 'reference_only',
      providerEnabled: true,
      providerStatus: 'observed',
      description: `AI HOT 公开全池近期观测来源，当前样本 ${observedItemCount} 条。`,
      notes: '只记录来源名；AI HOT 未公开该单源的独立订阅地址。',
      provenance: {
        sourceUrl: `${AIHOT_ITEMS_API}?mode=all`,
        observedAt,
        attributionRequired: true,
      },
    }));

  return [...channels, ...observed];
}

function historicalNote(notes) {
  const current = String(notes || '').trim();
  const suffix = '本轮刷新未观测到，保留为历史候选证据。';
  if (!current) return suffix;
  return current.includes(suffix) ? current : `${current} ${suffix}`;
}

export function mergeCatalogHistory(sources, existingSources, observedAt) {
  const existingByKey = new Map((existingSources || []).map((source) => [source.key, source]));
  const current = sources.map((source) => {
    const previous = existingByKey.get(source.key);
    if (!previous) {
      return {
        ...source,
        observationStatus: 'current',
        firstObservedAt: observedAt,
        lastObservedAt: observedAt,
      };
    }
    return {
      ...source,
      sourceTier: previous.sourceTier || source.sourceTier,
      readingTier: previous.readingTier || source.readingTier,
      recommended: typeof previous.recommended === 'boolean' ? previous.recommended : source.recommended,
      notes: previous.manualNotes || source.notes,
      manualNotes: previous.manualNotes || undefined,
      observationStatus: 'current',
      firstObservedAt: previous.firstObservedAt || previous.provenance?.observedAt || observedAt,
      lastObservedAt: observedAt,
    };
  });

  const currentKeys = new Set(current.map((source) => source.key));
  const historical = (existingSources || [])
    .filter((source) => source?.key && !currentKeys.has(source.key))
    .map((source) => ({
      ...source,
      defaultEnabled: false,
      providerEnabled: false,
      providerStatus: 'historical',
      observationStatus: 'historical',
      firstObservedAt: source.firstObservedAt || source.provenance?.observedAt || observedAt,
      lastObservedAt: source.lastObservedAt || source.provenance?.observedAt || observedAt,
      notes: source.manualNotes || historicalNote(source.notes),
    }));

  return [...current, ...historical];
}

async function main() {
  const observedAt = new Date().toISOString();
  let existingCatalog = null;
  try {
    existingCatalog = JSON.parse(await readFile(OUTPUT_PATH, 'utf8'));
  } catch {
    // First snapshot.
  }
  if (process.argv.includes('--origin12-only')) {
    const sources = [
      ...((existingCatalog?.sources || []).filter((source) => source.provider !== 'origin12')),
      ...origin12Entries(observedAt),
    ].sort((left, right) => left.provider.localeCompare(right.provider) || left.name.localeCompare(right.name, 'zh-CN'));
    const byProvider = sources.reduce((summary, source) => {
      summary[source.provider] = (summary[source.provider] || 0) + 1;
      return summary;
    }, {});
    const catalog = {
      ...(existingCatalog || {}),
      version: Number(existingCatalog?.version || 1),
      updatedAt: observedAt,
      stats: {
        ...(existingCatalog?.stats || {}),
        total: sources.length,
        byProvider,
        recommended: sources.filter((source) => source.recommended).length,
        current: sources.filter((source) => source.observationStatus !== 'historical').length,
        historical: sources.filter((source) => source.observationStatus === 'historical').length,
      },
      sources,
    };
    await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
    const review = await writeReferenceSourceReviewCsv({ catalogPath: OUTPUT_PATH });
    console.log(JSON.stringify({ output: OUTPUT_PATH, reviewOutput: review.output, ...catalog.stats }, null, 2));
    return;
  }
  const [qmreaderPayload, qmreaderSourceText, followBuildersConfig, aihotSnapshot] = await Promise.all([
    fetchJson(QMREADER_API),
    fetchText(QMREADER_SOURCE_CONFIG),
    fetchJson(FOLLOW_BUILDERS_CONFIG),
    fetchAihotSources(),
  ]);

  const existingSources = existingCatalog?.sources || [];

  const liveQmreaderById = new Map((qmreaderPayload.sources || []).map((source) => [source.id, source]));
  const qmreaderSources = parseQmreaderSourceConfig(qmreaderSourceText)
    .map((source) => qmreaderSourceEntry(source, liveQmreaderById.get(source.id), observedAt));
  const followSources = followBuildersEntries(followBuildersConfig, observedAt);
  const radarSources = aihotEntries(aihotSnapshot, observedAt);
  const sources = mergeCatalogHistory([...qmreaderSources, ...followSources, ...radarSources, ...origin12Entries(observedAt)], existingSources, observedAt)
    .sort((left, right) => left.provider.localeCompare(right.provider) || left.name.localeCompare(right.name, 'zh-CN'));

  const byProvider = sources.reduce((summary, source) => {
    summary[source.provider] = (summary[source.provider] || 0) + 1;
    return summary;
  }, {});
  const catalog = {
    version: 1,
    updatedAt: observedAt,
    description: '外部参考站的候选信源目录。所有条目默认不启用，只在用户明确选择后进入运行库。',
    sourcePolicy: {
      defaultEnabled: false,
      maxImportPerRequest: 5,
      notes: '单个 X 账号、微信公众号及未适配来源只记录；Follow Builders X 精选使用固定公开数据适配器。',
    },
    stats: {
      total: sources.length,
      byProvider,
      importable: sources.filter((source) => source.importMode === 'rss' || source.importMode === 'podcast').length,
      recommended: sources.filter((source) => source.recommended).length,
      current: sources.filter((source) => source.observationStatus !== 'historical').length,
      historical: sources.filter((source) => source.observationStatus === 'historical').length,
      aihotObservedItems: aihotSnapshot.itemCount,
      aihotObservedPages: aihotSnapshot.pageCount,
    },
    sources,
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  const review = await writeReferenceSourceReviewCsv({ catalogPath: OUTPUT_PATH });
  console.log(JSON.stringify({ output: OUTPUT_PATH, reviewOutput: review.output, ...catalog.stats }, null, 2));
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
