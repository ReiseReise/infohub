import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

export async function pushToNtfy(title: string, message: string, priority?: number): Promise<boolean> {
  const url = `${config.ntfy.url}/${config.ntfy.topic}`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Title': title,
        'Priority': String(priority || 3),
        'Tags': 'infohub',
      },
      body: message,
    });
    if (resp.ok) {
      logger.debug({ title }, 'ntfy push sent');
      return true;
    }
    logger.warn({ status: resp.status, title }, 'ntfy push failed');
    return false;
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'ntfy push error');
    return false;
  }
}

export async function pushToFeishu(title: string, content: string): Promise<boolean> {
  const webhookUrl = config.feishu.webhookUrl;
  if (!webhookUrl) {
    logger.debug('No Feishu webhook configured, skipping');
    return false;
  }

  try {
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msg_type: 'interactive',
        card: {
          header: {
            title: { tag: 'plain_text', content: title },
            template: 'blue',
          },
          elements: [
            { tag: 'markdown', content },
          ],
        },
      }),
    });
    if (resp.ok) {
      logger.debug({ title }, 'Feishu push sent');
      return true;
    }
    logger.warn({ status: resp.status, title }, 'Feishu push failed');
    return false;
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'Feishu push error');
    return false;
  }
}

export async function pushDailyReport(title: string, markdownContent: string): Promise<void> {
  await Promise.allSettled([
    pushToNtfy(title, markdownContent.slice(0, 4000), 3),
    pushToFeishu(title, markdownContent.slice(0, 4000)),
  ]);
}
