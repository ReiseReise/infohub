import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assignEventClustersBySimilarity,
  buildEventClusterKey,
  collapseEventClusterItems,
  selectEventClusterLead,
} from './event-clustering.js';

test('builds a stable event key from repeated AI launch wording', () => {
  assert.equal(
    buildEventClusterKey('Grok Web 正式推出 Connectors 功能，实现与日常应用深度集成'),
    buildEventClusterKey('xAI Grok Connectors 功能上线，打通 Office、GitHub 和 Notion'),
  );
});

test('keeps unrelated short commentary out of event clustering', () => {
  assert.equal(buildEventClusterKey('很多人都在说！'), null);
  assert.equal(buildEventClusterKey('OK'), null);
});

test('does not turn html or image markup from fallback content into an event key', () => {
  assert.equal(
    buildEventClusterKey('一篇普通中文文章', '<img src="https://oss.example/image.png" class="hero" />'),
    null,
  );
});

test('selects the most authoritative source as event cluster lead', () => {
  const lead = selectEventClusterLead([
    { id: 'kol', sourceTier: 'B', sourceKind: 'x', authorityWeight: 0.9, aiScore: 82, priorityScore: 0.8, publishedAt: '2026-05-07T08:00:00Z' },
    { id: 'official-x', sourceTier: 'A', sourceKind: 'x', authorityWeight: 1.08, aiScore: 75, priorityScore: 0.7, publishedAt: '2026-05-07T08:10:00Z' },
    { id: 'official-web', sourceTier: 'S', sourceKind: 'official', authorityWeight: 1.28, aiScore: 70, priorityScore: 0.68, publishedAt: '2026-05-07T07:50:00Z' },
  ]);

  assert.equal(lead?.id, 'official-web');
});

test('treats known official RSS and blog sources as first-party event evidence', () => {
  const lead = selectEventClusterLead([
    {
      id: 'media',
      sourceName: 'Tech media',
      sourceKind: 'media',
      sourceTier: 'S',
      authorityWeight: 1.3,
      aiScore: 95,
    },
    {
      id: 'deepmind',
      sourceName: 'Google DeepMind',
      sourceKind: 'rss',
      sourceType: 'rss',
      sourceCollectorType: 'rss',
      sourceConfig: { url: 'https://deepmind.google/blog/rss.xml' },
      sourceTier: 'A',
      authorityWeight: 1,
      aiScore: 75,
    },
  ]);

  assert.equal(lead?.id, 'deepmind');
});

test('collapses one event to the authoritative local lead and keeps external radar separate', () => {
  const localItems = [
    {
      id: 'media',
      clusterId: 'anthropic:claude:model',
      sourceId: 10,
      sourceName: 'Media A',
      sourceRole: 'normal',
      sourceTier: 'A',
      sourceKind: 'media',
      authorityWeight: 1.02,
      title: 'Anthropic releases a new Claude model',
      url: 'https://media.example/report',
      aiScore: 88,
      priorityScore: 0.91,
      publishedAt: '2026-07-20T08:10:00Z',
    },
    {
      id: 'official',
      clusterId: 'anthropic:claude:model',
      sourceId: 11,
      sourceName: 'Official Lab',
      sourceRole: 'normal',
      sourceTier: 'S',
      sourceKind: 'official',
      authorityWeight: 1.28,
      title: 'Anthropic announces the Claude model release',
      url: 'https://lab.example/news',
      aiScore: 75,
      priorityScore: 0.82,
      publishedAt: '2026-07-20T08:00:00Z',
    },
  ];
  const evidenceItems = [
    ...localItems,
    {
      id: 'radar',
      clusterId: 'anthropic:claude:model',
      sourceId: 12,
      sourceName: 'AI HOT Selected',
      sourceRole: 'radar',
      sourceTier: 'A',
      sourceKind: 'api',
      authorityWeight: 0.9,
      title: 'Radar discovery',
      url: 'https://source.example/original',
      originalUrl: 'https://source.example/original',
      curationSource: 'AI HOT',
      curationMeta: {
        externalSourceCount: 4,
        evidenceScope: 'external_radar',
      },
      publishedAt: '2026-07-20T08:05:00Z',
    },
  ];

  const collapsed = collapseEventClusterItems(localItems, evidenceItems);

  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0]?.id, 'official');
  assert.equal(collapsed[0]?.eventContext?.leadItemId, 'official');
  assert.equal(collapsed[0]?.eventContext?.internalSourceCount, 2);
  assert.equal(collapsed[0]?.eventContext?.externalSourceCount, 4);
  assert.equal(collapsed[0]?.eventContext?.firstPartyCount, 1);
  assert.match(collapsed[0]?.eventContext?.leadReason || '', /官方|一手/);
  assert.equal(
    collapsed[0]?.eventContext?.relatedItems.find((item) => item.id === 'radar')?.evidenceType,
    'external_radar',
  );
});

test('keeps unclustered items independent', () => {
  const collapsed = collapseEventClusterItems([
    { id: 'one', clusterId: null, title: 'One', url: 'https://example.com/one' },
    { id: 'two', clusterId: null, title: 'Two', url: 'https://example.com/two' },
  ]);

  assert.deepEqual(collapsed.map((item) => item.id), ['one', 'two']);
  assert.equal(collapsed.every((item) => item.eventContext === null), true);
});

