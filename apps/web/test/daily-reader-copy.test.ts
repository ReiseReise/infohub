import test from 'node:test';
import assert from 'node:assert/strict';

test('replaces internal processing terms in reader-facing lines', async () => {
  const { sanitizeReaderLine } = await import('../src/features/daily/reader-copy.ts');

  assert.equal(sanitizeReaderLine('主主题：Blogs / AI / 本地兜底'), '主主题：Blogs / AI / 待人工复核');
  assert.equal(sanitizeReaderLine('模型摘要暂时不可用'), '缺少可靠摘要');
  assert.equal(sanitizeReaderLine('达到评分阈值的候选池条目'), '达到筛选门槛的素材池条目');
});

test('keeps ordinary lines untouched', async () => {
  const { sanitizeReaderLine } = await import('../src/features/daily/reader-copy.ts');

  const line = '优先信号：Claude Opus 5 发布，价格为前代一半';
  assert.equal(sanitizeReaderLine(line), line);
});

test('drops structured lines whose only content was an internal marker', async () => {
  const { sanitizeReaderHighlights } = await import('../src/features/daily/reader-copy.ts');

  // 唯一"主题"就是内部状态时，展示「主主题：待人工复核」是在编造主题
  const result = sanitizeReaderHighlights([
    '今日高分条目不足',
    '主主题：本地兜底',
    '优先信号：某条真实新闻',
  ]);

  assert.deepEqual(result, ['今日高分条目不足', '优先信号：某条真实新闻']);
});

test('keeps structured lines that still carry real content after cleaning', async () => {
  const { sanitizeReaderHighlights } = await import('../src/features/daily/reader-copy.ts');

  const result = sanitizeReaderHighlights(['主主题：Blogs / AI / 本地兜底']);
  assert.deepEqual(result, ['主主题：Blogs / AI / 待人工复核']);
});

test('drops empty and whitespace-only lines', async () => {
  const { sanitizeReaderHighlights } = await import('../src/features/daily/reader-copy.ts');

  assert.deepEqual(sanitizeReaderHighlights(['', '   ', '有效内容']), ['有效内容']);
});
