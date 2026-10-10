import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSourceHealthSnapshot, type SourceHealthInput } from './source-health.js';

const baseInput: SourceHealthInput = {
  source: {
    id: 7,
    name: 'Anthropic Newsroom',
    collectorType: 'webpage',
    sourceTier: 'S',
    status: 'active',
    lastFetchedAt: new Date('2026-06-10T08:00:00.000Z'),
    lastSuccessAt: new Date('2026-06-10T08:00:00.000Z'),
    lastOutcome: 'new_items',
    lastError: null,
    healthScore: 100,
    config: {
      lastFetchEngine: 'native',
      lastBlockedReason: null,
    },
  },
  fetchLogs: [
    {
      status: 'success',
      outcome: 'new_items',
      startedAt: new Date('2026-06-10T08:00:00.000Z'),
      finishedAt: new Date('2026-06-10T08:00:03.000Z'),
      durationMs: 3000,
      itemsFound: 5,
      itemsNew: 2,
      itemsFiltered: 0,
      itemsDuplicate: 3,
      itemsQueuedAi: 0,
      error: null,
    },
  ],
  stats: {
    itemCount: 5,
    visibleCount: 5,
    filteredCount: 0,
    contentReadyCount: 2,
    contentDegradedCount: 2,
    contentMissingCount: 1,
    titleOnlyCount: 1,
    snippetOnlyCount: 2,
    longReadRiskCount: 1,
    scoredCount: 1,
    summaryReadyCount: 1,
    summaryFailedCount: 2,
    translationReadyCount: 0,
    translationFailedCount: 1,
    reportCandidateCount: 1,
    reportSelectedCount: 0,
    hotNotSelectedCount: 1,
    averageContentLength: 420,
  },
  aiFailures: [
    { stage: 'summary', reason: 'summary_must_be_chinese', count: 2 },
    { stage: 'translation', reason: 'llm_500', count: 1 },
  ],
};

test('builds actionable source health for content and AI degraded sources', () => {
  const snapshot = buildSourceHealthSnapshot(baseInput);

  assert.equal(snapshot.healthStatus, 'ai_blocked');
  assert.deepEqual(snapshot.healthReasons, [
    '正文质量偏低：5 条可见内容中只有 2 条正文可读。',
    'AI 处理失败：评分、摘要或翻译存在失败条目。',
    '日报有遗漏风险：有热点内容命中但没有进入日报。',
  ]);
  assert.equal(snapshot.stageHealth.fetch.status, 'healthy');
  assert.equal(snapshot.stageHealth.content.status, 'degraded');
  assert.equal(snapshot.stageHealth.display.status, 'degraded');
  assert.equal(snapshot.stageHealth.ai.status, 'failing');
  assert.equal(snapshot.stageHealth.report.status, 'degraded');
  assert.equal(snapshot.stageHealth.ai.latestIssue, '摘要需要中文化；模型服务返回 500。');
  assert.deepEqual(snapshot.recommendedActions.map((action) => action.action), [
    'repair_content',
    'repair_ai',
    'review_daily_coverage',
  ]);
});

