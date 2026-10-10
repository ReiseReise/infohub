export const TRANSLATION_FORMAT_VERSION = 'translation-v2' as const;

export type TranslationQualityReasonCode =
  | 'empty'
  | 'structured_output_leak'
  | 'non_chinese'
  | 'model_refusal'
  | 'too_short'
  | 'missing_paragraphs'
  | 'missing_links'
  | 'missing_images'
  | 'missing_code'
  | 'truncated';

export type TranslationQualityAssessment = {
  basisLength: number;
  translatedLength: number;
  chunkCount: number;
  complete: boolean;
  usable: boolean;
  reason: string | null;
  reasonCode: TranslationQualityReasonCode | null;
  formatVersion: typeof TRANSLATION_FORMAT_VERSION;
};

function countMatches(input: string, pattern: RegExp): number {
  return (input.match(pattern) || []).length;
}

function plainLength(input?: string | null): number {
  return String(input || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .length;
}

function isMostlyChinese(input: string): boolean {
  const linguisticText = input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/[^\s)"'<>]+/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const hanCount = countMatches(linguisticText, /[\u4e00-\u9fff]/g);
  const latinCount = countMatches(linguisticText, /[A-Za-z]/g);
  if (hanCount >= 24) return true;
  if (hanCount >= 10 && hanCount >= latinCount / 2) return true;
  return hanCount > 0 && latinCount <= 12;
}

function extractLinks(input: string): string[] {
  return [...new Set([
    ...(input.match(/https?:\/\/[^\s)"'<>]+/gi) || []),
    ...Array.from(input.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi), (match) => match[1]),
  ].map((url) => url.replace(/[.,;:!?]+$/, '')))];
}

function countParagraphs(input: string): number {
  const html = (input.match(/<\/(?:p|li|blockquote|h[1-6]|figcaption)>/gi) || []).length;
  const markdown = input
    .replace(/```[\s\S]*?```/g, '\n\n')
    .split(/\n{2,}/)
    .filter((block) => plainLength(block) >= 12)
    .length;
  return Math.max(html, markdown);
}

function containsStructuredOutputLeak(input: string): boolean {
  return /(?:^|[\s{,])"blocks"\s*:\s*\[/.test(input)
    || /(?:^|[\s{,])"translatedTitle"\s*:/.test(input)
    || /```json\s*\{[\s\S]*?"blocks"\s*:/i.test(input);
}

export function looksTruncatedTranslation(input: string): boolean {
  const text = input.trim();
  if (!text) return true;
  if (/[—\-–:：,，、（(]$/.test(text)) return true;
  if (/(evidenced|including|such as|for example|例如|比如|包括)$/i.test(text)) return true;
  return (text.match(/```/g) || []).length % 2 !== 0;
}

function failed(
  base: Omit<TranslationQualityAssessment, 'complete' | 'usable' | 'reason' | 'reasonCode'>,
  reasonCode: TranslationQualityReasonCode,
  reason: string,
): TranslationQualityAssessment {
  return { ...base, complete: false, usable: false, reason, reasonCode };
}

export function evaluateTranslationArtifact(
  translation?: string | null,
  sourceText?: string | null,
  options: { basisLength?: number | null } = {},
): TranslationQualityAssessment {
  const source = String(sourceText || '').trim();
  const translated = String(translation || '').trim();
  const basisLength = options.basisLength == null
    ? source.length
    : Math.max(0, Number(options.basisLength || 0));
  const translatedLength = translated.length;
  const base = {
    basisLength,
    translatedLength,
    chunkCount: Math.max(1, Math.ceil(Math.max(source.length, 1) / 1800)),
    formatVersion: TRANSLATION_FORMAT_VERSION,
  };

  if (!translated) return failed(base, 'empty', '译文为空。');
  if (containsStructuredOutputLeak(translated)) {
    return failed(base, 'structured_output_leak', '译文包含模型结构化输出，不能作为正文展示。');
  }
  if (!isMostlyChinese(translated)) {
    return failed(base, 'non_chinese', '译文不是可读的简体中文。');
  }
  if (/(请(?:您)?提供|未提供|无法进行|不能进行|很抱歉|抱歉).{0,40}(翻译|原文|内容|文本)/.test(translated)) {
    return failed(base, 'model_refusal', '模型没有返回正文译文。');
  }
  if (
    (basisLength >= 4000 && translatedLength < Math.max(900, basisLength * 0.3))
    || (basisLength >= 1800 && translatedLength < Math.max(620, basisLength * 0.3))
    || (basisLength >= 900 && translatedLength < Math.max(320, basisLength * 0.32))
    || (basisLength >= 500 && translatedLength < Math.max(140, basisLength * 0.28))
  ) {
    return failed(base, 'too_short', basisLength >= 900
      ? '译文明显短于原文，可能只覆盖了开头部分。'
      : '译文偏短，建议重新生成完整译文。');
  }

  const sourceParagraphs = countParagraphs(source);
  const translatedParagraphs = countParagraphs(translated);
  if (sourceParagraphs >= 4 && translatedParagraphs < Math.ceil(sourceParagraphs * 0.85)) {
    return failed(base, 'missing_paragraphs', '译文缺少部分原文段落，可能发生了概括或漏译。');
  }

  const sourceLinks = extractLinks(source);
  const translatedLinks = new Set(extractLinks(translated));
  if (sourceLinks.some((link) => !translatedLinks.has(link))) {
    return failed(base, 'missing_links', '译文没有完整保留原文链接结构。');
  }

  const sourceImages = (source.match(/!\[[^\]]*\]\([^)]+\)|<img\b[^>]*>/gi) || []).length;
  const translatedImages = (translated.match(/!\[[^\]]*\]\([^)]+\)|<img\b[^>]*>/gi) || []).length;
  if (sourceImages > translatedImages) {
    return failed(base, 'missing_images', '译文没有完整保留原文图片。');
  }

  const sourceCodeBlocks = Math.floor((source.match(/```/g) || []).length / 2);
  const translatedCodeBlocks = Math.floor((translated.match(/```/g) || []).length / 2);
  if (sourceCodeBlocks > translatedCodeBlocks) {
    return failed(base, 'missing_code', '译文没有完整保留原文代码块。');
  }
  if (looksTruncatedTranslation(translated)) {
    return failed(base, 'truncated', '译文疑似截断。');
  }

  return {
    ...base,
    complete: true,
    usable: true,
    reason: null,
    reasonCode: null,
  };
}
