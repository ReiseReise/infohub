import { and, asc, desc, eq, inArray, max } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export const FEEDBACK_TYPES = ['like', 'dislike', 'must_read', 'not_for_me'] as const;
export type FeedbackType = typeof FEEDBACK_TYPES[number];

export const SKILL_STATUSES = ['draft', 'active', 'archived'] as const;
export type SkillStatus = typeof SKILL_STATUSES[number];
export const SKILL_PRESET_KEYS = ['ai_industry', 'product_delivery', 'narrative_capital'] as const;
export type SkillPresetKey = typeof SKILL_PRESET_KEYS[number];

export type ScoringSkillRecord = typeof schema.scoringSkills.$inferSelect;
export type PreferenceProfileRecord = typeof schema.userPreferenceProfiles.$inferSelect;
export const LAST_ACTIVE_SKILL_ERROR = '至少保留一个启用中的评分技能';
export const FEEDBACK_REASON_TAGS = [
  'AI行业',
  '模型能力',
  'Agent',
  '产品落地',
  '应用案例',
  '资本市场',
  '监管政策',
  '头部舆论',
  '公司战略',
  '太泛',
  '标题党',
  '信息噪音',
] as const;

type CreateSkillInput = {
  name?: string;
  description?: string | null;
  presetKey?: SkillPresetKey | null;
  status?: SkillStatus;
  weight?: number;
  instructionPrompt?: string;
  rubricJson?: Record<string, unknown>;
  modelConfigId?: string | null;
  isDefault?: boolean;
};

type FeedbackSummary = {
  totalFeedback: number;
  positiveCount: number;
  negativeCount: number;
  topPositiveTags: string[];
  topNegativeTags: string[];
  lastFeedbackAt: string | null;
};

type SkillPresetDefinition = {
  presetKey: SkillPresetKey;
  name: string;
  description: string;
  weight: number;
  preferredSignals: string[];
  avoidSignals: string[];
  instructionLines: string[];
};

const DEFAULT_REASON_TAGS = [...FEEDBACK_REASON_TAGS];

const DEFAULT_SKILL_PRESETS: SkillPresetDefinition[] = [
  {
    presetKey: 'ai_industry',
    name: 'AI产业信号',
    description: '优先识别模型能力、基础设施、Agent 生态和产业链变化中的高信息密度信号。',
    weight: 1.2,
    preferredSignals: ['AI行业', '模型能力', 'Agent', '公司战略'],
    avoidSignals: ['标题党', '信息噪音', '太泛'],
    instructionLines: [
      '你是“AI产业信号”评分技能。重点判断这条资讯是否改变了对 AI 行业、模型能力、Agent 生态或公司战略的理解。',
      '优先关注真实能力跃迁、产业结构变化、关键发布和高价值竞争信号。',
      '对泛泛评论、情绪化观点和没有新增事实的复读内容明显降分。',
    ],
  },
  {
    presetKey: 'product_delivery',
    name: '产品落地信号',
    description: '优先筛出真正体现产品落地、使用体验改善和业务闭环进展的资讯。',
    weight: 1,
    preferredSignals: ['产品落地', '应用案例', 'Agent', '公司战略'],
    avoidSignals: ['太泛', '标题党', '信息噪音'],
    instructionLines: [
      '你是“产品落地信号”评分技能。重点判断这条资讯是否体现了 AI 产品真正落地、体验改进或商业闭环推进。',
      '优先关注真实用户价值、可部署能力、应用案例和业务结果，不迷信概念包装。',
      '对只谈愿景、没有使用场景或没有落地证据的内容降分。',
    ],
  },
  {
    presetKey: 'narrative_capital',
    name: '头部舆论与资本信号',
    description: '优先识别会影响市场叙事、资本预期、监管判断和头部舆论方向的资讯。',
    weight: 0.95,
    preferredSignals: ['头部舆论', '资本市场', '监管政策', '公司战略'],
    avoidSignals: ['信息噪音', '太泛', '重复观点'],
    instructionLines: [
      '你是“头部舆论与资本信号”评分技能。重点判断这条资讯是否会影响 AI 叙事、资本预期、监管环境或头部舆论风向。',
      '优先关注政策、投融资、市场定价、头部平台动作和舆论共识变化。',
      '对低信噪比的情绪化热点、泛科技围观和重复跟风观点降分。',
    ],
  },
];

function normalizeJsonArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeWeight(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 1;
  return Math.min(5, Math.max(0.1, Number(value.toFixed(2))));
}

function getPresetDefinition(presetKey?: SkillPresetKey | null) {
  return DEFAULT_SKILL_PRESETS.find((preset) => preset.presetKey === presetKey) || null;
}

function isLegacyDefaultSkill(skill: Pick<ScoringSkillRecord, 'isDefault' | 'presetKey' | 'name'>) {
  return Boolean(skill.isDefault) && !skill.presetKey && skill.name === '默认精选技能';
}

export function defaultSkillPrompt(presetKey?: SkillPresetKey | null) {
  const preset = getPresetDefinition(presetKey);
  if (preset) {
    return [
      ...preset.instructionLines,
      '你只负责感知层判断：请分别评估事实增量、行业影响、产品/工程可用性、来源可信度、选题价值五个维度；最终精选阈值和来源权重由系统代码计算。',
      '输出 JSON，不要输出解释性前缀：',
      '{"score":0-100,"confidence":0-1,"decision":"must_read|worth_read|skip|noise","dimensionScores":{"fact_delta":0-100,"impact":0-100,"utility":0-100,"source_credibility":0-100,"topic_value":0-100},"reasons":["..."],"matchedSignals":["..."],"riskFlags":["..."]}',
      'reasons 控制在 2-4 条，尽量具体，优先引用正文中的真实信号。',
    ].join('\n');
  }
  return [
    '你是“个人资讯精选评分技能”。请根据标题、正文、用户偏好画像和技能 rubric，为这条资讯打分。',
    '你只负责感知层判断：请分别评估事实增量、行业影响、产品/工程可用性、来源可信度、选题价值五个维度；最终精选阈值和来源权重由系统代码计算。',
    '输出 JSON，不要输出解释性前缀：',
    '{"score":0-100,"confidence":0-1,"decision":"must_read|worth_read|skip|noise","dimensionScores":{"fact_delta":0-100,"impact":0-100,"utility":0-100,"source_credibility":0-100,"topic_value":0-100},"reasons":["..."],"matchedSignals":["..."],"riskFlags":["..."]}',
    '要求：',
    '1. 优先识别 AI 产业、模型能力、产品落地、头部舆论、资本与监管信号。',
    '2. 对泛科技噪音、标题党、重复观点和低信息密度内容降分。',
    '3. reasons 控制在 2-4 条，尽量具体。',
  ].join('\n');
}

export function defaultSkillRubric(presetKey?: SkillPresetKey | null) {
  const preset = getPresetDefinition(presetKey);
  if (preset) {
    return {
      preferredSignals: preset.preferredSignals,
      avoidSignals: preset.avoidSignals,
      scoreGuide: {
        must_read: '82-100',
        worth_read: '62-81',
        skip: '35-61',
        noise: '0-34',
      },
      deterministicLayer: '模型只输出多维感知分；系统用 sourceTier/sourceKind/authorityWeight、规则调整和分类阈值计算最终优先级。',
    };
  }
  return {
    preferredSignals: ['AI产业', '产品落地', '模型能力', 'Agent', '资本市场', '监管政策'],
    avoidSignals: ['泛科技噪音', '标题党', '重复观点', '低信息密度'],
    scoreGuide: {
      must_read: '80-100',
      worth_read: '60-79',
      skip: '35-59',
      noise: '0-34',
    },
    deterministicLayer: '模型只输出多维感知分；系统用 sourceTier/sourceKind/authorityWeight、规则调整和分类阈值计算最终优先级。',
  };
}

