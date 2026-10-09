import { resolveDailyReportDeliveryDecision } from './daily-report-quality.js';

export function resolveSavedDailyReportMarkdown(input: {
  payload?: unknown;
  summary?: string | null;
}) {
  const payload = input.payload && typeof input.payload === 'object'
    ? input.payload as Record<string, unknown>
    : {};
  const markdown = typeof payload.markdown === 'string' ? payload.markdown.trim() : '';
  if (markdown) return markdown;
  return String(input.summary || '').trim();
}

export type SavedDailyReportMarkdownExportResult =
  | { status: 'full'; httpStatus: 200; markdown: string }
  | { status: 'degraded'; httpStatus: 409; error: string; qualityReasons: string[] }
  | { status: 'missing'; httpStatus: 404; error: string };

export function resolveSavedDailyReportMarkdownExport(input?: {
  payload?: unknown;
  summary?: string | null;
} | null): SavedDailyReportMarkdownExportResult {
  if (!input) {
    return { status: 'missing', httpStatus: 404, error: 'No saved daily report available' };
  }
  const delivery = resolveDailyReportDeliveryDecision(
    input.payload as Parameters<typeof resolveDailyReportDeliveryDecision>[0],
  );
  if (!delivery.allowAutomaticFormalExport) {
    return {
      status: 'degraded',
      httpStatus: 409,
      error: '日报未通过完整质量门禁，不能导出为正式 Markdown。',
      qualityReasons: delivery.quality.reasons,
    };
  }
  const markdown = resolveSavedDailyReportMarkdown(input);
  if (!markdown) {
    return { status: 'missing', httpStatus: 404, error: 'No saved daily report available' };
  }
  return { status: 'full', httpStatus: 200, markdown };
}
