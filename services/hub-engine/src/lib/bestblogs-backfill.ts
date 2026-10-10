export type BestBlogsOriginalUrlPatch = {
  originalUrl: string;
  curationUrl: string;
  curationSource: string;
  curationMeta: Record<string, unknown>;
};

function isExternalArticleUrl(value?: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.hostname.endsWith('bestblogs.dev');
  } catch {
    return false;
  }
}

export function buildBestBlogsOriginalUrlPatch(input: {
  itemUrl: string;
  curationUrl?: string | null;
  curationSource?: string | null;
  curationMeta?: Record<string, unknown> | null;
  resolvedOriginalUrl?: string | null;
  resolvedAt?: Date;
}): BestBlogsOriginalUrlPatch | null {
  const originalUrl = String(input.resolvedOriginalUrl || '').trim();
  if (!isExternalArticleUrl(originalUrl)) return null;

  const curationUrl = String(input.curationUrl || input.itemUrl || '').trim();
  const resolvedAt = input.resolvedAt || new Date();
  return {
    originalUrl,
    curationUrl,
    curationSource: String(input.curationSource || 'BestBlogs Daily Brief').trim(),
    curationMeta: {
      ...(input.curationMeta || {}),
      originalUrl,
      originalUrlBackfilledAt: resolvedAt.toISOString(),
      originalUrlResolvedBy: 'bestblogs-backfill-detail-html',
    },
  };
}
