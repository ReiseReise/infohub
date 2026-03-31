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

export async function exportToKnowledgeFiles(userId: string, since?: Date): Promise<number> {
  const sinceDate = since || new Date(Date.now() - 24 * 3600 * 1000);
  const dateStr = new Date().toISOString().split('T')[0];

  const items = await db
    .select({
      id: schema.items.id,
      title: schema.items.title,
      url: schema.items.url,
      snippet: schema.items.snippet,
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

    const frontmatter = toFrontmatter({
      title: item.title,
      url: item.url,
      sourceName: item.sourceName || 'Unknown',
      category: item.category || 'uncategorized',
      publishedAt: item.publishedAt?.toISOString() || null,
      aiScore: item.aiScore,
      aiTags: (item.aiTags as string[]) || [],
      sourceType: item.sourceType,
    });

    const body = [
      frontmatter,
      '',
      `# ${item.title}`,
      '',
      item.aiSummary ? `> ${item.aiSummary}` : '',
      '',
      item.aiTranslation ? `## 翻译\n\n${item.aiTranslation}\n` : '',
      item.snippet ? `## 摘要\n\n${item.snippet}\n` : '',
      `## 原文链接\n\n${item.url}`,
    ].filter(Boolean).join('\n');

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
