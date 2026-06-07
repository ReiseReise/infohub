import test from 'node:test';
import assert from 'node:assert/strict';

import { encodeNtfyHeader, scheduleDailyReportPush } from './push.js';

test('encodes non Latin-1 ntfy titles into ASCII-safe header values', () => {
  const encoded = encodeNtfyHeader('信息中枢日报 — 2026-05-26');

  assert.match(encoded, /^=\?UTF-8\?B\?.+\?=$/);
  assert.equal([...encoded].every((char) => char.charCodeAt(0) <= 255), true);
});

test('keeps ASCII ntfy titles readable', () => {
  assert.equal(encodeNtfyHeader('InfoHub Daily Report'), 'InfoHub Daily Report');
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
