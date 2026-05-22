import { eq, and, gte, desc } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { config } from '../config/index.js';

const KNOWLEDGE_DIR = process.env.KNOWLEDGE_DIR
  || (process.cwd().endsWith('/services/hub-engine') ? '../../data/knowledge' : './knowledge');

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function toFrontmatter(item: {
  title: string;
  url: string;
  sourceName: string;
  category: string;
  publishedAt: string | null;
  aiScore: number | null;
  aiTags: string[];
  sourceType: string;
}): string {
  return [
    '---',
    `title: "${item.title.replace(/"/g, '\\"')}"`,
    `source: "${item.sourceName}"`,
    `url: "${item.url}"`,
    `published_at: ${item.publishedAt || 'null'}`,
    `category: "${item.category}"`,
    `ai_score: ${item.aiScore ?? 'null'}`,
    `tags: [${item.aiTags.map(t => `"${t}"`).join(', ')}]`,
    `type: ${item.sourceType === 'podcast' ? 'podcast' : 'article'}`,
    '---',
  ].join('\n');
}

export interface KnowledgeMarkdownItem {
  title: string;
  url: string;
  sourceName: string;
  category: string;
  publishedAt: Date | string | null;
  aiScore: number | null;
  aiTags: string[];
  sourceType: string;
  aiSummary?: string | null;
  aiTranslation?: string | null;
  snippet?: string | null;
  content?: string | null;
}

function toIsoString(value: Date | string | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function isCaptureKnowledgeItem(item: KnowledgeMarkdownItem): boolean {
  return item.category === 'capture'
    || item.sourceName === 'Capture Inbox'
    || Boolean(item.content && item.content.includes('## Capture Inbox'));
}

export function formatKnowledgeMarkdown(item: KnowledgeMarkdownItem): string {
  const frontmatter = toFrontmatter({
    title: item.title,
    url: item.url,
    sourceName: item.sourceName || 'Unknown',
    category: item.category || 'uncategorized',
    publishedAt: toIsoString(item.publishedAt),
    aiScore: item.aiScore,
    aiTags: item.aiTags || [],
    sourceType: item.sourceType,
  });
  const isCapture = isCaptureKnowledgeItem(item);
  const sections = [
    frontmatter,
    '',
    `# ${item.title}`,
    '',
  ];

  if (item.aiSummary) sections.push(`> ${item.aiSummary}`, '');
  if (item.aiTranslation) sections.push(`## 翻译`, '', item.aiTranslation, '');
  if (item.snippet) sections.push(isCapture ? `## 人工摘录` : `## 摘要`, '', item.snippet, '');
  if (isCapture && item.content) sections.push(`## 剪藏正文`, '', item.content, '');
  sections.push(`## 原文链接`, '', item.url);

  return sections.filter((part) => part !== undefined && part !== null && part !== '').join('\n');
}

export async function exportToKnowledgeFiles(userId: string, since?: Date): Promise<number> {
  const sinceDate = since || new Date(Date.now() - 24 * 3600 * 1000);
  const dateStr = new Date().toISOString().split('T')[0];

  const items = await db
    .select({
      id: schema.items.id,
      title: schema.items.title,
      url: schema.items.url,
      snippet: schema.items.snippet,
      content: schema.items.content,
      aiSummary: schema.items.aiSummary,
      aiTags: schema.items.aiTags,
      aiScore: schema.items.aiScore,
      aiTranslation: schema.items.aiTranslation,
      publishedAt: schema.items.publishedAt,
      sourceType: schema.items.sourceType,
      sourceName: schema.sources.name,
      category: schema.sources.category,
    })
    .from(schema.items)
    .leftJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id))
    .where(and(
      eq(schema.items.userId, userId),
      eq(schema.items.isFiltered, false),
      gte(schema.items.fetchedAt, sinceDate),
    ))
    .orderBy(desc(schema.items.priorityScore))
    .limit(100);

  if (items.length === 0) return 0;

  const itemsDir = join(KNOWLEDGE_DIR, 'items', dateStr.slice(0, 7));
  await mkdir(itemsDir, { recursive: true });

  let exported = 0;
  for (const item of items) {
    const slug = slugify(item.title);
    const filename = `${slug}.md`;
    const filepath = join(itemsDir, filename);
    const body = formatKnowledgeMarkdown({
      title: item.title,
      url: item.url,
      sourceName: item.sourceName || 'Unknown',
      category: item.category || 'uncategorized',
      publishedAt: item.publishedAt,
      aiScore: item.aiScore,
      aiTags: (item.aiTags as string[]) || [],
      sourceType: item.sourceType,
      aiSummary: item.aiSummary,
      aiTranslation: item.aiTranslation,
      snippet: item.snippet,
      content: item.content,
    });

    await writeFile(filepath, body, 'utf-8');
    exported++;
  }

  logger.info({ exported, dir: itemsDir }, 'Knowledge files exported');
  return exported;
}

export async function exportManifest(userId: string): Promise<void> {
  const manifestPath = join(KNOWLEDGE_DIR, 'manifest.json');
  const now = new Date().toISOString();

  const sourcesCount = await db.select().from(schema.sources).where(eq(schema.sources.userId, userId));
  const manifest = {
    version: '3.0',
    exportedAt: now,
    userId,
    sources: sourcesCount.length,
    knowledgeDir: KNOWLEDGE_DIR,
  };

  await mkdir(KNOWLEDGE_DIR, { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  logger.debug({ path: manifestPath }, 'Manifest exported');
}
