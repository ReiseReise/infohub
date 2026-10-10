import test from 'node:test';
import assert from 'node:assert/strict';

import { clearApiSessionCaches, type MinimalCacheStorage } from '../src/lib/session-cache';

test('clears only API caches and preserves Workbox precache entries', async () => {
  const deleted: string[] = [];
  const storage: MinimalCacheStorage = {
    keys: async () => ['api-cache', 'api-cache-user-a', 'workbox-precache-v2-app', 'images'],
    delete: async (cacheName) => {
      deleted.push(cacheName);
      return true;
    },
  };

  assert.deepEqual(await clearApiSessionCaches(storage), ['api-cache', 'api-cache-user-a']);
  assert.deepEqual(deleted, ['api-cache', 'api-cache-user-a']);
});
