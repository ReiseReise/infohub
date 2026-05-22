import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dedupeActiveScoringSkills,
  parseSkillResponse,
  type ScoringSkillRecord,
} from './scoring-skills.js';

function skill(input: Pick<ScoringSkillRecord, 'id' | 'name' | 'presetKey' | 'updatedAt'>): ScoringSkillRecord {
  return {
    id: input.id,
    userId: '00000000-0000-0000-0000-000000000001',
    name: input.name,
    description: null,
    presetKey: input.presetKey,
    status: 'active',
    weight: 1,
    instructionPrompt: '',
    rubricJson: {},
    outputSchemaVersion: 1,
    modelConfigId: null,
    isDefault: true,
    createdAt: input.updatedAt,
    updatedAt: input.updatedAt,
  };
}

test('rejects empty scoring skill responses instead of defaulting to 50', () => {
  assert.throws(
    () => parseSkillResponse('   '),
    /empty_scoring_skill_response/,
  );
});

test('dedupes active scoring skills by preset key and keeps latest copy', () => {
  const older = new Date('2026-05-10T00:00:00Z');
  const newer = new Date('2026-05-12T00:00:00Z');
  const result = dedupeActiveScoringSkills([
    skill({ id: 1, name: 'AI产业信号', presetKey: 'ai_industry', updatedAt: older }),
    skill({ id: 2, name: 'AI产业信号', presetKey: 'ai_industry', updatedAt: newer }),
    skill({ id: 3, name: '产品落地信号', presetKey: 'product_signal', updatedAt: older }),
  ]);

  assert.deepEqual(result.map((item) => item.id), [2, 3]);
});
