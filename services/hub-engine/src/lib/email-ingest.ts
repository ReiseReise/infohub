import { createHash } from 'node:crypto';

type RawEmailIngestItem = Record<string, unknown>;

export interface RawEmlInput {
  filename?: string;
  content: string;
}

export interface NormalizedEmailIngestItem {
  title: string;
  url: string;
  guid: string;
  sourceType: 'email';
  sourceLabel?: string;
  content: string;
  snippet?: string;
  author?: string;
  publishedAt?: Date;
  messageId?: string;
}

export interface RedactedEmailIngestLog {
  title: string;
  author?: string;
  sourceLabel?: string;
  guidHash: string;
  sourceType: 'email';
  publishedAt?: string;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const numeric = Number(code);
      return Number.isFinite(numeric) ? String.fromCharCode(numeric) : _;
    });
}

function decodeMimeEncodedWords(value: string): string {
  return value.replace(/=\?([^?]+)\?([BQbq])\?([^?]+)\?=/g, (_, charset, encoding, encoded) => {
    try {
      const normalizedCharset = String(charset || '').toLowerCase();
      if (normalizedCharset && !/utf-?8/.test(normalizedCharset)) return _;
      const mode = String(encoding || '').toUpperCase();
      const buffer = mode === 'B'
        ? Buffer.from(String(encoded || ''), 'base64')
        : Buffer.from(String(encoded || '').replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_hex: string, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))), 'binary');
      return buffer.toString('utf8');
    } catch {
      return _;
    }
  }).trim();
}

function decodeQuotedPrintable(value: string): string {
  const softLineBreaksRemoved = value.replace(/=\r?\n/g, '');
  const binary = softLineBreaksRemoved.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  return Buffer.from(binary, 'binary').toString('utf8');
}

function decodeTransfer(value: string, transferEncoding: string): string {
  const encoding = transferEncoding.toLowerCase();
  if (encoding.includes('base64')) {
    try {
      return Buffer.from(value.replace(/\s+/g, ''), 'base64').toString('utf8').trim();
    } catch {
      return value.trim();
    }
  }
  if (encoding.includes('quoted-printable')) {
    return decodeQuotedPrintable(value).trim();
  }
  return value.trim();
}

function splitHeaderBody(raw: string): { headerText: string; bodyText: string } {
  const normalized = raw.replace(/\r\n/g, '\n');
  const splitAt = normalized.search(/\n\n/);
  if (splitAt < 0) return { headerText: normalized, bodyText: '' };
  return {
    headerText: normalized.slice(0, splitAt),
    bodyText: normalized.slice(splitAt + 2),
  };
}

function parseHeaders(headerText: string): Record<string, string> {
  const headers: Record<string, string> = {};
  let currentKey = '';
  for (const rawLine of headerText.split('\n')) {
    if (/^\s/.test(rawLine) && currentKey) {
      headers[currentKey] = `${headers[currentKey]} ${rawLine.trim()}`.trim();
      continue;
    }
    const match = rawLine.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    currentKey = match[1].trim().toLowerCase();
    headers[currentKey] = decodeMimeEncodedWords(match[2].trim());
  }
  return headers;
}

function extractHeaderParam(value: string, name: string): string {
  const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]+)"|([^;\\s]+))`, 'i');
  const match = value.match(pattern);
  return (match?.[1] || match?.[2] || '').trim();
}

function splitMultipart(bodyText: string, boundary: string): string[] {
  if (!boundary) return [];
  const marker = `--${boundary}`;
  return bodyText
    .split(marker)
    .map((part) => part.trim())
    .filter((part) => part && part !== '--' && !part.startsWith('--'));
}

function parseEmlPart(raw: string): { contentType: string; transferEncoding: string; body: string } {
  const { headerText, bodyText } = splitHeaderBody(raw);
  const headers = parseHeaders(headerText);
  return {
    contentType: (headers['content-type'] || 'text/plain').toLowerCase(),
    transferEncoding: headers['content-transfer-encoding'] || '',
    body: decodeTransfer(bodyText, headers['content-transfer-encoding'] || ''),
  };
}

