import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseOpml, type OpmlFeed } from './opml-parser.js';

export type SubscriptionPackageSlug = 'hn-popular-blogs';

export type SubscriptionPackageMeta = {
  slug: SubscriptionPackageSlug;
  title: string;
  description: string;
  sourceCount: number;
};

const PACKAGE_META: Record<SubscriptionPackageSlug, Omit<SubscriptionPackageMeta, 'sourceCount'>> = {
  'hn-popular-blogs': {
    slug: 'hn-popular-blogs',
    title: 'HN Popular Blogs',
    description: 'Hacker News 热门博客包，用于真实 RSS 抓取、AI 过滤、摘要与翻译回归。',
  },
};

const HN_PACKAGE_CANDIDATE_PATHS = [
  process.env.INFOHUB_HN_POPULAR_BLOGS_PATH || '',
  '/app/fixtures/hn-popular-blogs-2025.opml',
  path.resolve(process.cwd(), 'hn-popular-blogs-2025.opml'),
  path.resolve(process.cwd(), '../hn-popular-blogs-2025.opml'),
  path.resolve(process.cwd(), '../../hn-popular-blogs-2025.opml'),
];

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

async function loadHnPopularBlogsFeeds(): Promise<OpmlFeed[]> {
  const filePath = await findExistingPath(HN_PACKAGE_CANDIDATE_PATHS);
  if (!filePath) {
    throw new Error('hn-popular-blogs-2025.opml not found');
  }
  const xml = await readFile(filePath, 'utf8');
  return parseOpml(xml);
}

export async function listSubscriptionPackages(): Promise<SubscriptionPackageMeta[]> {
  const feeds = await loadHnPopularBlogsFeeds();
  return [
    {
      ...PACKAGE_META['hn-popular-blogs'],
      sourceCount: feeds.length,
    },
  ];
}

export async function loadSubscriptionPackage(slug: SubscriptionPackageSlug): Promise<OpmlFeed[]> {
  if (slug === 'hn-popular-blogs') {
    return loadHnPopularBlogsFeeds();
  }
  throw new Error(`Unknown subscription package: ${slug}`);
}
