import { normalizeAuthorityWeight, type SourceKind } from './aihot-governance.js';

export type EventClusterCandidate = {
  id: string;
  sourceTier?: string | null;
  sourceKind?: SourceKind | string | null;
  authorityWeight?: number | null;
  aiScore?: number | null;
  priorityScore?: number | null;
  publishedAt?: string | Date | null;
};

const STOP_WORDS = new Set([
  '正式', '推出', '发布', '宣布', '上线', '新增', '功能', '实现', '深度', '集成',
  'web', 'office', 'github', 'notion', 'xai',
  'the', 'and', 'with', 'for', 'from', 'into', 'new', 'launch', 'release', 'announces',
]);

function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/^ai$/, 'artificial-intelligence')
    .replace(/^connectors?$/, 'connector')
    .replace(/^grokweb$/, 'grok');
}

function tokenizeTitle(value: string): string[] {
  return value
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .map((token) => normalizeToken(token.trim()))
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
    .slice(0, 18);
}

export function buildEventClusterKey(title?: string | null, fallback?: string | null): string | null {
  const text = `${title || ''} ${fallback || ''}`.trim();
  if (text.length < 8) return null;
  const tokens = tokenizeTitle(text);
  const latinTokens = tokens.filter((token) => /[a-z0-9]/i.test(token));
  const hanTokens = tokens.filter((token) => /[\u4e00-\u9fff]/.test(token));
  const preferred = latinTokens.length >= 2 ? latinTokens : [...latinTokens, ...hanTokens];
  const keyTokens = Array.from(new Set(preferred)).slice(0, 4);
  if (keyTokens.length < 2) return null;
  return keyTokens.sort().join(':');
}

function tierRank(tier?: string | null) {
  switch (String(tier || '').trim().toUpperCase()) {
    case 'T1':
    case 'S':
      return 5;
    case 'T1.5':
    case 'A':
      return 4;
    case 'T2':
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

export function selectEventClusterLead<T extends EventClusterCandidate>(items: T[]): T | null {
  if (items.length === 0) return null;
  return [...items].sort((a, b) => {
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
