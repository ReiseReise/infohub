function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&ensp;/gi, ' ')
    .replace(/&emsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&hellip;/gi, '…')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&#(\d+);/g, (_, code) => {
      const value = Number.parseInt(code, 10);
      return Number.isFinite(value) ? String.fromCharCode(value) : '';
    });
}

function stripInlineTags(input: string): string {
  return decodeHtmlEntities(
    input
      .replace(/<\/?(?:em|i)\b[^>]*>/gi, '*')
      .replace(/<\/?(?:strong|b)\b[^>]*>/gi, '**')
      .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, code) => `\`${stripInlineTags(code)}\``)
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim(),
  );
}

export function looksLikeHtmlFragment(input?: string | null): boolean {
  return Boolean(input && /<\/?(?:p|ul|ol|li|a|h[1-6]|blockquote|br|div|article|section|pre|code|figure|figcaption|img)\b/i.test(input));
}

function getHtmlAttribute(input: string, name: string): string {
  const pattern = new RegExp(`${name}\\s*=\\s*(["'])(.*?)\\1`, 'i');
  return decodeHtmlEntities(input.match(pattern)?.[2] || '').trim();
}

function escapeMarkdownLabel(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
}

function imageMarkdownFromHtml(input: string): string {
  const imgTag = input.match(/<img\b[^>]*>/i)?.[0] || '';
  if (!imgTag) return '';
  const src = getHtmlAttribute(imgTag, 'src');
  if (!src) return '';
  const alt = getHtmlAttribute(imgTag, 'alt') || 'article image';
  return `![${escapeMarkdownLabel(alt)}](${src})`;
}

function normalizeLineEndings(input: string): string {
  return input.replace(/\r\n?/g, '\n');
}

function trimMalformedFeedContinuation(input: string): string {
  return input.replace(/\n?```#{1,6}[\s\S]*$/m, '').trim();
}

function extractPlainCode(input: string): string {
  return decodeHtmlEntities(
    input
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\r\n?/g, '\n'),
  ).trim();
}

function fenceCodeBlock(input: string): string {
  const code = extractPlainCode(input);
  if (!code) return '';
  return `\n\n\`\`\`\n${code.replace(/```/g, '\\`\\`\\`')}\n\`\`\`\n\n`;
}

function looksLikeCodeLine(line: string): boolean {
  const value = line.trim();
  if (!value) return false;
  const withoutMarkdownLinks = value
    .replace(/!?(?:\[[^\]]*\])\([^)]+\)/g, ' LINK ')
    .replace(/https?:\/\/\S+/g, ' URL ')
    .replace(/\s+/g, ' ')
    .trim();
  const wordCount = withoutMarkdownLinks.split(/\s+/).filter(Boolean).length;
  const looksLikeProse = wordCount >= 10
    && /[.!?。！？,，;；:]\s*(?:$|[A-Z\u4e00-\u9fff])/.test(withoutMarkdownLinks)
    && !/^(?:import |open |namespace |section |variable\b|theorem\b|lemma\b|def\b|class\b|instance\b|structure\b)/.test(withoutMarkdownLinks);
  if (looksLikeProse) return false;
  if (/^(?:import |open |namespace |section |variable\b|theorem\b|lemma\b|def\b|class\b|instance\b|structure\b)/.test(value)) return true;
  if (/^\/-!/.test(value)) return true;
  if (/^\s{2,}\S/.test(line)) return true;
  if (/:=|=>|->|\bby\b|\[.*\]|[{}<>^]|::/.test(withoutMarkdownLinks) && !/[。！？]/.test(withoutMarkdownLinks)) return true;
  if (/^[A-Za-z0-9_'.() ,:+\-/*=<>\x5b\x5d^|`]+$/.test(withoutMarkdownLinks) && /(?:=|:|\(|\)|\[|\]|\^)/.test(withoutMarkdownLinks)) return true;
  return false;
}

function isCodeHeavyPlainBlock(block: string): boolean {
  const withoutMarkdownImages = block.replace(
    /!\[[^\]]*\]\s*\(\s*https?:\/\/[^\s)]+(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g,
    '',
  ).trim();
  if (!withoutMarkdownImages) return false;

  const lines = normalizeLineEndings(block)
    .split('\n')
    .filter((line) => line.trim());
  if (!lines.length) return false;
  const codeLikeCount = lines.filter(looksLikeCodeLine).length;
  if (codeLikeCount >= 2) return true;
  if (lines.length === 1 && looksLikeCodeLine(lines[0])) return true;
  return codeLikeCount >= Math.ceil(lines.length * 0.6);
}

export function plainTextToReadableMarkdown(input?: string | null): string {
  const raw = trimMalformedFeedContinuation(normalizeLineEndings((input || '').trim()));
  if (!raw) return '';

  const blocks = raw
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const rendered: string[] = [];
  let pendingCodeBlocks: string[] = [];

  const flushPendingCode = () => {
    if (!pendingCodeBlocks.length) return;
    rendered.push(`\`\`\`\n${pendingCodeBlocks.join('\n\n').replace(/```/g, '\\`\\`\\`')}\n\`\`\``);
    pendingCodeBlocks = [];
  };

  for (const block of blocks) {
    if (isCodeHeavyPlainBlock(block)) {
      pendingCodeBlocks.push(block);
      continue;
    }
    flushPendingCode();
    rendered.push(block);
  }

  flushPendingCode();
  return rendered.join('\n\n').trim();
}

