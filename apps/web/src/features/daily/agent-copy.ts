export const dailyAgentCopy: Record<string, { name: string; role: string; input: string; output: string }> = {
  daily_report_cleaning: {
    name: '清洗 Agent',
    role: '过滤重复、泛噪声和不可读内容',
    input: '今日主流程条目',
    output: '候选基础池',
  },
  daily_report_decision: {
    name: '决策 Agent',
    role: '判断入报价值、风险和优先级',
    input: '候选池与评分',
    output: '入报理由',
  },
  daily_report_research: {
    name: '研究 Agent',
    role: '归纳主题、实体和趋势信号',
    input: '高价值候选',
    output: '研究摘要',
  },
  daily_report_reading: {
    name: '阅读 Agent',
    role: '转成可读的结论与阅读建议',
    input: '融合分析结果',
    output: '阅读导航',
  },
  daily_report_final: {
    name: '最终日报 Agent',
    role: '生成正式日报正文',
    input: '所有 Agent 输出',
    output: '高质量日报',
  },
};
