import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeEmailIngestItems, parseEmlMessages, redactEmailIngestLog } from './email-ingest.js';

test('normalizes email payloads into stable private feed items', () => {
  const [item] = normalizeEmailIngestItems([
    {
      subject: 'Claude research digest',
      from: 'newsletter@example.com',
      date: '2026-06-10T08:00:00Z',
      bodyHtml: '<h1>Claude digest</h1><p>Anthropic released a useful update.</p>',
      messageId: '<abc@example.com>',
      sourceLabel: 'AI Newsletter',
    },
  ]);

  assert.equal(item.title, 'Claude research digest');
  assert.equal(item.sourceType, 'email');
  assert.equal(item.author, 'newsletter@example.com');
  assert.equal(item.url.startsWith('email://'), true);
  assert.equal(item.guid, 'email:abc@example.com');
  assert.match(item.content || '', /Claude digest/);
  assert.doesNotMatch(item.content || '', /<p>/);
  assert.equal(item.publishedAt?.toISOString(), '2026-06-10T08:00:00.000Z');
});

test('dedupes repeated emails by message id or content hash', () => {
  const items = normalizeEmailIngestItems([
    { subject: 'Same', from: 'a@example.com', bodyText: 'Body', messageId: 'same-id' },
    { subject: 'Same again', from: 'a@example.com', bodyText: 'Body changed', messageId: 'same-id' },
    { subject: 'Same', from: 'a@example.com', bodyText: 'Body' },
    { subject: 'Same', from: 'a@example.com', bodyText: 'Body' },
  ]);

  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.guid), [
    'email:same-id',
    items[1].guid,
  ]);
});

test('redacts email ingest logs and never includes full body text', () => {
  const [item] = normalizeEmailIngestItems([
    {
      subject: 'Private deal memo',
      from: 'reise@example.com',
      bodyText: 'secret body should not appear in logs',
    },
  ]);

  const log = redactEmailIngestLog(item);
  assert.equal(log.title, 'Private deal memo');
  assert.equal(log.author, 'reise@example.com');
  assert.equal('content' in log, false);
  assert.equal('snippet' in log, false);
  assert.match(log.guidHash, /^[a-f0-9]{12}$/);
});

test('parses plain text eml messages into ingest payloads', () => {
  const raw = [
    'Message-ID: <plain-1@example.com>',
    'Subject: Claude launch digest',
    'From: Newsletter <news@example.com>',
    'Date: Wed, 10 Jun 2026 08:00:00 +0000',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Anthropic released a model update with concrete enterprise implications.',
  ].join('\r\n');

  const [message] = parseEmlMessages([{ filename: 'plain.eml', content: raw }], 'AI Newsletter');
  assert.equal(message.subject, 'Claude launch digest');
  assert.equal(message.from, 'Newsletter <news@example.com>');
  assert.equal(message.messageId, 'plain-1@example.com');
  assert.equal(message.sourceLabel, 'AI Newsletter');
  assert.match(String(message.bodyText || ''), /enterprise implications/);
});

test('parses multipart eml messages and prefers text/plain over html', () => {
  const raw = [
    'Message-ID: <multi-1@example.com>',
    'Subject: =?UTF-8?B?Q2xhdWRlIOaWsOaooeWei+WPkeW4gw==?=',
    'From: digest@example.com',
    'Date: Wed, 10 Jun 2026 08:00:00 +0000',
    'Content-Type: multipart/alternative; boundary="abc"',
    '',
    '--abc',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    '<p>HTML =E6=91=98=E8=A6=81</p>',
    '--abc',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from('Plain text 摘要优先', 'utf8').toString('base64'),
    '--abc--',
  ].join('\r\n');

  const [message] = parseEmlMessages([{ filename: 'multi.eml', content: raw }]);
  assert.equal(message.subject, 'Claude 新模型发布');
  assert.equal(String(message.bodyText || ''), 'Plain text 摘要优先');
  assert.equal(String(message.bodyHtml || ''), '<p>HTML 摘要</p>');
});
