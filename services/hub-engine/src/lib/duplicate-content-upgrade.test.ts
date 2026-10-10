import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDuplicateContentUpgradeResetPatch,
  buildAutomaticItemAiJobId,
  mergeContentProcessingCandidateIds,
  shouldQueueAutomaticContentProcessing,
  shouldReplaceDuplicateContent,
  shouldUpgradeDuplicateProvenance,
} from './duplicate-content-upgrade.js';

test('uses a stable content revision job id for repeated upgrades of the same body', () => {
  const input = { itemId: 'item-a', reason: 'content_upgrade' as const, content: '<p>same body</p>' };
  assert.equal(buildAutomaticItemAiJobId(input), buildAutomaticItemAiJobId(input));
  assert.match(buildAutomaticItemAiJobId(input) || '', /^item_ai_item-a_[a-f0-9]{64}$/);
});

test('changes the content upgrade job id when the body revision changes', () => {
  assert.notEqual(
    buildAutomaticItemAiJobId({ itemId: 'item-a', reason: 'content_upgrade', content: 'revision one' }),
    buildAutomaticItemAiJobId({ itemId: 'item-a', reason: 'content_upgrade', content: 'revision two' }),
  );
});

test('keeps new item identity compatible and never queues provenance-only updates', () => {
  assert.equal(buildAutomaticItemAiJobId({ itemId: 'item-a', reason: 'new_item' }), 'item_ai_item-a');
  assert.equal(buildAutomaticItemAiJobId({ itemId: 'item-a', reason: 'provenance_only' }), null);
});

test('queues upgraded content only when at least one automatic AI setting is enabled', () => {
  assert.equal(shouldQueueAutomaticContentProcessing({
    autoSummaryEnabled: true,
    autoTranslationEnabled: false,
  }), true);
  assert.equal(shouldQueueAutomaticContentProcessing({
    autoSummaryEnabled: false,
    autoTranslationEnabled: true,
  }), true);
  assert.equal(shouldQueueAutomaticContentProcessing({
    autoSummaryEnabled: false,
    autoTranslationEnabled: false,
  }), false);
});

test('merges new and body-upgraded ids into one stable deduplicated processing set', () => {
  assert.deepEqual(
    mergeContentProcessingCandidateIds(['new-a', 'shared'], ['upgrade-b', 'shared']),
    ['new-a', 'shared', 'upgrade-b'],
  );
});

test('does not infer provenance-only duplicates when only body-upgrade ids are supplied', () => {
  const bodyUpgradeIds = ['body-upgrade'];
  const provenanceOnlyIds = ['provenance-only'];
  const candidates = mergeContentProcessingCandidateIds([], bodyUpgradeIds);

  assert.deepEqual(candidates, ['body-upgrade']);
  assert.equal(candidates.includes(provenanceOnlyIds[0]), false);
});

test('replaces duplicate item content when incoming feed body is much richer and existing text is sponsor noise', () => {
  const decision = shouldReplaceDuplicateContent({
    existingContent: 'Sponsored by: Cloud provider identity platform. Register here. '.repeat(18),
    incomingContent: '<p>After two days with Claude Fable 5, the model behaved proactively and used tools aggressively.</p>'.repeat(90),
  });

  assert.equal(decision.replace, true);
  assert.equal(decision.reason, 'incoming_content_richer');
});

test('does not replace a full article with a short index summary', () => {
  const decision = shouldReplaceDuplicateContent({
    existingContent: '<p>Compilers operate on one function at a time.</p><pre><code>class Point</code></pre>'.repeat(300),
    incomingContent: 'Jun 12, 2026 Announcements',
  });

  assert.equal(decision.replace, false);
  assert.equal(decision.reason, 'incoming_too_short');
});

test('replaces noisy press-kit snapshots with clean article text of similar size', () => {
  const decision = shouldReplaceDuplicateContent({
    existingContent: 'press@anthropic.com Non-media inquiries How to get support Media assets Download press kit Claude Fable 5 and Claude Mythos 5',
    incomingContent: 'Anthropic announced Claude Fable 5 and Claude Mythos 5 for difficult knowledge work, coding, and long-running professional tasks. '.repeat(8),
  });

  assert.equal(decision.replace, true);
  assert.equal(decision.reason, 'existing_content_noisy');
});

test('resets stale filter and AI state after duplicate content upgrade', () => {
  const patch = buildDuplicateContentUpgradeResetPatch('existing_content_noisy');

  assert.equal(patch.processingStatus, 'raw');
  assert.equal(patch.summaryStatus, 'pending');
  assert.equal(patch.translationStatus, 'pending');
  assert.equal(patch.summaryReason, 'duplicate_content_upgraded:existing_content_noisy');
  assert.equal(patch.translationReason, 'duplicate_content_upgraded:existing_content_noisy');
  assert.equal(patch.isFiltered, false);
  assert.equal(patch.filterBucket, 'main');
  assert.equal(patch.qualityDecision, null);
  assert.equal(patch.qualityCheckedAt, null);
});

test('upgrades duplicate provenance when incoming index item resolves the missing original url', () => {
  const decision = shouldUpgradeDuplicateProvenance({
    existingOriginalUrl: null,
    incomingOriginalUrl: 'https://simonwillison.net/2026/Jun/16/claude-code-notes',
    existingCurationUrl: 'https://www.bestblogs.dev/en/explore/brief',
    incomingCurationUrl: 'https://www.bestblogs.dev/en/explore/brief',
  });

  assert.equal(decision.upgrade, true);
  assert.equal(decision.reason, 'incoming_original_url');
});

test('does not overwrite complete duplicate provenance with empty incoming metadata', () => {
  const decision = shouldUpgradeDuplicateProvenance({
    existingOriginalUrl: 'https://simonwillison.net/2026/Jun/16/claude-code-notes',
    incomingOriginalUrl: null,
    existingCurationUrl: 'https://www.bestblogs.dev/en/explore/brief',
    incomingCurationUrl: null,
  });

  assert.equal(decision.upgrade, false);
  assert.equal(decision.reason, 'existing_already_complete');
});
