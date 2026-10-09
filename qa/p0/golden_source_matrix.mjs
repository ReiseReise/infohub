#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';

export const GOLDEN_SOURCE_SPECS = [
  { key: 'openai', role: '官方 AI', label: 'OpenAI News', match: /^OpenAI News$/i },
  { key: 'anthropic', role: '官方 AI', label: 'Anthropic Newsroom', match: /^Anthropic Newsroom$/i },
  { key: 'reuters', role: '国际媒体', label: 'Reuters Technology AI', match: /^Reuters Technology AI$/i },
  { key: 'bestblogs', role: '精选榜单', label: 'BestBlogs Daily Brief', match: /^BestBlogs Daily Brief$/i },
  { key: 'email', role: '私密入口', label: 'Email Inbox', match: /^Email Inbox$/i, allowEmpty: true },
  { key: '36kr', role: '中文快讯', label: '36kr', match: /^36kr$/i },
  { key: 'johndcook', role: '技术长文', label: 'johndcook.com', match: /^johndcook\.com$/i },
  { key: 'simonwillison', role: 'AI 技术博客', label: 'simonwillison.net', match: /^simonwillison\.net$/i },
  { key: 'daringfireball', role: '科技评论', label: 'daringfireball.net', match: /^daringfireball\.net$/i },
  { key: 'seangoedecke', role: '工程长文', label: 'seangoedecke.com', match: /^seangoedecke\.com$/i },
  { key: 'paulgraham', role: '经典长文', label: 'paulgraham.com', match: /^paulgraham\.com$/i },
  { key: 'dwarkesh', role: '访谈深读', label: 'dwarkesh.com', match: /^dwarkesh\.com$/i },
  { key: 'gwern', role: '研究长文', label: 'gwern.net', match: /^gwern\.net$/i },
  { key: 'overreacted', role: '前端长文', label: 'overreacted.io', match: /^overreacted\.io$/i },
  { key: 'krebsonsecurity', role: '安全媒体', label: 'krebsonsecurity.com', match: /^krebsonsecurity\.com$/i },
  { key: 'pluralistic', role: '科技社会评论', label: 'pluralistic.net', match: /^pluralistic\.net$/i },
  { key: 'constructionphysics', role: '产业研究', label: 'construction-physics.com', match: /^construction-physics\.com$/i },
  { key: 'keygen', role: '健康 RSS 对照', label: 'keygen.sh', match: /^keygen\.sh$/i },
  { key: 'lightweight', role: '低质浅阅读对照', label: 'Example Lightweight Feed', match: /^Example Lightweight Feed$/i },
  { key: 'broken', role: '抓取失败对照', label: 'joanwestenberg.com', match: /^joanwestenberg\.com$/i },
];

function parseArgs(argv) {
  const result = {
    api: process.env.INFOHUB_API_URL || 'http://localhost/api',
    output: process.env.INFOHUB_GOLDEN_SOURCE_OUTPUT || '/private/tmp/infohub_golden_sources.md',
    sampleLimit: Number(process.env.INFOHUB_GOLDEN_SOURCE_LIMIT || 30),
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--api') result.api = argv[++index];
    else if (argv[index] === '--output') result.output = argv[++index];
    else if (argv[index] === '--limit') result.sampleLimit = Number(argv[++index]);
  }
  result.api = result.api.replace(/\/$/, '');
  return result;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${url} -> ${response.status}: ${data.error || data.message || text}`);
  return data;
}

async function resolveToken(api) {
  if (process.env.INFOHUB_TOKEN) return process.env.INFOHUB_TOKEN;
  const email = process.env.INFOHUB_EMAIL;
  const password = process.env.INFOHUB_PASSWORD;
  if (!email || !password) throw new Error('Set INFOHUB_TOKEN or INFOHUB_EMAIL/INFOHUB_PASSWORD');
  const login = await requestJson(`${api}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return login.accessToken;
}

function percent(value, total) {
  if (!total) return '0%';
  return `${Math.round((value / total) * 1000) / 10}%`;
}

