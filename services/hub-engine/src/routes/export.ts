import { Hono } from 'hono';
import { exportToKnowledgeFiles, exportManifest } from '../outputs/knowledge.js';
import { exportToObsidian } from '../outputs/obsidian.js';
import { requireAuth } from '../lib/auth.js';

const app = new Hono();

// POST /api/export/obsidian — 触发 Obsidian 导出
app.post('/obsidian', async (c) => {
  const authUser = requireAuth(c);
  try {
    const count = await exportToObsidian(authUser.userId);
    return c.json({ message: 'Obsidian export complete', exported: count });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// POST /api/export/knowledge — 触发知识库文件导出
app.post('/knowledge', async (c) => {
  const authUser = requireAuth(c);
  try {
    const count = await exportToKnowledgeFiles(authUser.userId);
    await exportManifest(authUser.userId);
    return c.json({ message: 'Knowledge files exported', exported: count });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// POST /api/export/markdown — 导出 Markdown 日报
app.post('/markdown', async (c) => {
  const authUser = requireAuth(c);
  try {
    const { generateDailyReport } = await import('../outputs/daily-report.js');
    const report = await generateDailyReport(authUser.userId);
    return c.text(report.markdown, 200, { 'Content-Type': 'text/markdown; charset=utf-8' });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

export default app;
