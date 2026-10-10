import { deriveSourceContentStrategy } from './source-content-strategy.js';

const AUTO_CONTENT_UPGRADE_SOURCE_TIERS = new Set(['A', 'S']);

function isHttpUrl(value?: string | null): boolean {
  return /^https?:\/\//i.test(String(value || '').trim());
}

export function shouldAutoUpgradeReadableContent(input: {
  url?: string | null;
  sourceType?: string | null;
  collectorType?: string | null;
  sourceKind?: string | null;
  sourceTier?: string | null;
  sourceRole?: string | null;
  processingProfile?: string | null;
  contentStrategy?: string | null;
  originalUrl?: string | null;
  fetchEngine?: string | null;
  renderMode?: string | null;
}): boolean {
  const strategy = deriveSourceContentStrategy(input);
  if (strategy === 'feed_only' || strategy === 'monitor_only') return false;

  const sourceType = String(input.sourceType || '').trim().toLowerCase();
  const collectorType = String(input.collectorType || '').trim().toLowerCase();
  const sourceKind = String(input.sourceKind || '').trim().toLowerCase();
  const sourceTier = String(input.sourceTier || '').trim().toUpperCase();
  const fetchEngine = String(input.fetchEngine || '').trim().toLowerCase();
  const renderMode = String(input.renderMode || '').trim().toLowerCase();
  const fetchableUrl = input.originalUrl || input.url || null;

  const isIndexSource = sourceType === 'curated_index' || collectorType === 'webpage_index';
  const isIndexContent = fetchEngine === 'webpage-index' || renderMode === 'index';
  if (strategy === 'full') {
    return isHttpUrl(fetchableUrl);
  }
  if (!isIndexSource && !isIndexContent) return false;
  if (!isHttpUrl(input.originalUrl)) return false;

  return sourceKind === 'official' || AUTO_CONTENT_UPGRADE_SOURCE_TIERS.has(sourceTier);
}
