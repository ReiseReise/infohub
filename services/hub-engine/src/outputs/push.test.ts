import test from 'node:test';
import assert from 'node:assert/strict';

import { encodeNtfyHeader, scheduleDailyReportPush, truncateUtf8Bytes } from './push.js';

test('encodes non Latin-1 ntfy titles into ASCII-safe header values', () => {
  const encoded = encodeNtfyHeader('信息中枢日报 — 2026-05-26');

  assert.match(encoded, /^=\?UTF-8\?B\?.+\?=$/);
  assert.equal([...encoded].every((char) => char.charCodeAt(0) <= 255), true);
});

test('keeps ASCII ntfy titles readable', () => {
  assert.equal(encodeNtfyHeader('InfoHub Daily Report'), 'InfoHub Daily Report');
});

test('truncates Chinese ntfy content by UTF-8 bytes without splitting characters', () => {
  const truncated = truncateUtf8Bytes('日报内容'.repeat(1000), 101);

  assert.ok(Buffer.byteLength(truncated, 'utf8') <= 101);
  assert.equal(truncated.includes('\uFFFD'), false);
  assert.equal(truncated.endsWith('日') || truncated.endsWith('报') || truncated.endsWith('内') || truncated.endsWith('容'), true);
});

test('schedules daily report push without awaiting delivery', async () => {
  let started = false;
  let release!: () => void;
  const delivery = new Promise<void>((resolve) => {
    release = resolve;
  });

  const queued = scheduleDailyReportPush('日报', '内容', async () => {
    started = true;
    await delivery;
  });

  assert.equal(queued, true);
  assert.equal(started, true);

  release();
  await delivery;
});
