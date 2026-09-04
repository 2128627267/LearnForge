"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils/cn";

/** Tab 项 */
export interface TabItem {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

/**
 * 轻量 Tab 切换条
 *
 * 可访问性（UX 修复）：
 * - role="tablist" / role="tab" + aria-selected（读屏器可识别选中态）
 * - 支持 ←/→ 方向键循环切换
 */
export function Tabs({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  /** 方向键切换（←/→ 循环） */
  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (index + dir + items.length) % items.length;
    const nextItem = items[nextIndex];
    onChange(nextItem.value);
    // 焦点跟随到下一个 Tab
    listRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [nextIndex]?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="选项卡"
      className={cn("flex items-center gap-0.5 border-b border-border", className)}
    >
      {items.map((it, index) => {
        const active = value === it.value;
        return (
          <button
            key={it.value}
            role="tab"
            aria-selected={active}
            aria-controls={`panel-${it.value}`}
            id={`tab-${it.value}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(it.value)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px",
              active
                ? "text-primary border-primary bg-primary/5"
                : "text-muted-foreground hover:text-foreground border-transparent"
            )}
          >
            {it.icon}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
