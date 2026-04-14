import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseOpml, type OpmlFeed } from './opml-parser.js';

export type SubscriptionPackageSlug = 'follow' | 'hn-popular-blogs';

export type SourceTier = 'S' | 'A' | 'B' | 'C' | 'D';

export type SubscriptionPackageMeta = {
  slug: SubscriptionPackageSlug;
  title: string;
  description: string;
  sourceCount: number;
  categoryDefault: string;
  tierSummary: Partial<Record<SourceTier, number>>;
};

export type SubscriptionPackageSourcePayload = {
  name: string;
  sourceType: string;
  collectorType: string;
  config: Record<string, unknown>;
  category: string;
  priority: number;
  fetchInterval: number;
  autoTranscribe: boolean;
  status: string;
  tags: string[];
  sourceRole: string;
  sourceTier: SourceTier;
  processingProfile: 'full' | 'smart' | 'brief' | 'monitor';
  growthAxes: string[];
  trustScore: number;
  noiseScore: number;
  upgradeRules: Record<string, unknown>;
};

const PACKAGE_META: Record<SubscriptionPackageSlug, Omit<SubscriptionPackageMeta, 'sourceCount'>> = {
  follow: {
    slug: 'follow',
    title: 'Follow OPML',
    description: 'Follow 导出的主订阅集合，按分类进行保守分级，适合作为日常阅读底座。',
    categoryDefault: 'follow',
    tierSummary: {},
  },
  'hn-popular-blogs': {
    slug: 'hn-popular-blogs',
    title: 'HN Popular Blogs',
    description: 'Hacker News 热门博客包，用于真实 RSS 抓取、AI 过滤、摘要与翻译回归。',
    categoryDefault: 'hn-popular-blogs',
    tierSummary: {},
  },
};

const PACKAGE_FILE_NAMES: Record<SubscriptionPackageSlug, string> = {
  follow: 'follow.opml',
  'hn-popular-blogs': 'hn-popular-blogs-2025.opml',
};

const PACKAGE_ENV_PATHS: Record<SubscriptionPackageSlug, string | undefined> = {
  follow: process.env.INFOHUB_FOLLOW_OPML_PATH,
  'hn-popular-blogs': process.env.INFOHUB_HN_POPULAR_BLOGS_PATH,
};

const FOLLOW_A_CATEGORIES = new Set(['AI', 'NewsLetter', '研报&数据', '出海']);
const FOLLOW_C_CATEGORIES = new Set(['浅阅读 | 扫读', 'Video', 'Videos', 'Life Style', 'Job']);

function packageCandidatePaths(slug: SubscriptionPackageSlug): string[] {
  const fileName = PACKAGE_FILE_NAMES[slug];
  return [
    PACKAGE_ENV_PATHS[slug] || '',
    `/app/fixtures/${fileName}`,
    path.resolve(process.cwd(), fileName),
    path.resolve(process.cwd(), `../${fileName}`),
    path.resolve(process.cwd(), `../../${fileName}`),
  ];
}

async function findExistingPath(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }
  return null;
}

async function loadPackageFeeds(slug: SubscriptionPackageSlug): Promise<OpmlFeed[]> {
  const filePath = await findExistingPath(packageCandidatePaths(slug));
  if (!filePath) {
    throw new Error(`${PACKAGE_FILE_NAMES[slug]} not found`);
  }
  const xml = await readFile(filePath, 'utf8');
  return parseOpml(xml);
}

export function isSubscriptionPackageSlug(value: string): value is SubscriptionPackageSlug {
  return value === 'follow' || value === 'hn-popular-blogs';
}

function sourceDefaultsForTier(tier: SourceTier) {
  if (tier === 'A') {
    return {
      processingProfile: 'smart' as const,
      trustScore: 78,
      noiseScore: 24,
      priority: 4,
      fetchInterval: 90,
    };
  }
  if (tier === 'C') {
    return {
      processingProfile: 'brief' as const,
      trustScore: 40,
      noiseScore: 72,
      priority: 2,
      fetchInterval: 360,
    };
  }
  return {
    processingProfile: 'brief' as const,
    trustScore: 62,
    noiseScore: 42,
    priority: 3,
    fetchInterval: 180,
  };
}