async function createPresetSkills(userId: string, presetKeys?: SkillPresetKey[]) {
  const targetPresets = DEFAULT_SKILL_PRESETS.filter((preset) => !presetKeys || presetKeys.includes(preset.presetKey));
  if (targetPresets.length === 0) return [];
  return db.insert(schema.scoringSkills).values(targetPresets.map((preset) => ({
    userId,
    name: preset.name,
    description: preset.description,
    presetKey: preset.presetKey,
    status: 'active',
    weight: preset.weight,
    instructionPrompt: defaultSkillPrompt(preset.presetKey),
    rubricJson: defaultSkillRubric(preset.presetKey),
    isDefault: true,
  }))).returning();
}

export async function ensureDefaultScoringSkills(userId: string) {
  const rows = await listScoringSkills(userId);
  const activeRows = rows.filter((row) => row.status === 'active');
  const hasCustomActive = activeRows.some((row) => !row.isDefault);
  if (hasCustomActive) return rows;

  const presetRows = rows.filter((row) => Boolean(row.presetKey)) as Array<ScoringSkillRecord & { presetKey: SkillPresetKey }>;
  const legacyDefaults = rows.filter(isLegacyDefaultSkill);
  const missingPresetKeys = DEFAULT_SKILL_PRESETS
    .map((preset) => preset.presetKey)
    .filter((presetKey) => !presetRows.some((row) => row.presetKey === presetKey));

  if (missingPresetKeys.length > 0) {
    await createPresetSkills(userId, missingPresetKeys);
  }

  if (legacyDefaults.length > 0) {
    await db.update(schema.scoringSkills)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(inArray(schema.scoringSkills.id, legacyDefaults.map((row) => row.id)));
  }

  const refreshed = await listScoringSkills(userId);
  const refreshedPresetIds = refreshed
    .filter((row) => Boolean(row.presetKey))
    .slice(0, 3)
    .map((row) => row.id);
  if (refreshedPresetIds.length > 0) {
    await db.update(schema.scoringSkills)
      .set({ status: 'active', updatedAt: new Date() })
      .where(inArray(schema.scoringSkills.id, refreshedPresetIds));
  }
  return listScoringSkills(userId);
}

export async function createDefaultScoringSkill(userId: string) {
  const rows = await ensureDefaultScoringSkills(userId);
  return rows.find((row) => row.status === 'active')?.id ?? null;
}

export async function listScoringSkills(userId: string) {
  const rows = await db
    .select()
    .from(schema.scoringSkills)
    .where(eq(schema.scoringSkills.userId, userId))
    .orderBy(desc(schema.scoringSkills.updatedAt), asc(schema.scoringSkills.id));
  const presetOrder = new Map(DEFAULT_SKILL_PRESETS.map((preset, index) => [preset.presetKey, index]));
  return rows.sort((left, right) => {
    const leftActive = left.status === 'active' ? 1 : 0;
    const rightActive = right.status === 'active' ? 1 : 0;
    if (leftActive !== rightActive) return rightActive - leftActive;
    const leftPreset = left.presetKey ? (presetOrder.get(left.presetKey as SkillPresetKey) ?? 99) : 999;
    const rightPreset = right.presetKey ? (presetOrder.get(right.presetKey as SkillPresetKey) ?? 99) : 999;
    if (leftPreset !== rightPreset) return leftPreset - rightPreset;
    return right.updatedAt.getTime() - left.updatedAt.getTime();
  });
}

export async function getActiveScoringSkills(userId: string) {
  let rows = await db
    .select()
    .from(schema.scoringSkills)
    .where(and(eq(schema.scoringSkills.userId, userId), eq(schema.scoringSkills.status, 'active')))
    .orderBy(desc(schema.scoringSkills.weight), asc(schema.scoringSkills.id));
  if (rows.length > 0) return dedupeActiveScoringSkills(rows).slice(0, 3);
  await ensureDefaultScoringSkills(userId);
  rows = await db
    .select()
    .from(schema.scoringSkills)
    .where(and(eq(schema.scoringSkills.userId, userId), eq(schema.scoringSkills.status, 'active')))
    .orderBy(desc(schema.scoringSkills.weight), asc(schema.scoringSkills.id));
  return dedupeActiveScoringSkills(rows).slice(0, 3);
}

export function dedupeActiveScoringSkills(rows: ScoringSkillRecord[]): ScoringSkillRecord[] {
  const picked = new Map<string, ScoringSkillRecord>();
  for (const row of rows) {
    const key = row.presetKey || row.name;
    const current = picked.get(key);
    if (!current || row.updatedAt > current.updatedAt || (row.updatedAt.getTime() === current.updatedAt.getTime() && row.id > current.id)) {
      picked.set(key, row);
    }
  }
  return Array.from(picked.values()).sort((left, right) => {
    if ((right.weight ?? 0) !== (left.weight ?? 0)) return (right.weight ?? 0) - (left.weight ?? 0);
    return left.id - right.id;
  });
}

async function getSkillById(userId: string, id: number) {
  const rows = await db
    .select()
    .from(schema.scoringSkills)
    .where(and(eq(schema.scoringSkills.id, id), eq(schema.scoringSkills.userId, userId)))
    .limit(1);
  return rows[0] || null;
}

async function countActiveSkills(userId: string) {
  const rows = await db
    .select({ id: schema.scoringSkills.id })
    .from(schema.scoringSkills)
    .where(and(eq(schema.scoringSkills.userId, userId), eq(schema.scoringSkills.status, 'active')));
  return rows.length;
}

async function assertCanDeactivateSkill(userId: string, skillId: number) {
  const activeCount = await countActiveSkills(userId);
  if (activeCount <= 1) {
    throw new Error(LAST_ACTIVE_SKILL_ERROR);
  }
  const current = await getSkillById(userId, skillId);
  if (!current) return null;
  return current;
}

export async function createScoringSkill(userId: string, input: CreateSkillInput = {}) {
  const created = await db.insert(schema.scoringSkills).values({
    userId,
    name: input.name?.trim() || '新的评分技能',
    description: input.description?.trim() || null,
    presetKey: input.presetKey || null,
    status: input.status || 'draft',
    weight: normalizeWeight(input.weight),
    instructionPrompt: input.instructionPrompt?.trim() || defaultSkillPrompt(input.presetKey),
    rubricJson: input.rubricJson || defaultSkillRubric(input.presetKey),
    modelConfigId: input.modelConfigId || null,
    isDefault: input.isDefault ?? false,
  }).returning();
  return created[0];
}

