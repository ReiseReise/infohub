import { createHash } from 'node:crypto';
import { normalizeAuthorityWeight, type SourceKind } from './aihot-governance.js';
import { isFirstPartySource } from './source-governance-classification.js';

export type EventClusterCandidate = {
  id: string;
  sourceName?: string | null;
  sourceCategory?: string | null;
  sourceType?: string | null;
  sourceCollectorType?: string | null;
  sourceRole?: string | null;
  sourceConfig?: unknown;
  sourceTier?: string | null;
  sourceKind?: SourceKind | string | null;
  authorityWeight?: number | null;
  aiScore?: number | null;
  priorityScore?: number | null;
  publishedAt?: string | Date | null;
};

export type EventEvidenceType = 'first_party' | 'local' | 'external_radar';

export type EventClusterListItem = EventClusterCandidate & {
  clusterId?: string | null;
  sourceId?: number | null;
  sourceName?: string | null;
  sourceRole?: string | null;
  title?: string | null;
  translatedTitle?: string | null;
  aiTags?: unknown;
  url?: string | null;
  originalUrl?: string | null;
  curationUrl?: string | null;
  curationSource?: string | null;
  curationMeta?: unknown;
  fetchedAt?: string | Date | null;
};

export type EventClusterSimilarityItem = {
  id: string;
  sourceId?: number | null;
  title?: string | null;
  translatedTitle?: string | null;
  aiTags?: unknown;
  publishedAt?: string | Date | null;
  fetchedAt?: string | Date | null;
  clusterId?: string | null;
};

export type EventContextRelatedItem = {
  id: string;
  title: string;
  url: string;
  originalUrl: string | null;
  sourceName: string | null;
  sourceTier: string | null;
  sourceKind: string | null;
  sourceRole: string | null;
  curationSource: string | null;
  evidenceType: EventEvidenceType;
  publishedAt: string | null;
  fetchedAt: string | null;
};

export type EventContext = {
  clusterId: string;
  leadItemId: string;
  leadSourceName: string | null;
  leadReason: string;
  internalSourceCount: number;
  externalSourceCount: number;
  firstPartyCount: number;
  relatedItems: EventContextRelatedItem[];
};

const STOP_WORDS = new Set([
  '正式', '推出', '发布', '宣布', '上线', '新增', '功能', '实现', '深度', '集成',
  'web', 'office', 'github', 'notion', 'xai',
  'the', 'and', 'with', 'for', 'from', 'into', 'new', 'launch', 'launches', 'launched',
  'release', 'releases', 'released', 'announces', 'announced', 'says', 'said', 'report',
  'reports', 'after', 'before', 'over', 'under', 'about', 'that', 'this', 'their', 'its',
  'now', 'available', 'how', 'why', 'what', 'when', 'where', 'who', 'could', 'would',
  'will', 'can', 'has', 'have', 'had', 'was', 'were', 'are', 'but', 'not', 'more',
  'a', 'an', 'as', 'at', 'be', 'by', 'in', 'is', 'it', 'of', 'on', 'or', 'our',
  'say', 'saying', 'than', 'to', 'us', 'we', 'you', 'your', 'update', 'updates',
  'artificial-intelligence', 'technology', 'tech', 'company', 'companies',
]);

const SUSPICIOUS_EVENT_TOKENS = new Set([
  'alt', 'article', 'center', 'class', 'content', 'div', 'gif', 'href', 'html',
  'http', 'https', 'image', 'img', 'jpeg', 'jpg', 'oss', 'png', 'script', 'span',
  'src', 'strong', 'style', 'svg', 'utils', 'webp',
]);

function normalizeToken(token: string): string {
  const normalized = token
    .toLowerCase()
    .replace(/^ai$/, 'artificial-intelligence')
    .replace(/^connectors?$/, 'connector')
    .replace(/^grokweb$/, 'grok');
  if (normalized.length > 4 && normalized.endsWith('ies')) return `${normalized.slice(0, -3)}y`;
  if (normalized.length > 4 && normalized.endsWith('es')) return normalized.slice(0, -2);
  if (normalized.length > 3 && normalized.endsWith('s')) return normalized.slice(0, -1);
  return normalized;
}

function tokenizeTitle(value: string): string[] {
  return value
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .map((token) => normalizeToken(token.trim()))
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
    .slice(0, 18);
}