test('marks configured sources with no successful run as needs_fetch', () => {
  const snapshot = buildSourceHealthSnapshot({
    source: {
      id: 8,
      name: 'Claude Release Notes',
      collectorType: 'webpage',
      sourceTier: 'S',
      status: 'active',
      lastFetchedAt: null,
      lastSuccessAt: null,
      lastOutcome: 'scheduled',
      lastError: null,
      healthScore: 100,
      config: {},
    },
    fetchLogs: [],
    stats: {
      itemCount: 0,
      visibleCount: 0,
      filteredCount: 0,
      contentReadyCount: 0,
      contentDegradedCount: 0,
      contentMissingCount: 0,
      titleOnlyCount: 0,
      snippetOnlyCount: 0,
      longReadRiskCount: 0,
      scoredCount: 0,
      summaryReadyCount: 0,
      summaryFailedCount: 0,
      translationReadyCount: 0,
      translationFailedCount: 0,
      reportCandidateCount: 0,
      reportSelectedCount: 0,
      hotNotSelectedCount: 0,
      averageContentLength: 0,
    },
    aiFailures: [],
  });

  assert.equal(snapshot.healthStatus, 'needs_fetch');
  assert.equal(snapshot.stageHealth.fetch.status, 'stale');
  assert.equal(snapshot.stageHealth.fetch.latestIssue, '已配置但还没有成功抓取记录。');
  assert.equal(snapshot.stageHealth.display.status, 'empty');
  assert.equal(snapshot.stageHealth.display.label, '暂无展示样本');
  assert.equal(snapshot.stageHealth.report.status, 'empty');
  assert.equal(snapshot.stageHealth.report.label, '暂无日报样本');
  assert.deepEqual(snapshot.recommendedActions.map((action) => action.action), ['fetch']);
});

test('does not claim normal report coverage before visible items form candidates', () => {
  const snapshot = buildSourceHealthSnapshot({
    ...baseInput,
    stats: {
      ...baseInput.stats,
      itemCount: 2,
      visibleCount: 2,
      contentReadyCount: 2,
      contentDegradedCount: 0,
      contentMissingCount: 0,
      titleOnlyCount: 0,
      snippetOnlyCount: 0,
      longReadRiskCount: 0,
      scoredCount: 2,
      summaryReadyCount: 2,
      summaryFailedCount: 0,
      translationReadyCount: 2,
      translationFailedCount: 0,
      reportCandidateCount: 0,
      reportSelectedCount: 0,
      hotNotSelectedCount: 0,
      averageContentLength: 900,
    },
    aiFailures: [],
  });

  assert.equal(snapshot.stageHealth.display.status, 'healthy');
  assert.equal(snapshot.stageHealth.report.status, 'empty');
  assert.equal(snapshot.stageHealth.report.label, '暂无日报候选');
  assert.equal(snapshot.stageHealth.report.summary, '已有可见内容，但当前还没有形成日报候选。');
});

test('does not mark AI as blocked when failed status already has usable outputs', () => {
  const snapshot = buildSourceHealthSnapshot({
    ...baseInput,
    stats: {
      ...baseInput.stats,
      itemCount: 1,
      visibleCount: 1,
      contentReadyCount: 1,
      contentDegradedCount: 0,
      contentMissingCount: 0,
      titleOnlyCount: 0,
      snippetOnlyCount: 0,
      longReadRiskCount: 0,
      scoredCount: 1,
      summaryReadyCount: 1,
      summaryFailedCount: 0,
      translationReadyCount: 1,
      translationFailedCount: 0,
      reportCandidateCount: 1,
      reportSelectedCount: 1,
      hotNotSelectedCount: 0,
      averageContentLength: 970,
    },
    aiFailures: [],
  });

  assert.equal(snapshot.healthStatus, 'healthy');
  assert.equal(snapshot.stageHealth.ai.status, 'healthy');
  assert.deepEqual(snapshot.recommendedActions, []);
});

test('recommends configuration review for webpage sources with only degraded snippets', () => {
  const snapshot = buildSourceHealthSnapshot({
    ...baseInput,
    source: {
      ...baseInput.source,
      name: 'Business Insider AI',
      collectorType: 'webpage',
    },
    stats: {
      ...baseInput.stats,
      itemCount: 1,
      visibleCount: 1,
      contentReadyCount: 0,
      contentDegradedCount: 1,
      contentMissingCount: 0,
      titleOnlyCount: 0,
      snippetOnlyCount: 1,
      longReadRiskCount: 0,
      scoredCount: 1,
      summaryReadyCount: 1,
      summaryFailedCount: 0,
      translationReadyCount: 1,
      translationFailedCount: 0,
      reportCandidateCount: 1,
      reportSelectedCount: 1,
      hotNotSelectedCount: 0,
      averageContentLength: 141,
    },
    aiFailures: [],
  });

  assert.equal(snapshot.healthStatus, 'content_degraded');
  assert.equal(snapshot.stageHealth.content.status, 'failing');
  assert.deepEqual(snapshot.recommendedActions.map((action) => action.action), [
    'repair_content',
    'check_config',
  ]);
});

