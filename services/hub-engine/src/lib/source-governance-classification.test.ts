import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySourceGovernance,
  normalizeSourceGovernanceRole,
  normalizeSourceTopicGroup,
} from './source-governance-classification.js';

test('cold start separates topic direction from source role', () => {
  const result = classifySourceGovernance({
    name: 'OpenAI News',
    category: 'AI',
    sourceKind: 'official',
    collectorType: 'rss',
  });

  assert.equal(result.topicGroup, 'ai_frontier');
  assert.equal(result.governanceRole, 'first_party');
  assert.equal(result.classificationSource, 'cold_start');
  assert.equal(result.needsGovernanceReview, true);
});

test('cold start recognizes aggregators, media, blogs and private sources', () => {
  assert.equal(classifySourceGovernance({ name: 'BestBlogs Daily Brief', sourceType: 'curated_index', collectorType: 'webpage_index' }).governanceRole, 'aggregator');
  assert.equal(classifySourceGovernance({ name: 'Reuters Technology AI', sourceKind: 'media', category: 'AI' }).governanceRole, 'professional_media');
  assert.equal(classifySourceGovernance({ name: "Simon Willison's Weblog", sourceKind: 'blog', category: 'Blogs' }).governanceRole, 'personal_blog');
  assert.equal(classifySourceGovernance({ name: 'Email Inbox', sourceType: 'email', sourceRole: 'inbox' }).governanceRole, 'private_inbox');
});

test('cold start handles known official sources and noisy reading-tier categories', () => {
  const openai = classifySourceGovernance({ name: 'OpenAI', category: '浅阅读 | 扫读', sourceKind: 'rss', config: { url: 'https://openai.com/news/rss.xml' } });
  assert.equal(openai.topicGroup, 'ai_frontier');
  assert.equal(openai.governanceRole, 'first_party');

  const huggingFace = classifySourceGovernance({ name: 'Hugging Face Blog', category: 'AI', sourceKind: 'blog', config: { url: 'https://huggingface.co/blog/feed.xml' } });
  assert.equal(huggingFace.governanceRole, 'first_party');

  const v2ex = classifySourceGovernance({ name: 'V2EX - 交易', category: '浅阅读 | 扫读', sourceKind: 'rss' });
  assert.equal(v2ex.topicGroup, 'business_industry');
  assert.equal(v2ex.governanceRole, 'community_social');

  const techCrunch = classifySourceGovernance({ name: 'TechCrunch', category: 'tech', sourceKind: 'rss' });
  assert.equal(techCrunch.topicGroup, 'business_industry');
  assert.equal(techCrunch.governanceRole, 'professional_media');

  const mismatchedOpenAi = classifySourceGovernance({ name: 'OpenAI', sourceKind: 'rss', config: { url: 'https://www.v2ex.com/index.xml' } });
  assert.equal(mismatchedOpenAi.governanceRole, 'other');
  assert.match(mismatchedOpenAi.classificationReasons.join(' '), /域名不匹配/);
});

test('official newsroom indexes stay first-party instead of being mislabeled as aggregators', () => {
  const anthropicEngineering = classifySourceGovernance({
    name: 'Anthropic Engineering',
    sourceType: 'webpage_index',
    collectorType: 'webpage_index',
    sourceKind: 'official',
    config: { url: 'https://www.anthropic.com/engineering' },
  });
  const claudeBlog = classifySourceGovernance({
    name: 'Claude Blog',
    sourceType: 'webpage_index',
    collectorType: 'webpage_index',
    config: { url: 'https://claude.com/blog' },
  });

  assert.equal(anthropicEngineering.governanceRole, 'first_party');
  assert.equal(claudeBlog.governanceRole, 'first_party');
});

test('manual classification overrides cold start one dimension at a time', () => {
  const partial = classifySourceGovernance({
    name: 'Custom source',
    category: 'Blog',
    sourceKind: 'rss',
    config: { topicGroup: 'engineering' },
  });
  assert.equal(partial.topicGroup, 'engineering');
  assert.equal(partial.classificationSource, 'partial');

  const manual = classifySourceGovernance({
    name: 'Custom source',
    category: 'Blog',
    config: { topicGroup: 'engineering', governanceRole: 'personal_blog' },
  });
  assert.equal(manual.topicGroup, 'engineering');
  assert.equal(manual.governanceRole, 'personal_blog');
  assert.equal(manual.classificationSource, 'manual');
  assert.equal(manual.needsGovernanceReview, false);
});

test('normalizers reject unknown classification values', () => {
  assert.equal(normalizeSourceTopicGroup('agents-products'), 'agents_products');
  assert.equal(normalizeSourceGovernanceRole('professional-media'), 'professional_media');
  assert.equal(normalizeSourceTopicGroup('unknown-topic'), null);
  assert.equal(normalizeSourceGovernanceRole('unknown-role'), null);
});
