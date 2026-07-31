"use client";

import { cn } from "@/lib/utils/cn";

/** Tab 项 */
export interface TabItem {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

/** 轻量 Tab 切换条 */
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
  return (
    <div className={cn("flex items-center gap-0.5 border-b border-border", className)}>
      {items.map((it) => (
        <button
          key={it.value}
          onClick={() => onChange(it.value)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px",
            value === it.value
              ? "text-primary border-primary bg-primary/5"
              : "text-muted-foreground hover:text-foreground border-transparent"
          )}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  );
}
