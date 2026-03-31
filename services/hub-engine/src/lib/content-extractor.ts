import { fetch } from 'undici';
import { fetchBrowserAssist } from './browser-assist-client.js';
import {
  fetchScraplingArticle,
  fetchScraplingSnapshot,
  resolvePreferredScraplingMode,
} from './scrapling-client.js';

export type FetchEngine =
  | 'native'
  | 'scrapling-http'
  | 'scrapling-dynamic'
  | 'scrapling-stealth'
  | 'browser-assist';

export interface ExtractedArticleResult {
  title: string | null;
  content: string | null;
  fetchEngine: FetchEngine | null;
  renderMode: string | null;
  blockedReason: string | null;
}

const USER_AGENT = 'InfoHub/3.1 (+content-extractor)';

const MAIN_BLOCK_PATTERNS: RegExp[] = [
  /<article\b[^>]*>([\s\S]*?)<\/article>/i,
  /<main\b[^>]*>([\s\S]*?)<\/main>/i,
  /<div\b[^>]*class=["'][^"']*(?:post-content|entry-content|article-content|transcript|content-body)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  /<section\b[^>]*class=["'][^"']*(?:article|content|post|entry)[^"']*["'][^>]*>([\s\S]*?)<\/section>/i,
];

const NAVIGATION_TERMS = [
  '账号设置', '我的关注', '我的收藏', '申请的报道', '退出登录', '登录', '搜索',
  '企业服务', '政府服务', '核心服务', '创投平台', '媒体品牌', '投资人服务',
  '36氪pro', '36krpro', '创投氪堂', '企业入驻', '创业者服务', 'lp源计划',
  '数字时氪', '未来消费', '智能涌现', '未来城市', '启动power on', '36氪出海',
  '创投发布', 'vclub', '投资机构库', '投资机构职位推介', '投资人认证',
  '企服点评', '36kr研究院', '36氪财经', '职场bonus', '36碳', '后浪研究所',
  '暗涌waves', '硬氪', '氪睿研究院', '企业号', '寻求报道', 'ai测评网',
];

const ARTICLE_END_MARKERS = [
  '原文链接', '下一篇', '24小时热榜', '查看更多榜单', '关于36氪', '热门推荐',
  '36氪APP下载', '违法和不良信息', '意见反馈', '联系我们', '加入我们',
];

const SHARE_PATTERNS: RegExp[] = [
  /打开微信[“"]?扫一扫[”"]?，?打开网页后点击屏幕右上角分享按钮/gi,
  /打开微信[“"]?扫一扫[”"]?/gi,
  /分享至/gi,
  /搜索\s+寻求报道\s+我要入驻\s+城市合作/gi,
];

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const value = Number.parseInt(code, 10);
      return Number.isFinite(value) ? String.fromCharCode(value) : '';
    });
}

function stripTagsToText(input: string): string {
  return decodeHtmlEntities(
    input
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  );
}

function removeBoilerplateLines(input: string): string {
  const lines = input
    .replace(/\u00a0/g, ' ')
    .replace(/[|｜•·]+/g, '\n')
    .replace(/\s{2,}/g, '\n')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const kept = lines.filter((line) => {
    const normalized = line.toLowerCase();
    const tokens = line.split(/[\s,，、/]+/).filter(Boolean);
    const shortTokenRatio = tokens.length > 0
      ? tokens.filter((token) => token.length <= 4).length / tokens.length
      : 0;
    const navHits = NAVIGATION_TERMS.filter((term) => normalized.includes(term)).length;
    const looksLikeNav = tokens.length >= 8 && shortTokenRatio >= 0.75 && !/[。！？.!?]/.test(line);
    const looksLikeServiceDirectory = navHits >= 3;
    return !looksLikeNav && !looksLikeServiceDirectory;
  });

  return kept.join('\n').trim();
}

function countNavigationHits(input: string): number {
  const normalized = input.toLowerCase();
  return NAVIGATION_TERMS.filter((term) => normalized.includes(term)).length;
}

