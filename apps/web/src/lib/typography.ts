/* ==============================================================
   字体系统 — 信息中枢 v3
   可复用的 Tailwind 类名组合，映射语义化文字样式
   ============================================================== */

/**
 * 语义化文字样式常量
 * 使用方式：cn(typography.displayLg, 'text-neutral-900')
 */
export const typography = {
  /** 大标题 — 页面主标题 */
  displayLg: "font-display text-3xl font-bold tracking-tight",
  /** 中标题 — 区块标题 */
  displayMd: "font-display text-2xl font-semibold tracking-tight",
  /** 小标题 — 卡片标题 */
  displaySm: "font-display text-xl font-semibold",

  /** 大正文 — 文章/详情正文 */
  bodyLg: "font-body text-lg leading-relaxed",
  /** 中正文 — 默认正文 */
  bodyMd: "font-body text-base leading-relaxed",
  /** 小正文 — 辅助文本/注释 */
  bodySm: "font-body text-sm leading-normal",

  /** 等宽字体 — 代码/数据 */
  mono: "font-mono text-sm",

  /** 标签 — 元信息/分类标签 */
  label: "text-xs font-medium uppercase tracking-wider text-neutral-500",

  /** 数据值 — 大号数字展示 */
  metric: "font-display text-2xl font-bold tabular-nums tracking-tight",

  /** 引用/强调 — 引用文字 */
  quote: "font-body text-base italic leading-relaxed text-neutral-600",
} as const;

/** Typography key 类型 */
export type TypographyKey = keyof typeof typography;
