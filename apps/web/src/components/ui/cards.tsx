import * as React from "react";
import { cn } from "../../lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "./card";

/* ==============================================================
   语义卡片层级 — 信息中枢 v3
   基于 shadcn Card 组件的高层级语义封装
   ============================================================== */

// ─── 共享 Props 类型 ─────────────────────────────────────────────

interface BaseCardProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  children?: React.ReactNode;
}

// ─── PrimaryCard ─────────────────────────────────────────────────
// 主要内容卡片：白色背景 + 较大阴影 + rounded-2xl + border

const PrimaryCard = React.forwardRef<HTMLDivElement, BaseCardProps>(
  ({ className, children, ...props }, ref) => (
    <Card
      ref={ref}
      className={cn(
        "rounded-2xl border border-neutral-200 bg-surface-card shadow-md p-6",
        className
      )}
      {...props}
    >
      {children}
    </Card>
  )
);
PrimaryCard.displayName = "PrimaryCard";

// ─── SecondaryCard ───────────────────────────────────────────────
// 次要内容卡片：浅灰背景 + 无边框 + rounded-xl

const SecondaryCard = React.forwardRef<HTMLDivElement, BaseCardProps>(
  ({ className, children, ...props }, ref) => (
    <Card
      ref={ref}
      className={cn(
        "rounded-xl border-0 bg-neutral-50 shadow-none p-5",
        className
      )}
      {...props}
    >
      {children}
    </Card>
  )
);
SecondaryCard.displayName = "SecondaryCard";

// ─── CompactCard ─────────────────────────────────────────────────
// 紧凑列表项：无圆角无边框 + hover态 + 左侧可选色条

interface CompactCardProps extends BaseCardProps {
  /** 左侧色条颜色 class，例如 "bg-primary-500" */
  accentColor?: string;
}

const CompactCard = React.forwardRef<HTMLDivElement, CompactCardProps>(
  ({ className, accentColor, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "relative flex items-start gap-3 rounded-none border-0 bg-transparent px-4 py-3 transition-colors hover:bg-neutral-50",
        className
      )}
      {...props}
    >
      {accentColor && (
        <span
          className={cn(
            "absolute left-0 top-2 bottom-2 w-0.5 rounded-full",
            accentColor
          )}
          aria-hidden="true"
        />
      )}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
);
CompactCard.displayName = "CompactCard";

// ─── DataCard ────────────────────────────────────────────────────
// 数据展示卡：白色背景 + metric label + 大号数据值 + 趋势指示

interface DataCardProps extends BaseCardProps {
  /** 指标名称标签 */
  label: string;
  /** 主要数据值 */
  value: string | number;
  /** 趋势描述，例如 "+12%" 或 "-3 items" */
  trend?: string;
  /** 趋势方向，决定颜色 */
  trendDirection?: "up" | "down" | "neutral";
}

const DataCard = React.forwardRef<HTMLDivElement, DataCardProps>(
  ({ className, label, value, trend, trendDirection = "neutral", children, ...props }, ref) => {
    const trendColorMap = {
      up: "text-success-600",
      down: "text-danger-600",
      neutral: "text-neutral-500",
    };

    return (
      <Card
        ref={ref}
        className={cn(
          "rounded-xl border border-neutral-200 bg-surface-card shadow-sm",
          className
        )}
        {...props}
      >
        <CardHeader className="pb-2 p-5">
          <CardTitle className="text-xs font-medium uppercase tracking-wider text-neutral-500">
            {label}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-5 pt-0">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-neutral-900 tracking-tight">
              {value}
            </span>
            {trend && (
              <span className={cn("text-sm font-medium", trendColorMap[trendDirection])}>
                {trend}
              </span>
            )}
          </div>
          {children && <div className="mt-3">{children}</div>}
        </CardContent>
      </Card>
    );
  }
);
DataCard.displayName = "DataCard";

// ─── 导出 ────────────────────────────────────────────────────────

export { PrimaryCard, SecondaryCard, CompactCard, DataCard };
export type { BaseCardProps, CompactCardProps, DataCardProps };
