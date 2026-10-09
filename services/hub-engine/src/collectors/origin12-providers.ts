import { createHash } from 'node:crypto';
import { DOMParser, parseHTML } from 'linkedom';
import type { CollectorResult, RawItem, SourceConfig } from './base.js';

export type Origin12Provider =
  | 'origin12_ai_news'
  | 'origin12_the_batch'
  | 'origin12_research_radar'
  | 'origin12_model_reality'
  | 'origin12_semianalysis';

type FetchLike = typeof fetch;

export type Origin12Options = {
  fetchImpl?: FetchLike;
  now?: () => Date;
};

type ComponentObservation = {
  at: string;
  ok: boolean;
  outcome: string;
  error?: string;
};

export type Origin12ComponentHealth = {
  name: string;
  url: string;
  required: boolean;
  lastCheckedAt: string;
  lastSuccessAt: string | null;
  lastOutcome: string;
  lastError: string | null;
  attempts7d: number;
  successes7d: number;
  successRate: number | null;
  observations: ComponentObservation[];
};

type ComponentState = {
  requestUrl?: string;
  etag?: string | null;
  lastModified?: string | null;
  lastFingerprint?: string | null;
  backoffUntil?: string | null;
  cachedBody?: string | null;
  cachedAt?: string | null;
};

type Origin12Config = Record<string, unknown> & {
  provider?: Origin12Provider;
  endpoints?: Record<string, unknown>;
  componentState?: Record<string, ComponentState>;
  componentHealth?: Record<string, Origin12ComponentHealth>;
  lastFingerprint?: string;
  modelRealityBaseline?: ModelRealitySnapshot;
  maxItems?: number;
};

type FetchComponentResult = {
  key: string;
  name: string;
  url: string;
  body: string | null;
  fresh: boolean;
  ok: boolean;
  outcome: string;
  error: string | null;
  state: ComponentState;
  health: Origin12ComponentHealth;
};

type ResearchCandidate = {
  source: 'huggingface' | 'alphaxiv';
  title: string;
  url: string;
  arxivId: string | null;
};

type ArxivPaper = {
  arxivId: string;
  title: string;
  summary: string;
  authors: string[];
  publishedAt?: Date;
  updatedAt?: string;
  absUrl: string;
  pdfUrl: string | null;
};

export type ModelRealityEntry = {
  model: string;
  rank?: number | null;
  score?: number | null;
  price?: number | null;
  speed?: number | null;
};

export type ModelRealitySnapshot = {
  capturedAt: string;
  arena: ModelRealityEntry[];
  artificialAnalysis: ModelRealityEntry[];
  openRouter: ModelRealityEntry[];
};

export type ModelRealityChange = {
  provider: 'arena' | 'artificialAnalysis' | 'openRouter';
  model: string;
  kind: 'top10_enter' | 'top10_exit' | 'rank' | 'price' | 'speed' | 'score';
  before: number | null;
  after: number | null;
  delta: number | null;
};

const USER_AGENT = 'InfoHubV3/3.2 (+https://localhost)';
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_CACHE_BYTES = 512 * 1024;
const MAX_COMPONENT_OBSERVATIONS = 96;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const DEFAULT_ENDPOINTS: Record<Origin12Provider, Record<string, string>> = {
  origin12_ai_news: {
    aiNews: 'https://news.smol.ai/',
  },
  origin12_the_batch: {
    theBatch: 'https://www.deeplearning.ai/the-batch/',
  },
  origin12_research_radar: {
    huggingface: 'https://huggingface.co/papers',
    alphaxiv: 'https://alphaxiv.org/',
    arxiv: 'https://export.arxiv.org/api/query',
  },
  origin12_model_reality: {
    arena: 'https://arena.ai/leaderboard/text/english',
    artificialAnalysis: 'https://artificialanalysis.ai/leaderboards/models',
    openRouter: 'https://openrouter.ai/api/v1/models?sort=most-popular',
  },
  origin12_semianalysis: {
    semianalysis: 'https://newsletter.semianalysis.com/feed',
  },
};

