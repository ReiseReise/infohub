import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { signAccessToken } from '../lib/auth.js';
import {
  createIntegrationsRoutes,
  referenceSourceIntegrationEnabled,
  summarizeReferenceSourceCounts,
} from './integrations.js';

const userId = '00000000-0000-4000-8000-000000000123';
const token = signAccessToken({
  userId,
  email: 'reader@example.com',
  username: 'reader',
  role: 'user',
});

test('GET /dibao/status returns injected Dibao health snapshot for authenticated users', async () => {
  const app = new Hono();
  app.route('/api/integrations', createIntegrationsRoutes({
    checkDibao: async () => ({
      available: false,
      publicUrl: '/reader-lab/',
      healthUrl: 'http://dibao-reader:8080/api/system/health',
      message: 'Dibao 阅读实验室暂时无法访问；请先启动 dibao-reader 服务。',
      version: null,
      checkedAt: '2026-06-15T08:00:00.000Z',
      error: 'connection refused',
    }),
    listDibaoSources: async () => [],
  }));

  const response = await app.request('/api/integrations/dibao/status', {
    headers: { Authorization: `Bearer ${token}` },
  });

  assert.equal(response.status, 200);
  const body = await response.json() as {
    data: {
      available: boolean;
      publicUrl: string;
      message: string;
    };
  };
  assert.equal(body.data.available, false);
  assert.equal(body.data.publicUrl, '/reader-lab/');
  assert.match(body.data.message, /暂时无法访问/);
});

