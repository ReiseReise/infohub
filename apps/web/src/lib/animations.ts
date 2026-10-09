import type { Variants, Transition } from "framer-motion";

/* ==============================================================
   动画系统 — 信息中枢 v3
   可复用的 framer-motion variants & transition 配置
   ============================================================== */

// ─── Transition 预设 ─────────────────────────────────────────────

/** 弹性动画 — 适合元素进场 */
export const springTransition: Transition = {
  type: "spring",
  stiffness: 300,
  damping: 24,
  mass: 0.8,
};

/** 快速弹性 — 适合微交互 */
export const springFast: Transition = {
  type: "spring",
  stiffness: 400,
  damping: 28,
  mass: 0.6,
};

/** 平滑缓动 — 适合渐变动画 */
export const easeSmooth: Transition = {
  type: "tween",
  ease: [0.25, 0.1, 0.25, 1],
  duration: 0.3,
};

/** 减速缓动 — 适合退出动画 */
export const easeOut: Transition = {
  type: "tween",
  ease: [0, 0, 0.2, 1],
  duration: 0.25,
};

/** 加速缓动 — 适合进入动画 */
export const easeIn: Transition = {
  type: "tween",
  ease: [0.4, 0, 1, 1],
  duration: 0.2,
};

// ─── 动画 Variants ──────────────────────────────────────────────

/** 淡入 */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: easeSmooth,
  },
};

/** 淡出 */
export const fadeOut: Variants = {
  visible: { opacity: 1 },
  exit: {
    opacity: 0,
    transition: easeOut,
  },
};

/** 从下方滑入 */
export const slideInUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: springTransition,
  },
};

/** 从上方滑入 */
export const slideInDown: Variants = {
  hidden: { opacity: 0, y: -16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: springTransition,
  },
};

/** 从左侧滑入 */
export const slideInLeft: Variants = {
  hidden: { opacity: 0, x: -20 },
  visible: {
    opacity: 1,
    x: 0,
    transition: springTransition,
  },
};

/** 从右侧滑入 */
export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 20 },
  visible: {
    opacity: 1,
    x: 0,
    transition: springTransition,
  },
};

/** 滑出到下方 */
export const slideOut: Variants = {
  visible: { opacity: 1, y: 0 },
  exit: {
    opacity: 0,
    y: 12,
    transition: easeOut,
  },
};

/** 缩放进入 — 适合 Dialog / Popover */
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: springFast,
  },
  exit: {
    opacity: 0,
    scale: 0.97,
    transition: easeOut,
  },
};

/** 列表容器 — 带 stagger children */
export const listContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.05,
    },
  },
};

/** 列表项动画 — 配合 listContainer 使用 */
export const listItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: springTransition,
  },
  exit: {
    opacity: 0,
    y: -4,
    transition: easeOut,
  },
};

/** Tab 内容切换动画 */
export const tabContent: Variants = {
  hidden: { opacity: 0, x: 8 },
  visible: {
    opacity: 1,
    x: 0,
    transition: easeSmooth,
  },
  exit: {
    opacity: 0,
    x: -8,
    transition: easeOut,
  },
};

/** 折叠展开动画 */
export const collapse: Variants = {
  hidden: {
    opacity: 0,
    height: 0,
    overflow: "hidden",
  },
  visible: {
    opacity: 1,
    height: "auto",
    overflow: "hidden",
    transition: {
      height: { type: "spring", stiffness: 300, damping: 30 },
      opacity: { duration: 0.2, delay: 0.05 },
    },
  },
  exit: {
    opacity: 0,
    height: 0,
    overflow: "hidden",
    transition: {
      height: { type: "spring", stiffness: 300, damping: 30 },
      opacity: { duration: 0.15 },
    },
  },
};

// ─── 便捷集合 ────────────────────────────────────────────────────

/** 所有 variants 的集合，方便按名称索引 */
export const variants = {
  fadeIn,
  fadeOut,
  slideInUp,
  slideInDown,
  slideInLeft,
  slideInRight,
  slideOut,
  scaleIn,
  listContainer,
  listItem,
  tabContent,
  collapse,
} as const;

/** 所有 transition 预设集合 */
export const transitions = {
  spring: springTransition,
  springFast,
  easeSmooth,
  easeOut,
  easeIn,
} as const;
