export interface MinimalCacheStorage {
  keys(): Promise<string[]>;
  delete(cacheName: string): Promise<boolean>;
}

export function isApiCacheName(cacheName: string): boolean {
  return cacheName === 'api-cache' || cacheName.startsWith('api-cache-');
}

export async function clearApiSessionCaches(
  cacheStorage: MinimalCacheStorage | undefined = globalThis.caches,
): Promise<string[]> {
  if (!cacheStorage) return [];
  const cacheNames = await cacheStorage.keys();
  const targets = cacheNames.filter(isApiCacheName);
  await Promise.all(targets.map((cacheName) => cacheStorage.delete(cacheName)));
  return targets;
}