function sanitizeArticleLine(input: string): string {
  let line = input
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!line) return '';

  line = line
    .replace(/^\d{4}[-/.年]\s*\d{1,2}[-/.月]\s*\d{1,2}(?:日)?\s+\d{1,2}:\d{2}\s*/, '')
    .replace(/^\d+\s*(分钟前|小时前|天前)\s*/, '')
    .replace(/^搜索\s+/i, '')
    .trim();

  for (const pattern of SHARE_PATTERNS) {
    line = line.replace(pattern, ' ').replace(/\s+/g, ' ').trim();
  }

  for (const marker of ARTICLE_END_MARKERS) {
    const index = line.indexOf(marker);
    if (index >= 0) {
      line = line.slice(0, index).trim();
    }
  }

  return line.trim();
}

function pickReadableLines(input: string): string[] {
  const normalizedInput = input
    .replace(/\r\n/g, '\n')
    .replace(/[|｜•·]+/g, '\n')
    .replace(/(\d{4}[-/.年]\s*\d{1,2}[-/.月]\s*\d{1,2}(?:日)?\s+\d{1,2}:\d{2})/g, '\n$1 ')
    .replace(/(原文链接|下一篇|24小时热榜|查看更多榜单|关于36氪|热门推荐)/g, '\n$1')
    .replace(/(36氪获悉|爱企查App显示|记者获悉|据[^，。]{0,12}(?:消息|报道|称))/g, '\n$1')
    .replace(/([。！？.!?；;])\s+(?=[^\s])/g, '$1\n')
    .replace(/\s{2,}/g, '\n')
    .replace(/\n{3,}/g, '\n\n');

  const lines = normalizedInput
    .replace(/\n{3,}/g, '\n\n')
    .split(/\n+/)
    .map(sanitizeArticleLine)
    .filter(Boolean);

  if (lines.length === 0) return [];

  if (lines.length === 1 && countNavigationHits(lines[0]) >= 3) {
    const extracted = sanitizeArticleLine(
      normalizedInput
        .replace(/^[\s\S]*?(\d{4}[-/.年]\s*\d{1,2}[-/.月]\s*\d{1,2}(?:日)?\s+\d{1,2}:\d{2}[\s\S]*)$/, '$1')
        .replace(/(原文链接|下一篇|24小时热榜|查看更多榜单|关于36氪|热门推荐)[\s\S]*$/g, ''),
    );
    if (extracted && countNavigationHits(extracted) < 2) {
      return [extracted];
    }
  }

  const bodyStart = lines.findIndex((line) => {
    const navHits = countNavigationHits(line);
    const hasSentence = /[。！？.!?；;]/.test(line);
    return navHits < 2 && line.length >= 18 && (hasSentence || line.length >= 48);
  });

  if (bodyStart === -1) {
    return lines.filter((line) => countNavigationHits(line) < 2).slice(0, 4);
  }

  const picked: string[] = [];
  for (let i = bodyStart; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    if (ARTICLE_END_MARKERS.some((marker) => line.includes(marker))) break;
    if (/^(关于36氪|热门推荐|36氪APP下载|违法和不良信息|意见反馈)/.test(line)) break;
    if (countNavigationHits(line) >= 2 && picked.length > 0) continue;
    picked.push(line);
    if (picked.length >= 10) break;
  }

  return picked;
}

function extractReadableText(input: string): string {
  const picked = pickReadableLines(input);
  if (picked.length > 0) {
    const body = picked.join('\n');
    return removeBoilerplateLines(body) || body;
  }
  return removeBoilerplateLines(input) || input;
}

function selectMainHtmlBlock(html: string): string {
  for (const pattern of MAIN_BLOCK_PATTERNS) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }

  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch?.[1]) return bodyMatch[1];
  return html;
}

function extractTitleFromHtml(html: string): string | null {
  const match = html.match(/<title>([\s\S]*?)<\/title>/i);
  const raw = match?.[1]?.replace(/\s+/g, ' ').trim();
  return raw ? decodeHtmlEntities(raw) : null;
}