test('GET /dibao/opml returns OPML for the current user sources', async () => {
  let capturedUserId = '';
  const app = new Hono();
  app.route('/api/integrations', createIntegrationsRoutes({
    checkDibao: async () => {
      throw new Error('not used');
    },
    listDibaoSources: async (requestedUserId) => {
      capturedUserId = requestedUserId;
      return [
        {
          id: 9,
          name: 'TechCrunch AI',
          sourceType: 'rss',
          collectorType: 'rss',
          category: 'AI',
          sourceTier: 'A',
          status: 'active',
          config: { url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
        },
      ];
    },
    generatedAt: () => new Date('2026-06-15T08:00:00.000Z'),
  }));

  const response = await app.request('/api/integrations/dibao/opml', {
    headers: { Authorization: `Bearer ${token}` },
  });

  assert.equal(response.status, 200);
  assert.equal(capturedUserId, userId);
  assert.equal(response.headers.get('content-type'), 'application/xml; charset=UTF-8');
  assert.match(response.headers.get('content-disposition') || '', /infohub-dibao-sources\.opml/);
  const body = await response.text();
  assert.match(body, /TechCrunch AI/);
  assert.match(body, /techcrunch.com\/category\/artificial-intelligence\/feed/);
});

test('reference source routes keep preview read-only and expose reversible lifecycle actions', async () => {
  const calls: Array<{ action: string; userId: string; key?: string; status?: string }> = [];
  const app = new Hono();
  app.route('/api/integrations', createIntegrationsRoutes({
    referenceSources: {
      catalog: async (requestedUserId) => {
        calls.push({ action: 'catalog', userId: requestedUserId });
        return {
          version: 1,
          updatedAt: '2026-07-20T00:00:00.000Z',
          enabled: true,
          total: 1,
          recommended: 1,
          limits: {
            totalActive: 31,
            referenceActive: 5,
            referenceShadow: 10,
            referenceFormal: 5,
            totalScheduled: 31,
          },
          activeCounts: {
            total: 21,
            reference: 0,
            formalReference: 0,
            referenceShadow: 0,
            referenceFormal: 0,
            totalScheduled: 21,
          },
          items: [],
        };
      },
      preview: async (requestedUserId, key) => {
        calls.push({ action: 'preview', userId: requestedUserId, key });
        return {
          key,
          status: 'ready',
          fetchedAt: '2026-07-20T00:00:00.000Z',
          error: null,
          items: [{
            title: 'Preview article',
            url: 'https://example.com/article',
            originalUrl: 'https://example.com/article',
            curationSource: 'AI HOT',
          }],
        };
      },
      enable: async (requestedUserId, key, status) => {
        calls.push({ action: 'enable', userId: requestedUserId, key, status });
        return { integrationStatus: status, sourceId: 90 };
      },
      disable: async (requestedUserId, key, status) => {
        calls.push({ action: 'disable', userId: requestedUserId, key, status });
        return { integrationStatus: status, dataPreserved: true };
      },
    },
  }));

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const catalogResponse = await app.request('/api/integrations/reference-sources/catalog', { headers });
  assert.equal(catalogResponse.status, 200);
  const catalogBody = await catalogResponse.json() as { data: { limits: { totalActive: number } } };
  assert.equal(catalogBody.data.limits.totalActive, 31);

  const encodedKey = encodeURIComponent('aihot:channel:selected');
  const previewResponse = await app.request(`/api/integrations/reference-sources/${encodedKey}/preview`, {
    method: 'POST', headers,
  });
  assert.equal(previewResponse.status, 200);
  const previewBody = await previewResponse.json() as { data: { items: Array<{ curationSource?: string | null }> } };
  assert.equal(previewBody.data.items[0].curationSource, 'AI HOT');

  const enableResponse = await app.request(`/api/integrations/reference-sources/${encodedKey}/enable`, {
    method: 'POST', headers, body: JSON.stringify({ status: 'shadow' }),
  });
  assert.equal(enableResponse.status, 200);

  const disableResponse = await app.request(`/api/integrations/reference-sources/${encodedKey}/disable`, {
    method: 'POST', headers, body: JSON.stringify({ status: 'removed' }),
  });
  assert.equal(disableResponse.status, 200);
  const disableBody = await disableResponse.json() as { data: { dataPreserved: boolean } };
  assert.equal(disableBody.data.dataPreserved, true);

  assert.deepEqual(calls, [
    { action: 'catalog', userId },
    { action: 'preview', userId, key: 'aihot:channel:selected' },
    { action: 'enable', userId, key: 'aihot:channel:selected', status: 'shadow' },
    { action: 'disable', userId, key: 'aihot:channel:selected', status: 'removed' },
  ]);
});

test('reference source feature flag defaults on and can stop new preview or enable actions', () => {
  assert.equal(referenceSourceIntegrationEnabled({}), true);
  assert.equal(referenceSourceIntegrationEnabled({ INFOHUB_REFERENCE_SOURCES_ENABLED: 'false' }), false);
});

test('reference source counts keep shadow capacity separate from formal adoption', () => {
  const counts = summarizeReferenceSourceCounts([
    {
      status: 'active',
      config: { integrationType: 'reference_source', integrationStatus: 'shadow' },
    },
    {
      status: 'active',
      config: { integrationType: 'reference_source', integrationStatus: 'active' },
    },
    {
      status: 'active',
      config: { url: 'https://example.com/feed.xml' },
    },
  ]);

  assert.deepEqual(counts, {
    total: 3,
    reference: 2,
    formalReference: 1,
    referenceShadow: 1,
    referenceFormal: 1,
    totalScheduled: 3,
  });
});

test('reference source routes require authentication', async () => {
  const app = new Hono();
  app.route('/api/integrations', createIntegrationsRoutes({
    referenceSources: {
      catalog: async () => { throw new Error('must not run'); },
      preview: async () => { throw new Error('must not run'); },
      enable: async () => { throw new Error('must not run'); },
      disable: async () => { throw new Error('must not run'); },
    },
  }));

  const response = await app.request('/api/integrations/reference-sources/catalog');
  assert.equal(response.status, 401);
});

test('disabled feature flag blocks new work but keeps the reversible disable path available', async () => {
  const calls: string[] = [];
  const app = new Hono();
  app.route('/api/integrations', createIntegrationsRoutes({
    referenceSourcesEnabled: () => false,
    referenceSources: {
      catalog: async () => { throw new Error('not used'); },
      preview: async () => {
        calls.push('preview');
        throw new Error('must not run');
      },
      enable: async () => {
        calls.push('enable');
        throw new Error('must not run');
      },
      disable: async (_requestedUserId, _key, status) => {
        calls.push(`disable:${status}`);
        return { integrationStatus: status, dataPreserved: true };
      },
    },
  }));

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const key = encodeURIComponent('aihot:channel:selected');
  const preview = await app.request(`/api/integrations/reference-sources/${key}/preview`, {
    method: 'POST', headers,
  });
  const enable = await app.request(`/api/integrations/reference-sources/${key}/enable`, {
    method: 'POST', headers, body: JSON.stringify({ status: 'shadow' }),
  });
  const disable = await app.request(`/api/integrations/reference-sources/${key}/disable`, {
    method: 'POST', headers, body: JSON.stringify({ status: 'removed' }),
  });

  assert.equal(preview.status, 503);
  assert.equal(enable.status, 503);
  assert.equal(disable.status, 200);
  assert.deepEqual(calls, ['disable:removed']);
  const body = await disable.json() as { data: { dataPreserved: boolean } };
  assert.equal(body.data.dataPreserved, true);
});

test('reference source enable surfaces quality gate failures as conflict responses', async () => {
  const app = new Hono();
  app.route('/api/integrations', createIntegrationsRoutes({
    referenceSources: {
      catalog: async () => { throw new Error('not used'); },
      preview: async () => { throw new Error('not used'); },
      enable: async () => { throw new Error('尚未达到启用门禁：影子观察尚未满 7 天'); },
      disable: async () => { throw new Error('not used'); },
    },
  }));

  const response = await app.request(`/api/integrations/reference-sources/${encodeURIComponent('follow_builders:podcast:no-priors')}/enable`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'active' }),
  });
  assert.equal(response.status, 409);
  const body = await response.json() as { error: string };
  assert.match(body.error, /尚未达到启用门禁/);
});
