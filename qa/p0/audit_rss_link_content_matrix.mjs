#!/usr/bin/env node
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '../..');
const SERVICE_ROOT = path.join(REPO_ROOT, 'services/hub-engine');
const serviceRequire = createRequire(path.join(SERVICE_ROOT, 'package.json'));
const jwt = serviceRequire('jsonwebtoken');
const postgres = serviceRequire('postgres');

const DEFAULT_API = process.env.INFOHUB_API_BASE || 'http://127.0.0.1:3001/api';
const DEFAULT_APP = process.env.INFOHUB_APP_BASE || 'http://localhost';
const RAW_ENUM_PATTERN = /\b(?:translation_truncated_or_empty|content_unavailable|summary_must_be_chinese|content_fetch_failed|skipped|uncategorized)\b/i;
const HTML_TAG_PATTERN = /<\/?(?:p|ul|ol|li|blockquote|pre|code|h[1-6]|a|div|span)\b[^>]*>/i;
const MALFORMED_MARKER_PATTERN = /```#|\/-\s*!|<li>|<\/li>/i;
const NAKED_URL_PATTERN = /(^|\s)https?:\/\/[^\s)）\]>]+/i;

function parseArgs(argv) {
  const args = {
    apiBase: DEFAULT_API,
    appBase: DEFAULT_APP,
    userEmail: process.env.INFOHUB_AUDIT_EMAIL || 'acceptance.admin@infohub.local',
    maxItems: Number.POSITIVE_INFINITY,
    detailLimit: 180,
    sourceStatus: 'all',
    outputDir: path.join(REPO_ROOT, 'qa/reports'),
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--api' && next) args.apiBase = next, i += 1;
    else if (arg === '--app' && next) args.appBase = next, i += 1;
    else if (arg === '--user-email' && next) args.userEmail = next, i += 1;
    else if (arg === '--max-items' && next) {
      args.maxItems = next === 'all' ? Number.POSITIVE_INFINITY : Math.max(1, Number(next) || 1);
      i += 1;
    } else if (arg === '--detail-limit' && next) {
      args.detailLimit = Math.max(0, Number(next) || 0);
      i += 1;
    } else if (arg === '--source-status' && next) {
      args.sourceStatus = next;
      i += 1;
    } else if (arg === '--output-dir' && next) {
      args.outputDir = path.resolve(next);
      i += 1;
    } else if (arg === '--help') {
      console.log(`Usage:
  node qa/p0/audit_rss_link_content_matrix.mjs [options]

Options:
  --api <url>              API base, default ${DEFAULT_API}
  --app <url>              App base for display URLs, default ${DEFAULT_APP}
  --user-email <email>     Local user to sign token for when no token is provided
  --max-items <n|all>      Max visible feed items to audit, default all
  --detail-limit <n>       Max high-risk item details to fetch, default 180
  --source-status <status> Source status filter for /sources, default all
  --output-dir <path>      Report output directory, default qa/reports

Auth:
  Prefers INFOHUB_TOKEN, then /private/tmp/infohub_login.json, then local JWT signing.