test('does not label a source healthy when AI stages are still pending', () => {
  const snapshot = buildSourceHealthSnapshot({
    ...baseInput,
    stats: {
      ...baseInput.stats,
      itemCount: 1,
      visibleCount: 1,
      contentReadyCount: 1,
      contentDegradedCount: 0,
      contentMissingCount: 0,
      titleOnlyCount: 0,
      snippetOnlyCount: 0,
      longReadRiskCount: 0,
      scoredCount: 1,
      summaryReadyCount: 1,
      summaryFailedCount: 0,
      translationReadyCount: 0,
      translationFailedCount: 0,
      reportCandidateCount: 1,
      reportSelectedCount: 1,
      hotNotSelectedCount: 0,
      averageContentLength: 457,
    },
    aiFailures: [],
  });

  assert.equal(snapshot.healthStatus, 'ai_blocked');
  assert.equal(snapshot.stageHealth.ai.status, 'degraded');
  assert.deepEqual(snapshot.healthReasons, ['AI 待补处理：评分、摘要或翻译还没有全部完成。']);
  assert.deepEqual(snapshot.recommendedActions.map((action) => action.action), ['repair_ai']);
});

test('marks official-looking source names as config mismatch when the feed points to another domain', () => {
  const snapshot = buildSourceHealthSnapshot({
    ...baseInput,
    source: {
      ...baseInput.source,
      name: 'OpenAI',
      collectorType: 'rss',
      config: {
        url: 'https://www.v2ex.com/feed/openai.xml',
        htmlUrl: 'https://www.v2ex.com/',
      },
    },
    stats: {
      ...baseInput.stats,
      itemCount: 5,
      visibleCount: 5,
      contentReadyCount: 5,
      contentDegradedCount: 0,
      contentMissingCount: 0,
      titleOnlyCount: 0,
      snippetOnlyCount: 0,
      longReadRiskCount: 0,
      scoredCount: 5,
      summaryReadyCount: 5,
      summaryFailedCount: 0,
      translationReadyCount: 5,
      translationFailedCount: 0,
      reportCandidateCount: 1,
      reportSelectedCount: 1,
      hotNotSelectedCount: 0,
      averageContentLength: 800,
    },
    aiFailures: [],
  });

  assert.equal(snapshot.healthStatus, 'config_mismatch');
  assert.equal(snapshot.healthLabel, '配置错配');
  assert.equal(snapshot.stageHealth.fetch.status, 'degraded');
  assert.match(snapshot.stageHealth.fetch.latestIssue || '', /OpenAI/);
  assert.match(snapshot.stageHealth.fetch.latestIssue || '', /v2ex.com/);
  assert.deepEqual(snapshot.recommendedActions.map((action) => action.action), ['check_config']);
});

test('does not flag community sources when the source name makes the host explicit', () => {
  const snapshot = buildSourceHealthSnapshot({
    ...baseInput,
    source: {
      ...baseInput.source,
      name: 'V2EX OpenAI',
      collectorType: 'rss',
      config: {
        url: 'https://www.v2ex.com/feed/openai.xml',
        htmlUrl: 'https://www.v2ex.com/',
      },
    },
    stats: {
      ...baseInput.stats,
      itemCount: 1,
      visibleCount: 1,
      contentReadyCount: 1,
      contentDegradedCount: 0,
      contentMissingCount: 0,
      titleOnlyCount: 0,
      snippetOnlyCount: 0,
      longReadRiskCount: 0,
      scoredCount: 1,
      summaryReadyCount: 1,
      summaryFailedCount: 0,
      translationReadyCount: 1,
      translationFailedCount: 0,
      reportCandidateCount: 1,
      reportSelectedCount: 1,
      hotNotSelectedCount: 0,
      averageContentLength: 800,
    },
    aiFailures: [],
  });

  assert.equal(snapshot.healthStatus, 'healthy');
});

