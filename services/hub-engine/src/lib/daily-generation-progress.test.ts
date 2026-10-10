import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDailyGenerationProgress,
  humanizeDailyGenerationError,
  normalizeDailyGenerationProgress,
} from './daily-generation-progress.js';

test('builds user-facing daily generation progress checkpoints', () => {
  const progress = buildDailyGenerationProgress('agent_decision', {
    message: '决策 Agent 正在分析候选内容',
    detail: { candidates: 18 },
  });

  assert.equal(progress.stage, 'agent_decision');
  assert.equal(progress.label, '决策分析');
  assert.equal(progress.percent, 72);
  assert.equal(progress.message, '决策 Agent 正在分析候选内容');
  assert.deepEqual(progress.detail, { candidates: 18 });
  assert.ok(progress.updatedAt);

  const moduleProgress = buildDailyGenerationProgress('module_generation', {
    detail: { moduleCount: 5, moduleArticleCount: 31 },
  });
  assert.equal(moduleProgress.label, '模块日报');
  assert.equal(moduleProgress.percent, 58);
  assert.deepEqual(moduleProgress.detail, { moduleCount: 5, moduleArticleCount: 31 });
});

test('normalizes unknown or stale daily generation progress safely', () => {
  const progress = normalizeDailyGenerationProgress({ stage: 'unknown_stage', percent: 999 });

  assert.equal(progress.stage, 'queued');
  assert.equal(progress.label, '任务已创建');
  assert.equal(progress.percent, 5);
});

test('hides database and provider internals from daily generation errors', () => {
  assert.equal(
    humanizeDailyGenerationError('insert or update violates foreign key constraint insights_user_id_fkey'),
    '日报保存失败，请稍后重试；若持续出现，请检查数据库服务。',
  );
  assert.equal(
    humanizeDailyGenerationError('LLM provider rate limit 429'),
    '模型服务暂时不可用，请稍后重新生成日报。',
  );
  assert.equal(
    humanizeDailyGenerationError('unexpected stack trace at daily-report.ts:42'),
    '日报生成失败，请稍后重试。',
  );
});