function cleanClusterText(value?: string | null): string {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/&(?:[a-z]+|#\d+|#x[0-9a-f]+);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function eventKeyFromText(value: string): string | null {
  if (value.length < 8) return null;
  const tokens = tokenizeTitle(value);
  const latinTokens = tokens.filter((token) => /[a-z0-9]/i.test(token));
  const hanTokens = tokens.filter((token) => /[\u4e00-\u9fff]/.test(token));
  const preferred = latinTokens.length >= 2 ? latinTokens : [...latinTokens, ...hanTokens];
  const keyTokens = Array.from(new Set(preferred)).slice(0, 4);
  if (keyTokens.length < 2) return null;
  if (keyTokens.some((token) => SUSPICIOUS_EVENT_TOKENS.has(token))) return null;
  return keyTokens.sort().join(':');
}

export function buildEventClusterKey(title?: string | null, fallback?: string | null): string | null {
  const cleanTitle = cleanClusterText(title);
  if (cleanTitle.length >= 8) return eventKeyFromText(cleanTitle);
  return eventKeyFromText(cleanClusterText(fallback));
}

type SemanticDescriptor = {
  entities: Set<string>;
  concepts: Set<string>;
  terms: Set<string>;
  all: Set<string>;
};

const ENTITY_PATTERNS: Array<[string, RegExp]> = [
  ['hugging-face', /\bhugging[\s-]+face\b|抱抱脸/iu],
  ['anthropic', /\banthropic\b/iu],
  ['claude', /\bclaude\b|克劳德/iu],
  ['openai', /\bopenai\b|\bchatgpt\b/iu],
  ['gpt', /\bgpt(?:[\s.-]*\d+(?:\.\d+)*)?\b/iu],
  ['microsoft', /\bmicrosoft\b|微软/iu],
  ['azure', /\bazure\b/iu],
  ['google', /\bgoogle\b|谷歌/iu],
  ['gemini', /\bgemini\b/iu],
  ['meta', /\bmeta\b/iu],
  ['llama', /\bllama\b/iu],
  ['nvidia', /\bnvidia\b|英伟达/iu],
  ['deepseek', /\bdeepseek\b|深度求索/iu],
  ['qwen', /\bqwen\b|通义千问/iu],
  ['mistral', /\bmistral\b/iu],
  ['xai', /\bxai\b/iu],
  ['grok', /\bgrok\b/iu],
  ['spacex', /\bspacex\b/iu],
  ['techcrunch', /\btechcrunch\b/iu],
];

const CONCEPT_PATTERNS: Array<[string, RegExp]> = [
  ['cyberattack', /\bcyber[\s-]?attack\b|\bhack(?:er|ers|ed|ing)?\b|\bbreach\b|网络攻击|遭攻击|黑客攻击|入侵/iu],
  ['access-token', /\baccess token\b|\bauthentication token\b|访问令牌|认证令牌/iu],
  ['cryptography', /\bcrypto(?:graphic|graphy)?\b|\bencryption\b|密码学|加密算法|加密/iu],
  ['vulnerability', /\bweakness(?:es)?\b|\bvulnerabilit(?:y|ies)\b|\bflaw(?:s)?\b|弱点|漏洞|缺陷/iu],
  ['scientific-research', /\bscientific discovery\b|\bacademic research\b|学术研究|科学发现|科研/iu],
  ['model-release', /\bmodel release\b|\bnew model\b|新模型|模型发布/iu],
  ['cloud', /\bcloud\b|云计算|云服务/iu],
  ['earnings', /\bearnings\b|\brevenue\b|\bprofit\b|财报|营收|利润/iu],
  ['hiring', /\bhiring\b|\brecruit(?:ment|ing)?\b|招聘|招募/iu],
  ['partnership', /\bpartnership\b|\bpartners? with\b|合作伙伴|达成合作|战略合作/iu],
  ['funding', /\bfunding\b|\braises?\b|\bfinancing\b|融资|募资/iu],
  ['acquisition', /\bacqui(?:res?|sition)\b|\bmerger\b|收购|并购/iu],
  ['regulation', /\bregulat(?:ion|ory)\b|\bpolicy\b|监管|政策/iu],
  ['antitrust-fine', /\bantitrust\b|\beu fine\b|\bcompetition violation\b|反垄断|竞争罚款/iu],
  ['product-launch', /\bproduct launch\b|\blaunch(?:es|ed|ing)?\b|\bintroduc(?:e|es|ed|ing)\b|产品发布|推出产品/iu],
];

const GENERIC_CONCEPTS = new Set([
  'cloud',
  'model-release',
  'partnership',
  'product-launch',
  'scientific-research',
]);

function eventText(item: EventClusterSimilarityItem): string {
  return [
    cleanClusterText(item.title),
    cleanClusterText(item.translatedTitle),
  ].filter(Boolean).join(' ');
}

function semanticDescriptor(item: EventClusterSimilarityItem): SemanticDescriptor {
  const text = eventText(item);
  const entities = new Set<string>();
  const concepts = new Set<string>();
  for (const [token, pattern] of ENTITY_PATTERNS) {
    if (pattern.test(text)) entities.add(token);
  }
  for (const match of text.matchAll(/\b(opus|fable|sonnet|haiku|gpt|gemini|llama|qwen)\s*[-.]?\s*(\d+(?:\.\d+)*)\b/giu)) {
    entities.add(`${String(match[1]).toLowerCase()}-${match[2]}`);
  }
  for (const [token, pattern] of CONCEPT_PATTERNS) {
    if (pattern.test(text)) concepts.add(token);
  }

  const terms = new Set(
    tokenizeTitle(text)
      .filter((token) => /[a-z0-9]/i.test(token))
      .filter((token) => !entities.has(token) && !concepts.has(token))
      .filter((token) => token !== 'artificial-intelligence')
      .slice(0, 32),
  );
  const all = new Set([...entities, ...concepts, ...terms]);
  return { entities, concepts, terms, all };
}

function intersection<T>(left: Set<T>, right: Set<T>): T[] {
  return [...left].filter((value) => right.has(value));
}

function eventTimesWithinWindow(
  left: EventClusterSimilarityItem,
  right: EventClusterSimilarityItem,
  maxHours: number,
): boolean {
  const leftTime = timeValue(left.publishedAt || left.fetchedAt);
  const rightTime = timeValue(right.publishedAt || right.fetchedAt);
  if (!leftTime || !rightTime) return true;
  return Math.abs(leftTime - rightTime) <= maxHours * 60 * 60 * 1000;
}

function itemsRepresentSameEvent(
  left: EventClusterSimilarityItem,
  right: EventClusterSimilarityItem,
  leftDescriptor: SemanticDescriptor,
  rightDescriptor: SemanticDescriptor,
): boolean {
  if (left.sourceId != null && right.sourceId != null && left.sourceId === right.sourceId) {
    return false;
  }
  if (!eventTimesWithinWindow(left, right, 96)) return false;

  const commonEntities = intersection(leftDescriptor.entities, rightDescriptor.entities);
  const commonConcepts = intersection(leftDescriptor.concepts, rightDescriptor.concepts);
  const commonSpecificConcepts = commonConcepts.filter((token) => !GENERIC_CONCEPTS.has(token));
  const commonTerms = intersection(leftDescriptor.terms, rightDescriptor.terms);

  if (
    commonEntities.length >= 2
    && commonEntities.some((token) => /\d/.test(token))
  ) return true;
  if (commonEntities.length >= 2 && commonConcepts.length >= 1) return true;
  if (commonEntities.length >= 2 && commonTerms.length >= 1) return true;
  if (commonEntities.length >= 1 && commonSpecificConcepts.length >= 1) return true;
  if (commonEntities.length >= 1 && commonConcepts.length >= 1 && commonTerms.length >= 1) return true;
  if (commonEntities.length >= 1 && commonTerms.length >= 3) return true;
  return commonTerms.length >= 5;
}

function shortClusterHash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 8);
}