export async function updateScoringSkill(userId: string, id: number, input: Partial<CreateSkillInput>) {
  const current = await getSkillById(userId, id);
  if (!current) return null;
  if (input.status !== undefined && current.status === 'active' && input.status !== 'active') {
    await assertCanDeactivateSkill(userId, id);
  }

  const update: Record<string, unknown> = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined) update.name = input.name?.trim() || '未命名技能';
  if (input.description !== undefined) update.description = input.description?.trim() || null;
  if (input.presetKey !== undefined) update.presetKey = input.presetKey || null;
  if (input.status !== undefined) update.status = input.status;
  if (input.weight !== undefined) update.weight = normalizeWeight(input.weight);
  if (input.instructionPrompt !== undefined) update.instructionPrompt = input.instructionPrompt?.trim() || defaultSkillPrompt(input.presetKey ?? current.presetKey as SkillPresetKey | null);
  if (input.rubricJson !== undefined) update.rubricJson = input.rubricJson || defaultSkillRubric(input.presetKey ?? current.presetKey as SkillPresetKey | null);
  if (input.modelConfigId !== undefined) update.modelConfigId = input.modelConfigId || null;
  if (input.isDefault !== undefined) update.isDefault = input.isDefault;

  const rows = await db
    .update(schema.scoringSkills)
    .set(update)
    .where(eq(schema.scoringSkills.id, id))
    .returning();
  return rows[0] || null;
}

export async function toggleScoringSkill(userId: string, id: number) {
  const current = await getSkillById(userId, id);
  if (!current) return null;
  if (current.status === 'active') {
    await assertCanDeactivateSkill(userId, id);
  }
  const nextStatus: SkillStatus = current.status === 'active' ? 'draft' : 'active';
  return updateScoringSkill(userId, id, { status: nextStatus });
}

export async function deleteScoringSkill(userId: string, id: number) {
  const current = await getSkillById(userId, id);
  if (!current) return null;
  if (current.status === 'active') {
    await assertCanDeactivateSkill(userId, id);
  }
  const rows = await db
    .delete(schema.scoringSkills)
    .where(and(eq(schema.scoringSkills.id, id), eq(schema.scoringSkills.userId, userId)))
    .returning();
  return rows[0] || null;
}

export async function getLatestItemFeedback(userId: string, itemId: string) {
  const rows = await db
    .select()
    .from(schema.itemFeedback)
    .where(and(eq(schema.itemFeedback.userId, userId), eq(schema.itemFeedback.itemId, itemId)))
    .orderBy(desc(schema.itemFeedback.createdAt), desc(schema.itemFeedback.id))
    .limit(1);
  return rows[0] || null;
}

export async function getItemScoreBreakdowns(userId: string, itemId: string) {
  return db
    .select({
      id: schema.itemScoreBreakdowns.id,
      itemId: schema.itemScoreBreakdowns.itemId,
      userId: schema.itemScoreBreakdowns.userId,
      skillId: schema.itemScoreBreakdowns.skillId,
      score: schema.itemScoreBreakdowns.score,
      confidence: schema.itemScoreBreakdowns.confidence,
      decision: schema.itemScoreBreakdowns.decision,
      reasons: schema.itemScoreBreakdowns.reasons,
      matchedSignals: schema.itemScoreBreakdowns.matchedSignals,
      riskFlags: schema.itemScoreBreakdowns.riskFlags,
      rawResponse: schema.itemScoreBreakdowns.rawResponse,
      createdAt: schema.itemScoreBreakdowns.createdAt,
      skillName: schema.scoringSkills.name,
      skillWeight: schema.scoringSkills.weight,
      skillStatus: schema.scoringSkills.status,
    })
    .from(schema.itemScoreBreakdowns)
    .leftJoin(schema.scoringSkills, eq(schema.itemScoreBreakdowns.skillId, schema.scoringSkills.id))
    .where(and(eq(schema.itemScoreBreakdowns.userId, userId), eq(schema.itemScoreBreakdowns.itemId, itemId)))
    .orderBy(desc(schema.itemScoreBreakdowns.score), asc(schema.itemScoreBreakdowns.id));
}

function toSignalCounts(entries: string[]) {
  const map = new Map<string, number>();
  for (const entry of entries) {
    const key = entry.trim();
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value]) => value)
    .slice(0, 8);
}

export async function rebuildPreferenceProfile(userId: string) {
  const feedbackRows = await db
    .select({
      feedbackType: schema.itemFeedback.feedbackType,
      reasonTags: schema.itemFeedback.reasonTags,
      createdAt: schema.itemFeedback.createdAt,
      aiTags: schema.items.aiTags,
      sourceCategory: schema.sources.category,
      title: schema.items.title,
    })
    .from(schema.itemFeedback)
    .leftJoin(schema.items, eq(schema.itemFeedback.itemId, schema.items.id))
    .leftJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id))
    .where(eq(schema.itemFeedback.userId, userId))
    .orderBy(desc(schema.itemFeedback.createdAt))
    .limit(300);

  const positiveSignals: string[] = [];
  const negativeSignals: string[] = [];
  let lastFeedbackAt: string | null = null;

  for (const row of feedbackRows) {
    if (!lastFeedbackAt && row.createdAt) {
      lastFeedbackAt = row.createdAt.toISOString();
    }
    const tags = [
      ...normalizeJsonArray(row.reasonTags),
      ...normalizeJsonArray(row.aiTags),
      row.sourceCategory ? String(row.sourceCategory) : '',
    ].filter(Boolean);
    if (row.feedbackType === 'like' || row.feedbackType === 'must_read') {
      positiveSignals.push(...tags);
    } else if (row.feedbackType === 'dislike' || row.feedbackType === 'not_for_me') {
      negativeSignals.push(...tags);
    }
  }

  const focusTopics = toSignalCounts(positiveSignals);
  const avoidTopics = toSignalCounts(negativeSignals);
  const summaryParts: string[] = [];
  if (focusTopics.length > 0) summaryParts.push(`更偏好：${focusTopics.slice(0, 5).join('、')}`);
  if (avoidTopics.length > 0) summaryParts.push(`尽量减少：${avoidTopics.slice(0, 5).join('、')}`);
  if (summaryParts.length === 0) summaryParts.push(`默认关注：${DEFAULT_REASON_TAGS.join('、')}`);
  const profileSummary = summaryParts.join('；');

  const rows = await db.insert(schema.userPreferenceProfiles).values({
    userId,
    profileSummary,
    positiveSignals: focusTopics,
    negativeSignals: avoidTopics,
    focusTopics,
    avoidTopics,
    updatedFromFeedbackAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: schema.userPreferenceProfiles.userId,
    set: {
      profileSummary,
      positiveSignals: focusTopics,
      negativeSignals: avoidTopics,
      focusTopics,
      avoidTopics,
      updatedFromFeedbackAt: new Date(),
      updatedAt: new Date(),
    },
  }).returning();

  const feedbackSummary: FeedbackSummary = {
    totalFeedback: feedbackRows.length,
    positiveCount: feedbackRows.filter((row) => row.feedbackType === 'like' || row.feedbackType === 'must_read').length,
    negativeCount: feedbackRows.filter((row) => row.feedbackType === 'dislike' || row.feedbackType === 'not_for_me').length,
    topPositiveTags: focusTopics,
    topNegativeTags: avoidTopics,
    lastFeedbackAt,
  };

  return {
    profile: rows[0] || null,
    feedbackSummary,
  };
}

