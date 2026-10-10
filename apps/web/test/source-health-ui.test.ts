import test from 'node:test';
import assert from 'node:assert/strict';

Reflect.set(globalThis, '__API_BASE_URL__', '/api');

test('source health filter options expose config mismatch as a first-class governance state', async () => {
  const mod = await import('../src/lib/source-governance-ui.ts');
  const options = (mod as {
    SOURCE_HEALTH_FILTER_OPTIONS?: Array<{ value: string; label: string }>;
  }).SOURCE_HEALTH_FILTER_OPTIONS || [];

  assert.ok(options.some((option) => option.value === 'config_mismatch' && option.label === '配置错配'));
});

test('source health label renders config mismatch distinctly', async () => {
  const mod = await import('../src/lib/source-governance-ui.ts');
  const sourceHealthLabel = (mod as {
    sourceHealthLabel?: (source: unknown) => { label: string; className: string };
  }).sourceHealthLabel;

  assert.equal(typeof sourceHealthLabel, 'function');
  const result = sourceHealthLabel?.({
    sourceHealth: {
      healthStatus: 'config_mismatch',
      healthLabel: '配置错配',
    },
  });

  assert.equal(result?.label, '配置错配');
  assert.match(result?.className || '', /rose|red|amber/);
});