function uniqueClusterKey(
  item: EventClusterSimilarityItem,
  descriptor: SemanticDescriptor,
): string {
  const meaningful = [
    ...descriptor.entities,
    ...descriptor.concepts,
    ...descriptor.terms,
  ].filter((token) => !SUSPICIOUS_EVENT_TOKENS.has(token)).slice(0, 3);
  const fallback = buildEventClusterKey(item.title, item.translatedTitle) || 'unclustered:item';
  const prefix = meaningful.length >= 2 ? meaningful.join(':') : fallback;
  return `${prefix}:${shortClusterHash(`${item.id}:${eventText(item)}`)}`;
}

function sharedClusterKey(
  members: EventClusterSimilarityItem[],
  descriptors: Map<string, SemanticDescriptor>,
): string {
  const frequencies = new Map<string, number>();
  const entityTokens = new Set<string>();
  const conceptTokens = new Set<string>();
  for (const member of members) {
    const descriptor = descriptors.get(member.id);
    if (!descriptor) continue;
    for (const token of descriptor.all) frequencies.set(token, (frequencies.get(token) || 0) + 1);
    for (const token of descriptor.entities) entityTokens.add(token);
    for (const token of descriptor.concepts) conceptTokens.add(token);
  }

  const shared = [...frequencies.entries()]
    .filter(([, count]) => count >= 2)
    .sort(([leftToken, leftCount], [rightToken, rightCount]) => {
      const leftRank = entityTokens.has(leftToken) ? 3 : conceptTokens.has(leftToken) ? 2 : 1;
      const rightRank = entityTokens.has(rightToken) ? 3 : conceptTokens.has(rightToken) ? 2 : 1;
      return rightRank - leftRank || rightCount - leftCount || leftToken.localeCompare(rightToken);
    })
    .map(([token]) => token)
    .filter((token) => token !== 'artificial-intelligence')
    .slice(0, 4);

  const keyTokens = shared.length >= 2
    ? shared
    : semanticDescriptor(members[0] || { id: 'unknown' }).all.size > 0
      ? [...semanticDescriptor(members[0] || { id: 'unknown' }).all].slice(0, 3)
      : ['event', 'cluster'];
  const componentIdentity = members.map((member) => member.id).sort().join(':');
  return `${keyTokens.join(':')}:${shortClusterHash(componentIdentity)}`;
}

