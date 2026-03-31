import { eq, and, gte, desc } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { formatMarkdown } from './daily-report.js';

const KNOWLEDGE_DIR = process.env.KNOWLEDGE_DIR
  || (process.cwd().endsWith('/services/hub-engine') ? '../../data/knowledge' : './knowledge');

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

interface SyncIndex {
  lastExportAt: string;
  exportedIds: string[];
}

async function loadSyncIndex(): Promise<SyncIndex> {
  const indexPath = join(KNOWLEDGE_DIR, 'obsidian', '_meta', 'sync-index.json');
  try {
    const raw = await readFile(indexPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { lastExportAt: '1970-01-01T00:00:00Z', exportedIds: [] };
  }
}

async function saveSyncIndex(index: SyncIndex): Promise<void> {
  const metaDir = join(KNOWLEDGE_DIR, 'obsidian', '_meta');
  await mkdir(metaDir, { recursive: true });
  await writeFile(join(metaDir, 'sync-index.json'), JSON.stringify(index, null, 2), 'utf-8');
}

export async function exportToObsidian(userId: string): Promise<number> {
  const syncIndex = await loadSyncIndex();
  const sinceDate = new Date(syncIndex.lastExportAt);
  const exportedSet = new Set(syncIndex.exportedIds);

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
      transcript: schema.items.transcript,
      knowledge: schema.items.knowledge,
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
    .limit(200);

  const newItems = items.filter(i => !exportedSet.has(i.id));
  if (newItems.length === 0) {
    logger.debug('No new items to export to Obsidian');
    return 0;
  }

  const inboxDir = join(KNOWLEDGE_DIR, 'obsidian', 'Inbox', dateStr);
  const podcastDir = join(KNOWLEDGE_DIR, 'obsidian', 'Podcasts', dateStr);
  await mkdir(inboxDir, { recursive: true });
  await mkdir(podcastDir, { recursive: true });

  let exported = 0;
  const newIds: string[] = [];

  for (const item of newItems) {
    const slug = slugify(item.title);
    const isPodcast = item.sourceType === 'podcast' || !!item.transcript;
    const dir = isPodcast ? podcastDir : inboxDir;
    const filepath = join(dir, `${slug}.md`);

    const frontmatter = [
      '---',
      `title: "${item.title.replace(/"/g, '\\"')}"`,
      `source: "${item.sourceName || 'Unknown'}"`,
      `url: "${item.url}"`,
      `published_at: ${item.publishedAt?.toISOString() || 'null'}`,
      `category: "${item.category || 'uncategorized'}"`,
      `ai_score: ${item.aiScore ?? 'null'}`,
      `tags: [${((item.aiTags as string[]) || []).map(t => `"${t}"`).join(', ')}]`,
      `type: ${isPodcast ? 'podcast' : 'article'}`,
      '---',
    ].join('\n');

    const sections: string[] = [
      frontmatter,
      '',
      `# ${item.title}`,
      '',
    ];

    if (item.aiSummary) sections.push(`> ${item.aiSummary}`, '');
    if (item.aiTranslation) sections.push(`## 翻译`, '', item.aiTranslation, '');
    if (item.transcript) sections.push(`## 转写稿`, '', item.transcript, '');
    if (item.knowledge) sections.push(`## 知识萃取`, '', item.knowledge, '');
    if (item.snippet) sections.push(`## 摘要`, '', item.snippet, '');
    sections.push(`## 原文`, '', `[${item.title}](${item.url})`);

    await writeFile(filepath, sections.join('\n'), 'utf-8');
    newIds.push(item.id);
    exported++;
  }

  await saveSyncIndex({
    lastExportAt: new Date().toISOString(),
    exportedIds: [...exportedSet, ...newIds].slice(-5000),
  });

  logger.info({ exported, dir: join(KNOWLEDGE_DIR, 'obsidian') }, 'Obsidian export complete');
  return exported;
}
