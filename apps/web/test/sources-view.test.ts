import test from 'node:test';
import assert from 'node:assert/strict';

test('uses source cards as the default view on narrow screens', async () => {
  const mod = await import('../src/lib/sources-view.ts').catch(() => ({}));
  const resolveInitialSourcesViewMode = (mod as {
    resolveInitialSourcesViewMode?: (viewportWidth?: number) => 'cards' | 'table';
  }).resolveInitialSourcesViewMode;

  assert.equal(typeof resolveInitialSourcesViewMode, 'function');
  assert.equal(resolveInitialSourcesViewMode(390), 'cards');
  assert.equal(resolveInitialSourcesViewMode(767), 'cards');
});

test('keeps source table as the default view on desktop screens', async () => {
  const { resolveInitialSourcesViewMode } = await import('../src/lib/sources-view.ts');

  assert.equal(resolveInitialSourcesViewMode(768), 'table');
  assert.equal(resolveInitialSourcesViewMode(1440), 'table');
});