export function assignEventClustersBySimilarity(
  items: EventClusterSimilarityItem[],
): Map<string, string> {
  const deduped = [...new Map(items.map((item) => [item.id, item])).values()];
  const descriptors = new Map(deduped.map((item) => [item.id, semanticDescriptor(item)]));
  const parent = deduped.map((_, index) => index);

  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };

  for (let leftIndex = 0; leftIndex < deduped.length; leftIndex += 1) {
    const left = deduped[leftIndex];
    const leftDescriptor = descriptors.get(left.id);
    if (!leftDescriptor) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < deduped.length; rightIndex += 1) {
      const right = deduped[rightIndex];
      const rightDescriptor = descriptors.get(right.id);
      if (
        rightDescriptor
        && itemsRepresentSameEvent(left, right, leftDescriptor, rightDescriptor)
      ) {
        union(leftIndex, rightIndex);
      }
    }
  }

  const grouped = new Map<number, EventClusterSimilarityItem[]>();
  deduped.forEach((item, index) => {
    const root = find(index);
    grouped.set(root, [...(grouped.get(root) || []), item]);
  });

  const assignments = new Map<string, string>();
  for (const members of grouped.values()) {
    const sourceCount = new Set(members.map((member) => member.sourceId ?? `item:${member.id}`)).size;
    const clusterKey = members.length >= 2 && sourceCount >= 2
      ? sharedClusterKey(members, descriptors)
      : uniqueClusterKey(members[0], descriptors.get(members[0].id) || semanticDescriptor(members[0]));
    for (const member of members) assignments.set(member.id, clusterKey);
  }
  return assignments;
}

function tierRank(tier?: string | null) {
  switch (String(tier || '').trim().toUpperCase()) {
    case 'S':
      return 5;
    case 'A':
      return 4;
    case 'B':
      return 3;
    case 'C':
      return 2;
    case 'D':
      return 1;
    default:
      return 0;
  }
}

function kindRank(kind?: string | null) {
  switch (String(kind || '').trim().toLowerCase()) {
    case 'official':
      return 5;
    case 'blog':
      return 4;
    case 'rss':
    case 'media':
      return 3;
    case 'x':
      return 2;
    case 'wechat':
      return 1;
    default:
      return 0;
  }
}

