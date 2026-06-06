import test from 'node:test';
import assert from 'node:assert/strict';

import { AI_TOKEN_BUDGETS } from './ai-token-budgets.js';

test('keeps feed scoring outputs bounded without starving reasoning-prone models', () => {
  assert.equal(AI_TOKEN_BUDGETS.feedScoringSkill >= 800 && AI_TOKEN_BUDGETS.feedScoringSkill <= 900, true);
  assert.equal(AI_TOKEN_BUDGETS.feedScoringLegacy >= 800 && AI_TOKEN_BUDGETS.feedScoringLegacy <= 900, true);
  assert.equal(AI_TOKEN_BUDGETS.feedScoringFallback >= 800 && AI_TOKEN_BUDGETS.feedScoringFallback <= 900, true);
  assert.equal(AI_TOKEN_BUDGETS.feedSummary >= 1000, true);
});

test('keeps final daily report enough room for synthesis after reasoning tokens', () => {
  assert.equal(AI_TOKEN_BUDGETS.dailyResearch >= 2200, true);
  assert.equal(AI_TOKEN_BUDGETS.dailyReading >= 1800, true);
  assert.equal(AI_TOKEN_BUDGETS.dailyFinal >= 3400, true);
});