export async function rebuildStalePreferenceProfiles(limit = 100) {
  const feedbackUsers = await db
    .select({
      userId: schema.itemFeedback.userId,
      lastFeedbackAt: max(schema.itemFeedback.createdAt),
    })
    .from(schema.itemFeedback)
    .groupBy(schema.itemFeedback.userId);

  if (feedbackUsers.length === 0) {
    return { rebuilt: 0, totalCandidates: 0 };
  }

  const profileRows = await db
    .select({
      userId: schema.userPreferenceProfiles.userId,
      updatedFromFeedbackAt: schema.userPreferenceProfiles.updatedFromFeedbackAt,
    })
    .from(schema.userPreferenceProfiles)
    .where(inArray(schema.userPreferenceProfiles.userId, feedbackUsers.map((row) => row.userId)));
  const profileMap = new Map(profileRows.map((row) => [row.userId, row.updatedFromFeedbackAt]));

  const staleUsers = feedbackUsers
    .filter((row) => {
      if (!row.lastFeedbackAt) return false;
      const updatedAt = profileMap.get(row.userId);
      return !updatedAt || row.lastFeedbackAt > updatedAt;
    })
    .sort((left, right) => {
      const leftMs = left.lastFeedbackAt?.getTime() || 0;
      const rightMs = right.lastFeedbackAt?.getTime() || 0;
      return rightMs - leftMs;
    })
    .slice(0, limit);

  for (const row of staleUsers) {
    await rebuildPreferenceProfile(row.userId);
  }

  return {
    rebuilt: staleUsers.length,
    totalCandidates: feedbackUsers.length,
  };
}

export async function getPreferenceProfile(userId: string) {
  const rows = await db
    .select()
    .from(schema.userPreferenceProfiles)
    .where(eq(schema.userPreferenceProfiles.userId, userId))
    .limit(1);
  const profile = rows[0] || null;

  const feedbackRows = await db
    .select({
      feedbackType: schema.itemFeedback.feedbackType,
      reasonTags: schema.itemFeedback.reasonTags,
      createdAt: schema.itemFeedback.createdAt,
    })
    .from(schema.itemFeedback)
    .where(eq(schema.itemFeedback.userId, userId))
    .orderBy(desc(schema.itemFeedback.createdAt))
    .limit(100);

  return {
    profile,
    feedbackSummary: {
      totalFeedback: feedbackRows.length,
      positiveCount: feedbackRows.filter((row) => row.feedbackType === 'like' || row.feedbackType === 'must_read').length,
      negativeCount: feedbackRows.filter((row) => row.feedbackType === 'dislike' || row.feedbackType === 'not_for_me').length,
      topPositiveTags: profile ? normalizeJsonArray(profile.focusTopics) : [],
      topNegativeTags: profile ? normalizeJsonArray(profile.avoidTopics) : [],
      lastFeedbackAt: feedbackRows[0]?.createdAt?.toISOString() || null,
    } satisfies FeedbackSummary,
  };
}

export function buildSkillPrompt(input: {
  skill: ScoringSkillRecord;
  profileSummary?: string | null;
  title: string;
  content: string;
}) {
  const rubric = JSON.stringify(input.skill.rubricJson || defaultSkillRubric(), null, 2);
  const profileSummary = input.profileSummary?.trim() || `默认关注：${DEFAULT_REASON_TAGS.join('、')}`;
  return [
    '输出硬约束：只返回一行 JSON；不要输出 Markdown、代码块、解释、前后缀或额外文本；每个数组最多 3 项，每项不超过 18 个字。',
    'JSON 形状必须是：{"score":0-100,"confidence":0-1,"decision":"must_read|worth_read|skip|noise","reasons":["..."],"matchedSignals":["..."],"riskFlags":["..."]}',
    `技能名称：${input.skill.name}`,
    input.skill.description ? `技能定位：${input.skill.description}` : '',
    `用户偏好画像：${profileSummary}`,
    '技能说明：',
    input.skill.instructionPrompt || defaultSkillPrompt(),
    '评分 rubric：',
    rubric,
    `标题：${input.title}`,
    `内容：${input.content}`,
  ].filter(Boolean).join('\n\n');
}

export function extractJsonPayload(text: string) {
  const trimmed = (text || '').trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced?.[1] || trimmed).trim();
}

export function parseSkillResponse(text: string) {
  const raw = extractJsonPayload(text);
  if (!raw.trim()) {
    throw new Error('empty_scoring_skill_response');
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const score = typeof parsed.score === 'number'
      ? Math.min(100, Math.max(0, parsed.score))
      : Number(String(parsed.score || '').match(/\d{1,3}/)?.[0] || 50);
    const confidence = typeof parsed.confidence === 'number'
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.6;
    return {
      score,
      confidence,
      decision: String(parsed.decision || 'worth_read'),
      reasons: normalizeJsonArray(parsed.reasons),
      matchedSignals: normalizeJsonArray(parsed.matchedSignals),
      riskFlags: normalizeJsonArray(parsed.riskFlags),
      rawResponse: raw,
    };
  } catch {
    const score = Number(raw.match(/\d{1,3}/)?.[0] || 50);
    return {
      score: Math.min(100, Math.max(0, score)),
      confidence: 0.4,
      decision: score >= 80 ? 'must_read' : score >= 60 ? 'worth_read' : score >= 35 ? 'skip' : 'noise',
      reasons: [raw.slice(0, 160)].filter(Boolean),
      matchedSignals: [],
      riskFlags: [],
      rawResponse: raw,
    };
  }
}

export function aggregateSkillScores(results: Array<{ score: number; confidence: number; weight: number }>) {
  if (results.length === 0) return null;
  const weighted = results.map((item) => ({
    score: item.score,
    effectiveWeight: Math.max(0.1, item.weight) * Math.max(0.35, item.confidence),
  }));
  const totalWeight = weighted.reduce((sum, item) => sum + item.effectiveWeight, 0);
  if (totalWeight <= 0) return null;
  const score = weighted.reduce((sum, item) => sum + item.score * item.effectiveWeight, 0) / totalWeight;
  return Number(score.toFixed(2));
}

export function buildSkillFailureSummary(errors: string[]) {
  const uniqueErrors = [...new Set(errors.map((error) => String(error || '').trim()).filter(Boolean))];
  if (uniqueErrors.length === 0) return '';
  return `partial_scoring_skill_failures:${uniqueErrors.slice(0, 3).join(',')}`;
}

export type ScoringSkillHealthEvent = {
  status?: string | null;
  label?: string | null;
  errorMessage?: string | null;
  targetId?: string | null;
  modelName?: string | null;
  modelConfigId?: string | null;
  createdAt?: Date | string | null;
};

export type ScoringSkillHealthSummary = {
  status: 'healthy' | 'warning' | 'error';
  totalSkillCount: number;
  activeSkillCount: number;
  recentErrorCount: number;
  emptyResponseCount: number;
  deterministicFallbackCount: number;
  retryRecoveredCount: number;
  unstableModelCount: number;
  lastErrorAt: string | null;
  activeSkills: Array<{
    id: number;
    name: string;
    presetKey: string | null;
    weight: number;
    modelConfigId: string | null;
  }>;
  recentErrors: Array<{
    skillName: string;
    message: string;
    targetId: string | null;
    modelName: string | null;
    modelConfigId: string | null;
    createdAt: string | null;
  }>;
  unstableModels: Array<{
    modelKey: string;
    modelName: string | null;
    modelConfigId: string | null;
    retryableFailureCount: number;
    retryRecoveredCount: number;
    deterministicFallbackCount: number;
    lastFailureAt: string | null;
    circuitBreakerRecommended: boolean;
  }>;
  recommendations: string[];
};

export type ScoringModelCircuitBreakerDecision = {
  shouldBypass: boolean;
  modelKey: string | null;
  modelName: string | null;
  modelConfigId: string | null;
  retryableFailureCount: number;
  retryRecoveredCount: number;
  deterministicFallbackCount: number;
  reason: string | null;
};

