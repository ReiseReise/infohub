import { createHash } from 'node:crypto';
import type { CollectorResult, RawItem } from './base.js';

// Consume public data only. Upstream prompts, scripts and delivery are never loaded.
export const FOLLOW_BUILDERS_X_URL = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-x.json';
export const FOLLOW_BUILDERS_X_HANDLES = ['karpathy', 'swyx', 'bcherny', 'trq212', 'steipete'] as const;
const MAX_AGE_MS = 48 * 3600_000;
const MAX_BYTES = 1024 * 1024;
const TOPIC = /\b(ai|agents?|claude|codex|llms?|models?|prompts?|inference|training|coding|openai|anthropic|mcp|openclaw)\b|人工智能|智能体|大模型/i;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function string(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function timestamp(value: unknown): number {
  const text = string(value);
  return /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(text) ? Date.parse(text) : NaN;
}
function html(text: string): string {
  return `<p>${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '<br>')}</p>`;
}

export function parseFollowBuildersX(value: unknown, now = new Date()) {
  const feed = object(value);
  const generated = timestamp(feed.generatedAt);
  if (!Number.isFinite(generated) || generated > now.getTime() + 5 * 60_000) throw new Error('follow_builders_invalid_timestamp');
  if (now.getTime() - generated > MAX_AGE_MS) throw new Error('follow_builders_stale_feed');
  if (!Array.isArray(feed.x) || feed.x.length > 100) throw new Error('follow_builders_invalid_schema');
  if (feed.errors !== undefined && (!Array.isArray(feed.errors) || feed.errors.length > 0)) throw new Error('follow_builders_upstream_errors');
  const allowed = new Set<string>(FOLLOW_BUILDERS_X_HANDLES);
  const seen = new Set<string>();
  const items: RawItem[] = [];
  const rejected = { unselected: 0, invalid: 0, stale: 0, missingContext: 0, offTopic: 0, duplicate: 0, overLimit: 0 };
  const selectedPresent = new Set<string>();
  const acceptedByHandle = new Map<string, number>();
  for (const rawBuilder of feed.x) {
    const builder = object(rawBuilder);
    if (!Array.isArray(builder.tweets) || builder.tweets.length > 100) throw new Error('follow_builders_invalid_schema');
    const handle = string(builder.handle).toLowerCase();
    if (!allowed.has(handle)) { rejected.unselected += builder.tweets.length; continue; }
    selectedPresent.add(handle);
    for (const rawTweet of builder.tweets) {
      const tweet = object(rawTweet);
      const id = string(tweet.id);
      const text = string(tweet.text);
      const published = timestamp(tweet.createdAt);
      let validUrl = false;
      try {
        const url = new URL(string(tweet.url));
        validUrl = url.protocol === 'https:' && !url.username && !url.password && !url.port
          && ['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com'].includes(url.hostname)
          && url.pathname.toLowerCase() === `/${handle}/status/${id}`;
      } catch { /* Invalid URLs are rejected below. */ }
      if (!/^\d{10,25}$/.test(id) || !validUrl || !text || text.length > 30_000 || !Number.isFinite(published)) { rejected.invalid++; continue; }
      if (published > generated + 5 * 60_000 || now.getTime() - published > MAX_AGE_MS) { rejected.stale++; continue; }
      // The public feed supplies quote IDs but not their text, attachments or thread context.
      if (tweet.isQuote === true || string(tweet.quotedTweetId) || /^@\w+\b/.test(text)) { rejected.missingContext++; continue; }
      const withoutUrls = text.replace(/https?:\/\/\S+/g, '').trim();
      if (withoutUrls.length < 60 || !TOPIC.test(withoutUrls)) { rejected.offTopic++; continue; }
      if (seen.has(id)) { rejected.duplicate++; continue; }
      if ((acceptedByHandle.get(handle) || 0) >= 3) { rejected.overLimit++; continue; }
      seen.add(id);
      acceptedByHandle.set(handle, (acceptedByHandle.get(handle) || 0) + 1);
      const url = `https://x.com/${handle}/status/${id}`;
      items.push({
        guid: `x:${id}`, url, originalUrl: url,
        title: `${string(builder.name) || handle}：${withoutUrls.replace(/\s+/g, ' ').slice(0, 120)}`,
        content: html(text), author: string(builder.name) || handle,
        publishedAt: new Date(published),
        curationSource: 'Follow Builders', curationUrl: 'https://github.com/zarazhangrui/follow-builders',
        curationMeta: {
          provider: 'follow_builders', channel: 'x', handle, tweetId: id,
          feedGeneratedAt: new Date(generated).toISOString(),
          selection: 'fixed-five-handles-keyword-filter',
          evidenceKind: 'public_social_post', completeness: 'text_only',
          limitations: '仅帖文文字；无附件、完整讨论串及独立事实核验。关键词筛选不代表内容质量已验收。',
        },
        fetchEngine: 'follow_builders_x', renderMode: 'social_text',
      });
    }
  }
  return {
    items,
    diagnostics: {
      generatedAt: new Date(generated).toISOString(), selectedHandles: [...FOLLOW_BUILDERS_X_HANDLES],
      selectedPresent: [...selectedPresent], accepted: items.length, rejected,
    },
  };
}

export async function fetchFollowBuildersX(options: { fetchImpl?: typeof fetch; now?: () => Date } = {}): Promise<CollectorResult> {
  const now = options.now?.() || new Date();
  try {
    const response = await (options.fetchImpl || fetch)(FOLLOW_BUILDERS_X_URL, {
      headers: { Accept: 'application/json', 'User-Agent': 'InfoHubV3/3.1' },
      signal: AbortSignal.timeout(15_000), redirect: 'error',
    });
    if (!response.ok) throw new Error(`follow_builders_http_${response.status}`);
    if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('follow_builders_response_too_large');
    if (!response.body) throw new Error('follow_builders_empty_body');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > MAX_BYTES) { await reader.cancel(); throw new Error('follow_builders_response_too_large'); }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const parsed = parseFollowBuildersX(JSON.parse(Buffer.concat(chunks).toString('utf8')), now);
    return {
      items: parsed.items, fetchedAt: now, outcomeHint: parsed.items.length ? 'new_items' : 'no_items',
      sourceConfigPatch: {
        lastProviderCheckedAt: now.toISOString(), lastProviderOutcome: parsed.items.length ? 'fresh' : 'fresh_empty',
        lastFingerprint: createHash('sha256').update(JSON.stringify(parsed.items)).digest('hex'),
        followBuildersDiagnostics: parsed.diagnostics,
      },
    };
  } catch (error) {
    // No cached-content fallback: old snapshots must never look like today's posts.
    return { items: [], fetchedAt: now, outcomeHint: 'error', error: error instanceof Error ? error.message : 'follow_builders_error' };
  }
}