const COMPONENT_NAMES: Record<string, string> = {
  aiNews: 'AI News',
  theBatch: 'The Batch',
  huggingface: 'Hugging Face Papers',
  alphaxiv: 'alphaXiv',
  arxiv: 'arXiv',
  arena: 'Arena',
  artificialAnalysis: 'Artificial Analysis',
  openRouter: 'OpenRouter',
  semianalysis: 'SemiAnalysis',
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const normalized = typeof value === 'string'
    ? value.replace(/[$,%]/g, '').replace(/,/g, '').trim()
    : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function hash(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function cleanText(value: unknown): string {
  return asString(value).replace(/\s+/g, ' ').trim();
}

function absoluteUrl(value: unknown, base: string): string | null {
  const raw = asString(value);
  if (!raw) return null;
  try {
    const url = new URL(raw, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeArxivId(value: unknown): string | null {
  const match = asString(value).match(/(?:arxiv[:/\s]|abs\/|pdf\/)?(\d{4}\.\d{4,5})(?:v\d+)?/i);
  return match?.[1] || null;
}

function componentEndpoint(config: Origin12Config, provider: Origin12Provider, key: string): string {
  return asString(asObject(config.endpoints)[key]) || DEFAULT_ENDPOINTS[provider][key];
}

function retryAfterDate(response: Response, now: Date): string {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return new Date(now.getTime() + Math.max(1, seconds) * 1000).toISOString();
    const parsed = new Date(retryAfter);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date(now.getTime() + 15 * 60 * 1000).toISOString();
}

function nextHealth(params: {
  previous?: Origin12ComponentHealth;
  key: string;
  url: string;
  now: Date;
  ok: boolean;
  outcome: string;
  error?: string | null;
}): Origin12ComponentHealth {
  const cutoff = params.now.getTime() - WINDOW_MS;
  const previous = Array.isArray(params.previous?.observations)
    ? params.previous.observations.filter((entry) => {
      const timestamp = new Date(entry.at).getTime();
      return Number.isFinite(timestamp) && timestamp >= cutoff;
    })
    : [];
  const observations = [...previous, {
    at: params.now.toISOString(),
    ok: params.ok,
    outcome: params.outcome,
    ...(params.error ? { error: params.error } : {}),
  }].slice(-MAX_COMPONENT_OBSERVATIONS);
  const successes = observations.filter((entry) => entry.ok).length;
  return {
    name: COMPONENT_NAMES[params.key] || params.key,
    url: params.url,
    required: true,
    lastCheckedAt: params.now.toISOString(),
    lastSuccessAt: params.ok ? params.now.toISOString() : params.previous?.lastSuccessAt || null,
    lastOutcome: params.outcome,
    lastError: params.error || null,
    attempts7d: observations.length,
    successes7d: successes,
    successRate: observations.length > 0 ? successes / observations.length : null,
    observations,
  };
}

async function readBoundedBody(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error(`component_response_too_large:${declared}`);
  const body = await response.text();
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes > MAX_RESPONSE_BYTES) throw new Error(`component_response_too_large:${bytes}`);
  return body;
}

async function fetchComponent(params: {
  key: string;
  url: string;
  accept: string;
  config: Origin12Config;
  options: Origin12Options;
  now: Date;
}): Promise<FetchComponentResult> {
  const storedState = params.config.componentState?.[params.key];
  // An arXiv id_list is a different resource; validators and bodies must travel together.
  const previousState = storedState?.requestUrl === params.url ? storedState : {};
  const previousHealth = params.config.componentHealth?.[params.key];
  const backoffUntil = previousState.backoffUntil ? new Date(previousState.backoffUntil) : null;
  if (backoffUntil && Number.isFinite(backoffUntil.getTime()) && backoffUntil > params.now) {
    const health = nextHealth({
      previous: previousHealth,
      key: params.key,
      url: params.url,
      now: params.now,
      ok: false,
      outcome: 'backoff',
      error: `backoff_until:${backoffUntil.toISOString()}`,
    });
    return {
      key: params.key,
      name: health.name,
      url: params.url,
      body: previousState.cachedBody || null,
      fresh: false,
      ok: false,
      outcome: 'backoff',
      error: health.lastError,
      state: previousState,
      health,
    };
  }

  const headers: Record<string, string> = {
    accept: params.accept,
    'user-agent': USER_AGENT,
  };
  if (previousState.cachedBody && previousState.etag) headers['if-none-match'] = previousState.etag;
  if (previousState.cachedBody && previousState.lastModified) headers['if-modified-since'] = previousState.lastModified;

  try {
    const response = await (params.options.fetchImpl || fetch)(params.url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 304) {
      if (!previousState.cachedBody) throw new Error('component_not_modified_without_cache');
      const health = nextHealth({
        previous: previousHealth,
        key: params.key,
        url: params.url,
        now: params.now,
        ok: true,
        outcome: 'not_modified',
      });
      return {
        key: params.key,
        name: health.name,
        url: params.url,
        body: previousState.cachedBody || null,
        fresh: false,
        ok: true,
        outcome: 'not_modified',
        error: null,
        state: previousState,
        health,
      };
    }
    if (response.status === 429) {
      const state = { ...previousState, requestUrl: params.url, backoffUntil: retryAfterDate(response, params.now) };
      const health = nextHealth({
        previous: previousHealth,
        key: params.key,
        url: params.url,
        now: params.now,
        ok: false,
        outcome: 'rate_limited',
        error: 'HTTP 429',
      });
      return {
        key: params.key,
        name: health.name,
        url: params.url,
        body: previousState.cachedBody || null,
        fresh: false,
        ok: false,
        outcome: 'rate_limited',
        error: 'HTTP 429',
        state,
        health,
      };
    }
    if (!response.ok) throw new Error(`component_http_${response.status}`);
    const body = await readBoundedBody(response);
    const fingerprint = hash(body);
    const unchanged = Boolean(previousState.lastFingerprint && previousState.lastFingerprint === fingerprint);
    const state: ComponentState = {
      requestUrl: params.url,
      etag: response.headers.get('etag') || null,
      lastModified: response.headers.get('last-modified') || null,
      lastFingerprint: fingerprint,
      backoffUntil: null,
      cachedBody: Buffer.byteLength(body, 'utf8') <= MAX_CACHE_BYTES ? body : null,
      cachedAt: params.now.toISOString(),
    };
    const outcome = unchanged ? 'fingerprint_unchanged' : 'updated';
    const health = nextHealth({
      previous: previousHealth,
      key: params.key,
      url: params.url,
      now: params.now,
      ok: true,
      outcome,
    });
    return {
      key: params.key,
      name: health.name,
      url: params.url,
      body,
      fresh: !unchanged,
      ok: true,
      outcome,
      error: null,
      state,
      health,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const health = nextHealth({
      previous: previousHealth,
      key: params.key,
      url: params.url,
      now: params.now,
      ok: false,
      outcome: previousState.cachedBody ? 'cache_fallback' : 'failed',
      error: message,
    });
    return {
      key: params.key,
      name: health.name,
      url: params.url,
      body: previousState.cachedBody || null,
      fresh: false,
      ok: false,
      outcome: health.lastOutcome,
      error: message,
      state: previousState,
      health,
    };
  }
}

function parseHtmlLinks(body: string, base: string): Array<{ title: string; url: string; context: string; time: string }> {
  const { document } = parseHTML(body) as any;
  return (Array.from(document.querySelectorAll('a[href]') as any) as any[]).flatMap((anchor) => {
    const title = cleanText(anchor.textContent)
      || cleanText(anchor.getAttribute('aria-label'))
      || cleanText(anchor.querySelector('img')?.getAttribute('alt'));
    const url = absoluteUrl(anchor.getAttribute('href'), base);
    if (!title || !url) return [];
    const container = anchor.closest('article, li, section, div');
    const time = container?.querySelector('time')?.getAttribute('datetime')
      || cleanText(container?.querySelector('time')?.textContent)
      || cleanText(container?.querySelector('a[href*="/the-batch/tag/"]')?.textContent);
    return [{
      title,
      url,
      context: cleanText(container?.textContent).slice(0, 1000),
      time: asString(time),
    }];
  });
}

function isSourceHost(url: URL, domain: string) {
  return !url.username && !url.password
    && (url.hostname === domain || url.hostname.endsWith(`.${domain}`));
}

function latestIssue(candidates: ReturnType<typeof parseHtmlLinks>) {
  const rank = (entry: (typeof candidates)[number]) => {
    const date = entry.time || new URL(entry.url).pathname.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    const timestamp = date ? Date.parse(date) : NaN;
    const issue = new URL(entry.url).pathname.match(/\/issue-(\d+)\/?$/i);
    return { timestamp: Number.isFinite(timestamp) ? timestamp : 0, issue: Number(issue?.[1] || 0) };
  };
  return candidates.sort((a, b) => {
    const left = rank(a);
    const right = rank(b);
    return right.issue - left.issue || right.timestamp - left.timestamp;
  })[0];
}

function issuePublishedAt(value: string) {
  if (!value) return undefined;
  const date = new Date(/^[A-Za-z]+ \d{1,2}, \d{4}$/.test(value) ? `${value} UTC` : value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function parseAiNewsIssue(body: string, base = DEFAULT_ENDPOINTS.origin12_ai_news.aiNews): RawItem | null {
  const candidates = parseHtmlLinks(body, base).filter((entry) => {
    const url = new URL(entry.url);
    const path = url.pathname.toLowerCase();
    return isSourceHost(url, 'smol.ai')
      && /^\/(?:issues|p)\/[^/]+\/?$/.test(path)
      && !/\/(?:tag|page|archive|search|subscribe)\/?$/.test(path);
  });
  const latest = latestIssue(candidates);
  if (!latest) return null;
  const publishedAt = issuePublishedAt(latest.time);
  return {
    title: latest.title,
    url: latest.url,
    originalUrl: latest.url,
    guid: `origin12:ai-news:${hash(latest.url).slice(0, 24)}`,
    content: latest.context || 'AI News 工作日雷达索引。',
    author: 'smol.ai',
    publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : undefined,
    curationUrl: base,
    curationSource: 'AI News',
    curationMeta: {
      evidenceScope: 'discovery_index',
      contentKind: 'issue_index',
      isPrimaryEvidence: false,
      isFullText: false,
      evidenceNotice: '发现材料；应沿原始链接回到公告、论文或开发者原帖核验。',
      attribution: { source: 'AI News', canonical: latest.url, required: true },
    },
    fetchEngine: 'origin12_html',
    renderMode: 'curated_index',
  };
}

export function parseTheBatchIssue(body: string, base = DEFAULT_ENDPOINTS.origin12_the_batch.theBatch): RawItem | null {
  const candidates = parseHtmlLinks(body, base).filter((entry) => {
    const url = new URL(entry.url);
    const path = url.pathname.replace(/\/+$/, '').toLowerCase();
    return isSourceHost(url, 'deeplearning.ai')
      && /^\/the-batch\/[^/]+$/.test(path)
      && !/\/(?:about|contact|privacy|terms|tag|tags|page|archive|search|subscribe|authors?|rss|feed)$/.test(path);
  });
  const latest = latestIssue(candidates);
  if (!latest) return null;
  const publishedAt = issuePublishedAt(latest.time);
  return {
    title: latest.title,
    url: latest.url,
    originalUrl: latest.url,
    guid: `origin12:the-batch:${hash(latest.url).slice(0, 24)}`,
    content: latest.context || 'The Batch 周报索引。',
    author: 'DeepLearning.AI',
    publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : undefined,
    curationUrl: base,
    curationSource: 'The Batch',
    curationMeta: {
      evidenceScope: 'analysis_index',
      contentKind: 'weekly_issue',
      isPrimaryEvidence: false,
      isFullText: false,
      evidenceNotice: '编辑周报与分析材料，不替代其引用的原始证据。',
      attribution: { source: 'The Batch', canonical: latest.url, required: true },
    },
    fetchEngine: 'origin12_html',
    renderMode: 'curated_index',
  };
}

export function parseResearchCandidates(
  body: string,
  source: ResearchCandidate['source'],
  base: string,
): ResearchCandidate[] {
  const links = parseHtmlLinks(body, base);
  const seen = new Set<string>();
  const candidates: ResearchCandidate[] = [];
  for (const link of links) {
    const url = new URL(link.url);
    const paperPath = source === 'huggingface'
      ? isSourceHost(url, 'huggingface.co') && url.pathname.match(/^\/papers\/([^/]+)\/?$/)
      : isSourceHost(url, 'alphaxiv.org') && url.pathname.match(/^\/(?:abs|paper)\/([^/]+)\/?$/);
    if (!paperPath) continue;
    if (/^(?:date|trending|daily|weekly|monthly|search|submit|about|all)$/i.test(paperPath[1])) continue;
    if (/^(?:previous|next|view\s*(?:all|pdf)\d*|download\s*pdf|autoresearch|replicate|follow|\d+)$/i.test(link.title)) continue;
    // Only this link establishes identity. Nearby IDs may belong to another card.
    const arxivId = paperPath[1].match(/^(\d{4}\.\d{4,5})(?:v\d+)?$/)?.[1] || null;
    url.search = '';
    const key = arxivId ? `arxiv:${arxivId}` : `${source}:${url.toString()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ source, title: link.title, url: url.toString(), arxivId });
  }
  return candidates.slice(0, 40);
}

export function parseArxivAtom(body: string): Map<string, ArxivPaper> {
  const document = new DOMParser().parseFromString(body, 'text/xml') as any;
  const papers = new Map<string, ArxivPaper>();
  if (!document) return papers;
  for (const entry of Array.from(document.querySelectorAll('entry') as any) as any[]) {
    const rawId = cleanText(entry.querySelector('id')?.textContent);
    const arxivId = normalizeArxivId(rawId);
    if (!arxivId) continue;
    const links = (Array.from(entry.querySelectorAll('link') as any) as any[]).map((link) => ({
      href: asString(link.getAttribute('href')),
      rel: asString(link.getAttribute('rel')),
      type: asString(link.getAttribute('type')),
      title: asString(link.getAttribute('title')),
    }));
    const absUrl = links.find((link) => link.rel === 'alternate')?.href
      || absoluteUrl(rawId, 'https://arxiv.org/')
      || `https://arxiv.org/abs/${arxivId}`;
    const pdfUrl = links.find((link) => link.title === 'pdf' || link.type === 'application/pdf')?.href || null;
    const published = cleanText(entry.querySelector('published')?.textContent);
    const publishedAt = published ? new Date(published) : undefined;
    papers.set(arxivId, {
      arxivId,
      title: cleanText(entry.querySelector('title')?.textContent) || arxivId,
      summary: cleanText(entry.querySelector('summary')?.textContent),
      authors: (Array.from(entry.querySelectorAll('author > name') as any) as any[]).map((node) => cleanText(node.textContent)).filter(Boolean),
      publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : undefined,
      updatedAt: cleanText(entry.querySelector('updated')?.textContent) || undefined,
      absUrl,
      pdfUrl,
    });
  }
  return papers;
}

export function mergeResearchPapers(candidates: ResearchCandidate[], arxivPapers: Map<string, ArxivPaper>): RawItem[] {
  const groups = new Map<string, ResearchCandidate[]>();
  for (const candidate of candidates) {
    const key = candidate.arxivId ? `arxiv:${candidate.arxivId}` : `${candidate.source}:${candidate.url}`;
    groups.set(key, [...(groups.get(key) || []), candidate]);
  }
  return Array.from(groups.entries()).map(([key, evidence]) => {
    const arxivId = evidence[0].arxivId;
    const paper = arxivId ? arxivPapers.get(arxivId) : undefined;
    const sourceLinks: Array<{ source: 'huggingface' | 'alphaxiv' | 'arxiv'; url: string }> = evidence
      .map((entry) => ({ source: entry.source, url: entry.url }));
    if (paper) sourceLinks.push({ source: 'arxiv', url: paper.absUrl });
    const canonical = paper?.absUrl || evidence[0].url;
    return {
      title: paper?.title || evidence[0].title,
      url: canonical,
      originalUrl: canonical,
      guid: `origin12:paper:${arxivId || hash(key).slice(0, 24)}`,
      content: paper?.summary || '论文发现索引；尚未取得 arXiv 摘要。',
      author: paper?.authors.join(', ') || evidence.map((entry) => entry.source).join(' + '),
      publishedAt: paper?.publishedAt,
      curationUrl: evidence[0].url,
      curationSource: '论文雷达',
      curationMeta: {
        evidenceScope: 'research_index',
        contentKind: paper ? 'abstract' : 'discovery_only',
        isPrimaryEvidence: Boolean(paper),
        isFullText: false,
        evidenceNotice: paper
          ? 'arXiv 摘要与版本信息，不代表同行评审，也不是论文全文。'
          : '社区筛选线索，缺少 arXiv ID 时不与其他论文做模糊合并。',
        researchEvidence: {
          arxivId,
          versionUpdatedAt: paper?.updatedAt || null,
          abstractUrl: paper?.absUrl || null,
          pdfUrl: paper?.pdfUrl || null,
          links: sourceLinks,
          collectedAt: new Date().toISOString(),
          metricDefinition: 'Hugging Face/alphaXiv 社区筛选 + arXiv 原始摘要与版本',
        },
        attribution: { source: '论文雷达', canonical, required: true },
      },
      fetchEngine: 'origin12_research_merge',
      renderMode: 'research_index',
    } satisfies RawItem;
  });
}

function tableRows(body: string): Array<Record<string, string>> {
  const { document } = parseHTML(body) as any;
  const rows: Array<Record<string, string>> = [];
  for (const table of Array.from(document.querySelectorAll('table') as any) as any[]) {
    const headerCells = Array.from(table.querySelectorAll('thead th, tr:first-child th') as any) as any[];
    const headers = headerCells.map((cell, index) => cleanText(cell.textContent).toLowerCase() || `column${index}`);
    const explicitRows = Array.from(table.querySelectorAll('tbody tr') as any) as any[];
    const bodyRows = explicitRows.length > 0
      ? explicitRows
      : (Array.from(table.querySelectorAll('tr') as any) as any[]).slice(1);
    for (const row of bodyRows) {
      const cells = (Array.from(row.querySelectorAll('td, th') as any) as any[]).map((cell) => cleanText(cell.textContent));
      if (cells.length < 2) continue;
      rows.push(Object.fromEntries(cells.map((cell, index) => [headers[index] || `column${index}`, cell])));
    }
  }
  return rows;
}

function modelRowsFromEmbeddedJson(body: string): ModelRealityEntry[] {
  const { document } = parseHTML(body) as any;
  const values: unknown[] = [];
  for (const script of Array.from(document.querySelectorAll('script') as any) as any[]) {
    const text = asString(script.textContent);
    if (!text || text.length > 2 * 1024 * 1024 || (!text.startsWith('{') && !text.startsWith('['))) continue;
    try {
      values.push(JSON.parse(text));
    } catch {
      // Ignore non-JSON scripts. Browser execution is intentionally out of scope.
    }
  }
  const entries: ModelRealityEntry[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 10 || entries.length >= 100) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, depth + 1));
      return;
    }
    const object = asObject(value);
    if (Object.keys(object).length === 0) return;
    const model = asString(object.model)
      || asString(object.modelName)
      || asString(object.model_name)
      || asString(object.displayName)
      || asString(object.display_name);
    if (model) {
      entries.push({
        model,
        rank: asNumber(object.rank ?? object.ranking ?? object.position),
        score: asNumber(object.score ?? object.elo ?? object.rating ?? object.intelligenceIndex ?? object.intelligence_index),
        price: asNumber(object.price ?? object.cost ?? object.outputPrice ?? object.output_price),
        speed: asNumber(object.speed ?? object.outputSpeed ?? object.output_speed ?? object.tokensPerSecond ?? object.tokens_per_second),
      });
    }
    Object.values(object).forEach((entry) => visit(entry, depth + 1));
  };
  values.forEach((value) => visit(value, 0));
  const seen = new Set<string>();
  return entries.filter((entry, index) => {
    const key = normalizeModelName(entry.model);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    if (!entry.rank) entry.rank = index + 1;
    return true;
  }).slice(0, 50);
}

function valueFor(row: Record<string, string>, patterns: RegExp[]): string {
  const entry = Object.entries(row).find(([key]) => patterns.some((pattern) => pattern.test(key)));
  return entry?.[1] || '';
}

export function parseModelLeaderboard(body: string): ModelRealityEntry[] {
  const rows = tableRows(body).flatMap((row, index) => {
    const model = valueFor(row, [/model/, /name/, /模型/]) || Object.values(row)[1] || '';
    if (!model) return [];
    const rank = asNumber(valueFor(row, [/rank/, /排名/])) ?? index + 1;
    return [{
      model,
      rank,
      score: asNumber(valueFor(row, [/score/, /index/, /elo/, /quality/, /intelligence/, /指数/])),
      price: asNumber(valueFor(row, [/price/, /cost/, /价格/])),
      speed: asNumber(valueFor(row, [/speed/, /tokens.*sec/, /output.*speed/, /速度/])),
    }];
  }).slice(0, 50);
  return rows.length > 0 ? rows : modelRowsFromEmbeddedJson(body);
}

export function parseOpenRouterModels(body: string): ModelRealityEntry[] {
  const raw = JSON.parse(body) as unknown;
  const entries = Array.isArray(asObject(raw).data) ? asObject(raw).data as unknown[] : [];
  return entries.flatMap((value, index) => {
    const model = asObject(value);
    const id = asString(model.id) || asString(model.name);
    if (!id) return [];
    const pricing = asObject(model.pricing);
    const prompt = asNumber(pricing.prompt);
    const completion = asNumber(pricing.completion);
    const price = prompt === null && completion === null
      ? null
      : ((prompt || 0) + (completion || 0)) * 1_000_000;
    return [{ model: id, rank: index + 1, price }];
  }).slice(0, 50);
}

function normalizeModelName(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function percentDelta(before: number, after: number): number | null {
  if (before === 0) return after === 0 ? 0 : null;
  return Math.abs((after - before) / before);
}

export function meaningfulModelChanges(
  previous: ModelRealitySnapshot,
  current: ModelRealitySnapshot,
): ModelRealityChange[] {
  const changes: ModelRealityChange[] = [];
  const providers: Array<ModelRealityChange['provider']> = ['arena', 'artificialAnalysis', 'openRouter'];
  for (const provider of providers) {
    const beforeEntries = previous[provider];
    const afterEntries = current[provider];
    const before = new Map(beforeEntries.map((entry) => [normalizeModelName(entry.model), entry]));
    const after = new Map(afterEntries.map((entry) => [normalizeModelName(entry.model), entry]));
    const models = new Set([...before.keys(), ...after.keys()]);
    for (const modelKey of models) {
      const oldEntry = before.get(modelKey);
      const newEntry = after.get(modelKey);
      const oldTop10 = Boolean(oldEntry?.rank && oldEntry.rank <= 10);
      const newTop10 = Boolean(newEntry?.rank && newEntry.rank <= 10);
      if (!oldTop10 && newTop10) {
        changes.push({ provider, model: newEntry?.model || modelKey, kind: 'top10_enter', before: oldEntry?.rank ?? null, after: newEntry?.rank ?? null, delta: null });
      } else if (oldTop10 && !newTop10) {
        changes.push({ provider, model: oldEntry?.model || modelKey, kind: 'top10_exit', before: oldEntry?.rank ?? null, after: newEntry?.rank ?? null, delta: null });
      }
      if (oldEntry?.rank && newEntry?.rank && Math.abs(newEntry.rank - oldEntry.rank) >= 3) {
        changes.push({ provider, model: newEntry.model, kind: 'rank', before: oldEntry.rank, after: newEntry.rank, delta: newEntry.rank - oldEntry.rank });
      }
      if (oldEntry?.price !== null && oldEntry?.price !== undefined && newEntry?.price !== null && newEntry?.price !== undefined) {
        const delta = percentDelta(oldEntry.price, newEntry.price);
        if (delta !== null && delta >= 0.1) changes.push({ provider, model: newEntry.model, kind: 'price', before: oldEntry.price, after: newEntry.price, delta: newEntry.price - oldEntry.price });
      }
      if (oldEntry?.speed !== null && oldEntry?.speed !== undefined && newEntry?.speed !== null && newEntry?.speed !== undefined) {
        const delta = percentDelta(oldEntry.speed, newEntry.speed);
        if (delta !== null && delta >= 0.2) changes.push({ provider, model: newEntry.model, kind: 'speed', before: oldEntry.speed, after: newEntry.speed, delta: newEntry.speed - oldEntry.speed });
      }
      if (provider === 'artificialAnalysis'
        && oldEntry?.score !== null && oldEntry?.score !== undefined
        && newEntry?.score !== null && newEntry?.score !== undefined
        && Math.abs(newEntry.score - oldEntry.score) >= 2) {
        changes.push({ provider, model: newEntry.model, kind: 'score', before: oldEntry.score, after: newEntry.score, delta: newEntry.score - oldEntry.score });
      }
    }
  }
  return changes;
}

function modelChangeLabel(change: ModelRealityChange): string {
  if (change.kind === 'top10_enter') return `${change.model} 进入 Top 10`;
  if (change.kind === 'top10_exit') return `${change.model} 退出 Top 10`;
  if (change.kind === 'rank') return `${change.model} 名次 ${change.before}→${change.after}`;
  if (change.kind === 'price') return `${change.model} 价格 ${change.before}→${change.after}`;
  if (change.kind === 'speed') return `${change.model} 速度 ${change.before}→${change.after}`;
  return `${change.model} 指数 ${change.before}→${change.after}`;
}

function buildModelRealityItem(snapshot: ModelRealitySnapshot, changes: ModelRealityChange[]): RawItem {
  const day = snapshot.capturedAt.slice(0, 10);
  return {
    title: `模型现实监测：${changes.length} 项显著变化`,
    url: 'https://arena.ai/leaderboard/text/english',
    originalUrl: 'https://arena.ai/leaderboard/text/english',
    guid: `origin12:model-reality:${day}:${hash(changes).slice(0, 16)}`,
    content: changes.slice(0, 20).map(modelChangeLabel).join('；'),
    author: '模型现实监测',
    publishedAt: new Date(snapshot.capturedAt),
    curationSource: '模型现实监测',
    curationUrl: 'https://artificialanalysis.ai/leaderboards/models',
    curationMeta: {
      evidenceScope: 'benchmark_usage_index',
      contentKind: 'material_change_report',
      isPrimaryEvidence: false,
      isFullText: false,
      evidenceNotice: '榜单与公开调用排序只反映各自口径，不等同于统一的“最强模型”。',
      modelRealitySnapshot: {
        capturedAt: snapshot.capturedAt,
        thresholds: { top10Membership: true, rank: 3, priceRate: 0.1, speedRate: 0.2, artificialAnalysisScore: 2 },
        changes,
        metrics: snapshot,
        sources: [
          { source: 'Arena', url: DEFAULT_ENDPOINTS.origin12_model_reality.arena, definition: '用户盲测偏好' },
          { source: 'Artificial Analysis', url: DEFAULT_ENDPOINTS.origin12_model_reality.artificialAnalysis, definition: '独立能力、价格和速度评测' },
          { source: 'OpenRouter', url: DEFAULT_ENDPOINTS.origin12_model_reality.openRouter, definition: '公开 Models API 的 most-popular 排序，不是精确日调用量' },
        ],
      },
      attribution: { source: '模型现实监测', required: true },
    },
    fetchEngine: 'origin12_model_diff',
    renderMode: 'benchmark_delta',
  };
}

export function parseSemiAnalysisFeed(body: string, base = 'https://semianalysis.com/'): RawItem[] {
  const document = new DOMParser().parseFromString(body, 'text/xml') as any;
  if (!document) return [];
  const entries = Array.from(document.querySelectorAll('item, entry') as any) as any[];
  return entries.flatMap((entry) => {
    const title = cleanText(entry.querySelector('title')?.textContent);
    const linkNode = entry.querySelector('link');
    const url = absoluteUrl(linkNode?.getAttribute('href') || linkNode?.textContent, base);
    if (!title || !url) return [];
    const description = cleanText(
      entry.querySelector('description')?.textContent
      || entry.querySelector('summary')?.textContent
      || entry.querySelector('content')?.textContent,
    );
    const date = cleanText(entry.querySelector('pubDate')?.textContent || entry.querySelector('published')?.textContent);
    const publishedAt = date ? new Date(date) : undefined;
    return [{
      title,
      url,
      originalUrl: url,
      guid: `origin12:semianalysis:${hash(url).slice(0, 24)}`,
      content: description,
      author: 'SemiAnalysis',
      publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : undefined,
      curationSource: 'SemiAnalysis',
      curationUrl: base,
      curationMeta: {
        evidenceScope: 'public_article_index',
        contentKind: 'public_feed_summary',
        isPrimaryEvidence: false,
        isFullText: false,
        paywallPolicy: 'public_metadata_only',
        evidenceNotice: '仅保留公开标题、链接和摘要；付费内容需在原站订阅后阅读。',
        attribution: { source: 'SemiAnalysis', canonical: url, required: true },
      },
      fetchEngine: 'origin12_public_feed',
      renderMode: 'public_summary',
    } satisfies RawItem];
  });
}

function resultPatch(
  results: FetchComponentResult[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    componentState: Object.fromEntries(results.map((result) => [result.key, result.state])),
    componentHealth: Object.fromEntries(results.map((result) => [result.key, result.health])),
    lastProviderCheckedAt: results[0]?.health.lastCheckedAt || new Date().toISOString(),
    ...extra,
  };
}

function finalResult(params: {
  items: RawItem[];
  results: FetchComponentResult[];
  config: Origin12Config;
  now: Date;
  extraPatch?: Record<string, unknown>;
}): CollectorResult {
  const fingerprint = hash(params.items.map((item) => ({ guid: item.guid, title: item.title, content: item.content })));
  const unchanged = Boolean(params.config.lastFingerprint && params.config.lastFingerprint === fingerprint);
  const anyFailed = params.results.some((result) => !result.ok);
  const items = unchanged ? [] : params.items;
  const errors = params.results.filter((result) => result.error).map((result) => `${result.name}: ${result.error}`);
  return {
    items,
    fetchedAt: params.now,
    outcomeHint: items.length > 0 ? 'new_items' : unchanged ? 'no_change' : 'no_items',
    ...(anyFailed ? { error: `origin12_component_degraded:${errors.join('; ')}` } : {}),
    sourceConfigPatch: resultPatch(params.results, {
      lastFingerprint: fingerprint,
      lastProviderOutcome: anyFailed ? 'component_degraded' : items.length > 0 ? 'updated' : unchanged ? 'unchanged' : 'empty',
      lastProviderError: anyFailed ? errors.join('; ') : null,
      ...params.extraPatch,
    }),
  };
}

async function fetchSingleIndex(
  source: SourceConfig,
  provider: Origin12Provider,
  key: string,
  parser: (body: string, base: string) => RawItem | null,
  options: Origin12Options,
): Promise<CollectorResult> {
  const config = source.config as Origin12Config;
  const now = options.now ? options.now() : new Date();
  const url = componentEndpoint(config, provider, key);
  const result = await fetchComponent({ key, url, accept: 'text/html,application/xhtml+xml', config, options, now });
  const item = result.body ? parser(result.body, url) : null;
  if (result.ok && !item) {
    result.ok = false;
    result.outcome = 'parse_empty';
    result.error = 'no_supported_issue_found';
    result.health = nextHealth({ previous: config.componentHealth?.[key], key, url, now, ok: false, outcome: 'parse_empty', error: result.error });
  }
  return finalResult({ items: item ? [item] : [], results: [result], config, now });
}

async function fetchResearchRadar(source: SourceConfig, options: Origin12Options): Promise<CollectorResult> {
  const config = source.config as Origin12Config;
  const now = options.now ? options.now() : new Date();
  const hfUrl = componentEndpoint(config, 'origin12_research_radar', 'huggingface');
  const alphaUrl = componentEndpoint(config, 'origin12_research_radar', 'alphaxiv');
  const discovery = await Promise.all([
    fetchComponent({ key: 'huggingface', url: hfUrl, accept: 'text/html,application/xhtml+xml', config, options, now }),
    fetchComponent({ key: 'alphaxiv', url: alphaUrl, accept: 'text/html,application/xhtml+xml', config, options, now }),
  ]);
  const candidates = [
    ...(discovery[0].body ? parseResearchCandidates(discovery[0].body, 'huggingface', hfUrl) : []),
    ...(discovery[1].body ? parseResearchCandidates(discovery[1].body, 'alphaxiv', alphaUrl) : []),
  ];
  for (const result of discovery) {
    const componentCandidates = candidates.filter((candidate) => candidate.source === result.key);
    if (result.ok && componentCandidates.length === 0) {
      result.ok = false;
      result.outcome = 'parse_empty';
      result.error = 'no_supported_papers_found';
      result.health = nextHealth({ previous: config.componentHealth?.[result.key], key: result.key, url: result.url, now, ok: false, outcome: 'parse_empty', error: result.error });
    }
  }
  const ids = Array.from(new Set(candidates.map((candidate) => candidate.arxivId).filter((id): id is string => Boolean(id)))).slice(0, 40);
  const arxivBase = componentEndpoint(config, 'origin12_research_radar', 'arxiv');
  const arxivUrl = new URL(arxivBase);
  let arxiv: FetchComponentResult;
  if (ids.length > 0) {
    arxivUrl.searchParams.set('id_list', ids.join(','));
    arxiv = await fetchComponent({ key: 'arxiv', url: arxivUrl.toString(), accept: 'application/atom+xml,application/xml', config, options, now });
  } else {
    const error = 'no_filtered_arxiv_ids';
    const health = nextHealth({ previous: config.componentHealth?.arxiv, key: 'arxiv', url: arxivUrl.toString(), now, ok: false, outcome: 'skipped_no_ids', error });
    arxiv = {
      key: 'arxiv',
      name: health.name,
      url: arxivUrl.toString(),
      body: null,
      fresh: false,
      ok: false,
      outcome: 'skipped_no_ids',
      error,
      state: config.componentState?.arxiv || {},
      health,
    };
  }
  const arxivPapers = arxiv.body ? parseArxivAtom(arxiv.body) : new Map<string, ArxivPaper>();
  if (arxiv.ok && ids.length > 0 && arxivPapers.size === 0) {
    arxiv.ok = false;
    arxiv.outcome = 'parse_empty';
    arxiv.error = 'no_arxiv_entries_found';
    arxiv.health = nextHealth({ previous: config.componentHealth?.arxiv, key: 'arxiv', url: arxiv.url, now, ok: false, outcome: 'parse_empty', error: arxiv.error });
  }
  const items = mergeResearchPapers(candidates, arxivPapers)
    .map((item) => ({
      ...item,
      curationMeta: {
        ...item.curationMeta,
        researchEvidence: {
          ...asObject(item.curationMeta?.researchEvidence),
          collectedAt: now.toISOString(),
        },
      },
    }))
    .slice(0, Math.max(1, Math.min(Number(config.maxItems || 30), 50)));
  return finalResult({ items, results: [...discovery, arxiv], config, now });
}

async function fetchModelReality(source: SourceConfig, options: Origin12Options): Promise<CollectorResult> {
  const config = source.config as Origin12Config;
  const now = options.now ? options.now() : new Date();
  const keys = ['arena', 'artificialAnalysis', 'openRouter'] as const;
  const results = await Promise.all(keys.map((key) => fetchComponent({
    key,
    url: componentEndpoint(config, 'origin12_model_reality', key),
    accept: key === 'openRouter' ? 'application/json' : 'text/html,application/xhtml+xml',
    config,
    options,
    now,
  })));
  const snapshot: ModelRealitySnapshot = {
    capturedAt: now.toISOString(),
    arena: results[0].body ? parseModelLeaderboard(results[0].body) : [],
    artificialAnalysis: results[1].body ? parseModelLeaderboard(results[1].body) : [],
    openRouter: results[2].body ? parseOpenRouterModels(results[2].body) : [],
  };
  results.forEach((result, index) => {
    const count = snapshot[keys[index]].length;
    if (result.ok && count === 0) {
      result.ok = false;
      result.outcome = 'parse_empty';
      result.error = 'no_supported_ranking_rows_found';
      result.health = nextHealth({ previous: config.componentHealth?.[result.key], key: result.key, url: result.url, now, ok: false, outcome: 'parse_empty', error: result.error });
    }
  });
  const previous = config.modelRealityBaseline;
  const allComponentsHealthy = results.every((result) => result.ok);
  const changes = previous && allComponentsHealthy ? meaningfulModelChanges(previous, snapshot) : [];
  const item = previous && allComponentsHealthy && changes.length > 0 ? buildModelRealityItem(snapshot, changes) : null;
  return finalResult({
    items: item ? [item] : [],
    results,
    config,
    now,
    extraPatch: {
      ...(allComponentsHealthy ? { modelRealityBaseline: snapshot } : previous ? { modelRealityBaseline: previous } : {}),
      modelRealityChangeCount: changes.length,
      modelRealityBaselineCreated: allComponentsHealthy && !previous,
    },
  });
}

async function fetchSemiAnalysis(source: SourceConfig, options: Origin12Options): Promise<CollectorResult> {
  const config = source.config as Origin12Config;
  const now = options.now ? options.now() : new Date();
  const url = componentEndpoint(config, 'origin12_semianalysis', 'semianalysis');
  const result = await fetchComponent({ key: 'semianalysis', url, accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml', config, options, now });
  const items = result.body ? parseSemiAnalysisFeed(result.body) : [];
  if (result.ok && items.length === 0) {
    result.ok = false;
    result.outcome = 'parse_empty';
    result.error = 'no_public_feed_entries_found';
    result.health = nextHealth({ previous: config.componentHealth?.semianalysis, key: 'semianalysis', url, now, ok: false, outcome: 'parse_empty', error: result.error });
  }
  return finalResult({ items: items.slice(0, Math.max(1, Math.min(Number(config.maxItems || 20), 50))), results: [result], config, now });
}

export function isOrigin12Provider(value: unknown): value is Origin12Provider {
  return value === 'origin12_ai_news'
    || value === 'origin12_the_batch'
    || value === 'origin12_research_radar'
    || value === 'origin12_model_reality'
    || value === 'origin12_semianalysis';
}

export async function fetchOrigin12Provider(
  source: SourceConfig,
  options: Origin12Options = {},
): Promise<CollectorResult | null> {
  const config = source.config as Origin12Config;
  if (!isOrigin12Provider(config.provider)) return null;
  if (config.provider === 'origin12_ai_news') {
    return fetchSingleIndex(source, config.provider, 'aiNews', parseAiNewsIssue, options);
  }
  if (config.provider === 'origin12_the_batch') {
    return fetchSingleIndex(source, config.provider, 'theBatch', parseTheBatchIssue, options);
  }
  if (config.provider === 'origin12_research_radar') return fetchResearchRadar(source, options);
  if (config.provider === 'origin12_model_reality') return fetchModelReality(source, options);
  return fetchSemiAnalysis(source, options);
}