`);
      process.exit(0);
    }
  }
  args.apiBase = args.apiBase.replace(/\/$/, '');
  args.appBase = args.appBase.replace(/\/$/, '');
  return args;
}

function parseDotenv(raw) {
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? env[name] ?? '');
  }
  return env;
}

async function loadLocalEnv() {
  const candidates = [
    path.join(REPO_ROOT, '.env'),
    path.join(SERVICE_ROOT, '.env'),
  ];
  const merged = {};
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    Object.assign(merged, parseDotenv(await readFile(file, 'utf8')));
  }
  return { ...merged, ...process.env };
}

async function requestJson(url, token, options = {}) {
  const resp = await fetch(url, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await resp.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!resp.ok) {
    const message = data.error || data.message || data.detail || text || resp.statusText;
    throw new Error(`${options.method || 'GET'} ${url} -> ${resp.status}: ${message}`);
  }
  return data;
}

async function resolveToken(apiBase, userEmail) {
  if (process.env.INFOHUB_TOKEN) return process.env.INFOHUB_TOKEN.trim();
  const loginJson = process.env.INFOHUB_LOGIN_JSON || '/private/tmp/infohub_login.json';
  try {
    const raw = JSON.parse(await readFile(loginJson, 'utf8'));
    if (typeof raw.accessToken === 'string' && raw.accessToken.trim()) return raw.accessToken.trim();
  } catch {
    // fall through
  }
  if (process.env.INFOHUB_EMAIL && process.env.INFOHUB_PASSWORD) {
    const login = await requestJson(`${apiBase}/auth/login`, '', {
      method: 'POST',
      body: JSON.stringify({ email: process.env.INFOHUB_EMAIL, password: process.env.INFOHUB_PASSWORD }),
    });
    if (login.accessToken) return login.accessToken;
  }

  const env = await loadLocalEnv();
  const databaseUrl = env.DATABASE_URL || 'postgres://postgres:infohub_dev_2026@localhost:5432/infohub';
  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret) throw new Error('Cannot sign local audit token: JWT_SECRET is missing.');
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const rows = await sql`
      select id, email, username, role
      from auth.users
      where email = ${userEmail}
      limit 1
    `;
    if (rows.length === 0) throw new Error(`Local user not found: ${userEmail}`);
    const user = rows[0];
    return jwt.sign(
      { sub: user.id, email: user.email, username: user.username, role: user.role || 'user' },
      jwtSecret,
      { expiresIn: env.JWT_EXPIRES_IN || '7d' },
    );
  } finally {
    await sql.end({ timeout: 1 });
  }
}

function safeUrl(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function hostOf(value) {
  const url = safeUrl(value);
  return url ? url.hostname.replace(/^www\./, '') : '';
}

function sourceFeedUrl(source) {
  const config = source.config && typeof source.config === 'object' ? source.config : {};
  return source.url || config.url || config.feedUrl || config.endpoint || config.htmlUrl || '';
}

function addIssue(issues, severity, type, message, context = {}) {
  issues.push({ severity, type, message, ...context });
}

function auditSource(source) {
  const issues = [];
  const feedUrl = sourceFeedUrl(source);
  const collector = String(source.collectorType || '');
  const sourceType = String(source.sourceType || '');
  const sourceName = source.name || `source#${source.id}`;
  const url = safeUrl(feedUrl);
  const isFeedLike = ['rss', 'rsshub', 'youtube'].includes(collector) || ['rss', 'podcast'].includes(sourceType);

  if (isFeedLike && !feedUrl) {
    addIssue(issues, 'high', 'source.feed_url_missing', `${sourceName} 是 RSS/Feed 类来源，但没有可审计的 feed URL`, { sourceId: source.id });
  } else if (feedUrl && !url && !String(feedUrl).startsWith('/')) {
    addIssue(issues, 'high', 'source.feed_url_invalid', `${sourceName} 的 feed URL 无法解析`, { sourceId: source.id, feedUrl });
  }

  if (source.status && !['active', 'paused'].includes(String(source.status))) {
    addIssue(issues, 'medium', 'source.status_unusual', `${sourceName} 状态不是 active/paused`, { sourceId: source.id, status: source.status });
  }
  if (source.lastOutcome === 'error' || source.freshnessState === 'error') {
    addIssue(issues, 'high', 'source.fetch_error', `${sourceName} 最近抓取异常`, {
      sourceId: source.id,
      lastError: source.lastError || source.errorMessage || source.blockedReason || null,
    });
  }
  if ((source.itemCount || 0) > 0 && (source.contentReadyCount || 0) === 0 && (source.contentDegradedCount || 0) === 0) {
    addIssue(issues, 'medium', 'source.no_readable_items', `${sourceName} 有条目但没有可读正文/摘要`, {
      sourceId: source.id,
      itemCount: source.itemCount || 0,
    });
  }
  return { feedUrl, issues };
}

