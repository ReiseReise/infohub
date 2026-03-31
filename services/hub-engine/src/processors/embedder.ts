import { eq, and, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { getActiveAiConfig, callLLM } from './ai-scorer.js';

async function getEmbedding(text: string, config: { baseUrl?: string | null; apiKeyEnc?: string | null; model: string }): Promise<number[] | null> {
  const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  const apiKey = config.apiKeyEnc || process.env.OPENAI_API_KEY || '';

  if (!apiKey) return null;

  try {
    const resp = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model || 'text-embedding-3-small',
        input: text.slice(0, 8000),
      }),
    });

    if (!resp.ok) {
      logger.warn({ status: resp.status }, 'Embedding API error');
      return null;
    }

    const data = await resp.json() as any;
    return data.data?.[0]?.embedding || null;
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'Embedding request failed');
    return null;
  }
}

export async function embedItems(userId: string, limit = 20): Promise<number> {
  const items = await db
    .select({
      id: schema.items.id,
      title: schema.items.title,
      aiSummary: schema.items.aiSummary,
      snippet: schema.items.snippet,
    })
    .from(schema.items)
    .where(and(
      eq(schema.items.userId, userId),
      eq(schema.items.isFiltered, false),
      sql`embedding IS NULL`,
    ))
    .limit(limit);

  if (items.length === 0) return 0;

  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey) {
    logger.debug('No OPENAI_API_KEY set, skipping embedding');
    return 0;
  }

  const config = { baseUrl: process.env.OPENAI_BASE_URL || null, apiKeyEnc: apiKey, model: 'text-embedding-3-small' };

  let embedded = 0;
  for (const item of items) {
    const text = `${item.title} ${item.aiSummary || item.snippet || ''}`;
    const vector = await getEmbedding(text, config);

    if (vector) {
      // pgvector requires raw SQL for vector insert since Drizzle doesn't natively support it
      const vectorStr = `[${vector.join(',')}]`;
      try {
        await db.execute(
          `UPDATE hub.items SET embedding = '${vectorStr}'::vector WHERE id = '${item.id}'`
        );
        embedded++;
      } catch (err) {
        logger.error({ itemId: item.id, error: (err as Error).message }, 'Vector insert failed');
      }
    }
  }

  logger.info({ userId, embedded, total: items.length }, 'Batch embedding complete');
  return embedded;
}
