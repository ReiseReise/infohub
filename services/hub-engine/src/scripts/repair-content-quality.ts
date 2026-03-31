import { desc, eq, gte } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { summarizeItemsDetailed, translateItemsDetailed } from '../processors/ai-summarizer.js';
import { generateDailyReport } from '../outputs/daily-report.js';

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function countMatches(input: string, pattern: RegExp): number {
  return (input.match(pattern) || []).length;
}

function isMostlyChinese(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  const hanCount = countMatches(text, /[\u4e00-\u9fff]/g);
  const latinCount = countMatches(text, /[A-Za-z]/g);
  if (hanCount >= 24) return true;
  if (hanCount >= 10 && hanCount >= latinCount / 2) return true;
  return hanCount > 0 && latinCount <= 12;
}

function looksTruncatedText(input: string): boolean {
  const text = input.trim();
  if (!text) return true;
  if (/[—\-–:：,，、（(]$/.test(text)) return true;
  if (/(evidenced|including|such as|for example|例如|比如|包括)$/i.test(text)) return true;
  const fenceCount = (text.match(/```/g) || []).length;
  return fenceCount % 2 !== 0;
}

async function main() {
  const days = Math.max(1, parseInt(argValue('--days', '7'), 10) || 7);
  const limit = Math.max(10, parseInt(argValue('--limit', '80'), 10) || 80);
  const reportDays = Math.max(1, parseInt(argValue('--report-days', '3'), 10) || 3);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: schema.items.id,
      userId: schema.items.userId,
      title: schema.items.title,
      aiSummary: schema.items.aiSummary,
      aiTranslation: schema.items.aiTranslation,
      fetchedAt: schema.items.fetchedAt,
    })
    .from(schema.items)
    .where(gte(schema.items.fetchedAt, cutoff))
    .orderBy(desc(schema.items.fetchedAt))
    .limit(limit);

  const summaryTargets = rows.filter((row) => {
    const summary = (row.aiSummary || '').trim();
    return summary && !isMostlyChinese(summary);
  });
  const translationTargets = rows.filter((row) => {
    const translation = (row.aiTranslation || '').trim();
    return translation && looksTruncatedText(translation);
  });

  const activeUsers = new Set(rows.map((row) => row.userId));
  const affectedUsers = new Set<string>();

  for (const row of summaryTargets) {
    affectedUsers.add(row.userId);
    await db.update(schema.items).set({
      aiSummary: null,
      aiTags: [],
      processingStatus: 'scored',
      summaryStatus: 'pending',
      summaryBasis: null,
    }).where(eq(schema.items.id, row.id));
  }

  for (const row of summaryTargets) {
    await summarizeItemsDetailed(row.userId, 1, { itemId: row.id });
  }

  for (const row of translationTargets) {
    affectedUsers.add(row.userId);
    await db.update(schema.items).set({
      aiTranslation: null,
      processingStatus: 'summarized',
      translationStatus: 'pending',
      translationReason: null,
    }).where(eq(schema.items.id, row.id));
  }

  for (const row of translationTargets) {
    await translateItemsDetailed(row.userId, 1, { itemId: row.id });
  }

  for (const userId of new Set([...activeUsers, ...affectedUsers])) {
    for (let offset = 0; offset < reportDays; offset += 1) {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - offset);
      await generateDailyReport(userId, date, { preset: 'full' });
    }
  }

  console.log(JSON.stringify({
    days,
    scanned: rows.length,
    repairedSummaries: summaryTargets.length,
    repairedTranslations: translationTargets.length,
    regeneratedUsers: new Set([...activeUsers, ...affectedUsers]).size,
    reportDays,
  }, null, 2));
}

void main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