const SCORING_MODEL_RECOVERY_SUCCESS_STREAK = 3;

export type ScoringModelRemediationInput = {
  currentModelConfigId?: string | null;
  unstableModels: ScoringSkillHealthSummary['unstableModels'];
  probeEvents?: ScoringSkillHealthEvent[];
  availableModels: Array<{
    id: string;
    alias?: string | null;
    provider?: string | null;
    modelName?: string | null;
    modelType?: string | null;
    isActive?: boolean | null;
    isDefault?: boolean | null;
    testStatus?: string | null;
  }>;
};

export type ScoringModelRemediation = {
  action: 'none' | 'switch_model' | 'repair_config';
  currentModelConfigId: string | null;
  recommendedModelConfigId: string | null;
  message: string;
  candidateModels: Array<{
    id: string;
    label: string;
    provider: string | null;
    modelName: string | null;
    testStatus: string | null;
    isDefault: boolean;
  }>;
};

export type ScoringModelProbeResult = {
  itemId: string;
  title: string;
  ok: boolean;
  score?: number | null;
  decision?: string | null;
  confidence?: number | null;
  error?: string | null;
};

export type ScoringModelProbeSummary = {
  status: 'passed' | 'failed' | 'empty';
  canSwitch: boolean;
  modelConfigId: string;
  modelLabel: string;
  probed: number;
  passed: number;
  failed: number;
  firstError: string | null;
  message: string;
  results: ScoringModelProbeResult[];
};

export type ScoringModelRepairSummary = {
  status: 'recovered' | 'failed' | 'empty';
  canContinueBatchRepair: boolean;
  modelConfigId: string;
  modelLabel: string;
  attempted: number;
  recovered: number;
  failed: number;
  skipped: number;
  recoveryRate: number;
  firstError: string | null;
  itemIds: string[];
  message: string;
};

export const FALLBACK_SCORING_RISK_FLAGS = [
  'deterministic_fallback',
  'model_circuit_breaker',
  'ai_scoring_unavailable',
] as const;

export type FallbackScoringRecoverySummary = {
  status: 'recovered' | 'partial' | 'failed' | 'empty' | 'blocked';
  candidateCount: number;
  attempted: number;
  recovered: number;
  failed: number;
  skipped: number;
  remainingCandidateCount: number;
  recoveryRate: number;
  firstError: string | null;
  itemIds: string[];
  verifiedRecoveredItemIds: string[];
  message: string;
};

export function canRecoverFallbackScoringItems(role?: string | null) {
  return role === 'user' || role === 'admin';
}

export function isFallbackScoringRecoveryStatus(status?: string | null) {
  return status === 'scored' || status === 'done';
}

export function normalizeFallbackScoringRecoveryRequest(input: unknown): { limit: number; itemIds: string[] } {
  const body = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const seen = new Set<string>();
  const itemIds = Array.isArray(body.itemIds)
    ? body.itemIds
      .map((value) => String(value || '').trim())
      .filter((value) => {
        if (!value || seen.has(value)) return false;
        seen.add(value);
        return true;
      })
      .slice(0, 20)
    : [];
  const requestedLimit = Number(body.limit || (itemIds.length > 0 ? itemIds.length : 3));
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 3, 1), 20);
  return {
    limit,
    itemIds: itemIds.slice(0, limit),
  };
}

function toIsoString(value?: Date | string | null) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function buildScoringSkillHealthSummary(
  skills: Array<Pick<ScoringSkillRecord, 'id' | 'name' | 'presetKey' | 'status' | 'weight' | 'modelConfigId'>>,
  events: ScoringSkillHealthEvent[] = [],
): ScoringSkillHealthSummary {
  const activeSkills = skills
    .filter((skill) => skill.status === 'active')
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      presetKey: skill.presetKey || null,
      weight: Number(skill.weight || 1),
      modelConfigId: skill.modelConfigId || null,
    }));
  const recentErrors = events
    .filter((event) => event.status === 'error' || Boolean(event.errorMessage))
    .map((event) => ({
      skillName: event.label || '未知评分 Skill',
      message: event.errorMessage || 'unknown_scoring_skill_error',
      targetId: event.targetId || null,
      modelName: event.modelName || null,
      modelConfigId: event.modelConfigId || null,
      createdAt: toIsoString(event.createdAt),
    }))
    .sort((left, right) => {
      const leftMs = left.createdAt ? new Date(left.createdAt).getTime() : 0;
      const rightMs = right.createdAt ? new Date(right.createdAt).getTime() : 0;
      return rightMs - leftMs;
    })
    .slice(0, 10);
  const emptyResponseCount = recentErrors.filter((event) => event.message.includes('empty_scoring_skill_response')).length;
  const deterministicFallbackCount = recentErrors.filter((event) => (
    event.skillName.includes('deterministic fallback scoring')
    || event.message.includes('deterministic_fallback_scoring')
  )).length;
  const retryRecoveredCount = events.filter((event) => (
    event.status === 'success'
    && String(event.label || '').includes('retry recovered')
  )).length;
  const modelBuckets = new Map<string, {
    modelKey: string;
    modelName: string | null;
    modelConfigId: string | null;
    retryableFailureCount: number;
    retryRecoveredCount: number;
    deterministicFallbackCount: number;
    lastFailureAt: string | null;
    recoverySuccessStreak: number;
  }>();
  const getModelBucket = (event: ScoringSkillHealthEvent) => {
    const modelConfigId = event.modelConfigId || null;
    const modelName = event.modelName || null;
    const modelKey = modelConfigId || modelName || 'unknown_model';
    const existing = modelBuckets.get(modelKey);
    if (existing) return existing;
    const next = {
      modelKey,
      modelName,
      modelConfigId,
      retryableFailureCount: 0,
      retryRecoveredCount: 0,
      deterministicFallbackCount: 0,
      lastFailureAt: null,
      recoverySuccessStreak: 0,
    };
    modelBuckets.set(modelKey, next);
    return next;
  };

  const orderedEvents = [...events].sort((left, right) => {
    const leftMs = toIsoString(left.createdAt) ? new Date(toIsoString(left.createdAt) || '').getTime() : 0;
    const rightMs = toIsoString(right.createdAt) ? new Date(toIsoString(right.createdAt) || '').getTime() : 0;
    return leftMs - rightMs;
  });

  for (const event of orderedEvents) {
    const message = event.errorMessage || '';
    const label = event.label || '';
    const bucket = getModelBucket(event);
    const createdAt = toIsoString(event.createdAt);
    const isFailure = isRetryableScoringFailure(message) || label.includes('retryable failure') || label.includes('retry failed');
    if (isRetryableScoringFailure(message) || label.includes('retryable failure') || label.includes('retry failed')) {
      bucket.retryableFailureCount += 1;
      if (createdAt && (!bucket.lastFailureAt || new Date(createdAt).getTime() > new Date(bucket.lastFailureAt).getTime())) {
        bucket.lastFailureAt = createdAt;
      }
      bucket.recoverySuccessStreak = 0;
    }
    if (event.status === 'success' && label.includes('retry recovered')) {
      bucket.retryRecoveredCount += 1;
    }
    if (label.includes('deterministic fallback scoring') || message.includes('deterministic_fallback_scoring')) {
      bucket.deterministicFallbackCount += 1;
      if (createdAt && (!bucket.lastFailureAt || new Date(createdAt).getTime() > new Date(bucket.lastFailureAt).getTime())) {
        bucket.lastFailureAt = createdAt;
      }
      bucket.recoverySuccessStreak = 0;
    }
    if (!isFailure && event.status === 'success' && !event.errorMessage && bucket.lastFailureAt && createdAt) {
      if (new Date(createdAt).getTime() > new Date(bucket.lastFailureAt).getTime()) {
        bucket.recoverySuccessStreak += 1;
      }
    }
  }
  const unstableModels = [...modelBuckets.values()]
    .map((bucket) => ({
      ...bucket,
      circuitBreakerRecommended: (
        bucket.recoverySuccessStreak < SCORING_MODEL_RECOVERY_SUCCESS_STREAK
        && (bucket.retryableFailureCount >= 3 || bucket.deterministicFallbackCount >= 1)
      ),
    }))
    .filter((bucket) => bucket.circuitBreakerRecommended)
    .sort((left, right) => {
      const failureDiff = right.retryableFailureCount - left.retryableFailureCount;
      if (failureDiff !== 0) return failureDiff;
      const rightMs = right.lastFailureAt ? new Date(right.lastFailureAt).getTime() : 0;
      const leftMs = left.lastFailureAt ? new Date(left.lastFailureAt).getTime() : 0;
      return rightMs - leftMs;
    })
    .slice(0, 5);
  const recommendations: string[] = [];

  if (activeSkills.length === 0) {
    recommendations.push('启用至少 1 个评分 Skill，否则 Feed 精选只能退回基础规则。');
  }
  if (emptyResponseCount > 0) {
    recommendations.push('近期有评分 Skill 返回空响应，优先检查模型绑定、输出 JSON 约束和该模型是否适合结构化评分。');
  }
  if (recentErrors.length > emptyResponseCount) {
    recommendations.push('近期存在非空响应类评分错误，建议查看失败条目的 Feed 详情并重跑评分。');
  }
  if (deterministicFallbackCount > 0) {
    recommendations.push('系统已用确定性低置信兜底接住部分评分失败；这类条目不会卡死，但仍建议修复模型输出稳定性。');
  }
  if (retryRecoveredCount > 0) {
    recommendations.push('近期有评分失败通过紧凑 JSON 重试恢复，说明模型可用但输出稳定性仍需观察。');
  }
  if (unstableModels.length > 0) {
    recommendations.push('已有评分模型达到熔断观察阈值，建议暂停或切换评分模型，并降低该模型进入日报链路的信任度。');
  }
  if (recommendations.length === 0) {
    recommendations.push('评分 Skill 近期未发现错误，继续用 Feed 反馈校准偏好画像。');
  }

  return {
    status: activeSkills.length === 0 ? 'error' : recentErrors.length > 0 ? 'warning' : 'healthy',
    totalSkillCount: skills.length,
    activeSkillCount: activeSkills.length,
    recentErrorCount: recentErrors.length,
    emptyResponseCount,
    deterministicFallbackCount,
    retryRecoveredCount,
    unstableModelCount: unstableModels.length,
    lastErrorAt: recentErrors[0]?.createdAt || null,
    activeSkills,
    recentErrors,
    unstableModels,
    recommendations,
  };
}

