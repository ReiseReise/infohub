export type SourceHealthStatus =
  | 'healthy'
  | 'config_mismatch'
  | 'needs_fetch'
  | 'fetch_failing'
  | 'content_degraded'
  | 'ai_blocked'
  | 'report_gap'
  | 'watch';

export type SourceStageStatus = 'healthy' | 'stale' | 'degraded' | 'failing' | 'blocked' | 'empty';

export type SourceRecommendedActionName =
  | 'fetch'
  | 'check_config'
  | 'repair_content'
  | 'repair_ai'
  | 'review_daily_coverage';

export type SourceHealthSource = {
  id: number;
  name: string;
  sourceType?: string | null;
  collectorType?: string | null;
  sourceTier?: string | null;
  status?: string | null;
  lastFetchedAt?: Date | string | null;
  lastSuccessAt?: Date | string | null;
  lastOutcome?: string | null;
  lastError?: string | null;
  healthScore?: number | null;
  config?: Record<string, unknown> | null;
};

export type SourceHealthFetchLog = {
  status?: string | null;
  outcome?: string | null;
  startedAt?: Date | string | null;
  finishedAt?: Date | string | null;
  durationMs?: number | null;
  itemsFound?: number | null;
  itemsNew?: number | null;
  itemsFiltered?: number | null;
  itemsDuplicate?: number | null;
  itemsQueuedAi?: number | null;
  error?: string | null;
};

export type SourceHealthStats = {
  itemCount: number;
  visibleCount: number;
  filteredCount: number;
  contentReadyCount: number;
  contentDegradedCount: number;
  contentMissingCount: number;
  titleOnlyCount: number;
  snippetOnlyCount: number;
  longReadRiskCount: number;
  scoredCount: number;
  summaryReadyCount: number;
  summaryFailedCount: number;
  translationReadyCount: number;
  translationFailedCount: number;
  reportCandidateCount: number;
  reportSelectedCount: number;
  hotNotSelectedCount: number;
  averageContentLength: number;
};

export type SourceHealthAiFailure = {
  stage: 'quality' | 'score' | 'summary' | 'translation' | 'other' | string;
  reason: string;
  count: number;
};

export type SourceHealthInput = {
  source: SourceHealthSource;
  fetchLogs: SourceHealthFetchLog[];
  stats: SourceHealthStats;
  aiFailures: SourceHealthAiFailure[];
};

export type SourceStageHealth = {
  status: SourceStageStatus;
  label: string;
  summary: string;
  latestIssue: string | null;
  metrics: Record<string, number | string | null>;
};

export type SourceRecommendedAction = {
  action: SourceRecommendedActionName;
  label: string;
  reason: string;
  stage: 'fetch' | 'content' | 'ai' | 'report';
};

export type SourceHealthSnapshot = {
  healthStatus: SourceHealthStatus;
  healthLabel: string;
  healthReasons: string[];
  stageHealth: {
    fetch: SourceStageHealth;
    content: SourceStageHealth;
    display: SourceStageHealth;
    ai: SourceStageHealth;
    report: SourceStageHealth;
  };
  recommendedActions: SourceRecommendedAction[];
};

function asCount(value: number | null | undefined): number {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed);
}

function asRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Number(Math.max(0, Math.min(1, numerator / denominator)).toFixed(3));
}

function latestLog(logs: SourceHealthFetchLog[]): SourceHealthFetchLog | null {
  return logs[0] || null;
}

function countConsecutiveFailures(logs: SourceHealthFetchLog[]): number {
  let failures = 0;
  for (const log of logs) {
    if (log.status === 'error' || log.outcome === 'error' || log.error) failures++;
    else break;
  }
  return failures;
}

function containsTimeout(value?: string | null): boolean {
  return /timeout|timed out|超时/i.test(String(value || ''));
}

function containsTransientDnsFailure(value?: string | null): boolean {
  return /EAI_AGAIN|temporary failure in name resolution|getaddrinfo[^\n]*again|temporary DNS/i.test(String(value || ''));
}

function hasTransientDnsFailure(input: SourceHealthInput): boolean {
  return containsTransientDnsFailure(input.source.lastError)
    || input.fetchLogs.some((row) => containsTransientDnsFailure(row.error));
}