function isExpectedBestBlogsCuratedSummaryWithoutOriginalUrl(item, primaryLayer, readiness) {
  const url = safeUrl(item.url || '');
  if (!url || !url.hostname.endsWith('bestblogs.dev')) return false;
  if (!/^\/(?:video|podcast|status)\//.test(url.pathname)) return false;
  if (item.originalUrl) return false;
  if (primaryLayer !== 'curatedSummary') return false;
  if (readiness.fullTextAvailable === true) return false;
  if (item.translationAction && item.translationAction !== 'open_original') return false;
  return true;
}

function isExpectedExternalLinkSummary(item, primaryLayer, readiness) {
  return primaryLayer === 'externalLinkSummary'
    || readiness.kind === 'external_link_summary'
    || /外链摘要/.test(String(readiness.label || ''));
}

export function auditItemListRecord(item, source, appBase) {
  const issues = [];
  const title = item.title || `item#${item.id}`;
  const itemUrl = item.url || '';
  const originalUrl = item.originalUrl || '';
  const sourceType = String(item.sourceType || source?.sourceType || '');
  const collector = String(item.sourceCollectorType || source?.collectorType || '');
  const readiness = item.contentReadiness || {};
  const evidence = item.contentEvidence || {};
  const primaryLayer = evidence.primaryLayer || readiness.kind || '';
  const displayUrl = `${appBase}/feed/${encodeURIComponent(item.id)}${item.sourceId ? `?sourceId=${item.sourceId}` : ''}`;

  if (!item.sourceId) {
    addIssue(issues, 'high', 'item.source_id_missing', '条目没有 sourceId，无法追溯来源', { itemId: item.id, title });
  } else if (!source) {
    addIssue(issues, 'high', 'item.source_not_found', '条目 sourceId 找不到对应来源', { itemId: item.id, sourceId: item.sourceId, title });
  }

  if (!itemUrl) {
    addIssue(issues, 'high', 'item.url_missing', '条目没有 URL，无法打开原文', { itemId: item.id, title });
  } else if (!safeUrl(itemUrl) && !itemUrl.startsWith('email://')) {
    addIssue(issues, 'high', 'item.url_invalid', '条目 URL 不是可识别链接', { itemId: item.id, title, itemUrl });
  }

  const indexLike = ['curated_index', 'webpage_index'].includes(sourceType) || ['webpage_index'].includes(collector);
  const expectedCuratedSummaryOnly = isExpectedBestBlogsCuratedSummaryWithoutOriginalUrl(item, primaryLayer, readiness);
  if (indexLike && !originalUrl && !expectedCuratedSummaryOnly) {
    addIssue(issues, 'medium', 'item.original_url_missing_for_index', '索引/榜单条目没有 originalUrl，只能展示索引摘要，不能当全文', {
      itemId: item.id,
      sourceId: item.sourceId,
      title,
    });
    addIssue(issues, 'medium', 'display.index_metadata_reader_noise', '索引/榜单条目缺原站链接时，阅读区容易暴露榜单 URL/元数据，应收进来源信息栏', {
      itemId: item.id,
      sourceId: item.sourceId,
      title,
    });
  }

  const readinessLabel = `${readiness.label || ''} ${readiness.status || ''} ${readiness.kind || ''}`;
  const claimsFullText = readiness.fullTextAvailable === true || /全文可读|full/i.test(readinessLabel);
  const weakLayer = ['title', 'snippet', 'curated_summary', 'index_summary', 'snapshot_text'].includes(String(primaryLayer));
  if (claimsFullText && weakLayer) {
    addIssue(issues, 'high', 'content.full_text_mislabel', '内容状态声称全文可读，但证据层不是正文', {
      itemId: item.id,
      title,
      primaryLayer,
      readiness: readiness.label || readiness.status || null,
    });
  }

  if (readiness.originalTextStatus === 'missing_original_url' && originalUrl) {
    addIssue(issues, 'medium', 'content.original_status_conflict', '条目有 originalUrl，但正文状态仍说缺原文链接', {
      itemId: item.id,
      title,
      originalUrl,
    });
  }

  const translationAction = item.translationAction || '';
  if ((item.translationStatus === 'failed' || /failed|truncated|empty/i.test(String(item.translationReason || ''))) && translationAction === 'none') {
    addIssue(issues, 'medium', 'translation.no_recovery_action', '翻译失败或不完整，但前端动作被判为 none', {
      itemId: item.id,
      title,
      translationStatus: item.translationStatus || null,
      translationReason: item.translationReason || null,
    });
  }

  const sourceHost = hostOf(sourceFeedUrl(source || {}));
  const itemHost = hostOf(originalUrl || itemUrl);
  if (
    sourceHost
    && itemHost
    && sourceType === 'rss'
    && itemHost !== sourceHost
    && !itemHost.endsWith(sourceHost)
    && !sourceHost.endsWith(itemHost)
    && !isExpectedExternalLinkSummary(item, primaryLayer, readiness)
  ) {
    addIssue(issues, 'low', 'item.host_differs_from_source', 'RSS 条目 host 与来源 host 不一致，需要确认是否为正常转载/跳转', {
      itemId: item.id,
      title,
      sourceHost,
      itemHost,
    });
  }

  return {
    itemId: item.id,
    title,
    sourceId: item.sourceId || null,
    sourceName: item.sourceName || source?.name || null,
    sourceType,
    collectorType: collector,
    itemUrl,
    originalUrl,
    displayUrl,
    primaryLayer,
    contentReadiness: readiness.label || readiness.status || null,
    translationAction: translationAction || null,
    translationStatus: item.translationStatus || null,
    issues,
  };
}

export function auditItemDetail(item) {
  const issues = [];
  const title = item.title || `item#${item.id}`;
  const content = String(item.content || item.readabilityContent || '');
  const summary = String(item.aiSummary || '');
  const translation = String(item.aiTranslation || '');
  const textForRawCheck = `${summary}\n${translation}\n${item.summaryReason || ''}\n${item.translationReason || ''}`;
  const evidence = item.contentEvidence || {};
  const readiness = item.contentReadiness || {};
  const primaryLayer = evidence.primaryLayer || readiness.kind || '';
  const isConvertibleSourceHtml = ['externalLinkSummary', 'rawFeedHtml'].includes(String(primaryLayer))
    || ['external_link_summary', 'rss_summary'].includes(String(readiness.kind || ''));

  if (content && content.length > 500 && HTML_TAG_PATTERN.test(content) && !String(item.renderMode || '').includes('html') && !isConvertibleSourceHtml) {
    addIssue(issues, 'medium', 'display.raw_html_risk', '正文可能以裸 HTML/伪 Markdown 进入阅读区', { itemId: item.id, title });
  }
  if (content && MALFORMED_MARKER_PATTERN.test(content)) {
    addIssue(issues, 'medium', 'content.malformed_marker', '正文含异常标记或列表残留，阅读格式可能错乱', { itemId: item.id, title });
  }
  if (RAW_ENUM_PATTERN.test(textForRawCheck)) {
    addIssue(issues, 'medium', 'display.raw_enum_visible_risk', '摘要/翻译/原因字段包含 raw enum，容易泄露到阅读界面', {
      itemId: item.id,
      title,
    });
  }
  if (NAKED_URL_PATTERN.test(content) && (item.sourceType === 'curated_index' || item.sourceType === 'webpage_index')) {
    addIssue(issues, 'medium', 'display.naked_url_in_index_reader', '索引/榜单正文含裸 URL，阅读区应渲染成可点击文本或收进来源元信息', {
      itemId: item.id,
      title,
    });
  }
  if (item.translationStatus === 'ready' && translation && content.length > 1200 && translation.length < Math.min(350, content.length * 0.08)) {
    addIssue(issues, 'high', 'translation.too_short_for_basis', '译文明显短于正文，疑似只翻译了开头或摘要', {
      itemId: item.id,
      title,
      contentLength: content.length,
      translationLength: translation.length,
    });
  }
  if ((item.translationStatus === 'pending' || item.translationStatus === 'failed') && item.translationAction === 'none') {
    addIssue(issues, 'high', 'translation.action_hidden', '没有可用译文，但翻译主动作被隐藏', {
      itemId: item.id,
      title,
      translationStatus: item.translationStatus,
      translationReason: item.translationReason || null,
    });
  }
  return issues;
}

async function fetchAllItems(apiBase, token, maxItems) {
  const all = [];
  let offset = 0;
  const limit = 100;
  while (all.length < maxItems) {
    const data = await requestJson(`${apiBase}/items?limit=${limit}&offset=${offset}&includeFiltered=true&sortBy=publishedAt`, token);
    const items = Array.isArray(data.data) ? data.data : [];
    all.push(...items);
    if (!data.hasMore || items.length === 0) break;
    offset = Number(data.nextOffset ?? offset + limit);
  }
  return all.slice(0, maxItems);
}

function issueKey(issue) {
  return `${issue.severity}:${issue.type}`;
}

function summarizeIssues(issues) {
  const byType = new Map();
  for (const issue of issues) {
    const key = issueKey(issue);
    const entry = byType.get(key) || { severity: issue.severity, type: issue.type, count: 0, examples: [] };
    entry.count += 1;
    if (entry.examples.length < 5) entry.examples.push(issue);
    byType.set(key, entry);
  }
  const severityOrder = { high: 0, medium: 1, low: 2 };
  return [...byType.values()].sort((a, b) =>
    (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9) || b.count - a.count || a.type.localeCompare(b.type),
  );
}

function pickDetailTargets(itemAudits, detailLimit) {
  const ranked = [...itemAudits].sort((a, b) => {
    const score = (entry) => entry.issues.reduce((sum, issue) => sum + (issue.severity === 'high' ? 5 : issue.severity === 'medium' ? 2 : 1), 0);
    return score(b) - score(a);
  });
  const selected = [];
  const seen = new Set();
  for (const entry of ranked) {
    if (selected.length >= detailLimit) break;
    if (seen.has(entry.itemId)) continue;
    if (entry.issues.length === 0 && selected.length > Math.floor(detailLimit / 3)) continue;
    selected.push(entry);
    seen.add(entry.itemId);
  }
  return selected;
}

function markdownEscape(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function renderReport({ generatedAt, args, sources, items, sourceAudits, itemAudits, detailIssues, summary, jsonFile }) {
  const high = summary.filter((entry) => entry.severity === 'high').reduce((sum, entry) => sum + entry.count, 0);
  const medium = summary.filter((entry) => entry.severity === 'medium').reduce((sum, entry) => sum + entry.count, 0);
  const low = summary.filter((entry) => entry.severity === 'low').reduce((sum, entry) => sum + entry.count, 0);
  const noItemSources = sources.filter((source) => Number(source.itemCount || 0) === 0).length;
  const sourceIssueCount = sourceAudits.reduce((sum, entry) => sum + entry.issues.length, 0);
  const itemIssueCount = itemAudits.reduce((sum, entry) => sum + entry.issues.length, 0);

  const lines = [];
  lines.push('# 信息中枢 V3 RSS/链接/正文/展示全链路审计');
  lines.push('');
  lines.push(`- 生成时间：${generatedAt}`);
  lines.push(`- API：\`${args.apiBase}\``);
  lines.push(`- 用户：\`${args.userEmail}\``);
  lines.push(`- 来源数：${sources.length}，无条目来源：${noItemSources}`);
  lines.push(`- 条目数：${items.length}（API 可见主链路，includeFiltered=true）`);
  lines.push(`- 详情抽查：${detailIssues.length} 个详情问题来自 ${Math.min(args.detailLimit, itemAudits.length)} 个高风险条目`);
  lines.push(`- 问题总数：高 ${high} / 中 ${medium} / 低 ${low}`);
  lines.push(`- JSON 明细：\`${path.relative(REPO_ROOT, jsonFile)}\``);
  lines.push('');

  lines.push('## 结论');
  lines.push('');
  if (high > 0) {
    lines.push('- 当前仍存在高优先级链路问题，主要集中在“来源抓取异常、条目链接缺失/错配、全文可读误标、翻译恢复动作缺失”。');
  } else if (medium > 0) {
    lines.push('- 没发现阻断级问题，但仍有会影响阅读信任感的中优先级问题，需要按来源治理。');
  } else {
    lines.push('- 本轮矩阵未发现明显链路问题，但仍建议对高价值来源保持抽样浏览器验收。');
  }
  lines.push('- 这份审计只读，不会修改来源、条目、正文或 AI 状态。');
  lines.push('');

  lines.push('## 问题分布');
  lines.push('');
  lines.push('| 严重级 | 类型 | 数量 | 示例 |');
  lines.push('|---|---:|---:|---|');
  for (const entry of summary.slice(0, 24)) {
    const example = entry.examples[0] || {};
    lines.push(`| ${entry.severity} | \`${entry.type}\` | ${entry.count} | ${markdownEscape(example.title || example.message || example.sourceId || example.itemId || '')} |`);
  }
  lines.push('');

  lines.push('## 来源层高风险样例');
  lines.push('');
  lines.push('| 来源 | 类型 | 采集器 | 最近结果 | 问题 |');
  lines.push('|---|---|---|---|---|');
  for (const entry of sourceAudits.filter((item) => item.issues.some((issue) => issue.severity === 'high')).slice(0, 20)) {
    const source = entry.source;
    lines.push(`| ${markdownEscape(source.name)} (#${source.id}) | ${markdownEscape(source.sourceType)} | ${markdownEscape(source.collectorType)} | ${markdownEscape(source.lastOutcome || source.freshnessState || '')} | ${markdownEscape(entry.issues.map((issue) => issue.type).join(', '))} |`);
  }
  if (sourceIssueCount === 0) lines.push('| 无 |  |  |  | 未发现来源层问题 |');
  lines.push('');

  lines.push('## 条目层高风险样例');
  lines.push('');
  lines.push('| 条目 | 来源 | 证据层 | 翻译动作 | 问题 | 展示 URL |');
  lines.push('|---|---|---|---|---|---|');
  for (const entry of itemAudits.filter((item) => item.issues.some((issue) => issue.severity === 'high')).slice(0, 30)) {
    lines.push(`| ${markdownEscape(entry.title)} | ${markdownEscape(entry.sourceName || entry.sourceId)} | ${markdownEscape(entry.primaryLayer)} | ${markdownEscape(entry.translationAction || '')} | ${markdownEscape(entry.issues.map((issue) => issue.type).join(', '))} | [打开](${entry.displayUrl}) |`);
  }
  if (itemIssueCount === 0) lines.push('| 无 |  |  |  | 未发现条目层问题 |  |');
  lines.push('');

  lines.push('## 详情正文/译文风险样例');
  lines.push('');
  lines.push('| 严重级 | 类型 | 条目 | 说明 |');
  lines.push('|---|---|---|---|');
  for (const issue of detailIssues.slice(0, 30)) {
    lines.push(`| ${issue.severity} | \`${issue.type}\` | ${markdownEscape(issue.title || issue.itemId)} | ${markdownEscape(issue.message)} |`);
  }
  if (detailIssues.length === 0) lines.push('| 无 |  |  | 高风险详情抽查未发现正文/译文风险 |');
  lines.push('');

  lines.push('## 后续建议');
  lines.push('');
  lines.push('1. 先处理 `high` 类型，尤其是全文误标、翻译动作隐藏、索引条目缺原站链接。');
  lines.push('2. 对本报告里的展示 URL 用 Playwright 抽查，确认 DOM 可见内容和 API 状态一致。');
  lines.push('3. 每次改 RSS collector、readability、translation、Feed 展示后重跑本脚本，避免同类问题回归。');
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  const generatedAt = new Date().toISOString();
  const token = await resolveToken(args.apiBase, args.userEmail);
  if (!token) throw new Error('No auth token resolved.');

  const sourceParams = args.sourceStatus === 'all' ? '' : `?status=${encodeURIComponent(args.sourceStatus)}`;
  const sourcePayload = await requestJson(`${args.apiBase}/sources${sourceParams}`, token);
  const sources = Array.isArray(sourcePayload.data) ? sourcePayload.data : [];
  const sourceMap = new Map(sources.map((source) => [source.id, source]));

  const items = await fetchAllItems(args.apiBase, token, args.maxItems);
  const sourceAudits = sources.map((source) => ({ source, ...auditSource(source) }));
  const itemAudits = items.map((item) => auditItemListRecord(item, sourceMap.get(item.sourceId), args.appBase));

  const detailTargets = pickDetailTargets(itemAudits, args.detailLimit);
  const detailIssues = [];
  for (const target of detailTargets) {
    try {
      const payload = await requestJson(`${args.apiBase}/items/${encodeURIComponent(target.itemId)}`, token);
      const item = payload.data || payload;
      detailIssues.push(...auditItemDetail(item));
    } catch (err) {
      addIssue(detailIssues, 'high', 'detail.fetch_failed', '条目详情接口读取失败', {
        itemId: target.itemId,
        title: target.title,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const allIssues = [
    ...sourceAudits.flatMap((entry) => entry.issues),
    ...itemAudits.flatMap((entry) => entry.issues),
    ...detailIssues,
  ];
  const summary = summarizeIssues(allIssues);

  await mkdir(args.outputDir, { recursive: true });
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const jsonFile = path.join(args.outputDir, `rss-link-content-audit-${stamp}.json`);
  const mdFile = path.join(args.outputDir, `rss-link-content-audit-${stamp}.md`);
  const jsonPayload = {
    generatedAt,
    args: {
      apiBase: args.apiBase,
      appBase: args.appBase,
      userEmail: args.userEmail,
      maxItems: Number.isFinite(args.maxItems) ? args.maxItems : 'all',
      detailLimit: args.detailLimit,
      sourceStatus: args.sourceStatus,
    },
    counts: {
      sources: sources.length,
      items: items.length,
      sourceIssues: sourceAudits.reduce((sum, entry) => sum + entry.issues.length, 0),
      itemIssues: itemAudits.reduce((sum, entry) => sum + entry.issues.length, 0),
      detailIssues: detailIssues.length,
    },
    summary,
    sourceAudits: sourceAudits.filter((entry) => entry.issues.length > 0).map((entry) => ({
      source: {
        id: entry.source.id,
        name: entry.source.name,
        sourceType: entry.source.sourceType,
        collectorType: entry.source.collectorType,
        status: entry.source.status,
        lastOutcome: entry.source.lastOutcome,
        freshnessState: entry.source.freshnessState,
        itemCount: entry.source.itemCount,
        contentReadyCount: entry.source.contentReadyCount,
        contentDegradedCount: entry.source.contentDegradedCount,
        contentMissingCount: entry.source.contentMissingCount,
        feedUrl: entry.feedUrl,
      },
      issues: entry.issues,
    })),
    itemAudits: itemAudits.filter((entry) => entry.issues.length > 0),
    detailIssues,
  };
  await writeFile(jsonFile, `${JSON.stringify(jsonPayload, null, 2)}\n`, 'utf8');
  await writeFile(mdFile, renderReport({
    generatedAt,
    args,
    sources,
    items,
    sourceAudits,
    itemAudits,
    detailIssues,
    summary,
    jsonFile,
  }), 'utf8');

  console.log(JSON.stringify({
    generatedAt,
    sources: sources.length,
    items: items.length,
    issueTypes: summary.length,
    high: summary.filter((entry) => entry.severity === 'high').reduce((sum, entry) => sum + entry.count, 0),
    medium: summary.filter((entry) => entry.severity === 'medium').reduce((sum, entry) => sum + entry.count, 0),
    low: summary.filter((entry) => entry.severity === 'low').reduce((sum, entry) => sum + entry.count, 0),
    mdFile,
    jsonFile,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack || err.message : String(err));
    process.exit(1);
  });
}
