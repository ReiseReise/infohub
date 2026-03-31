import { config } from '../config/index.js';

export type BrowserAssistTarget = 'article' | 'snapshot';

type BrowserAssistResponse = {
  title?: string | null;
  content?: string | null;
  snippet?: string | null;
  html?: string | null;
  finalUrl?: string | null;
  renderMode?: string | null;
  provider?: string | null;
  blocked?: boolean;
  blockedReason?: string | null;
  latencyMs?: number;
};

function normalizedBaseUrl(): string {
  return config.browserAssist.url.replace(/\/+$/, '');
}

export function isBrowserAssistEnabled(): boolean {
  return config.browserAssist.enabled && Boolean(normalizedBaseUrl());
}

export async function fetchBrowserAssist(
  url: string,
  target: BrowserAssistTarget,
  options: { provider?: string | null } = {},
): Promise<BrowserAssistResponse | null> {
  if (!isBrowserAssistEnabled()) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.browserAssist.timeoutMs);

  try {
    const endpoint = `${normalizedBaseUrl()}/extract/${target}`;
    const provider = (options.provider || config.browserAssist.provider || 'generic').trim() || 'generic';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-browser-assist-provider': provider,
    };
    if (config.browserAssist.token) {
      headers.Authorization = `Bearer ${config.browserAssist.token}`;
    }

    const resp = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: JSON.stringify({
        url,
        sourceHint: 'infohub',
      }),
    });
    if (!resp.ok) return null;
    return await resp.json() as BrowserAssistResponse;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