export function resolveScoringModelCircuitBreaker(
  model: { modelConfigId?: string | null; modelName?: string | null },
  events: ScoringSkillHealthEvent[] = [],
): ScoringModelCircuitBreakerDecision {
  const modelConfigId = model.modelConfigId || null;
  const modelName = model.modelName || null;
  const modelKey = modelConfigId || modelName || null;
  const health = buildScoringSkillHealthSummary([], events);
  const unstableModel = health.unstableModels.find((entry) => {
    if (modelConfigId && entry.modelConfigId === modelConfigId) return true;
    if (!modelConfigId && modelName && entry.modelName === modelName) return true;
    return false;
  });
  const modelEvents = events.filter((event) => (
    (modelConfigId && event.modelConfigId === modelConfigId)
    || (modelName && event.modelName === modelName)
  ));
  const latestProbeSuccessAt = modelEvents
    .filter((event) => event.status === 'success' && String(event.label || '').includes('scoring model probe'))
    .map((event) => toIsoString(event.createdAt))
    .filter(Boolean)
    .sort()
    .at(-1) || null;

  if (!unstableModel) {
    return {
      shouldBypass: false,
      modelKey,
      modelName,
      modelConfigId,
      retryableFailureCount: 0,
      retryRecoveredCount: 0,
      deterministicFallbackCount: 0,
      reason: null,
    };
  }
  if (latestProbeSuccessAt && unstableModel.lastFailureAt && new Date(latestProbeSuccessAt).getTime() > new Date(unstableModel.lastFailureAt).getTime()) {
    return {
      shouldBypass: false,
      modelKey,
      modelName,
      modelConfigId,
      retryableFailureCount: unstableModel.retryableFailureCount,
      retryRecoveredCount: unstableModel.retryRecoveredCount,
      deterministicFallbackCount: unstableModel.deterministicFallbackCount,
      reason: null,
    };
  }

  const reason = [
    '评分模型近期不稳定，已触发运行时熔断并改用低置信确定性评分。',
    `retryable_failures=${unstableModel.retryableFailureCount}`,
    `deterministic_fallbacks=${unstableModel.deterministicFallbackCount}`,
  ].join(' ');

  return {
    shouldBypass: true,
    modelKey: unstableModel.modelKey,
    modelName: unstableModel.modelName,
    modelConfigId: unstableModel.modelConfigId,
    retryableFailureCount: unstableModel.retryableFailureCount,
    retryRecoveredCount: unstableModel.retryRecoveredCount,
    deterministicFallbackCount: unstableModel.deterministicFallbackCount,
    reason,
  };
}