test('classifies repeated webpage timeouts without suggesting automatic config changes', () => {
  const snapshot = buildSourceHealthSnapshot({
    ...baseInput,
    source: {
      ...baseInput.source,
      lastOutcome: 'error',
      lastError: 'TimeoutError: page load timeout',
      healthScore: 60,
    },
    fetchLogs: [
      {
        status: 'error',
        outcome: 'error',
        startedAt: new Date('2026-06-10T08:00:00.000Z'),
        finishedAt: new Date('2026-06-10T08:00:20.000Z'),
        durationMs: 20000,
        itemsFound: 0,
        itemsNew: 0,
        itemsFiltered: 0,
        itemsDuplicate: 0,
        itemsQueuedAi: 0,
        error: 'TimeoutError: page load timeout',
      },
      {
        status: 'error',
        outcome: 'error',
        startedAt: new Date('2026-06-10T07:00:00.000Z'),
        finishedAt: new Date('2026-06-10T07:00:20.000Z'),
        durationMs: 20000,
        itemsFound: 0,
        itemsNew: 0,
        itemsFiltered: 0,
        itemsDuplicate: 0,
        itemsQueuedAi: 0,
        error: 'TimeoutError: page load timeout',
      },
    ],
  });

  assert.equal(snapshot.healthStatus, 'fetch_failing');
  assert.equal(snapshot.stageHealth.fetch.status, 'failing');
  assert.equal(snapshot.stageHealth.fetch.latestIssue, '网页抓取超时，建议检查来源可访问性或人工调整抓取模式。');
  assert.deepEqual(snapshot.recommendedActions.map((action) => action.action), [
    'fetch',
    'check_config',
    'repair_content',
    'repair_ai',
    'review_daily_coverage',
  ]);
  assert.equal(snapshot.recommendedActions.map((action) => String(action.action)).includes('auto_disable'), false);
});

test('describes rss timeouts without blaming webpage extraction', () => {
  const snapshot = buildSourceHealthSnapshot({
    ...baseInput,
    source: {
      ...baseInput.source,
      collectorType: 'rss',
      lastOutcome: 'error',
      lastError: 'TimeoutError: feed request timed out',
    },
    fetchLogs: [
      {
        status: 'error',
        outcome: 'error',
        startedAt: new Date('2026-06-10T08:00:00.000Z'),
        finishedAt: new Date('2026-06-10T08:00:20.000Z'),
        durationMs: 20000,
        itemsFound: 0,
        itemsNew: 0,
        itemsFiltered: 0,
        itemsDuplicate: 0,
        itemsQueuedAi: 0,
        error: 'TimeoutError: feed request timed out',
      },
    ],
    stats: {
      ...baseInput.stats,
      itemCount: 0,
      visibleCount: 0,
      contentReadyCount: 0,
      contentDegradedCount: 0,
      contentMissingCount: 0,
      scoredCount: 0,
      summaryReadyCount: 0,
      summaryFailedCount: 0,
      translationReadyCount: 0,
      translationFailedCount: 0,
      reportCandidateCount: 0,
      reportSelectedCount: 0,
      hotNotSelectedCount: 0,
    },
    aiFailures: [],
  });

  assert.equal(snapshot.stageHealth.fetch.latestIssue, '订阅源超时，建议检查来源可访问性或人工调整抓取模式。');
});