function sourceTypeLabel(input: SourceHealthSource): string {
  const sourceType = String(input.sourceType || '').toLowerCase();
  const type = String(input.collectorType || '').toLowerCase();
  if (sourceType === 'email') return '邮箱投递';
  if (sourceType === 'curated_index' || type === 'webpage_index') return '榜单源';
  if (type === 'rss' || type === 'rsshub') return '订阅源';
  if (type === 'changedetection') return '网页监控';
  if (type === 'webpage' || type === 'browser-assist') return '网页抓取';
  return '抓取';
}

function isEmailSource(input: SourceHealthSource): boolean {
  return String(input.sourceType || '').toLowerCase() === 'email';
}

type ExpectedSourceDomain = {
  keyword: string;
  host: string;
  label: string;
};

const EXPECTED_SOURCE_DOMAINS: ExpectedSourceDomain[] = [
  { keyword: 'openai', host: 'openai.com', label: 'OpenAI' },
  { keyword: 'anthropic', host: 'anthropic.com', label: 'Anthropic' },
  { keyword: 'claude', host: 'anthropic.com', label: 'Claude/Anthropic' },
  { keyword: 'john d. cook', host: 'johndcook.com', label: 'John D. Cook' },
  { keyword: 'johndcook', host: 'johndcook.com', label: 'John D. Cook' },
  { keyword: 'simon willison', host: 'simonwillison.net', label: 'Simon Willison' },
  { keyword: 'daring fireball', host: 'daringfireball.net', label: 'Daring Fireball' },
  { keyword: 'techcrunch', host: 'techcrunch.com', label: 'TechCrunch' },
  { keyword: 'the verge', host: 'theverge.com', label: 'The Verge' },
  { keyword: '36kr', host: '36kr.com', label: '36kr' },
  { keyword: 'bestblogs', host: 'bestblogs.dev', label: 'BestBlogs' },
];

const COMMUNITY_CONTEXT_WORDS = [
  'v2ex',
  'twitter',
  'x.com',
  'reddit',
  'hacker news',
  'rsshub',
  '微博',
  '论坛',
  '社区',
  '讨论',
];

function hostFromUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function collectConfigHosts(config: Record<string, unknown> | null | undefined): string[] {
  if (!config) return [];
  return Array.from(new Set([
    config.url,
    config.feedUrl,
    config.htmlUrl,
    config.siteUrl,
    config.originalUrl,
  ].map(hostFromUrl).filter(Boolean) as string[]));
}

export function detectSourceConfigMismatch(source: SourceHealthSource): string | null {
  const name = String(source.name || '').trim();
  const normalizedName = name.toLowerCase();
  if (!normalizedName) return null;
  if (COMMUNITY_CONTEXT_WORDS.some((word) => normalizedName.includes(word))) return null;

  const expected = EXPECTED_SOURCE_DOMAINS.find((entry) => normalizedName.includes(entry.keyword));
  if (!expected) return null;

  const hosts = collectConfigHosts(source.config);
  if (hosts.length === 0) return null;
  if (hosts.some((host) => host === expected.host || host.endsWith(`.${expected.host}`))) return null;

  return `来源命名/URL 不一致：${expected.label} 源实际抓取 ${hosts.join('、')}，需要检查订阅 URL 或把来源命名为社区/转述来源。`;
}

function humanizeIssue(reason: string): string {
  const raw = String(reason || '').trim();
  if (!raw) return '未知错误';
  if (/summary_must_be_chinese/i.test(raw)) return '摘要需要中文化';
  if (/llm_?500|500/i.test(raw)) return '模型服务返回 500';
  if (/timeout|timed out/i.test(raw)) return '处理超时';
  if (/content|extract|正文/i.test(raw)) return '正文抽取失败';
  return raw.replace(/_/g, ' ');
}

