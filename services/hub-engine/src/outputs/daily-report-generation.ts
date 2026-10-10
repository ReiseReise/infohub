import type { DailyReportData } from './daily-report.js';

export type DailyReportModuleTask<T> = {
  key: string;
  enabled: boolean;
  run: () => Promise<T>;
  assign: (result: T) => void;
};

export interface DailyReportModuleFallbacks {
  decision: { markdown: string; bullets: string[] };
  research: { markdown: string; bullets: string[] };
  reading: { markdown: string; bullets: string[] };
}

function normalizeComparableMarkdown(input?: string | null): string {
  return (input || '')
    .replace(/\s+/g, ' ')
    .replace(/[>*#`-]/g, '')
    .trim();
}

export function ensureDistinctDailyReportModules(
  modules: DailyReportData['modules'],
  fallbacks: DailyReportModuleFallbacks,
) {
  const seen = new Map<string, keyof DailyReportData['modules']>();
  (['decision', 'research', 'reading'] as const).forEach((key) => {
    const module = modules[key];
    if (!module?.markdown?.trim()) {
      if (module) {
        module.markdown = fallbacks[key].markdown;
        module.bullets = fallbacks[key].bullets;
        module.meta = { ...module.meta, status: 'fallback', error: module.meta?.error || 'empty_module_markdown' };
      }
      return;
    }
    const normalized = normalizeComparableMarkdown(module.markdown);
    const existingKey = seen.get(normalized);
    if (existingKey) {
      module.markdown = fallbacks[key].markdown;
      module.bullets = fallbacks[key].bullets;
      module.meta = { ...module.meta, status: 'fallback', error: 'duplicate_module_output' };
      return;
    }
    seen.set(normalized, key);
  });
}

export async function runDailyReportModuleTasksService<T>(tasks: DailyReportModuleTask<T>[]): Promise<void> {
  await Promise.all(
    tasks
      .filter((task) => task.enabled)
      .map(async (task) => {
        const result = await task.run();
        task.assign(result);
      }),
  );
}

export function buildDailyReportInsightConflictUpdateService(input: {
  summary: string;
  itemCount: number;
  topics: unknown;
  payload: unknown;
  pipelineVersion: number;
}) {
  return {
    summary: input.summary,
    itemCount: input.itemCount,
    topics: input.topics,
    payload: input.payload,
    pipelineVersion: input.pipelineVersion,
    generatedAt: new Date(),
  };
}
