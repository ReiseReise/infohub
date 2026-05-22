import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAiSceneModelBinding } from './ai-scene-bindings.js';

test('builds scene runtime fields from a Volcengine Ark model config alias', () => {
  const binding = buildAiSceneModelBinding({
    id: 'model-1',
    provider: 'volcengine_ark',
    alias: '豆包-默认主模型',
    modelName: 'ep-20250922092456-gf47b',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    extraConfig: {
      accessMode: 'endpoint',
      endpointId: 'ep-20250922092456-gf47b',
    },
    isActive: true,
  });

  assert.deepEqual(binding, {
    provider: 'volcengine_ark',
    model: 'ep-20250922092456-gf47b',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    modelLabel: '豆包-默认主模型',
  });
});

test('rejects inactive or invalid model configs before binding a scene', () => {
  assert.throws(() => buildAiSceneModelBinding({
    id: 'model-2',
    provider: 'volcengine_ark',
    alias: '旧豆包模型',
    modelName: 'doubao-pro-32k',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    extraConfig: null,
    isActive: true,
  }), /endpoint id/);

  assert.throws(() => buildAiSceneModelBinding({
    id: 'model-3',
    provider: 'dashscope',
    alias: '停用模型',
    modelName: 'dashscope/qwen-flash',
    baseUrl: null,
    extraConfig: null,
    isActive: false,
  }), /not active/);
});