test('does not collapse suspicious legacy html clusters or same-source rows', () => {
  const suspicious = collapseEventClusterItems([
    { id: 'one', clusterId: 'https:img:oss:src', sourceId: 1, title: 'One', url: 'https://example.com/one' },
    { id: 'two', clusterId: 'https:img:oss:src', sourceId: 2, title: 'Two', url: 'https://example.com/two' },
  ]);
  const sameSource = collapseEventClusterItems([
    { id: 'three', clusterId: 'claude:model:release', sourceId: 3, title: 'Three', url: 'https://example.com/three' },
    { id: 'four', clusterId: 'claude:model:release', sourceId: 3, title: 'Four', url: 'https://example.com/four' },
  ]);

  assert.deepEqual(suspicious.map((item) => item.id), ['one', 'two']);
  assert.equal(suspicious.every((item) => item.eventContext === null), true);
  assert.deepEqual(sameSource.map((item) => item.id), ['three', 'four']);
});

test('reclusters the same Hugging Face attack across local and radar sources', () => {
  const assignments = assignEventClustersBySimilarity([
    {
      id: 'techcrunch',
      sourceId: 1,
      title: 'Hugging Face says hackers stole authentication tokens in cyberattack',
      publishedAt: '2026-07-29T01:00:00Z',
    },
    {
      id: 'radar',
      sourceId: 2,
      title: 'Hugging Face 遭网络攻击，部分访问令牌被窃取',
      translatedTitle: 'Hugging Face cyberattack exposed access tokens',
      publishedAt: '2026-07-29T03:00:00Z',
    },
  ]);

  assert.equal(assignments.get('techcrunch'), assignments.get('radar'));
  assert.match(assignments.get('techcrunch') || '', /hugging-face/);
});

test('reclusters Claude cryptography weakness reports across languages', () => {
  const assignments = assignEventClustersBySimilarity([
    {
      id: 'blog',
      sourceId: 10,
      title: 'Discovering cryptographic weaknesses with Claude',
      publishedAt: '2026-07-28T08:00:00Z',
    },
    {
      id: 'radar',
      sourceId: 11,
      title: 'Claude 发现加密算法弱点，研究成果正式发布',
      translatedTitle: 'Claude discovers cryptographic weaknesses',
      publishedAt: '2026-07-28T09:00:00Z',
    },
  ]);

  assert.equal(assignments.get('blog'), assignments.get('radar'));
  assert.match(assignments.get('blog') || '', /claude/);
});

test('does not merge unrelated cloud business reports through generic AI wording', () => {
  const assignments = assignEventClustersBySimilarity([
    {
      id: 'earnings',
      sourceId: 20,
      title: 'Microsoft beats quarterly forecast as cloud revenue rises',
      publishedAt: '2026-07-29T01:00:00Z',
    },
    {
      id: 'comparison',
      sourceId: 21,
      title: 'Google Cloud narrows the gap with Azure in enterprise AI',
      publishedAt: '2026-07-29T02:00:00Z',
    },
  ]);

  assert.notEqual(assignments.get('earnings'), assignments.get('comparison'));
});

test('does not merge different stories merely because both mention the same AI labs', () => {
  const assignments = assignEventClustersBySimilarity([
    {
      id: 'competition',
      sourceId: 22,
      title: 'Microsoft is openly competing with OpenAI and Anthropic more than ever',
      publishedAt: '2026-07-29T01:00:00Z',
    },
    {
      id: 'pace-letter',
      sourceId: 23,
      title: 'OpenAI, Anthropic and Google sign a letter on the pace of AI development',
      publishedAt: '2026-07-29T02:00:00Z',
    },
  ]);

  assert.notEqual(assignments.get('competition'), assignments.get('pace-letter'));
});

test('does not treat repeated posts from one source as multi-source clustering evidence', () => {
  const assignments = assignEventClustersBySimilarity([
    {
      id: 'one',
      sourceId: 30,
      title: 'OpenAI launches GPT-6 research preview',
      publishedAt: '2026-07-29T01:00:00Z',
    },
    {
      id: 'two',
      sourceId: 30,
      title: 'OpenAI GPT-6 research preview is now available',
      publishedAt: '2026-07-29T02:00:00Z',
    },
  ]);

  assert.notEqual(assignments.get('one'), assignments.get('two'));
});

test('uses transitive evidence instead of splitting one event by the first title anchor', () => {
  const assignments = assignEventClustersBySimilarity([
    {
      id: 'indexing',
      sourceId: 40,
      title: 'Acme vector database benchmark indexing latency results',
      publishedAt: '2026-07-29T01:00:00Z',
    },
    {
      id: 'memory',
      sourceId: 41,
      title: 'Acme database query throughput benchmark memory usage',
      publishedAt: '2026-07-29T02:00:00Z',
    },
    {
      id: 'bridge',
      sourceId: 42,
      title: 'Acme vector database benchmark compares indexing latency and query throughput',
      publishedAt: '2026-07-29T03:00:00Z',
    },
  ]);

  assert.equal(assignments.get('indexing'), assignments.get('bridge'));
  assert.equal(assignments.get('memory'), assignments.get('bridge'));
});
