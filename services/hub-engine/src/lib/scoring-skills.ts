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
