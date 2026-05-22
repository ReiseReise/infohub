type RawCaptureItem = Record<string, unknown>;

export interface NormalizedCaptureItem {
  title: string;
  url: string;
  guid: string;
  sourceType: string;
  content?: string;
  snippet?: string;
  author?: string;
  publishedAt?: Date;
}

export interface IngestSourceDefaults {
  name: string;
  category: string;
  config: Record<string, unknown>;
}

const KNOWN_CAPTURE_TOOLS = new Set(['obsidian', 'zotero', 'organic-notes', 'manual']);
const KNOWN_CAPTURE_KINDS = new Set(['article_capture', 'reference_capture']);

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean);
}

function slugifyStableId(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return slug || 'untitled';
}

function normalizeCaptureTool(raw: RawCaptureItem): string {
  const tool = asText(raw.captureTool).toLowerCase();
  if (KNOWN_CAPTURE_TOOLS.has(tool)) return tool;
  if (tool) return slugifyStableId(tool);
  return 'manual';
}

function normalizeCaptureKind(raw: RawCaptureItem, tool: string): string {
  const kind = asText(raw.captureKind).toLowerCase();
  if (KNOWN_CAPTURE_KINDS.has(kind)) return kind;
  if (tool === 'zotero') return 'reference_capture';
  return 'article_capture';
}

function normalizePublishedAt(value: unknown): Date | undefined {
  const text = asText(value);
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function hasCaptureMetadata(raw: RawCaptureItem): boolean {
  return Boolean(
    asText(raw.captureTool)
    || asText(raw.captureKind)
    || asText(raw.userNotes)
    || asText(raw.highlightNote)
    || asText(raw.notesText)
    || asTextArray(raw.attachmentPaths).length > 0
  );
}

export function resolveIngestSourceDefaults(isCapturePayload: boolean): IngestSourceDefaults {
  if (isCapturePayload) {
    return {
      name: 'Capture Inbox',
      category: 'capture',
      config: { inboxKind: 'capture' },
    };
  }
  return {
    name: 'Webhook Ingest',
    category: 'webhook',
    config: {},
  };
}

function buildCaptureContent(raw: RawCaptureItem, baseContent: string, tool: string, kind: string): string {
  const userNotes = asText(raw.userNotes);
  const attachmentPaths = asTextArray(raw.attachmentPaths);
  const lines: string[] = [];
  const trimmedBase = baseContent.trim();
  if (trimmedBase) {
    lines.push(trimmedBase, '');
  }
  lines.push('## Capture Inbox', '', `- capture_tool: ${tool}`, `- capture_kind: ${kind}`);
  if (asText(raw.guid)) lines.push(`- capture_guid: ${asText(raw.guid)}`);
  if (attachmentPaths.length > 0) lines.push(`- attachment_count: ${attachmentPaths.length}`);
  if (userNotes) {
    lines.push('', '## 用户笔记', '', userNotes);
  }
  if (attachmentPaths.length > 0) {
    lines.push('', '## 附件', '', ...attachmentPaths.map((item) => `- ${item}`));
  }
  return lines.join('\n').trim() + '\n';
}

export function normalizeCaptureIngestItem(raw: RawCaptureItem): NormalizedCaptureItem {
  const title = asText(raw.title) || asText(raw.text) || 'Untitled';
  const url = asText(raw.url) || asText(raw.link) || asText(raw.href);
  const sourceType = asText(raw.sourceType) || 'custom';
  const author = asText(raw.author) || asText(raw.user) || undefined;
  const rawContent = asText(raw.content) || asText(raw.body) || asText(raw.text);
  const userNotes = asText(raw.userNotes);
  const snippet = asText(raw.snippet)
    || asText(raw.highlightNote)
    || asText(raw.notesText)
    || userNotes
    || (rawContent ? rawContent.slice(0, 200) : undefined);
  const publishedAt = normalizePublishedAt(raw.publishedAt);

  if (!hasCaptureMetadata(raw)) {
    return {
      title,
      url,
      guid: asText(raw.guid) || url,
      sourceType,
      content: rawContent || undefined,
      snippet,
      author,
      publishedAt,
    };
  }

  const tool = normalizeCaptureTool(raw);
  const kind = normalizeCaptureKind(raw, tool);
  const guid = asText(raw.guid) || `capture:${tool}:${slugifyStableId(url || title)}`;
  return {
    title,
    url,
    guid,
    sourceType: 'custom',
    content: buildCaptureContent(raw, rawContent, tool, kind),
    snippet,
    author,
    publishedAt,
  };
}