function buildFetchStage(input: SourceHealthInput): SourceStageHealth {
  const log = latestLog(input.fetchLogs);
  const failures = countConsecutiveFailures(input.fetchLogs);
  const timeout = containsTimeout(input.source.lastError) || input.fetchLogs.some((row) => containsTimeout(row.error));
  const transientDnsFailure = hasTransientDnsFailure(input);
  const totalFound = input.fetchLogs.reduce((sum, row) => sum + asCount(row.itemsFound), 0);
  const totalDuplicate = input.fetchLogs.reduce((sum, row) => sum + asCount(row.itemsDuplicate), 0);
  const duplicateRate = asRate(totalDuplicate, totalFound);
  const durationMs = asCount(log?.durationMs);
  const configMismatchIssue = detectSourceConfigMismatch(input.source);

  if (isEmailSource(input.source)) {
    const delivered = asCount(input.stats.itemCount);
    if (delivered > 0) {
      return {
        status: 'healthy',
        label: '已投递',
        summary: `已收到 ${delivered} 条邮件投递，后续按正文和 AI 阶段继续处理。`,
        latestIssue: null,
        metrics: {
          lastAttemptAt: input.source.lastFetchedAt ? String(input.source.lastFetchedAt) : null,
          lastSuccessAt: input.source.lastSuccessAt ? String(input.source.lastSuccessAt) : null,
          consecutiveFailures: 0,
          duplicateRate,
          durationMs,
        },
      };
    }
    return {
      status: 'empty',
      label: '等待邮件投递',
      summary: '邮箱入口已配置，还没有收到可处理邮件。',
      latestIssue: null,
      metrics: {
        lastAttemptAt: null,
        lastSuccessAt: null,
        consecutiveFailures: 0,
        duplicateRate,
        durationMs,
      },
    };
  }

  if (configMismatchIssue) {
    return {
      status: 'degraded',
      label: '来源配置需确认',
      summary: '来源名称像官方源，但订阅 URL 指向另一个站点；这会污染阅读、推荐和日报判断。',
      latestIssue: configMismatchIssue,
      metrics: {
        lastAttemptAt: input.source.lastFetchedAt ? String(input.source.lastFetchedAt) : null,
        lastSuccessAt: input.source.lastSuccessAt ? String(input.source.lastSuccessAt) : null,
        consecutiveFailures: failures,
        duplicateRate,
        durationMs,
      },
    };
  }

  if (!input.source.lastSuccessAt && input.fetchLogs.length === 0) {
    return {
      status: 'stale',
      label: '尚未成功抓取',
      summary: '来源已经配置，但还没有可证明的成功抓取记录。',
      latestIssue: '已配置但还没有成功抓取记录。',
      metrics: {
        lastAttemptAt: input.source.lastFetchedAt ? String(input.source.lastFetchedAt) : null,
        lastSuccessAt: null,
        consecutiveFailures: failures,
        duplicateRate,
        durationMs,
      },
    };
  }

  if (input.source.lastOutcome === 'error' || log?.status === 'error' || input.source.lastError) {
    return {
      status: 'failing',
      label: transientDnsFailure ? '网络解析异常' : timeout ? '抓取超时' : '抓取失败',
      summary: transientDnsFailure
        ? '容器 DNS 出现临时解析失败，系统会拉长间隔后重试，暂时不需要修改来源 URL。'
        : timeout ? `最近${sourceTypeLabel(input.source)}超时，普通调度不应被它阻塞。` : '最近抓取失败，需要检查来源可访问性。',
      latestIssue: transientDnsFailure
        ? '容器 DNS 临时解析失败（EAI_AGAIN），请等待系统重试；若多个来源同时出现，优先检查 Docker 网络而非单个订阅地址。'
        : timeout
        ? `${sourceTypeLabel(input.source)}超时，建议检查来源可访问性或人工调整抓取模式。`
        : (input.source.lastError || log?.error || '最近抓取失败。'),
      metrics: {
        lastAttemptAt: input.source.lastFetchedAt ? String(input.source.lastFetchedAt) : null,
        lastSuccessAt: input.source.lastSuccessAt ? String(input.source.lastSuccessAt) : null,
        consecutiveFailures: Math.max(1, failures),
        networkFailureKind: transientDnsFailure ? 'dns_transient' : null,
        duplicateRate,
        durationMs,
      },
    };
  }

  if (input.source.lastOutcome === 'no_items') {
    return {
      status: 'empty',
      label: '抓取成功但无条目',
      summary: '来源可访问，但最近没有发现可入库内容。',
      latestIssue: '抓取成功，但没有发现新条目。',
      metrics: {
        lastAttemptAt: input.source.lastFetchedAt ? String(input.source.lastFetchedAt) : null,
        lastSuccessAt: input.source.lastSuccessAt ? String(input.source.lastSuccessAt) : null,
        consecutiveFailures: failures,
        duplicateRate,
        durationMs,
      },
    };
  }

  return {
    status: 'healthy',
    label: '抓取正常',
    summary: '最近抓取链路有成功记录。',
    latestIssue: null,
    metrics: {
      lastAttemptAt: input.source.lastFetchedAt ? String(input.source.lastFetchedAt) : null,
      lastSuccessAt: input.source.lastSuccessAt ? String(input.source.lastSuccessAt) : null,
      consecutiveFailures: failures,
      duplicateRate,
      durationMs,
    },
  };
}

