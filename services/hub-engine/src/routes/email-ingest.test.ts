import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { createEmailIngestHandler } from './hooks.js';

type EmailReceipt = { ingested: number; duplicates: number; failed: number; total: number; error?: string };

function fixture(outcomes: Array<'inserted' | 'duplicate' | 'failed'>, owned = true) {
  let writes = 0;
  const database = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => owned ? [{ id: 42 }] : [] }) }) }),
    insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => {
      const outcome = outcomes[writes++];
      if (outcome === 'failed') throw Object.assign(new Error('fixture foreign key failure'), { code: '23503' });
      return outcome === 'duplicate' ? [] : [{ id: `item-${writes}` }];
    } }) }) }),
  };
  const app = new Hono();
  app.post('/email-ingest', createEmailIngestHandler(
    database as unknown as Parameters<typeof createEmailIngestHandler>[0],
    () => ({ userId: '00000000-0000-4000-8000-000000000123', email: 'fixture@example.com', username: 'fixture', role: 'user' }),
  ));
  return { app, writes: () => writes };
}

const email = (id: string) => ({ subject: `Fixture ${id}`, messageId: id, bodyText: 'A readable fixture newsletter body.' });
const post = (app: Hono, body: unknown) => app.request('/email-ingest', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('database failures remain failures instead of becoming duplicate emails', async () => {
  const { app } = fixture(['failed']);
  const response = await post(app, { sourceId: 42, items: [email('a')] });
  const body = await response.json() as EmailReceipt;
  assert.equal(response.status, 503);
  assert.equal(body.ingested, 0);
  assert.equal(body.duplicates, 0);
  assert.equal(body.failed, 1);
  assert.match(body.error || '', /could not be saved/);
});

test('partial import reports saved, duplicate and failed emails separately', async () => {
  const { app } = fixture(['inserted', 'duplicate', 'failed']);
  const response = await post(app, { sourceId: 42, items: [email('a'), email('a'), email('b'), email('c')] });
  const body = await response.json() as EmailReceipt;
  assert.equal(response.status, 503);
  assert.deepEqual([body.ingested, body.duplicates, body.failed, body.total], [1, 2, 1, 4]);
});

test('a duplicate-only import remains a successful idempotent request', async () => {
  const { app } = fixture(['duplicate']);
  const response = await post(app, { sourceId: 42, items: [email('a')] });
  const body = await response.json() as EmailReceipt;
  assert.equal(response.status, 200);
  assert.deepEqual([body.ingested, body.duplicates, body.failed], [0, 1, 0]);
});

test('unknown or unowned source IDs are rejected before inserting mail', async () => {
  const { app, writes } = fixture([], false);
  assert.equal((await post(app, { sourceId: 42, items: [email('a')] })).status, 404);
  assert.equal((await post(app, { sourceId: 'invalid', items: [email('a')] })).status, 400);
  assert.equal(writes(), 0);
});
