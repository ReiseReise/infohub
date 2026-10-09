import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSourceCardViewModel, sourcePercent, sourceQualityGrade } from '../src/features/sources/source-card-model.ts';

test('source card model keeps scheduler and feed diagnostics in user language', () => {
  const result = buildSourceCardViewModel({
    id: 1,
    name: 'Example RSS',
    sourceType: 'rss',
    collectorType: 'rss',
    category: 'AI',
    status: 'active',
    autoFetchEnabled: true,
    lastOutcome: 'error',
    freshnessState: 'due',
    lastError: 'XML document has non-whitespace before first tag',
    config: { url: 'https://example.com/feed.xml', htmlUrl: 'https://example.com' },
  });

  assert.equal(result.schedule.label, '退避中');
  assert.equal(result.freshness?.label, '待补抓');
  assert.equal(result.feedLabel, 'https://example.com/feed.xml');
  assert.equal(result.websiteLabel, 'https://example.com');
  assert.equal(result.issue?.label, '订阅格式异常');
});

test('source card formatters keep quality metrics stable after component extraction', () => {
  assert.equal(sourcePercent(0.856), '86%');
  assert.equal(sourcePercent(null), '0%');
  assert.equal(sourceQualityGrade('excellent'), '优秀');
  assert.equal(sourceQualityGrade('poor'), '需修复');
});