export function buildScoringModelRemediation(input: ScoringModelRemediationInput): ScoringModelRemediation {
  const currentModelConfigId = input.currentModelConfigId || null;
  const unstableKeys = new Set(input.unstableModels.flatMap((model) => [
    model.modelKey,
    model.modelConfigId || '',
    model.modelName || '',
  ].filter(Boolean)));
  const currentIsUnstable = Boolean(
    input.unstableModels.length > 0
    && (!currentModelConfigId || unstableKeys.has(currentModelConfigId)),
  );
  const probeBuckets = new Map<string, { passed: number; failed: number; lastAt: string | null }>();
  const latestProbeSuccessByKey = new Map<string, string>();
  for (const event of input.probeEvents || []) {
    const keys = [
      event.modelConfigId || '',
      event.modelName || '',
    ].filter(Boolean);
    if (keys.length === 0) continue;
    const createdAt = toIsoString(event.createdAt);
    for (const key of keys) {
      const bucket = probeBuckets.get(key) || { passed: 0, failed: 0, lastAt: null };
      if (event.status === 'success') {
        bucket.passed += 1;
        if (createdAt && (!latestProbeSuccessByKey.get(key) || new Date(createdAt).getTime() > new Date(latestProbeSuccessByKey.get(key) || 0).getTime())) {
          latestProbeSuccessByKey.set(key, createdAt);
        }
      }
      if (event.status === 'error' || event.errorMessage) bucket.failed += 1;
      if (createdAt && (!bucket.lastAt || new Date(createdAt).getTime() > new Date(bucket.lastAt).getTime())) {
        bucket.lastAt = createdAt;
      }
      probeBuckets.set(key, bucket);
    }
  }
  const failedProbeKeys = new Set<string>();
  for (const [key, bucket] of probeBuckets.entries()) {
    if (bucket.failed > 0 && bucket.passed === 0) failedProbeKeys.add(key);
  }
  const isModelStillUnstable = (model: { id: string; modelName?: string | null }) => {
    const matched = input.unstableModels.find((entry) => (
      entry.modelKey === model.id
      || entry.modelConfigId === model.id
      || Boolean(model.modelName && (entry.modelKey === model.modelName || entry.modelName === model.modelName))
    ));
    if (!matched) return false;
    const latestProbeSuccess = latestProbeSuccessByKey.get(model.id) || (model.modelName ? latestProbeSuccessByKey.get(model.modelName) : null);
    if (!latestProbeSuccess) return true;
    if (!matched.lastFailureAt) return false;
    return new Date(latestProbeSuccess).getTime() <= new Date(matched.lastFailureAt).getTime();
  };

  if (!currentIsUnstable) {
    return {
      action: 'none',
      currentModelConfigId,
      recommendedModelConfigId: null,
      message: '评分模型暂未触发治理动作。',
      candidateModels: [],
    };
  }

  const candidateModels = input.availableModels
    .filter((model) => model.isActive !== false)
    .filter((model) => String(model.modelType || '').toLowerCase() === 'llm')
    .filter((model) => model.id !== currentModelConfigId)
    .filter((model) => !isModelStillUnstable(model))
    .filter((model) => !failedProbeKeys.has(model.id) && !failedProbeKeys.has(model.modelName || ''))
    .map((model) => {
      const testStatus = model.testStatus || null;
      const testWeight = testStatus === 'passed' ? 0 : testStatus === 'untested' ? 1 : 2;
      return {
        id: model.id,
        label: model.alias || model.modelName || model.id,
        provider: model.provider || null,
        modelName: model.modelName || null,
        testStatus,
        isDefault: Boolean(model.isDefault),
        sortKey: `${testWeight}:${model.isDefault ? 0 : 1}:${model.alias || model.modelName || model.id}`,
      };
    })
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey))
    .map(({ sortKey: _sortKey, ...model }) => model)
    .slice(0, 3);

  if (candidateModels.length > 0) {
    return {
      action: 'switch_model',
      currentModelConfigId,
      recommendedModelConfigId: candidateModels[0]?.id || null,
      message: `当前评分模型已触发熔断，建议切换评分场景到备用模型：${candidateModels[0]?.label || '备用模型'}。`,
      candidateModels,
    };
  }

  return {
    action: 'repair_config',
    currentModelConfigId,
    recommendedModelConfigId: null,
    message: '当前评分模型已触发熔断，但没有可用备用模型；请先新增或测试通过一个 LLM 模型，再恢复评分链路。',
    candidateModels: [],
  };
}

export function buildScoringModelProbeSummary(input: {
  modelConfigId: string;
  modelLabel?: string | null;
  results: ScoringModelProbeResult[];
}): ScoringModelProbeSummary {
  const results = input.results;
  const passed = results.filter((result) => result.ok).length;
  const failed = results.length - passed;
  const firstError = results.find((result) => !result.ok)?.error || null;
  const modelLabel = input.modelLabel || input.modelConfigId;
  if (results.length === 0) {
    return {
      status: 'empty',
      canSwitch: false,
      modelConfigId: input.modelConfigId,
      modelLabel,
      probed: 0,
      passed: 0,
      failed: 0,
      firstError: null,
      message: '没有可用于验证的评分失败样本，暂不建议自动切换。',
      results,
    };
  }
  if (passed > 0) {
    return {
      status: 'passed',
      canSwitch: true,
      modelConfigId: input.modelConfigId,
      modelLabel,
      probed: results.length,
      passed,
      failed,
      firstError,
      message: `${modelLabel} 已通过 ${passed}/${results.length} 条评分样本验证，备用模型可用于评分。`,
      results,
    };
  }
  return {
    status: 'failed',
    canSwitch: false,
    modelConfigId: input.modelConfigId,
    modelLabel,
    probed: results.length,
    passed,
    failed,
    firstError,
    message: `${modelLabel} 未通过评分样本验证，暂不建议切换。`,
    results,
  };
}

export function buildScoringModelRepairSummary(input: {
  modelConfigId: string;
  modelLabel?: string | null;
  itemIds: string[];
  scoring: {
    processed: number;
    attempted: number;
    failed: number;
    skipped: number;
    errors: string[];
  };
}): ScoringModelRepairSummary {
  const modelLabel = input.modelLabel || input.modelConfigId;
  const attempted = Number(input.scoring.attempted || input.itemIds.length || 0);
  const recovered = Number(input.scoring.processed || 0);
  const skipped = Number(input.scoring.skipped || 0);
  const failed = Math.max(Number(input.scoring.failed || 0), attempted - recovered - skipped);
  const recoveryRate = attempted > 0 ? Number((recovered / attempted).toFixed(2)) : 0;
  const firstError = input.scoring.errors[0] || null;

  if (attempted === 0) {
    return {
      status: 'empty',
      canContinueBatchRepair: false,
      modelConfigId: input.modelConfigId,
      modelLabel,
      attempted,
      recovered,
      failed,
      skipped,
      recoveryRate,
      firstError,
      itemIds: input.itemIds,
      message: '没有可用于小批量修复的评分失败条目。',
    };
  }

  if (recovered > 0) {
    return {
      status: 'recovered',
      canContinueBatchRepair: recoveryRate >= 0.5,
      modelConfigId: input.modelConfigId,
      modelLabel,
      attempted,
      recovered,
      failed,
      skipped,
      recoveryRate,
      firstError,
      itemIds: input.itemIds,
      message: `${modelLabel} 已恢复 ${recovered}/${attempted} 条评分失败项，恢复率 ${Math.round(recoveryRate * 100)}%。`,
    };
  }

  return {
    status: 'failed',
    canContinueBatchRepair: false,
    modelConfigId: input.modelConfigId,
    modelLabel,
    attempted,
    recovered,
    failed,
    skipped,
    recoveryRate,
    firstError,
    itemIds: input.itemIds,
    message: `${modelLabel} 没有恢复失败条目，暂不建议扩大批量修复。`,
  };
}

export function hasFallbackScoringRiskFlags(flags?: unknown[] | null) {
  if (!Array.isArray(flags)) return false;
  const fallbackFlags = new Set<string>(FALLBACK_SCORING_RISK_FLAGS);
  return flags.some((flag) => fallbackFlags.has(String(flag)));
}

