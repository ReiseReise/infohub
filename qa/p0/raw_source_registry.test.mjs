import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const registryPath = new URL('../../docs/source-registry/raw-sources.json', import.meta.url);
const registry = JSON.parse(await readFile(registryPath, 'utf8'));

assert.equal(registry.version, 1);
assert.ok(Array.isArray(registry.sources), 'registry.sources must be an array');

const ids = new Set();
const rawUrls = new Set();
for (const source of registry.sources) {
  assert.equal(typeof source.id, 'string', 'source.id is required');
  assert.equal(typeof source.name, 'string', `${source.id}: name is required`);
  assert.equal(typeof source.rawUrl, 'string', `${source.id}: rawUrl is required`);
  assert.match(source.rawUrl, /^https?:\/\//, `${source.id}: rawUrl must be http(s)`);
  assert.equal(typeof source.sourceType, 'string', `${source.id}: sourceType is required`);
  assert.equal(typeof source.collectorType, 'string', `${source.id}: collectorType is required`);
  assert.equal(typeof source.category, 'string', `${source.id}: category is required`);
  assert.equal(typeof source.sourceTier, 'string', `${source.id}: sourceTier is required`);
  assert.equal(typeof source.readingTier, 'string', `${source.id}: readingTier is required`);
  assert.ok(Array.isArray(source.tags), `${source.id}: tags must be an array`);
  assert.ok(Array.isArray(source.growthAxes), `${source.id}: growthAxes must be an array`);
  assert.ok(!ids.has(source.id), `duplicate source id: ${source.id}`);
  assert.ok(!rawUrls.has(source.rawUrl), `duplicate rawUrl: ${source.rawUrl}`);
  ids.add(source.id);
  rawUrls.add(source.rawUrl);
}

const reutersAi = registry.sources.find((source) => source.id === 'reuters-technology-ai-rss');
assert.ok(reutersAi, 'Reuters Technology AI source must be maintained in the raw registry');
assert.equal(reutersAi.rawUrl, 'https://yzcw.dpdns.org/users/1/web_requests/573/R-Technology-AI-slu896.xml');
assert.equal(reutersAi.sourceType, 'rss');
assert.equal(reutersAi.collectorType, 'rss');
assert.equal(reutersAi.sourceTier, 'A');
assert.equal(reutersAi.readingTier, 'light_reading');
assert.equal(reutersAi.dailyReportEnabled, true);
assert.ok(reutersAi.tags.includes('reuters'));
assert.ok(reutersAi.tags.includes('ai-news'));

const highValueRegistryPath = new URL('../../docs/source-registry/high-value-rss.json', import.meta.url);
const highValueRegistry = JSON.parse(await readFile(highValueRegistryPath, 'utf8'));
const highValueReuters = highValueRegistry.sources.find((source) => source.id === 'reuters-technology-ai');
assert.ok(highValueReuters, 'Reuters Technology AI must remain in the cold-start registry');
assert.equal(highValueReuters.dailyReportEnabled, true, 'Reuters dedicated daily report must survive cold-start import');
