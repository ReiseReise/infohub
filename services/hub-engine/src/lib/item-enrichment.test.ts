import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveItemText } from './item-enrichment.js';

test('resolveItemText returns cleaned readable text instead of raw html', () => {
  const resolved = resolveItemText({
    title: 'Claude code 云端部署教程',
    content: '<div style="font-family: sans-serif"><nav>菜单</nav><article><h1>Claude code 云端部署</h1><p>'
      + '这篇文章介绍如何通过 SDK 改造实现 HTTP 流式调用，并说明部署中的关键注意事项、鉴权方式、长连接保持、错误恢复和生产环境观测指标。文章还补充了服务端转发、模型配置、日志排查和前端消费流式响应的完整步骤，适合用于生产环境落地参考。部署时还需要关注鉴权隔离、请求限流、模型降级、失败重试和日志审计，确保前端看到的是稳定的事件流而不是一次性阻塞响应。'.repeat(3)
      + '</p></article></div>',
    snippet: null,
  });

  assert.equal(resolved.basis, 'content');
  assert.match(resolved.text, /HTTP 流式调用/);
  assert.doesNotMatch(resolved.text, /<div|style=|<article/i);
});

test('resolveItemText treats short RSS excerpts as snippet basis', () => {
  const excerpt = 'Asana acquires Stack AI and plans to integrate agent workflows into its work management product.';
  const resolved = resolveItemText({
    title: 'Asana acquires no-code agent-builder Stack AI',
    content: excerpt,
    snippet: excerpt,
  });

  assert.equal(resolved.basis, 'snippet');
  assert.match(resolved.text, /Stack AI/);
});
