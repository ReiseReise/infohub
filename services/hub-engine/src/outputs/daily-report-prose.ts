/** Publication checks run on the delivered prose, not just the model response. */
export function containsDailyPlaceholder(text: string) {
  return /(?:当前缺少可靠摘要|模型摘要暂[时]?不可用|本地阅读导读|本地兜底|正文约\s*\d+\s*字|开头涉及|稍后重跑摘要|当前只确认了文章主题|摘要仍需补充|translation_truncated|content_unavailable)/i.test(text);
}

export function dailyProseIssue(markdown: string): string | null {
  if (containsDailyPlaceholder(markdown)) return 'placeholder_content';
  if (/REUTERS\/[A-Za-z]|\bFile Photo\b|\bIllustration\/File\b/.test(markdown)) return 'photo_caption_as_summary';
  if (/\[!\[|!\[[^\]\n]*(?:\n|$)/.test(markdown)) return 'broken_editorial_markup';
  return null;
}

function numbers(value: string) {
  const units: Record<string, number> = { trillion: 1e12, billion: 1e9, million: 1e6, thousand: 1e3, 万亿: 1e12, 亿: 1e8, 万: 1e4, 千: 1e3 };
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const normalized = value.replace(/(?<=\d),(?=\d{3}\b)/g, '')
    .replace(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/gi,
      (month) => `${months.findIndex((name) => name.toLowerCase() === month.toLowerCase()) + 1}月`);
  return [...normalized.matchAll(/(\d+(?:\.\d+)?)\s*(trillion\b|billion\b|million\b|thousand\b|万亿|亿|万|千)?/gi)]
    .map((match) => String(Number((Number(match[1]) * (units[match[2]?.toLowerCase()] || 1)).toPrecision(12))));
}

export function hasUnsupportedEditorialNumbers(prose: string, evidence: string) {
  const supported = new Set(numbers(evidence));
  // Citation IDs and list numbering are not factual numbers.
  const text = prose.replace(/\]\([^)]*\)/g, ']').replace(/^\s*\d+[.)、]\s+/gm, '');
  return numbers(text).some((number) => !supported.has(number));
}

export function preserveEditorialProse(body: string, evidence: string, allowedItemIds: Set<string>) {
  const value = body.trim();
  if (value.length < 100 || (value.match(/[\u3400-\u9fff]/g) || []).length < 40) return '';
  if (dailyProseIssue(value) || /(?:候选池|评分阈值|入报原因|全文约|符合.*字数|REUTERS\/|File Photo|avatar)/i.test(value)) return '';
  if (hasUnsupportedEditorialNumbers(value, evidence)) return '';
  const links = [...value.matchAll(/\[[^\]\n]+\]\(([^)\s]+)\)/g)];
  if (links.some((match) => !allowedItemIds.has(match[1].match(/^\/feed\/([^?#/]+)(?:[?#].*)?$/)?.[1] || ''))) return '';
  return value;
}