test('classifies simultaneous Docker DNS failures without blaming source configuration', () => {
  const snapshot = buildSourceHealthSnapshot({
    ...baseInput,
    source: {
      ...baseInput.source,
      collectorType: 'rss',
      lastOutcome: 'error',
      lastError: 'getaddrinfo EAI_AGAIN example.com',
    },
    fetchLogs: [{
      status: 'error',
      outcome: 'error',
      error: 'getaddrinfo EAI_AGAIN example.com',
    }],
  });

  assert.equal(snapshot.healthStatus, 'fetch_failing');
  assert.equal(snapshot.stageHealth.fetch.label, '网络解析异常');
  assert.equal(snapshot.stageHealth.fetch.metrics.networkFailureKind, 'dns_transient');
  assert.match(snapshot.stageHealth.fetch.latestIssue || '', /Docker 网络/);
  assert.deepEqual(snapshot.recommendedActions.map((action) => action.action), [
    'fetch',
    'repair_content',
    'repair_ai',
    'review_daily_coverage',
  ]);
  assert.equal(snapshot.recommendedActions.some((action) => action.action === 'check_config'), false);
});

test('describes curated index sources as readable brief with article body pending', () => {
  const snapshot = buildSourceHealthSnapshot({
    ...baseInput,
    source: {
      ...baseInput.source,
      name: 'BestBlogs Daily Brief',
      sourceType: 'curated_index',
      collectorType: 'webpage_index',
      sourceTier: 'A',
      lastOutcome: 'new_items',
      config: {
        lastFetchEngine: 'browser-assist:generic',
        lastBlockedReason: null,
      },
    },
    stats: {
      ...baseInput.stats,
      itemCount: 3,
      visibleCount: 3,
      contentReadyCount: 0,
      contentDegradedCount: 3,
      contentMissingCount: 0,
      titleOnlyCount: 0,
      snippetOnlyCount: 3,
      longReadRiskCount: 0,
      scoredCount: 3,
      summaryReadyCount: 3,
      summaryFailedCount: 0,
      translationReadyCount: 3,
      translationFailedCount: 0,
      reportCandidateCount: 2,
      reportSelectedCount: 1,
      hotNotSelectedCount: 0,
      averageContentLength: 260,
    },
    aiFailures: [],
  });

  assert.equal(snapshot.stageHealth.content.status, 'degraded');
  assert.equal(snapshot.stageHealth.content.label, '榜单摘要可读');
  assert.equal(snapshot.stageHealth.content.latestIssue, '榜单摘要可读，原文待补抓。');
  assert.equal(snapshot.healthStatus, 'content_degraded');
});

test('treats email inbox sources as delivered instead of missing fetch logs', () => {
  const snapshot = buildSourceHealthSnapshot({
    ...baseInput,
    source: {
      ...baseInput.source,
      name: 'Email Inbox',
      sourceType: 'email',
      collectorType: 'custom',
      sourceTier: 'B',
      lastFetchedAt: null,
      lastSuccessAt: null,
      lastOutcome: null,
      config: {},
    },
    fetchLogs: [],
    stats: {
      ...baseInput.stats,
      itemCount: 3,
      visibleCount: 3,
      contentReadyCount: 1,
      contentDegradedCount: 2,
      contentMissingCount: 0,
      titleOnlyCount: 0,
      snippetOnlyCount: 2,
      longReadRiskCount: 0,
      scoredCount: 1,
      summaryReadyCount: 1,
      summaryFailedCount: 0,
      translationReadyCount: 0,
      translationFailedCount: 0,
      reportCandidateCount: 0,
      reportSelectedCount: 0,
      hotNotSelectedCount: 0,
      averageContentLength: 260,
    },
    aiFailures: [],
  });

  assert.equal(snapshot.stageHealth.fetch.status, 'healthy');
  assert.equal(snapshot.stageHealth.fetch.label, '已投递');
  assert.equal(snapshot.healthReasons.includes('来源已配置，但还没有成功抓取记录。'), false);
  assert.equal(snapshot.recommendedActions.some((action) => action.action === 'fetch'), false);
});