export function parseEmlMessages(inputs: RawEmlInput[], sourceLabel?: string): RawEmailIngestItem[] {
  return inputs.flatMap((input) => {
    const { headerText, bodyText } = splitHeaderBody(input.content);
    const headers = parseHeaders(headerText);
    const contentType = (headers['content-type'] || 'text/plain').toLowerCase();
    const transferEncoding = headers['content-transfer-encoding'] || '';
    const boundary = extractHeaderParam(contentType, 'boundary');

    let bodyTextValue = '';
    let bodyHtmlValue = '';
    if (contentType.includes('multipart/') && boundary) {
      for (const partRaw of splitMultipart(bodyText, boundary)) {
        const part = parseEmlPart(partRaw);
        if (part.contentType.includes('text/plain') && !bodyTextValue) {
          bodyTextValue = part.body;
        } else if (part.contentType.includes('text/html') && !bodyHtmlValue) {
          bodyHtmlValue = part.body;
        }
      }
    } else if (contentType.includes('text/html')) {
      bodyHtmlValue = decodeTransfer(bodyText, transferEncoding);
    } else {
      bodyTextValue = decodeTransfer(bodyText, transferEncoding);
    }

    return [{
      subject: headers.subject || input.filename || '邮件：无标题',
      from: headers.from || undefined,
      date: headers.date || undefined,
      messageId: normalizeMessageId(headers['message-id']),
      bodyText: bodyTextValue || undefined,
      bodyHtml: bodyHtmlValue || undefined,
      sourceLabel,
    }];
  });
}

function stripHtml(value: string): string {
  if (!value.trim()) return '';
  return decodeBasicHtmlEntities(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeMessageId(value: unknown): string {
  return asText(value).replace(/^<|>$/g, '').trim();
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function parseDate(value: unknown): Date | undefined {
  const text = asText(value);
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function buildEmailContent(raw: RawEmailIngestItem, body: string): string {
  const from = asText(raw.from);
  const sourceLabel = asText(raw.sourceLabel);
  const lines: string[] = [];
  lines.push(body.trim());
  lines.push('', '## 邮件信息');
  if (from) lines.push(`- 发件人：${from}`);
  if (sourceLabel) lines.push(`- 来源标签：${sourceLabel}`);
  return lines.join('\n').trim() + '\n';
}

export function normalizeEmailIngestItems(rawItems: RawEmailIngestItem[]): NormalizedEmailIngestItem[] {
  const seen = new Set<string>();
  const normalized: NormalizedEmailIngestItem[] = [];

  for (const raw of rawItems) {
    const subject = asText(raw.subject) || asText(raw.title) || '邮件：无标题';
    const from = asText(raw.from) || asText(raw.author) || undefined;
    const sourceLabel = asText(raw.sourceLabel) || asText(raw.label) || undefined;
    const bodyText = asText(raw.bodyText) || asText(raw.text) || asText(raw.body);
    const bodyHtml = asText(raw.bodyHtml) || asText(raw.html);
    const body = bodyText || stripHtml(bodyHtml);
    if (!subject && !body) continue;

    const messageId = normalizeMessageId(raw.messageId);
    const hashBasis = messageId || [subject, from || '', asText(raw.date), body].join('\n');
    const hash = sha256(hashBasis);
    const guid = messageId ? `email:${messageId}` : `email:${hash}`;
    if (seen.has(guid)) continue;
    seen.add(guid);

    const content = buildEmailContent(raw, body || subject);
    const publishedAt = parseDate(raw.date || raw.publishedAt);
    normalized.push({
      title: subject,
      url: `email://${hash.slice(0, 24)}`,
      guid,
      sourceType: 'email',
      sourceLabel,
      content,
      snippet: compactWhitespace(body || subject).slice(0, 220) || undefined,
      author: from,
      publishedAt,
      messageId: messageId || undefined,
    });
  }

  return normalized;
}

export function redactEmailIngestLog(item: NormalizedEmailIngestItem): RedactedEmailIngestLog {
  return {
    title: item.title,
    author: item.author,
    sourceLabel: item.sourceLabel,
    guidHash: sha256(item.guid).slice(0, 12),
    sourceType: 'email',
    publishedAt: item.publishedAt?.toISOString(),
  };
}