function extractObsidianPreloadMarkdownUrl(html: string): string | null {
  const match = html.match(/window\.preloadPage\s*=\s*f\(["']([^"']+\.md(?:\?[^"']*)?)["']\)/i);
  return match?.[1]?.trim() || null;
}

async function fetchPlainText(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/plain,text/markdown;q=0.9,*/*;q=0.1',
      },
      redirect: 'follow',
    });
    if (!resp.ok) return null;
    const text = (await resp.text()).trim();
    return text || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function extractJsonLdArticleBody(html: string): string | null {
  const matches = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of matches) {
    const raw = decodeHtmlEntities(match[1] || '').trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const candidate of candidates) {
        if (!candidate || typeof candidate !== 'object') continue;
        const articleBody = (candidate as Record<string, unknown>).articleBody;
        if (typeof articleBody === 'string' && articleBody.trim().length >= 80) {
          return articleBody.trim();
        }
        const graph = (candidate as Record<string, unknown>)['@graph'];
        if (Array.isArray(graph)) {
          for (const item of graph) {
            if (!item || typeof item !== 'object') continue;
            const graphBody = (item as Record<string, unknown>).articleBody;
            if (typeof graphBody === 'string' && graphBody.trim().length >= 80) {
              return graphBody.trim();
            }
          }
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

function stripHtmlForDensity(input: string): string {
  return stripTagsToText(input)
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDenseHtmlBlock(html: string): string | null {
  const candidates = [...html.matchAll(/<(article|section|div)[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((match) => match[0])
    .slice(0, 120);

  let bestBlock: string | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const text = stripHtmlForDensity(candidate);
    if (text.length < 120) continue;
    const paragraphLike = (text.match(/[。！？.!?；;:：]/g) || []).length;
    const score = text.length + paragraphLike * 60 - countNavigationHits(text) * 120;
    if (score > bestScore) {
      bestScore = score;
      bestBlock = candidate;
    }
  }

  return bestBlock;
}

export function plainTextLength(input?: string | null): number {
  if (!input) return 0;
  const isHtml = /<\/?[a-z][\s\S]*>/i.test(input);
  const text = isHtml ? stripTagsToText(input) : input.trim();
  return text.length;
}

export function buildSnippet(input?: string | null, maxLen = 200): string | undefined {
  if (!input) return undefined;
  const isHtml = /<\/?[a-z][\s\S]*>/i.test(input);
  const mainText = isHtml ? stripTagsToText(selectMainHtmlBlock(input)) : input;
  const cleaned = extractReadableText(mainText);
  const normalized = cleaned.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maxLen);
}

export function cleanPreviewText(input?: string | null, maxLen = 220): string | undefined {
  if (!input) return undefined;
  const isHtml = /<\/?[a-z][\s\S]*>/i.test(input);
  const text = isHtml ? stripTagsToText(selectMainHtmlBlock(input)) : input;
  const cleaned = extractReadableText(text);
  const normalized = cleaned.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maxLen);
}

export function cleanArticleBody(input?: string | null, maxLen = 50000): string | undefined {
  if (!input) return undefined;
  const isHtml = /<\/?[a-z][\s\S]*>/i.test(input);
  const text = isHtml ? stripTagsToText(selectMainHtmlBlock(input)) : input;
  const cleaned = extractReadableText(text).replace(/\n{3,}/g, '\n\n').trim();
  if (!cleaned) return undefined;
  return cleaned.slice(0, maxLen);
}

export function looksLikeBoilerplateText(input?: string | null): boolean {
  if (!input) return false;
  const isHtml = /<\/?[a-z][\s\S]*>/i.test(input);
  const text = (isHtml ? stripTagsToText(selectMainHtmlBlock(input)) : input).trim();
  if (!text) return false;
  return countNavigationHits(text) >= 3 || /24小时热榜|关于36氪|打开微信.*分享按钮|账号设置/.test(text);
}

export function detectLikelyLanguage(input?: string | null): string | null {
  if (!input) return null;
  const text = input.trim();
  if (!text) return null;

  const zhChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const latinChars = (text.match(/[A-Za-z]/g) || []).length;

  if (zhChars >= 12 && zhChars >= latinChars * 0.4) {
    return 'zh';
  }

  if (latinChars >= 30 && zhChars <= 2) {
    return 'en';
  }

  if (latinChars >= 20 && zhChars === 0) {
    return 'en';
  }

  return null;
}

function mapScraplingEngine(renderMode?: string | null): FetchEngine {
  switch ((renderMode || '').trim()) {
    case 'dynamic':
      return 'scrapling-dynamic';
    case 'stealth':
      return 'scrapling-stealth';
    default:
      return 'scrapling-http';
  }
}

function normalizeRenderedArticle(
  rendered: Awaited<ReturnType<typeof fetchScraplingArticle>> | null,
): ExtractedArticleResult | null {
  if (!rendered) return null;
  const content = cleanArticleBody(rendered.content || rendered.html || '', 50000)
    || cleanArticleBody(rendered.html || '', 50000)
    || rendered.content
    || null;
  if (!content) return null;
  return {
    title: rendered.title || null,
    content: content.slice(0, 50000),
    fetchEngine: mapScraplingEngine(rendered.renderMode),
    renderMode: rendered.renderMode || null,
    blockedReason: rendered.blockedReason || null,
  };
}

function normalizeBrowserAssistArticle(
  assisted: Awaited<ReturnType<typeof fetchBrowserAssist>> | null,
): ExtractedArticleResult | null {
  if (!assisted) return null;
  const content = cleanArticleBody(assisted.content || assisted.html || '', 50000)
    || cleanArticleBody(assisted.html || '', 50000)
    || assisted.content
    || null;
  if (!content) return null;
  return {
    title: assisted.title || null,
    content: content.slice(0, 50000),
    fetchEngine: 'browser-assist',
    renderMode: assisted.renderMode || 'browser-assist',
    blockedReason: assisted.blockedReason || null,
  };
}

export async function fetchArticleResult(url: string, timeoutMs = 8000): Promise<ExtractedArticleResult | null> {
  if (!/^https?:\/\//i.test(url)) return null;

  const preferredScraplingMode = resolvePreferredScraplingMode(url);
  if (preferredScraplingMode !== 'auto') {
    const rendered = normalizeRenderedArticle(await fetchScraplingArticle(url, preferredScraplingMode));
    if (rendered?.content && plainTextLength(rendered.content) >= 80) {
      return rendered;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });

    if (!resp.ok) return null;
    const contentType = (resp.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html')) return null;

    const html = await resp.text();
    if (!html) return null;
    const title = extractTitleFromHtml(html);

    const preloadMarkdownUrl = extractObsidianPreloadMarkdownUrl(html);
    if (preloadMarkdownUrl) {
      const preloadText = await fetchPlainText(preloadMarkdownUrl, timeoutMs);
      const cleanedPreload = cleanArticleBody(preloadText, 50000) || preloadText;
      if (cleanedPreload && plainTextLength(cleanedPreload) >= 80) {
        return {
          title,
          content: cleanedPreload.slice(0, 50000),
          fetchEngine: 'native',
          renderMode: 'native',
          blockedReason: null,
        };
      }
    }

    const primaryBlock = selectMainHtmlBlock(html);
    const denseBlock = extractDenseHtmlBlock(html);
    const candidates = [
      extractJsonLdArticleBody(html),
      cleanArticleBody(primaryBlock, 50000),
      denseBlock ? cleanArticleBody(denseBlock, 50000) : null,
      cleanArticleBody(html, 50000),
      buildSnippet(primaryBlock, 600),
    ].filter((value): value is string => Boolean(value && value.trim()));

    const best = candidates.find((candidate) => plainTextLength(candidate) >= 140)
      || candidates.find((candidate) => plainTextLength(candidate) >= 80)
      || null;

    if (best) {
      return {
        title,
        content: best.slice(0, 50000),
        fetchEngine: 'native',
        renderMode: 'native',
        blockedReason: null,
      };
    }

    const rendered = normalizeRenderedArticle(await fetchScraplingArticle(url, 'auto'));
    if (rendered?.content && plainTextLength(rendered.content) >= 80) {
      return rendered;
    }

    const assisted = normalizeBrowserAssistArticle(await fetchBrowserAssist(url, 'article'));
    if (assisted?.content && plainTextLength(assisted.content) >= 80) {
      return assisted;
    }

    return rendered || assisted;
  } catch {
    const rendered = normalizeRenderedArticle(await fetchScraplingArticle(url, preferredScraplingMode));
    if (rendered?.content && plainTextLength(rendered.content) >= 80) {
      return rendered;
    }
    const assisted = normalizeBrowserAssistArticle(await fetchBrowserAssist(url, 'article'));
    return assisted || rendered;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchArticleText(url: string, timeoutMs = 8000): Promise<string | null> {
  const result = await fetchArticleResult(url, timeoutMs);
  return result?.content || null;
}

export async function fetchPageSnapshot(
  url: string,
  timeoutMs = 8000,
): Promise<ExtractedArticleResult | null> {
  if (!/^https?:\/\//i.test(url)) return null;

  const preferredScraplingMode = resolvePreferredScraplingMode(url);
  if (preferredScraplingMode !== 'auto') {
    const rendered = normalizeRenderedArticle(await fetchScraplingSnapshot(url, preferredScraplingMode));
    if (rendered?.content) {
      return rendered;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });

    if (!resp.ok) return null;
    const contentType = (resp.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html')) return null;

    const html = await resp.text();
    if (!html) return null;

    const preloadMarkdownUrl = extractObsidianPreloadMarkdownUrl(html);
    if (preloadMarkdownUrl) {
      const preloadText = await fetchPlainText(preloadMarkdownUrl, timeoutMs);
      const cleanedPreload = cleanArticleBody(preloadText, 50000) || preloadText;
      if (cleanedPreload) {
        return {
          title: extractTitleFromHtml(html),
          content: cleanedPreload.slice(0, 50000),
          fetchEngine: 'native',
          renderMode: 'native',
          blockedReason: null,
        };
      }
    }

    const block = selectMainHtmlBlock(html);
    const text = (cleanArticleBody(block, 50000)
      || cleanArticleBody(html, 50000)
      || stripTagsToText(block).slice(0, 50000));
    const snapshot = {
      title: extractTitleFromHtml(html),
      content: text || null,
      fetchEngine: 'native' as const,
      renderMode: 'native',
      blockedReason: null,
    };
    if (snapshot.content && plainTextLength(snapshot.content) >= 80) {
      return snapshot;
    }

    const rendered = normalizeRenderedArticle(await fetchScraplingSnapshot(url, 'auto'));
    if (rendered?.content && plainTextLength(rendered.content) >= 80) {
      return {
        ...rendered,
        title: rendered.title || snapshot.title || null,
        content: rendered.content || snapshot.content || null,
      };
    }

    const assisted = normalizeBrowserAssistArticle(await fetchBrowserAssist(url, 'snapshot'));
    if (assisted?.content) {
      return {
        ...assisted,
        title: assisted.title || rendered?.title || snapshot.title || null,
        content: assisted.content || rendered?.content || snapshot.content || null,
      };
    }

    return rendered ? {
      ...rendered,
      title: rendered.title || snapshot.title || null,
      content: rendered.content || snapshot.content || null,
    } : snapshot;
  } catch {
    const rendered = normalizeRenderedArticle(await fetchScraplingSnapshot(url, preferredScraplingMode));
    if (rendered?.content) return rendered;
    return normalizeBrowserAssistArticle(await fetchBrowserAssist(url, 'snapshot'));
  } finally {
    clearTimeout(timeout);
  }
}