function buildContentStage(input: SourceHealthInput): SourceStageHealth {
  const visible = Math.max(1, asCount(input.stats.visibleCount));
  const ready = asCount(input.stats.contentReadyCount);
  const degraded = asCount(input.stats.contentDegradedCount);
  const missing = asCount(input.stats.contentMissingCount);
  const readyRate = asRate(ready, visible);
  const isCuratedIndex = String(input.source.sourceType || '').toLowerCase() === 'curated_index'
    || String(input.source.collectorType || '').toLowerCase() === 'webpage_index';
  if (isCuratedIndex && ready === 0 && degraded > 0) {
    return {
      status: 'degraded',
      label: '榜单摘要可读',
      summary: '已抓到榜单摘要，原文正文还需要后续补抓。',
      latestIssue: '榜单摘要可读，原文待补抓。',
      metrics: {
        ready,
        degraded,
        missing,
        readyRate,
        averageContentLength: asCount(input.stats.averageContentLength),
        extractionEngine: typeof input.source.config?.lastFetchEngine === 'string' ? input.source.config.lastFetchEngine : null,
        blockedReason: typeof input.source.config?.lastBlockedReason === 'string' ? input.source.config.lastBlockedReason : null,
      },
    };
  }
  const status: SourceStageStatus = readyRate >= 0.75 ? 'healthy' : ready > 0 ? 'degraded' : input.stats.visibleCount > 0 ? 'failing' : 'empty';
  return {
    status,
    label: status === 'healthy' ? '正文可读' : status === 'empty' ? '暂无正文样本' : '正文质量偏低',
    summary: status === 'healthy'
      ? '多数可见条目已经有可读正文。'
      : `${input.stats.visibleCount} 条可见内容中只有 ${ready} 条正文可读。`,
    latestIssue: status === 'healthy' || status === 'empty' ? null : `${input.stats.visibleCount} 条可见内容中只有 ${ready} 条正文可读。`,
    metrics: {
      ready,
      degraded,
      missing,
      readyRate,
      averageContentLength: asCount(input.stats.averageContentLength),
      extractionEngine: typeof input.source.config?.lastFetchEngine === 'string' ? input.source.config.lastFetchEngine : null,
      blockedReason: typeof input.source.config?.lastBlockedReason === 'string' ? input.source.config.lastBlockedReason : null,
    },
  };
}

function buildDisplayStage(input: SourceHealthInput): SourceStageHealth {
  if (asCount(input.stats.visibleCount) === 0) {
    return {
      status: 'empty',
      label: '暂无展示样本',
      summary: '还没有可见条目，暂时无法判断列表和详情页的可读性。',
      latestIssue: null,
      metrics: {
        titleOnly: 0,
        snippetOnly: 0,
        longReadRisk: 0,
        degradedRate: 0,
      },
    };
  }
  const visible = Math.max(1, asCount(input.stats.visibleCount));
  const titleOnly = asCount(input.stats.titleOnlyCount);
  const snippetOnly = asCount(input.stats.snippetOnlyCount);
  const longReadRisk = asCount(input.stats.longReadRiskCount);
  const degradedRate = asRate(titleOnly + snippetOnly + longReadRisk, visible);
  const status: SourceStageStatus = degradedRate >= 0.5 ? 'degraded' : 'healthy';
  return {
    status,
    label: status === 'healthy' ? '展示可读' : '展示需优化',
    summary: status === 'healthy' ? '列表和详情页有足够正文依据。' : '部分条目只有标题/片段，或长文格式风险较高。',
    latestIssue: status === 'healthy' ? null : '部分条目只有标题/片段，或长文格式风险较高。',
    metrics: {
      titleOnly,
      snippetOnly,
      longReadRisk,
      degradedRate,
    },
  };
}

