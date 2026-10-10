import test from 'node:test';
import assert from 'node:assert/strict';

import { AI_TOKEN_BUDGETS } from './ai-token-budgets.js';

test('keeps feed scoring outputs bounded without starving reasoning-prone models', () => {
  assert.equal(AI_TOKEN_BUDGETS.feedScoringSkill >= 800 && AI_TOKEN_BUDGETS.feedScoringSkill <= 900, true);
  assert.equal(AI_TOKEN_BUDGETS.feedScoringLegacy >= 800 && AI_TOKEN_BUDGETS.feedScoringLegacy <= 900, true);
  assert.equal(AI_TOKEN_BUDGETS.feedScoringFallback >= 800 && AI_TOKEN_BUDGETS.feedScoringFallback <= 900, true);
  assert.equal(AI_TOKEN_BUDGETS.feedSummary >= 1000, true);
});

test('keeps daily report agents enough room after reasoning tokens', () => {
  assert.equal(AI_TOKEN_BUDGETS.dailyDecision >= 4200, true);
  assert.equal(AI_TOKEN_BUDGETS.dailyResearch >= 3600, true);
  assert.equal(AI_TOKEN_BUDGETS.dailyReading >= 2800, true);
  // The final contract requires at least 6,000 Chinese characters. A 3,400
  // token cap consistently truncated the model before it could satisfy it.
  assert.equal(AI_TOKEN_BUDGETS.dailyFinal >= 8000, true);
});
