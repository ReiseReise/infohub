#!/usr/bin/env node

const rawBaseUrl = process.env.INFOHUB_API_URL || process.env.HUB_ENGINE_URL || 'http://127.0.0.1:3001';
const baseUrl = rawBaseUrl.replace(/\/$/, '').endsWith('/api')
  ? rawBaseUrl.replace(/\/$/, '')
  : `${rawBaseUrl.replace(/\/$/, '')}/api`;

const reportDate = process.env.INFOHUB_REPORT_DATE || new Intl.DateTimeFormat('en-CA', {
  timeZone: process.env.INFOHUB_TIMEZONE || 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const shouldGenerate = process.env.INFOHUB_GENERATE_REPORT !== '0';

function fail(message) {
  throw new Error(message);
}

async function request(path, options = {}) {
  const resp = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  });
  const text = await resp.text();
  const data = text ? JSON.parse(text) : {};
  if (!resp.ok) {
    fail(`${options.method || 'GET'} ${path} -> ${resp.status} ${resp.statusText}: ${data.error || data.message || text}`);
  }
  return data;
}

async function resolveToken() {
  if (process.env.INFOHUB_TOKEN) return process.env.INFOHUB_TOKEN;
  const email = process.env.INFOHUB_EMAIL;
  const password = process.env.INFOHUB_PASSWORD;
  if (!email || !password) {
    fail('Set INFOHUB_TOKEN, or set INFOHUB_EMAIL and INFOHUB_PASSWORD for the target acceptance account.');
  }
  const login = await request('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  if (!login.accessToken) fail('Login did not return accessToken.');
  return login.accessToken;
}

function byReason(summary) {
  const map = {};
  for (const group of summary?.byReason || []) {
    map[group.reason] = group.count;
  }
  return map;
}

function compactItems(items = []) {
  return items.map((item) => ({
    id: item.id,
    title: item.title || item.displayTitle,
    aiScore: item.aiScore,
    sourceName: item.sourceName,
    selectionMode: item.selectionMode,
    selectionReason: item.selectionReason,
    translationStatus: item.translationStatus,
    reason: item.reason,
  }));
}

function markdownAudit(markdown, topItems) {
  const requiredSections = ['## 生成口径', '## 今日结论', '## 关键进展', '## 阅读建议', '## 下一步动作'];
  const missingSections = requiredSections.filter((section) => !markdown.includes(section));
  const ordinalRefRegex = /(见|参考|对应)?\s*(头部舆论|新闻焦点|第)\s*[^\n]{0,12}第\s*\d+\s*条/;
  const topTitleOccurrences = topItems
    .slice(0, 3)
    .map((item) => item.title || item.displayTitle)
    .filter(Boolean)
    .map((title) => ({
      title,
      occurrences: markdown.split(title).length - 1,
    }));
  return {
    length: markdown.length,
    missingSections,
    hasOrdinalRefs: ordinalRefRegex.test(markdown),
    topTitleOccurrences,
  };
}

const token = await resolveToken();
const workflowResult = await request('/insights/workflow', { token });
const workflow = workflowResult.data?.workflow;
if (!workflow) fail('Workflow API did not return data.workflow.');

const previewResult = await request('/insights/workflow/preview', {
  method: 'POST',
  token,
  body: { workflow },
});
const preview = previewResult.data?.preview;
if (!preview) fail('Workflow preview did not return data.preview.');

const generated = shouldGenerate
  ? await request(`/insights/generate?mode=fast&date=${reportDate}`, { method: 'POST', token })
  : { data: {} };

const latest = await request(`/insights/${reportDate}`, { token });
const insight = latest.data;
if (!insight) fail(`No daily insight found for ${reportDate}.`);

const report = generated.data || {};
const snapshot = insight.payload?.snapshot || report.snapshot || {};
const topItems = snapshot.topItems || [];
if (topItems.length === 0) fail('Generated insight snapshot has no topItems.');

const previewTopIds = new Set((preview.candidates || []).map((item) => item.id));
const snapshotTopIds = new Set(topItems.map((item) => item.id));
const topOverlap = [...snapshotTopIds].filter((id) => previewTopIds.has(id));
const businessNoiseIds = new Set(
  (snapshot.excludedCandidates || [])
    .filter((item) => item.reason === 'business_noise')
    .map((item) => item.id),
);
const businessNoiseInTop = topItems.filter((item) => businessNoiseIds.has(item.id));

const markdown = report.markdown || generated.markdown || insight.summary || '';
const markdownResult = markdownAudit(markdown, topItems);

if (topOverlap.length !== snapshotTopIds.size) {
  fail(`Preview/snapshot TOP mismatch: ${topOverlap.length}/${snapshotTopIds.size}`);
}
if (businessNoiseInTop.length > 0) {
  fail(`Business noise entered TOP: ${businessNoiseInTop.map((item) => item.id).join(', ')}`);
}
if (markdownResult.missingSections.length > 0) {
  fail(`Daily report markdown missing sections: ${markdownResult.missingSections.join(', ')}`);
}
if (markdownResult.hasOrdinalRefs) {
  fail('Daily report markdown still contains ordinal cross references.');
}

const audit = {
  status: 'pass',
  reportDate,
  generated: shouldGenerate,
  workflow: {
    topN: workflow.topN,
    minScore: workflow.minScore,
    enableLatestFallback: workflow.enableLatestFallback,
    requireChinese: workflow.requireChinese,
  },
  preview: {
    selectionMode: preview.selectionMode,
    funnel: preview.funnel,
    candidates: compactItems(preview.candidates).slice(0, 8),
    excludedByReason: byReason(preview.excludedSummary),
  },
  snapshot: {
    insightId: insight.id,
    generatedAt: insight.generatedAt,
    generationMode: snapshot.generationMode || report.generationMode,
    funnel: snapshot.candidateFunnel,
    reportFunnel: snapshot.reportFunnel,
    topItems: compactItems(topItems).slice(0, 8),
    excludedByReason: byReason(snapshot.excludedCandidateSummary),
  },
  consistency: {
    topOverlap: `${topOverlap.length}/${snapshotTopIds.size}`,
    businessNoiseInTop: compactItems(businessNoiseInTop),
    markdown: markdownResult,
  },
};

console.log(JSON.stringify(audit, null, 2));
