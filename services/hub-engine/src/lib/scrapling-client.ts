import { config } from '../config/index.js';

export type ScraplingMode = 'auto' | 'native' | 'dynamic' | 'stealth';

type ScraplingResponse = {
  title?: string | null;
  content?: string | null;
  snippet?: string | null;
  html?: string | null;
  finalUrl?: string | null;
  renderMode?: ScraplingMode;
  blocked?: boolean;
  blockedReason?: string | null;
  latencyMs?: number;
};

function normalizeUrl(input: string): string {
  return input.trim();
}

function isKnownDynamicDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return ['toutiao.com', 'www.toutiao.com', 'jinritoutiao.com', 'www.jinritoutiao.com'].includes(host);
  } catch {
    return false;
  }
}

export function resolvePreferredScraplingMode(url: string): ScraplingMode {
  return isKnownDynamicDomain(url) ? 'dynamic' : 'auto';
}

export async function fetchScraplingArticle(
  url: string,
  mode: ScraplingMode = 'auto',
): Promise<ScraplingResponse | null> {
  if (!config.scrapling.enabled) return null;
  const target = normalizeUrl(url);
  if (!target) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.scrapling.timeoutMs);

  try {
    const resp = await fetch(`${config.scrapling.url}/extract/article`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: target,
        mode,
        waitMs: Math.min(Math.max(config.scrapling.timeoutMs - 3000, 6000), 45000),
        networkIdle: true,
      }),
    });
    if (!resp.ok) return null;
    return await resp.json() as ScraplingResponse;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchScraplingSnapshot(
  url: string,
  mode: ScraplingMode = 'auto',
): Promise<ScraplingResponse | null> {
  if (!config.scrapling.enabled) return null;
  const target = normalizeUrl(url);
  if (!target) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.scrapling.timeoutMs);

  try {
    const resp = await fetch(`${config.scrapling.url}/extract/snapshot`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: target,
        mode,
        waitMs: Math.min(Math.max(config.scrapling.timeoutMs - 3000, 6000), 45000),
        networkIdle: true,
      }),
    });
    if (!resp.ok) return null;
    return await resp.json() as ScraplingResponse;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