function looksLikeCodeParagraph(attrs: string, body: string): boolean {
  const normalizedAttrs = attrs.toLowerCase();
  const hasPreHint = /whitespace-pre|white-space\s*:\s*pre|padding-left\s*:\s*\d+px/.test(normalizedAttrs);
  const text = extractPlainCode(body);
  if (!text) return false;
  if (hasPreHint) {
    if (text.includes('\n')) return true;
    return /\b(?:theorem|lemma|variable|import|def|class|function|nlinarith|trivial)\b|:=|\/-|--|=>|\{|\}/.test(text);
  }
  return isCodeHeavyPlainBlock(text);
}

export function htmlToReadableMarkdown(input?: string | null): string {
  const raw = trimMalformedFeedContinuation((input || '').trim());
  if (!raw) return '';

  let value = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');

  const codeBlocks: string[] = [];
  const stashCodeBlock = (markdown: string) => {
    const key = `@@INFOHUB_CODE_BLOCK_${codeBlocks.length}@@`;
    codeBlocks.push(markdown);
    return key;
  };

  value = value
    .replace(/<figure\b[^>]*>([\s\S]*?)<\/figure>/gi, (_, body) => {
      const image = imageMarkdownFromHtml(body);
      const caption = stripInlineTags(body.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1] || '');
      return [image, caption ? `_${caption.replace(/_/g, '\\_')}_` : ''].filter(Boolean).join('\n\n');
    })
    .replace(/<img\b[^>]*>/gi, (imgTag) => imageMarkdownFromHtml(imgTag));

  value = value
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, body) => stashCodeBlock(fenceCodeBlock(body)))
    .replace(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi, (match, attrs, body) => (
      looksLikeCodeParagraph(attrs, body) ? stashCodeBlock(fenceCodeBlock(body)) : match
    ));

  value = value.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
    const text = stripInlineTags(label).replace(/\*/g, '').trim();
    return text ? `[${text}](${href})` : href;
  });

  value = value
    .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_, text) => `\n# ${stripInlineTags(text)}\n`)
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_, text) => `\n## ${stripInlineTags(text)}\n`)
    .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, (_, text) => `\n### ${stripInlineTags(text)}\n`)
    .replace(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi, (_, text) => `\n#### ${stripInlineTags(text)}\n`)
    .replace(/<h5\b[^>]*>([\s\S]*?)<\/h5>/gi, (_, text) => `\n##### ${stripInlineTags(text)}\n`)
    .replace(/<h6\b[^>]*>([\s\S]*?)<\/h6>/gi, (_, text) => `\n###### ${stripInlineTags(text)}\n`)
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, text) => `\n> ${stripInlineTags(text)}\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, text) => `\n- ${stripInlineTags(text)}`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p\b[^>]*>/gi, '')
    .replace(/<\/?(?:ul|ol|article|section|div|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  const normalized = decodeHtmlEntities(value)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return codeBlocks.reduce((result, block, index) => (
    result.replace(`@@INFOHUB_CODE_BLOCK_${index}@@`, block.trim())
  ), normalized).replace(/\n{3,}/g, '\n\n').trim();
}

function isMostlyChineseText(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  const hanCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const latinCount = (text.match(/[A-Za-z]/g) || []).length;
  if (hanCount >= 24) return true;
  if (hanCount >= 10 && hanCount >= latinCount / 2) return true;
  return hanCount > 0 && latinCount <= 12;
}

export function isUsableDisplaySummary(input?: string | null): boolean {
  const text = (input || '').trim();
  if (!isMostlyChineseText(text)) return false;
  if (/^(?:\{|\[)/.test(text)) return false;
  if (text.length < 60) return false;
  if (/(请(?:您)?提供|未提供|无法进行|不能进行|很抱歉|抱歉).{0,40}(摘要|改写|内容|文本)/.test(text)) return false;
  if (/(?:(?:财报|报告|数据|调查|研究|声明|公司|文章)?(?:还|也)?(?:显示|指出|称|表示)|(?:包括|涉及|例如|原因是|主要为|主要是|分别为|如下))$/i.test(text)) return false;
  return /[。！？.!?]$/.test(text);
}

type ReaderStructureMetrics = {
  paragraphs: number;
  links: string[];
  images: number;
  codeBlocks: number;
};

function readerStructureMetrics(input?: string | null): ReaderStructureMetrics {
  const value = normalizeLineEndings((input || '').trim());
  if (!value) return { paragraphs: 0, links: [], images: 0, codeBlocks: 0 };

  const htmlParagraphs = (value.match(/<\/(?:p|li|blockquote|h[1-6]|figcaption)>/gi) || []).length;
  const markdownParagraphs = value
    .replace(/```[\s\S]*?```/g, '\n\n')
    .split(/\n{2,}/)
    .filter((block) => block.replace(/<[^>]+>/g, ' ').trim().length >= 12)
    .length;
  const links = Array.from(new Set([
    ...(value.match(/https?:\/\/[^\s)"'<>]+/gi) || []),
    ...Array.from(value.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi), (match) => match[1]),
  ].map((url) => url.replace(/[.,;:!?]+$/, ''))));
  const images = (value.match(/<img\b/gi) || []).length + (value.match(/!\[[^\]]*\]\([^\n)]+\)/g) || []).length;
  const codeBlocks = (value.match(/```/g) || []).length / 2 + (value.match(/<(?:pre|code)\b/gi) || []).length;

  return {
    paragraphs: Math.max(htmlParagraphs, markdownParagraphs),
    links,
    images,
    codeBlocks: Math.floor(codeBlocks),
  };
}

