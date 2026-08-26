"use client";

import { cn } from "@/lib/utils/cn";

/** 原生 select 封装（统一视觉） */
export function Select({
  value,
  onChange,
  options,
  className,
  placeholder,
  title,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  className?: string;
  placeholder?: string;
  /** 提示文本（原生 title 属性，悬停显示） */
  title?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={title}
      className={cn(
        "h-9 rounded-md border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary",
        className
      )}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
