import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

export function encodeNtfyHeader(value: string): string {
  if ([...value].every((char) => char.charCodeAt(0) <= 255)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

export async function pushToNtfy(title: string, message: string, priority?: number): Promise<boolean> {
  const url = `${config.ntfy.url}/${config.ntfy.topic}`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Title': encodeNtfyHeader(title),
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

export function scheduleDailyReportPush(
  title: string,
  markdownContent: string,
  push: (title: string, markdownContent: string) => Promise<void> = pushDailyReport,
): boolean {
  void push(title, markdownContent).catch((err) => {
    logger.error({ title, error: (err as Error).message }, 'Daily report background push failed');
  });
  return true;
}