export function buildSourceRow(spec, source, items = [], total = 0) {
  if (!source) {
    return { spec, source: null, status: 'missing', total: 0, sampled: 0, fullText: 0, translated: 0, issue: '当前账号缺少该黄金来源。' };
  }
  const fullText = items.filter((item) => item.fullTextReady === true).length;
  const translated = items.filter((item) => item.translationStatus === 'ready').length;
  const health = String(source.healthStatus || 'unknown');
  const issues = [];
  if (!spec.allowEmpty && total === 0) issues.push('没有内容');
  if (['fetch_failing', 'ai_blocked'].includes(health)) issues.push(health === 'fetch_failing' ? '抓取失败' : 'AI 处理卡住');
  if (items.length >= 5 && fullText / items.length < 0.5 && !['精选榜单', '中文快讯', '低质浅阅读对照', '抓取失败对照'].includes(spec.role)) {
    issues.push('抽样全文率低于 50%');
  }
  return {
    spec,
    source,
    status: issues.length > 0 ? 'review' : 'pass',
    total,
    sampled: items.length,
    fullText,
    translated,
    latestTitle: items[0]?.title || '',
    issue: issues.join('；'),
  };
}

export function renderMarkdown(rows, generatedAt) {
  const counts = rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});
  const lines = [
    '# 信息中枢 V3 二十源黄金验收矩阵',
    '',
    `- 生成时间：${generatedAt}`,
    `- 来源角色：${rows.length}；通过 ${counts.pass || 0}；需复核 ${counts.review || 0}；缺失 ${counts.missing || 0}`,
    '- 口径：每个来源抽取最近 30 条，分别核对来源健康、全文可读率和已有译文率。榜单、快讯和失败对照不套用长文全文率门槛。',
    '',
    '| 角色 | 黄金来源 | 状态 | 权威等级 | 阅读层级 | 健康 | 总量 | 抽样全文 | 抽样译文 | 最近内容 | 问题 |',
    '| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | --- | --- |',
  ];
  for (const row of rows) {
    const source = row.source || {};
    const cells = [
      row.spec.role,
      source.name || row.spec.label,
      row.status === 'pass' ? '通过' : row.status === 'review' ? '需复核' : '缺失',
      source.sourceTier || '-',
      source.readingTierLabel || source.readingTier || '-',
      source.healthStatus || '-',
      row.total,
      `${row.fullText}/${row.sampled} (${percent(row.fullText, row.sampled)})`,
      `${row.translated}/${row.sampled} (${percent(row.translated, row.sampled)})`,
      row.latestTitle || '-',
      row.issue || '-',
    ].map((value) => String(value).replace(/\|/g, '\\|').replace(/\n/g, ' '));
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return `${lines.join('\n')}\n`;
}

export async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const token = await resolveToken(args.api);
  const headers = { authorization: `Bearer ${token}` };
  const sourcePayload = await requestJson(`${args.api}/sources?limit=1000`, { headers });
  const sources = sourcePayload.sources || sourcePayload.data?.sources || sourcePayload.data || [];
  const rows = [];

  for (const spec of GOLDEN_SOURCE_SPECS) {
    const source = sources.find((candidate) => spec.match.test(String(candidate.name || '')));
    if (!source) {
      rows.push(buildSourceRow(spec, null));
      continue;
    }
    const itemPayload = await requestJson(`${args.api}/items?sourceId=${encodeURIComponent(source.id)}&limit=${args.sampleLimit}&sortBy=latest`, { headers });
    const items = itemPayload.items || itemPayload.data?.items || itemPayload.data || [];
    rows.push(buildSourceRow(spec, source, items, Number(itemPayload.total || items.length)));
  }

  const markdown = renderMarkdown(rows, new Date().toISOString());
  await writeFile(args.output, markdown, 'utf8');
  const summary = rows.reduce((acc, row) => ({ ...acc, [row.status]: (acc[row.status] || 0) + 1 }), {});
  console.log(JSON.stringify({ output: args.output, total: rows.length, ...summary }, null, 2));
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  run().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
