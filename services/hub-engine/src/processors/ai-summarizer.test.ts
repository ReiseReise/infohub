import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChineseSummaryRepairPrompt,
  parseSummaryResponse,
  isMostlyChineseSummary,
  isUsableChineseSummary,
  resolveSummarySkipReason,
} from './ai-summarizer.js';
import { buildAiStageResult } from './ai-scorer.js';

test('parses Chinese summary from JSON wrapped rewrite responses', () => {
  const parsed = parseSummaryResponse(JSON.stringify({
    summary: '这篇文章说明 OpenRouter 年处理量已经超过一千万亿 tokens，反映出多模型路由正在成为 AI 应用基础设施的重要入口。',
    tags: ['OpenRouter', 'AI infra'],
  }));

  assert.equal(parsed.summary, '这篇文章说明 OpenRouter 年处理量已经超过一千万亿 tokens，反映出多模型路由正在成为 AI 应用基础设施的重要入口。');
  assert.deepEqual(parsed.tags, ['OpenRouter', 'AI infra']);
  assert.equal(isMostlyChineseSummary(parsed.summary), true);
});

test('keeps plain Chinese summary responses valid', () => {
  const parsed = parseSummaryResponse('摘要：这是一条中文摘要，保留 Claude Code、RAG 和 MCP 等英文专名，但主体仍然是中文。');

  assert.equal(parsed.summary, '这是一条中文摘要，保留 Claude Code、RAG 和 MCP 等英文专名，但主体仍然是中文。');
  assert.deepEqual(parsed.tags, []);
  assert.equal(isMostlyChineseSummary(parsed.summary), true);
});

test('builds a simple Chinese repair prompt without json output requirements', () => {
  const prompt = buildChineseSummaryRepairPrompt(
    '5 Things Broke When I Shipped a RAG + MCP Agent to Production.',
    'The system routes knowledge requests through hybrid search and reranking, then exposes production failures around null MCP tool responses.',
  );

  assert.match(prompt, /只输出中文自然段/);
  assert.match(prompt, /不要 JSON/);
  assert.match(prompt, /RAG \+ MCP Agent/);
  assert.match(prompt, /hybrid search/);
});

test('rejects malformed json and model meta replies as usable summaries', () => {
  assert.equal(isUsableChineseSummary('{"summary":"微软计划将 Copilot 订阅转为 token 计费，但 JSON 没有闭合'), false);
  assert.equal(isUsableChineseSummary('请提供待改写的摘要内容，以便我进行忠实改写。'), false);
  assert.equal(isUsableChineseSummary('这篇文章说明 Claude Code 在生产部署中需要处理鉴权、流式响应和错误恢复，适合继续阅读。'), true);
});

test('counts skipped AI stage items separately from processed and failed', () => {
  const result = buildAiStageResult(1, 4, ['timeout', 'timeout', 'bad_json'], 2);

  assert.equal(result.processed, 1);
  assert.equal(result.attempted, 4);
  assert.equal(result.skipped, 2);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.errors, ['timeout', 'bad_json']);
});

test('explains summary skips with user-facing policy reasons', () => {
  assert.equal(resolveSummarySkipReason({ processingProfile: 'monitor', aiScore: 90 }), '监控档位默认不做摘要');
  assert.equal(resolveSummarySkipReason({ processingProfile: 'brief', aiScore: 39.9 }), 'AI 评分过低，跳过摘要');
  assert.equal(resolveSummarySkipReason({ processingProfile: 'smart', aiScore: 40 }), null);
});
