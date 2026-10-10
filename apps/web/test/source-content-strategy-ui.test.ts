import test from 'node:test';
import assert from 'node:assert/strict';

Reflect.set(globalThis, '__API_BASE_URL__', '/api');

test('sources page exposes source content strategy options', async () => {
  const mod = await import('../src/lib/source-governance-ui.ts');
  const options = (mod as {
    SOURCE_CONTENT_STRATEGY_OPTIONS?: Array<{ value: string; label: string }>;
  }).SOURCE_CONTENT_STRATEGY_OPTIONS || [];

  assert.deepEqual(
    options.map((option) => option.value),
    ['feed_only', 'smart', 'full', 'monitor_only'],
  );
});