export function buildFallbackScoringRecoverySummary(input: {
  candidateCount: number;
  itemIds: string[];
  verifiedRecoveredItemIds: string[];
  blockedReason?: string | null;
  scoring: {
    processed: number;
    attempted: number;
    failed: number;
    skipped: number;
    errors: string[];
  };
}): FallbackScoringRecoverySummary {
  const candidateCount = Math.max(Number(input.candidateCount || 0), 0);
  const attempted = Number(input.scoring.attempted || input.itemIds.length || 0);
  const recovered = input.verifiedRecoveredItemIds.length;
  const skipped = Number(input.scoring.skipped || 0);
  const failed = Math.max(Number(input.scoring.failed || 0), attempted - recovered - skipped);
  const remainingCandidateCount = Math.max(candidateCount - recovered, 0);
  const recoveryRate = attempted > 0 ? Number((recovered / attempted).toFixed(2)) : 0;
  const firstError = input.blockedReason || input.scoring.errors[0] || null;

  if (input.blockedReason) {
    return {
      status: 'blocked',
      candidateCount,
      attempted,
      recovered,
      failed: 0,
      skipped,
      remainingCandidateCount: candidateCount,
      recoveryRate: 0,
      firstError,
      itemIds: input.itemIds,
      verifiedRecoveredItemIds: input.verifiedRecoveredItemIds,
      message: `${input.blockedReason}；请先切换或修复评分模型，再回收历史兜底评分。`,
    };
  }

  if (candidateCount === 0 || attempted === 0) {
    return {
      status: 'empty',
      candidateCount,
      attempted,
      recovered,
      failed: 0,
      skipped,
      remainingCandidateCount: candidateCount,
      recoveryRate: 0,
      firstError: null,
      itemIds: input.itemIds,
      verifiedRecoveredItemIds: input.verifiedRecoveredItemIds,
      message: '没有历史兜底评分条目需要回收。',
    };
  }

  if (recovered === attempted) {
    return {
      status: 'recovered',
      candidateCount,
      attempted,
      recovered,
      failed: 0,
      skipped,
      remainingCandidateCount,
      recoveryRate,
      firstError,
      itemIds: input.itemIds,
      verifiedRecoveredItemIds: input.verifiedRecoveredItemIds,
      message: `历史兜底评分已用真实 Skill 评分恢复 ${recovered}/${attempted} 条。`,
    };
  }

  if (recovered > 0) {
    return {
      status: 'partial',
      candidateCount,
      attempted,
      recovered,
      failed,
      skipped,
      remainingCandidateCount,
      recoveryRate,
      firstError,
      itemIds: input.itemIds,
      verifiedRecoveredItemIds: input.verifiedRecoveredItemIds,
      message: `历史兜底评分用真实 Skill 评分恢复 ${recovered}/${attempted} 条，剩余条目仍需继续修复或检查失败原因。`,
    };
  }

  return {
    status: 'failed',
    candidateCount,
    attempted,
    recovered,
    failed,
    skipped,
    remainingCandidateCount,
    recoveryRate,
    firstError,
    itemIds: input.itemIds,
    verifiedRecoveredItemIds: input.verifiedRecoveredItemIds,
    message: '历史兜底评分本轮没有恢复，请先检查评分模型健康或失败原因。',
  };
}

export function buildFallbackScoringPrompt(input: { title: string; content: string }) {
  const compactContent = String(input.content || '').trim().slice(0, 1200);
  return [
    'You are a news ranking assistant. Return JSON only.',
    'Score whether this item is worth reading for an AI/product/technology intelligence feed.',
    'Use this exact JSON shape:',
    '{"score":0-100,"confidence":0-1,"decision":"must_read|worth_read|skip|noise","reasons":["..."],"matchedSignals":["..."],"riskFlags":["..."]}',
    '',
    `Title: ${input.title}`,
    `Content: ${compactContent || input.title}`,
  ].join('\n');
}

export function isRetryableScoringFailure(message?: string | null) {
  const text = String(message || '').toLowerCase();
  if (!text) return false;
  return text.includes('empty_scoring_skill_response')
    || /\b(408|409|429|500|502|503|504)\b/.test(text)
    || text.includes('timeout')
    || text.includes('temporarily unavailable')
    || text.includes('rate limit');
}

export function buildScoringRetryPrompt(input: {
  title: string;
  content: string;
  failureMessage?: string | null;
}) {
  const compactContent = String(input.content || '').trim().slice(0, 1200);
  return [
    'Retry scoring after failure.',
    `Failure: ${String(input.failureMessage || 'unknown_scoring_failure').slice(0, 180)}`,
    'Return exactly one JSON object. No markdown. No explanation.',
    '{"score":0-100,"confidence":0-1,"decision":"must_read|worth_read|skip|noise","reasons":["..."],"matchedSignals":["..."],"riskFlags":["..."]}',
    'Use conservative scoring. If evidence is weak, choose skip or noise.',
    '',
    `Title: ${input.title}`,
    `Content: ${compactContent || input.title}`,
  ].join('\n');
}

export function buildDeterministicFallbackScore(input: {
  title: string;
  content: string;
  failureSummary?: string | null;
}) {
  const text = `${input.title}\n${input.content}`.trim();
  const contentLength = input.content.trim().length;
  const aiSignal = /(AI|人工智能|大模型|LLM|Agent|智能体|OpenAI|Anthropic|Claude|Gemini|模型|算力|芯片|RAG|MCP|API|SDK)/i.test(text);
  const productSignal = /(发布|上线|推出|release|launch|deploy|runtime|workflow|automation|企业|产品|用户|功能|能力)/i.test(text);
  const noiseSignal = /(股价|行情|财报|融资|估值|广告|促销|招聘|coupon|deal)/i.test(text);
  const lengthScore = contentLength >= 900 ? 8 : contentLength >= 300 ? 5 : contentLength >= 120 ? 2 : -4;
  const signalScore = (aiSignal ? 7 : 0) + (productSignal ? 3 : 0) - (noiseSignal ? 5 : 0);
  const score = Math.min(58, Math.max(contentLength < 80 ? 32 : 40, 40 + lengthScore + signalScore));
  const decision = score >= 62 ? 'worth_read' : score >= 35 ? 'skip' : 'noise';
  const reasons = [
    'AI 评分不可用，系统使用确定性低置信兜底分，避免条目长期卡在评分失败。',
    aiSignal ? '标题或正文包含 AI/模型/Agent 等相关信号，但仍需人工或模型复核。' : '未识别到强 AI/科技信号，默认保守降权。',
    input.failureSummary ? `失败摘要：${String(input.failureSummary).slice(0, 120)}` : '',
  ].filter(Boolean);

  return {
    score,
    confidence: 0.25,
    decision,
    reasons,
    matchedSignals: [
      aiSignal ? 'AI/模型信号' : '',
      productSignal ? '产品/落地信号' : '',
    ].filter(Boolean),
    riskFlags: ['deterministic_fallback', 'ai_scoring_unavailable'],
    rawResponse: JSON.stringify({
      score,
      confidence: 0.25,
      decision,
      reasons,
      matchedSignals: [
        aiSignal ? 'AI/模型信号' : '',
        productSignal ? '产品/落地信号' : '',
      ].filter(Boolean),
      riskFlags: ['deterministic_fallback', 'ai_scoring_unavailable'],
      fallback: 'deterministic_fallback',
    }),
  };
}

export async function replaceItemBreakdowns(userId: string, itemId: string, rows: Array<{
  skillId: number | null;
  score: number;
  confidence: number;
  decision: string;
  reasons: string[];
  matchedSignals: string[];
  riskFlags: string[];
  rawResponse: string;
}>) {
  await db.delete(schema.itemScoreBreakdowns).where(and(
    eq(schema.itemScoreBreakdowns.userId, userId),
    eq(schema.itemScoreBreakdowns.itemId, itemId),
  ));
  if (rows.length === 0) return;

  await db.insert(schema.itemScoreBreakdowns).values(rows.map((row) => ({
    itemId,
    userId,
    skillId: row.skillId,
    score: row.score,
    confidence: row.confidence,
    decision: row.decision,
    reasons: row.reasons,
    matchedSignals: row.matchedSignals,
    riskFlags: row.riskFlags,
    rawResponse: row.rawResponse,
  })));
}

export async function getSkillModelOverrides(userId: string) {
  const rows = await db
    .select()
    .from(schema.scoringSkills)
    .where(and(eq(schema.scoringSkills.userId, userId), inArray(schema.scoringSkills.status, ['active', 'draft'])));
  return rows;
}
