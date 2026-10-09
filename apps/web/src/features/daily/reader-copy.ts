/**
 * 处理链路会把内部状态（如"本地兜底"）写进 aiTags，再被拼进日报 highlights，
 * 于是工作台出现过「主主题：Blogs / AI / 本地兜底」这种把处理状态当内容主题的展示。
 *
 * 后端已在 outputs/daily-report.ts 的 buildFinalFallback 处过滤，但**已生成并落库的历史日报**
 * 仍带着这些词。这里做渲染期的兜底清洗，让旧数据也不会把内部术语暴露给读者。
 */
const INTERNAL_TERM_REPLACEMENTS: ReadonlyArray<[RegExp, string]> = [
  [/本地兜底/g, '待人工复核'],
  [/模型摘要暂(?:时)?不可用/g, '缺少可靠摘要'],
  [/评分阈值/g, '筛选门槛'],
  [/候选池/g, '素材池'],
];

/** 清洗单行读者可见文案中的内部术语。 */
export function sanitizeReaderLine(line: string): string {
  return INTERNAL_TERM_REPLACEMENTS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    line,
  );
}

/**
 * 清洗 highlights，并丢弃清洗后已无信息量的行。
 * 例如「主主题：本地兜底」在唯一主题就是内部标记时，替换后变成「主主题：待人工复核」——
 * 那不是主题，直接丢掉比展示一个假主题更诚实。
 */
export function sanitizeReaderHighlights(lines: readonly string[]): string[] {
  return lines
    .map(sanitizeReaderLine)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      // 主主题/优先信号 这类结构化行，若冒号后只剩占位词则无展示价值
      const match = trimmed.match(/^(?:主主题|优先信号)\s*[:：]\s*(.+)$/);
      if (!match) return true;
      const value = match[1].trim();
      return value !== '待人工复核' && value !== '缺少可靠摘要';
    });
}