function preservesReaderStructure(translation: string, source: string): boolean {
  const sourceMetrics = readerStructureMetrics(source);
  const translationMetrics = readerStructureMetrics(translation);
  if (sourceMetrics.paragraphs >= 6 && translationMetrics.paragraphs < Math.max(3, Math.floor(sourceMetrics.paragraphs * 0.5))) {
    return false;
  }
  if (sourceMetrics.links.length > 0) {
    const translatedLinks = new Set(translationMetrics.links);
    const retainedLinks = sourceMetrics.links.filter((link) => translatedLinks.has(link)).length;
    if (retainedLinks < Math.ceil(sourceMetrics.links.length * 0.8)) return false;
  }
  if (sourceMetrics.images > 0 && translationMetrics.images < sourceMetrics.images) return false;
  if (sourceMetrics.codeBlocks > 0 && translationMetrics.codeBlocks < sourceMetrics.codeBlocks) return false;
  return true;
}

export function isUsableDisplayTranslation(input?: string | null, sourceText?: string | null): boolean {
  const text = (input || '').trim();
  if (/(?:^|[\s{,])"blocks"\s*:\s*\[/.test(text) || /(?:^|[\s{,])"translatedTitle"\s*:/.test(text)) return false;
  if (!isMostlyChineseText(text)) return false;
  if (/(请(?:您)?提供|未提供|无法进行|不能进行|很抱歉|抱歉).{0,40}(翻译|原文|内容|文本)/.test(text)) return false;
  if (/^(?:#{1,6}\s*)?标题[:：]/.test(text) && text.length < 260) return false;

  const source = (sourceText || '').trim();
  if (!source) return text.length >= 24;
  const sourceReadableLength = source.replace(/\s+/g, ' ').length;
  const sourceLineCount = source.split(/\n+/).filter((line) => line.trim().length >= 8).length;
  if (sourceReadableLength >= 4000 && text.length < Math.max(900, sourceReadableLength * 0.3)) return false;
  if (sourceReadableLength >= 1800 && text.length < Math.max(620, sourceReadableLength * 0.3)) return false;
  if (sourceReadableLength >= 900 && text.length < Math.max(320, sourceReadableLength * 0.32)) return false;
  if (sourceReadableLength >= 500 && text.length < Math.max(140, sourceReadableLength * 0.28)) return false;
  if (sourceLineCount >= 5 && text.length < 120) return false;
  if (!preservesReaderStructure(text, source)) return false;
  return true;
}
