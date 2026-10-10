import test from 'node:test';
import assert from 'node:assert/strict';

test('normalizes Dibao sidecar status for user-facing cards', async () => {
  const mod = await import('../src/lib/reader-lab.ts');

  assert.deepEqual(mod.describeDibaoStatus({
    available: true,
    publicUrl: 'http://localhost:8082',
    healthUrl: 'http://dibao-reader:8080/api/system/health',
    message: 'ok',
    version: '0.1.3',
    checkedAt: '2026-06-15T08:00:00.000Z',
    error: null,
  }), {
    tone: 'ok',
    title: 'Dibao 已就绪',
    description: '可打开阅读实验室，并用同一批 OPML 做抓取质量对照。',
  });

  assert.equal(mod.describeDibaoStatus({
    available: false,
    publicUrl: 'http://localhost:8082',
    healthUrl: 'http://dibao-reader:8080/api/system/health',
    message: 'Dibao 阅读实验室暂时无法访问；请先启动 dibao-reader 服务。',
    version: null,
    checkedAt: '2026-06-15T08:00:00.000Z',
    error: 'connection refused',
  }).tone, 'warn');
});

test('selects representative source rows for Dibao comparison without requiring every source to exist', async () => {
  const mod = await import('../src/lib/reader-lab.ts');
  const selected = mod.selectDibaoCompareSources([
    { id: 1, name: 'Anthropic Newsroom', category: 'AI', sourceTier: 'S', itemCount: 17, sourceQuality: { contentReadyRate: 0.5, aiReadyRate: 0.2 } },
    { id: 2, name: 'TechCrunch AI', category: 'AI', sourceTier: 'A', itemCount: 50, sourceQuality: { contentReadyRate: 0.9, aiReadyRate: 0.7 } },
    { id: 3, name: 'Random Low Quality', category: 'Other', sourceTier: 'C', itemCount: 6, sourceQuality: { contentReadyRate: 0.1, aiReadyRate: 0 } },
    { id: 4, name: '36kr', category: '商业', sourceTier: 'B', itemCount: 200, sourceQuality: { contentReadyRate: 0.8, aiReadyRate: 0.4 } },
  ] as never, 3);

  assert.deepEqual(selected.map((source) => source.name), [
    'Anthropic Newsroom',
    'TechCrunch AI',
    '36kr',
  ]);
});
