import { createHash } from 'node:crypto';
import { cleanArticleBody, plainTextLength } from './content-extractor.js';

export type DuplicateContentUpgradeDecision = {
  replace: boolean;
  reason: 'incoming_content_richer' | 'existing_content_noisy' | 'incoming_too_short' | 'existing_already_better';
  existingLength: number;
  incomingLength: number;
};

export type DuplicateProvenanceUpgradeDecision = {
  upgrade: boolean;
  reason: 'incoming_original_url' | 'incoming_curation_url' | 'existing_already_complete';
};

export function mergeContentProcessingCandidateIds(
  newItemIds: string[],
  contentUpgradeItemIds: string[],
): string[] {
  return [...new Set([...newItemIds, ...contentUpgradeItemIds].filter(Boolean))];
}

export function shouldQueueAutomaticContentProcessing(input: {
  autoSummaryEnabled: boolean;
  autoTranslationEnabled: boolean;
}): boolean {
  return input.autoSummaryEnabled || input.autoTranslationEnabled;
}

export function buildAutomaticItemAiJobId(input: {
  itemId: string;
  reason: 'new_item' | 'content_upgrade' | 'provenance_only';
  content?: string | null;
}): string | null {
  if (input.reason === 'provenance_only') return null;
  if (input.reason === 'new_item') return `item_ai_${input.itemId}`;
  const revision = createHash('sha256').update(String(input.content || ''), 'utf8').digest('hex');
  return `item_ai_${input.itemId}_${revision}`;
}

function isHttpUrl(input?: string | null): boolean {
  return /^https?:\/\//i.test(String(input || '').trim());
}

function normalizedText(input?: string | null): string {
  return (cleanArticleBody(input, 80_000) || input || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksNoisy(input?: string | null): boolean {
  const text = normalizedText(input);
  if (!text) return false;
  return /\b(?:Sponsored by|Register here|Advertisement|Cookie policy|Privacy policy)\b/i.test(text)
    || /press@anthropic\.com|Download press kit|How to get support|Non-media inquiries/i.test(text);
}

export function shouldReplaceDuplicateContent(input: {
  existingContent?: string | null;
  incomingContent?: string | null;
}): DuplicateContentUpgradeDecision {
  const existingText = normalizedText(input.existingContent);
  const incomingText = normalizedText(input.incomingContent);
  const existingLength = plainTextLength(existingText);
  const incomingLength = plainTextLength(incomingText);

  if (incomingLength < 180) {
    return { replace: false, reason: 'incoming_too_short', existingLength, incomingLength };
  }

  const existingNoisy = looksNoisy(input.existingContent);
  const incomingNoisy = looksNoisy(input.incomingContent);
  if (existingLength >= 180 && incomingLength >= Math.max(existingLength + 500, existingLength * 1.8)) {
    return { replace: true, reason: 'incoming_content_richer', existingLength, incomingLength };
  }

  if (existingNoisy && !incomingNoisy && incomingLength >= Math.max(180, existingLength * 0.7)) {
    return { replace: true, reason: 'existing_content_noisy', existingLength, incomingLength };
  }

  if (incomingLength >= Math.max(existingLength + 500, existingLength * 1.8)) {
    return { replace: true, reason: 'incoming_content_richer', existingLength, incomingLength };
  }

  return { replace: false, reason: 'existing_already_better', existingLength, incomingLength };
}

export function shouldUpgradeDuplicateProvenance(input: {
  existingOriginalUrl?: string | null;
  incomingOriginalUrl?: string | null;
  existingCurationUrl?: string | null;
  incomingCurationUrl?: string | null;
}): DuplicateProvenanceUpgradeDecision {
  if (!isHttpUrl(input.existingOriginalUrl) && isHttpUrl(input.incomingOriginalUrl)) {
    return { upgrade: true, reason: 'incoming_original_url' };
  }
  if (!isHttpUrl(input.existingCurationUrl) && isHttpUrl(input.incomingCurationUrl)) {
    return { upgrade: true, reason: 'incoming_curation_url' };
  }
  return { upgrade: false, reason: 'existing_already_complete' };
}

export function buildDuplicateContentUpgradeResetPatch(reason: DuplicateContentUpgradeDecision['reason']) {
  return {
    processingStatus: 'raw',
    aiScore: null,
    priorityScore: null,
    summaryStatus: 'pending',
    summaryBasis: null,
    summaryReason: `duplicate_content_upgraded:${reason}`,
    aiSummary: null,
    translationStatus: 'pending',
    translationReason: `duplicate_content_upgraded:${reason}`,
    aiTranslation: null,
    translatedTitle: null,
    isFiltered: false,
    filterBucket: 'main',
    filterReason: null,
    qualityDecision: null,
    qualitySummary: null,
    qualityReason: null,
    qualityTags: [],
    qualityRiskFlags: [],
    qualityScore: null,
    qualityConfidence: null,
    qualityCheckedAt: null,
  };
}