function buildAiStage(input: SourceHealthInput): SourceStageHealth {
  if (asCount(input.stats.visibleCount) === 0) {
    return {
      status: 'empty',
      label: '暂无 AI 样本',
      summary: '还没有可见条目，暂时不需要重跑 AI。',
      latestIssue: null,
      metrics: {
        scored: 0,
        summarized: 0,
        translated: 0,
        summaryFailed: 0,
        translationFailed: 0,
        readyRate: 0,
      },
    };
  }
  const visible = Math.max(1, asCount(input.stats.visibleCount));
  const scored = asCount(input.stats.scoredCount);
  const summarized = asCount(input.stats.summaryReadyCount);
  const translated = asCount(input.stats.translationReadyCount);
  const summaryFailed = asCount(input.stats.summaryFailedCount);
  const translationFailed = asCount(input.stats.translationFailedCount);
  const readyRate = asRate(scored + summarized + translated, visible * 3);
  const failing = summaryFailed + translationFailed > 0 || input.aiFailures.length > 0;
  const status: SourceStageStatus = failing ? 'failing' : readyRate >= 0.75 ? 'healthy' : 'degraded';
  const issues = input.aiFailures.map((failure) => humanizeIssue(failure.reason));
  const latestIssue = issues.length > 0 ? `${Array.from(new Set(issues)).join('；')}。` : null;
  return {
    status,
    label: status === 'healthy' ? 'AI 已处理' : status === 'failing' ? 'AI 处理失败' : 'AI 待补处理',
    summary: status === 'healthy' ? '评分、摘要、翻译整体完成度较好。' : '评分、摘要或翻译存在待修复条目。',
    latestIssue,
    metrics: {
      scored,
      summarized,
      translated,
      summaryFailed,
      translationFailed,
      readyRate,
    },
  };
}

function buildReportStage(input: SourceHealthInput): SourceStageHealth {
  if (asCount(input.stats.visibleCount) === 0) {
    return {
      status: 'empty',
      label: '暂无日报样本',
      summary: '还没有可见条目，暂时无法判断日报覆盖。',
      latestIssue: null,
      metrics: {
        candidates: 0,
        selected: 0,
        hotNotSelected: 0,
        selectedRate: 0,
      },
    };
  }
  const candidates = asCount(input.stats.reportCandidateCount);
  const selected = asCount(input.stats.reportSelectedCount);
  const hotNotSelected = asCount(input.stats.hotNotSelectedCount);
  if (candidates === 0 && selected === 0 && hotNotSelected === 0) {
    return {
      status: 'empty',
      label: '暂无日报候选',
      summary: '已有可见内容，但当前还没有形成日报候选。',
      latestIssue: null,
      metrics: {
        candidates,
        selected,
        hotNotSelected,
        selectedRate: 0,
      },
    };
  }
  const status: SourceStageStatus = hotNotSelected > 0 ? 'degraded' : candidates > 0 && selected === 0 ? 'degraded' : 'healthy';
  return {
    status,
    label: status === 'healthy' ? '日报覆盖正常' : '日报可能漏报',
    summary: status === 'healthy' ? '未发现明显日报覆盖缺口。' : '有候选或热点内容没有进入日报，需要复核覆盖策略。',
    latestIssue: status === 'healthy' ? null : '有热点内容命中但没有进入日报。',
    metrics: {
      candidates,
      selected,
      hotNotSelected,
      selectedRate: asRate(selected, Math.max(candidates, 1)),
    },
  };
}

function healthLabel(status: SourceHealthStatus): string {
  const labels: Record<SourceHealthStatus, string> = {
    healthy: '健康',
    config_mismatch: '配置错配',
    needs_fetch: '待首次抓取',
    fetch_failing: '抓取失败',
    content_degraded: '正文质量差',
    ai_blocked: 'AI 卡住',
    report_gap: '影响日报',
    watch: '待观察',
  };
  return labels[status];
}

function pushAction(actions: SourceRecommendedAction[], action: SourceRecommendedAction) {
  if (!actions.some((existing) => existing.action === action.action)) actions.push(action);
}

