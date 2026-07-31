"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { MODE_META, type LearnModeId } from "@/lib/learning/types";
import { Clock, Flame, Target } from "lucide-react";

/**
 * 会话统计条组件
 *
 * 设计依据：.doc/WORD_LEARNING_DESIGN.md §4.5
 *
 * 用途：
 *   - 学习页面顶部：实时展示当前会话累计指标
 *   - SessionEnd 状态：展示本次学习总结
 *
 * 展示内容：正确率进度条、题数/正确率/连击/平均响应时长四宫格、各考查方式分布小标签。
 *
 * 数据来源：父组件维护的本地会话累计（与后端滚动 20 条窗口区分）。
 */
export interface SessionStatsBarProps {
  /** 已答题数 */
  total: number;
  /** 答对数 */
  correct: number;
  /** 当前连击数（连续答对） */
  currentStreak: number;
  /** 平均响应时长（毫秒） */
  avgResponseMs: number;
  /** 各考查方式出现次数，key 为 modeId */
  modeDistribution: Record<number, number>;
  className?: string;
}

export function SessionStatsBar({
  total,
  correct,
  currentStreak,
  avgResponseMs,
  modeDistribution,
  className,
}: SessionStatsBarProps) {
  // 正确率（百分比），无题时为 0
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
  // 平均响应时长（秒，保留 1 位小数）
  const avgSeconds = avgResponseMs > 0 ? (avgResponseMs / 1000).toFixed(1) : "—";

  return (
    <div className={cn("space-y-2", className)} aria-label="本次会话统计">
      {/* 正确率进度条 */}
      <div
        className="h-1.5 w-full bg-muted rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={accuracy}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="正确率"
      >
        <div
          className="h-full bg-primary transition-all duration-500 ease-out"
          style={{ width: `${Math.min(100, accuracy)}%` }}
        />
      </div>

      {/* 核心指标四宫格 */}
      <div className="grid grid-cols-4 gap-2 text-center">
        <Metric label="题数" value={String(total)} />
        <Metric
          label="正确率"
          value={`${accuracy}%`}
          icon={<Target className="h-3 w-3" />}
        />
        <Metric
          label="连击"
          value={String(currentStreak)}
          icon={<Flame className="h-3 w-3 text-orange-500" />}
        />
        <Metric
          label="均时"
          value={avgResponseMs > 0 ? `${avgSeconds}s` : "—"}
          icon={<Clock className="h-3 w-3" />}
        />
      </div>

      {/* 考查方式分布小标签 */}
      {Object.keys(modeDistribution).length > 0 && (
        <div className="flex flex-wrap gap-1 justify-center">
          {Object.entries(modeDistribution).map(([m, n]) => (
            <span
              key={m}
              className="text-[10px] leading-none px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground"
            >
              {MODE_META[Number(m) as LearnModeId]?.name ?? `模式${m}`} ×{n}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** 单个指标格 */
interface MetricProps {
  label: string;
  value: string;
  icon?: ReactNode;
}

function Metric({ label, value, icon }: MetricProps) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] text-muted-foreground flex items-center justify-center gap-0.5">
        {icon}
        {label}
      </span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}