function followTierForCategory(category: string): SourceTier {
  if (FOLLOW_A_CATEGORIES.has(category)) return 'A';
  if (FOLLOW_C_CATEGORIES.has(category)) return 'C';
  return 'B';
}

function rssPayloadFromFeed(feed: OpmlFeed, patch: Omit<SubscriptionPackageSourcePayload, 'sourceType' | 'collectorType' | 'config'>): SubscriptionPackageSourcePayload {
  const xmlUrl = feed.xmlUrl.trim();
  try {
    const parsed = new URL(xmlUrl);
    const isRsshubHost = /rsshub/i.test(parsed.hostname);
    if (isRsshubHost) {
      return {
        ...patch,
        sourceType: 'rsshub',
        collectorType: 'rsshub',
        config: { route: parsed.pathname + parsed.search, htmlUrl: feed.htmlUrl },
      };
    }
  } catch {
    // Keep rss defaults.
  }

  return {
    ...patch,
    sourceType: 'rss',
    collectorType: 'rss',
    config: { url: xmlUrl, htmlUrl: feed.htmlUrl },
  };
}

export function buildSubscriptionPackageSourcePayload(
  slug: SubscriptionPackageSlug,
  feed: OpmlFeed,
  categoryDefault?: string,
): SubscriptionPackageSourcePayload {
  if (slug === 'hn-popular-blogs') {
    const tier: SourceTier = 'A';
    const defaults = sourceDefaultsForTier(tier);
    return rssPayloadFromFeed(feed, {
      name: feed.title,
      category: categoryDefault || PACKAGE_META[slug].categoryDefault,
      priority: defaults.priority,
      fetchInterval: defaults.fetchInterval,
      autoTranscribe: false,
      status: 'active',
      tags: ['hn-popular-blogs'],
      sourceRole: 'normal',
      sourceTier: tier,
      processingProfile: defaults.processingProfile,
      growthAxes: ['技术能力', '认知升级'],
      trustScore: defaults.trustScore,
      noiseScore: defaults.noiseScore,
      upgradeRules: {},
    });
  }

  const category = (feed.category || categoryDefault || PACKAGE_META.follow.categoryDefault).trim() || PACKAGE_META.follow.categoryDefault;
  const tier = followTierForCategory(category);
  const defaults = sourceDefaultsForTier(tier);
  return rssPayloadFromFeed(feed, {
    name: feed.title,
    category,
    priority: defaults.priority,
    fetchInterval: defaults.fetchInterval,
    autoTranscribe: false,
    status: 'active',
    tags: ['follow', `follow:${category}`],
    sourceRole: 'normal',
    sourceTier: tier,
    processingProfile: defaults.processingProfile,
    growthAxes: tier === 'A' ? ['技术能力', '认知升级'] : ['认知升级'],
    trustScore: defaults.trustScore,
    noiseScore: defaults.noiseScore,
    upgradeRules: {},
  });
}

function summarizeTiers(slug: SubscriptionPackageSlug, feeds: OpmlFeed[]): Partial<Record<SourceTier, number>> {
  const summary: Partial<Record<SourceTier, number>> = {};
  for (const feed of feeds) {
    const tier = buildSubscriptionPackageSourcePayload(slug, feed).sourceTier;
    summary[tier] = (summary[tier] || 0) + 1;
  }
  return summary;
}

export async function listSubscriptionPackages(): Promise<SubscriptionPackageMeta[]> {
  const slugs: SubscriptionPackageSlug[] = ['follow', 'hn-popular-blogs'];
  const packages: SubscriptionPackageMeta[] = [];
  for (const slug of slugs) {
    const feeds = await loadPackageFeeds(slug);
    packages.push({
      ...PACKAGE_META[slug],
      sourceCount: feeds.length,
      tierSummary: summarizeTiers(slug, feeds),
    });
  }
  return packages;
}

export async function loadSubscriptionPackage(slug: SubscriptionPackageSlug): Promise<OpmlFeed[]> {
  return loadPackageFeeds(slug);
}
