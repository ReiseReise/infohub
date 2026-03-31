import { Hono } from 'hono';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';

const app = new Hono();

app.get('/health', async (c) => {
  try {
    await db.execute(sql`SELECT 1`);
    return c.json({
      status: 'ok',
      service: 'hub-engine',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  } catch (err) {
    return c.json({
      status: 'error',
      service: 'hub-engine',
      error: (err as Error).message,
    }, 503);
  }
});

export default app;