function isPageMonitorSource(input: SourceHealthInput): boolean {
  return ['webpage', 'webpage_index', 'changedetection', 'browser-assist'].includes(String(input.source.collectorType || '').toLowerCase());
}

export function buildSourceHealthSnapshot(input: SourceHealthInput): SourceHealthSnapshot {
  const configMismatchIssue = detectSourceConfigMismatch(input.source);
  const fetch = buildFetchStage(input);
  const content = buildContentStage(input);
  const display = buildDisplayStage(input);
  const ai = buildAiStage(input);
  const report = buildReportStage(input);
  const actions: SourceRecommendedAction[] = [];
  const reasons: string[] = [];

  if (fetch.status === 'stale') {
    reasons.push('来源已配置，但还没有成功抓取记录。');
    pushAction(actions, { action: 'fetch', label: '立即抓取', reason: '先验证来源是否能产出内容。', stage: 'fetch' });
  }
  if (configMismatchIssue) {
    reasons.push(configMismatchIssue);
    pushAction(actions, { action: 'check_config', label: '检查配置', reason: '来源名称与订阅 URL 不一致，先确认它是官方源还是社区转述源。', stage: 'fetch' });
  }
  if (fetch.status === 'failing') {
    reasons.push(fetch.latestIssue || '最近抓取失败。');
    const transientDnsFailure = hasTransientDnsFailure(input);
    pushAction(actions, {
      action: 'fetch',
      label: transientDnsFailure ? '等待重试' : '重新抓取',
      reason: transientDnsFailure ? '等待 Docker DNS 恢复后由延时重试再次验证。' : '重新验证来源可访问性。',
      stage: 'fetch',
    });
    if (!transientDnsFailure) {
      pushAction(actions, { action: 'check_config', label: '检查配置', reason: '连续失败时需要人工确认 URL 或抓取模式。', stage: 'fetch' });
    }
  }
  if (content.status === 'degraded' || content.status === 'failing') {
    reasons.push(`正文质量偏低：${input.stats.visibleCount} 条可见内容中只有 ${asCount(input.stats.contentReadyCount)} 条正文可读。`);
    pushAction(actions, { action: 'repair_content', label: '补正文', reason: '补齐正文后摘要、翻译和日报才可靠。', stage: 'content' });
    if (content.status === 'failing' && isPageMonitorSource(input)) {
      pushAction(actions, { action: 'check_config', label: '检查配置', reason: '网页源可能抓到列表页或动态壳，需要人工确认监控 URL 与选择器。', stage: 'content' });
    }
  }
  if (ai.status === 'degraded' || ai.status === 'failing') {
    reasons.push(ai.status === 'failing'
      ? 'AI 处理失败：评分、摘要或翻译存在失败条目。'
      : 'AI 待补处理：评分、摘要或翻译还没有全部完成。');
    pushAction(actions, { action: 'repair_ai', label: '重跑 AI', reason: '补齐评分、摘要、翻译处理债。', stage: 'ai' });
  }
  if (report.status === 'degraded') {
    reasons.push('日报有遗漏风险：有热点内容命中但没有进入日报。');
    pushAction(actions, { action: 'review_daily_coverage', label: '复核日报覆盖', reason: '检查候选池、关键词和入报门槛。', stage: 'report' });
  }

  let healthStatus: SourceHealthStatus = 'healthy';
  if (fetch.status === 'stale') healthStatus = 'needs_fetch';
  else if (fetch.status === 'failing') healthStatus = 'fetch_failing';
  else if (configMismatchIssue) healthStatus = 'config_mismatch';
  else if (ai.status === 'degraded' || ai.status === 'failing') healthStatus = 'ai_blocked';
  else if (content.status === 'degraded' || content.status === 'failing') healthStatus = 'content_degraded';
  else if (report.status === 'degraded') healthStatus = 'report_gap';
  else if (display.status === 'degraded' || fetch.status === 'empty') healthStatus = 'watch';

  return {
    healthStatus,
    healthLabel: healthLabel(healthStatus),
    healthReasons: reasons,
    stageHealth: {
      fetch,
      content,
      display,
      ai,
      report,
    },
    recommendedActions: actions,
  };
}