function timeValue(value?: string | Date | null) {
  if (!value) return 0;
  const parsed = value instanceof Date ? value : new Date(value);
  const time = parsed.getTime();
  return Number.isFinite(time) ? time : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finiteNonNegative(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function externalSourceCountFromMeta(value: unknown): number {
  const meta = asRecord(value);
  const direct = Math.max(
    finiteNonNegative(meta.externalSourceCount),
    Array.isArray(meta.externalSourceNames) ? meta.externalSourceNames.length : 0,
  );
  const radarCounts = Object.values(asRecord(meta.externalRadars)).map((entry) => {
    const radar = asRecord(entry);
    return Math.max(
      finiteNonNegative(radar.externalSourceCount),
      finiteNonNegative(radar.sourceCount),
      Array.isArray(radar.externalSourceNames) ? radar.externalSourceNames.length : 0,
      Array.isArray(radar.sourceNames) ? radar.sourceNames.length : 0,
    );
  });
  return Math.max(direct, ...radarCounts, 0);
}

function isExternalRadarItem(item: EventClusterListItem): boolean {
  const role = String(item.sourceRole || '').trim().toLowerCase();
  return role === 'radar' || role === 'reference';
}

function isFirstPartyItem(item: EventClusterCandidate): boolean {
  return isFirstPartySource({
    name: item.sourceName,
    category: item.sourceCategory,
    sourceType: item.sourceType,
    collectorType: item.sourceCollectorType,
    sourceKind: item.sourceKind,
    sourceRole: item.sourceRole,
    config: item.sourceConfig,
  });
}

function evidenceType(item: EventClusterListItem): EventEvidenceType {
  if (isExternalRadarItem(item)) return 'external_radar';
  if (isFirstPartyItem(item)) return 'first_party';
  return 'local';
}

function sourceKey(item: EventClusterListItem): string {
  if (item.sourceId != null) return `id:${item.sourceId}`;
  if (item.sourceName) return `name:${item.sourceName.trim().toLowerCase()}`;
  return `item:${item.id}`;
}

function clusterTokens(clusterId: string): string[] {
  return clusterId
    .split(':')
    .map((token) => normalizeToken(token.trim()))
    .filter((token) => token.length >= 2);
}

function isSuspiciousClusterId(clusterId: string): boolean {
  const tokens = clusterTokens(clusterId);
  if (tokens.length < 2 || tokens.length > 6) return true;
  return tokens.some((token) => (
    SUSPICIOUS_EVENT_TOKENS.has(token)
    || /^https?$/i.test(token)
    || /\.(?:gif|jpe?g|png|svg|webp)$/i.test(token)
  ));
}

function titleSupportsCluster(item: EventClusterListItem, tokens: string[]): boolean {
  const semanticTokens = semanticDescriptor(item).all;
  const meaningfulTokens = tokens.filter((token) => !/^[a-f0-9]{8}$/i.test(token));
  const matched = meaningfulTokens.filter((token) => semanticTokens.has(token));
  return matched.length >= Math.min(2, meaningfulTokens.length);
}

function hasTrustedLocalEvidence(items: EventClusterListItem[], clusterId: string): boolean {
  if (isSuspiciousClusterId(clusterId)) return false;
  const tokens = clusterTokens(clusterId);
  const supportingSources = new Set(
    items
      .filter((item) => !isExternalRadarItem(item) && titleSupportsCluster(item, tokens))
      .map(sourceKey),
  );
  return supportingSources.size >= 2;
}

function isoTime(value?: string | Date | null): string | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function resolveLeadReason(item: EventClusterListItem): string {
  if (isFirstPartyItem(item)) {
    return '官方或一手来源优先作为当前事件主条。';
  }
  if (normalizeAuthorityWeight(item.authorityWeight, item.sourceTier, item.sourceKind) >= 1.15) {
    return '当前来源的权威度更高，优先作为事件主条。';
  }
  return '当前条目在可见证据中的来源质量与时效更适合作为主条。';
}

export function selectEventClusterLead<T extends EventClusterCandidate>(items: T[]): T | null {
  if (items.length === 0) return null;
  return [...items].sort((a, b) => {
    const firstPartyDiff = Number(isFirstPartyItem(b)) - Number(isFirstPartyItem(a));
    if (firstPartyDiff !== 0) return firstPartyDiff;

    const authorityDiff = normalizeAuthorityWeight(b.authorityWeight, b.sourceTier, b.sourceKind)
      - normalizeAuthorityWeight(a.authorityWeight, a.sourceTier, a.sourceKind);
    if (authorityDiff !== 0) return authorityDiff;

    const tierDiff = tierRank(b.sourceTier) - tierRank(a.sourceTier);
    if (tierDiff !== 0) return tierDiff;

    const kindDiff = kindRank(b.sourceKind) - kindRank(a.sourceKind);
    if (kindDiff !== 0) return kindDiff;

    const scoreDiff = Number(b.aiScore || 0) - Number(a.aiScore || 0);
    if (scoreDiff !== 0) return scoreDiff;

    const priorityDiff = Number(b.priorityScore || 0) - Number(a.priorityScore || 0);
    if (priorityDiff !== 0) return priorityDiff;

    return timeValue(a.publishedAt) - timeValue(b.publishedAt);
  })[0];
}

export function buildEventContext(
  items: EventClusterListItem[],
  requestedLeadItemId?: string | null,
): EventContext | null {
  const clusterId = items.find((item) => item.clusterId)?.clusterId || null;
  if (!clusterId || items.length === 0) return null;

  const deduped = [...new Map(items.map((item) => [item.id, item])).values()];
  if (!hasTrustedLocalEvidence(deduped, clusterId)) return null;
  const requestedLead = requestedLeadItemId
    ? deduped.find((item) => item.id === requestedLeadItemId) || null
    : null;
  const lead = requestedLead || selectEventClusterLead(deduped);
  if (!lead) return null;

  const internalItems = deduped.filter((item) => !isExternalRadarItem(item));
  const externalItems = deduped.filter(isExternalRadarItem);
  const internalSources = new Set(internalItems.map(sourceKey));
  const externalRadarItems = new Set(externalItems.map(sourceKey));
  const firstPartySources = new Set(
    internalItems
      .filter((item) => evidenceType(item) === 'first_party')
      .map(sourceKey),
  );
  const declaredExternalCount = deduped.reduce(
    (max, item) => Math.max(max, externalSourceCountFromMeta(item.curationMeta)),
    0,
  );

  return {
    clusterId,
    leadItemId: lead.id,
    leadSourceName: lead.sourceName || null,
    leadReason: resolveLeadReason(lead),
    internalSourceCount: internalSources.size,
    externalSourceCount: Math.max(externalRadarItems.size, declaredExternalCount),
    firstPartyCount: firstPartySources.size,
    relatedItems: deduped
      .filter((item) => item.id !== lead.id)
      .map((item) => ({
        id: item.id,
        title: item.title || '未命名条目',
        url: item.url || item.originalUrl || '',
        originalUrl: item.originalUrl || null,
        sourceName: item.sourceName || null,
        sourceTier: item.sourceTier || null,
        sourceKind: item.sourceKind ? String(item.sourceKind) : null,
        sourceRole: item.sourceRole || null,
        curationSource: item.curationSource || null,
        evidenceType: evidenceType(item),
        publishedAt: isoTime(item.publishedAt),
        fetchedAt: isoTime(item.fetchedAt),
      })),
  };
}

export function collapseEventClusterItems<T extends EventClusterListItem>(
  items: T[],
  evidenceItems: EventClusterListItem[] = items,
): Array<T & { eventContext: EventContext | null }> {
  const itemGroups = new Map<string, T[]>();
  const evidenceGroups = new Map<string, EventClusterListItem[]>();
  for (const item of items) {
    if (!item.clusterId) continue;
    itemGroups.set(item.clusterId, [...(itemGroups.get(item.clusterId) || []), item]);
  }
  for (const item of evidenceItems) {
    if (!item.clusterId) continue;
    evidenceGroups.set(item.clusterId, [...(evidenceGroups.get(item.clusterId) || []), item]);
  }

  const seen = new Set<string>();
  const collapsed: Array<T & { eventContext: EventContext | null }> = [];
  for (const item of items) {
    if (!item.clusterId) {
      collapsed.push({ ...item, eventContext: null });
      continue;
    }
    const localGroup = itemGroups.get(item.clusterId) || [item];
    const lead = selectEventClusterLead(localGroup) || item;
    const evidenceGroup = [
      ...(evidenceGroups.get(item.clusterId) || []),
      ...localGroup,
    ];
    const eventContext = buildEventContext(evidenceGroup, lead.id);
    if (!eventContext) {
      collapsed.push({ ...item, eventContext: null });
      continue;
    }
    if (seen.has(item.clusterId)) continue;
    seen.add(item.clusterId);
    collapsed.push({
      ...lead,
      eventContext,
    });
  }
  return collapsed;
}
