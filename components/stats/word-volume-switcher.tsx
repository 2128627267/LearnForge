"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * 单词综合学习量切换卡片
 *
 * 在天/周/月/年四个时间维度间快速切换查看，
 * 数据由服务端预查询后一次性传入，切换无网络开销。
 *
 * 设计依据：用户需求「天/周/月/年单词综合学习量，可快速切换」
 *
 * 口径：统计 StudyLog 全部学习行为（不区分卡片类型），
 *      与现有「今日学习」指标保持一致。
 */

/** 支持的时间维度 */
type Range = "day" | "week" | "month" | "year";

/** 各维度的展示元信息 */
const RANGE_META: Record<
  Range,
  { label: string; shortLabel: string; hint: string }
> = {
  day: { label: "今日", shortLabel: "天", hint: "今日 0 点至今" },
  week: { label: "本周", shortLabel: "周", hint: "本周一 0 点至今" },
  month: { label: "本月", shortLabel: "月", hint: "本月 1 号 0 点至今" },
  year: { label: "本年", shortLabel: "年", hint: "本年 1 月 1 日 0 点至今" },
};

/** 切换顺序，用于键盘导航 */
const RANGE_ORDER: Range[] = ["day", "week", "month", "year"];

interface WordVolumeSwitcherProps {
  /** 今日学习量（day 维度） */
  day: number;
  /** 本周学习量（week 维度） */
  week: number;
  /** 本月学习量（month 维度） */
  month: number;
  /** 本年学习量（year 维度） */
  year: number;
}

/**
 * 综合学习量切换卡片
 *
 * 渲染一个 6 列网格中占 1 格的卡片，
 * 顶部为切换按钮组，中部为数值，底部为时间范围说明。
 */
export function WordVolumeSwitcher({
  day,
  week,
  month,
  year,
}: WordVolumeSwitcherProps) {
  const [active, setActive] = useState<Range>("day");
  const value = { day, week, month, year }[active];
  const meta = RANGE_META[active];

  return (
    <div>
      {/* 切换按钮组：四个维度平铺，激活态高亮 */}
      <div className="flex items-center gap-0.5 mb-2 bg-muted rounded p-0.5">
        {RANGE_ORDER.map((r) => {
          const isActive = r === active;
          return (
            <button
              key={r}
              type="button"
              onClick={() => setActive(r)}
              aria-pressed={isActive}
              title={RANGE_META[r].hint}
              className={cn(
                "flex-1 text-xs py-1 px-1 rounded transition-colors font-medium",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {RANGE_META[r].shortLabel}
            </button>
          );
        })}
      </div>
      {/* 数值展示 */}
      <div className="text-3xl font-bold text-blue-600 tabular-nums">
        {value.toLocaleString()}
      </div>
      <div className="text-sm text-muted-foreground">{meta.label}综合学习量</div>
    </div>
  );
}
