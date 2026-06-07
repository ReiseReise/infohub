export type ExcludedCandidateRepairStage = 'content' | 'quality' | 'scoring' | 'summary' | 'translation' | 'all';

export type ExcludedCandidateRepairAction = {
  stage: ExcludedCandidateRepairStage | null;
  label: string;
  hint: string;
  canRun: boolean;
};

export type ExcludedCandidateRepairInput = {
  id: string;
  reason: string;
  detail?: string | null;
};

export type ExcludedCandidateRepairJob = {
  itemId: string;
  stage: ExcludedCandidateRepairStage;
  label: string;
};

export type ExcludedCandidateRepairResponse = {
  matched: number;
  content?: number;
  quality?: number;
  scored: number;
  summarized: number;
  translated: number;
  skipped?: Partial<Record<'quality' | 'scoring' | 'summary' | 'translation', number>>;
  errors?: Record<string, string[]>;
};

export type ExcludedCandidateRepairRun = ExcludedCandidateRepairJob & {
  title?: string | null;
  response: ExcludedCandidateRepairResponse;
};

export type ExcludedCandidateRepairProblemItem = {
  itemId: string;
  title?: string | null;
  label: string;
  stage: ExcludedCandidateRepairStage;
  messages: string[];
};

export type RepairProblemAction =
  | { kind: 'retry'; label: string; stage: ExcludedCandidateRepairStage; itemId: string }
  | { kind: 'link'; label: string; href: string };

export type ExcludedCandidateRepairSummary = {
  totalRuns: number;
  matched: number;
  content: number;
  quality: number;
  scored: number;
  summarized: number;
  translated: number;
  skippedTotal: number;
  successfulRuns: number;
  warningRuns: number;
  stageCounts: Partial<Record<ExcludedCandidateRepairStage, number>>;
  problemItems: ExcludedCandidateRepairProblemItem[];
};

export function resolveExcludedCandidateRepairAction(reason: string, detail?: string | null): ExcludedCandidateRepairAction {
  if (reason === 'translation_failed') {
    if (/评分过低|low score|score too low/i.test(detail || '')) {
      return {
        stage: 'scoring',
        label: '重跑评分',
        hint: '当前因低分跳过翻译；先刷新评分，达标后再补翻译。',
        canRun: true,
      };
    }
    return {
      stage: 'translation',
      label: '重跑翻译',
      hint: '重新生成中文译文后再预览候选池。',
      canRun: true,
    };
  }
  if (reason === 'not_chinese') {
    return {
      stage: 'translation',
      label: '补中文材料',
      hint: '优先补翻译；如果仍无中文摘要，再回到 Feed 补正文和摘要。',
      canRun: true,
    };
  }
  if (reason === 'not_selected') {
    return {
      stage: 'scoring',
      label: '重跑评分',
      hint: '刷新 AI 评分和标签后再判断是否达到入报门槛。',
      canRun: true,
    };
  }
  if (reason === 'business_noise') {
    return {
      stage: null,
      label: '查看条目',
      hint: '这是噪声收紧结果，建议先人工查看，不默认重跑 AI。',
      canRun: false,
    };
  }
  return {
    stage: 'all',
    label: '批量修复',
    hint: '重新补齐正文、质检、评分、摘要和翻译后再判断。',
    canRun: true,
  };
}

export function buildExcludedCandidateRepairPlan(
  items: ExcludedCandidateRepairInput[],
  limit = 10,
): ExcludedCandidateRepairJob[] {
  const jobs: ExcludedCandidateRepairJob[] = [];
  for (const item of items) {
    if (jobs.length >= limit) break;
    const action = resolveExcludedCandidateRepairAction(item.reason, item.detail);
    if (!action.canRun || !action.stage) continue;
    jobs.push({ itemId: item.id, stage: action.stage, label: action.label });
  }
  return jobs;
}

function countSkipped(response: ExcludedCandidateRepairResponse): number {
  return Object.values(response.skipped || {}).reduce((total, value) => total + (value || 0), 0);
}

function flattenErrors(response: ExcludedCandidateRepairResponse): string[] {
  return Object.entries(response.errors || {}).flatMap(([stage, messages]) => (
    messages.map((message) => `${stage}: ${message}`)
  ));
}

export function summarizeExcludedCandidateRepairRuns(
  runs: ExcludedCandidateRepairRun[],
): ExcludedCandidateRepairSummary {
  const stageCounts: Partial<Record<ExcludedCandidateRepairStage, number>> = {};
  const problemItems: ExcludedCandidateRepairProblemItem[] = [];
  let matched = 0;
  let content = 0;
  let quality = 0;
  let scored = 0;
  let summarized = 0;
  let translated = 0;
  let skippedTotal = 0;
  let successfulRuns = 0;
  let warningRuns = 0;

  for (const run of runs) {
    stageCounts[run.stage] = (stageCounts[run.stage] || 0) + 1;
    matched += run.response.matched;
    content += run.response.content || 0;
    quality += run.response.quality || 0;
    scored += run.response.scored;
    summarized += run.response.summarized;
    translated += run.response.translated;

    const skipped = countSkipped(run.response);
    const errors = flattenErrors(run.response);
    skippedTotal += skipped;
    const changed = (run.response.content || 0)
      + (run.response.quality || 0)
      + run.response.scored
      + run.response.summarized
      + run.response.translated > 0;
    if (changed && skipped === 0 && errors.length === 0) successfulRuns += 1;
    if (skipped > 0 || errors.length > 0 || run.response.matched === 0) {
      warningRuns += 1;
      problemItems.push({
        itemId: run.itemId,
        title: run.title,
        label: run.label,
        stage: run.stage,
        messages: [
          ...errors,
          ...(skipped > 0 ? [`策略跳过 ${skipped} 次`] : []),
          ...(run.response.matched === 0 ? ['未命中可修复条目'] : []),
        ],
      });
    }
  }

  return {
    totalRuns: runs.length,
    matched,
    content,
    quality,
    scored,
    summarized,
    translated,
    skippedTotal,
    successfulRuns,
    warningRuns,
    stageCounts,
    problemItems,
  };
}

export function resolveRepairProblemActions(problem: ExcludedCandidateRepairProblemItem): RepairProblemAction[] {
  const actions: RepairProblemAction[] = [
    {
      kind: 'retry',
      label: `再次${problem.label}`,
      stage: problem.stage,
      itemId: problem.itemId,
    },
    {
      kind: 'link',
      label: 'Feed 详情',
      href: `/feed/${problem.itemId}`,
    },
  ];
  const messageText = problem.messages.join('\n');
  if (problem.stage === 'scoring' || /empty_scoring_skill_response|scoring/i.test(messageText)) {
    actions.push({
      kind: 'link',
      label: '查看评分配置',
      href: '/settings',
    });
  }
  return actions;
}
