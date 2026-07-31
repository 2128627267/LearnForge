/**
 * 类名合并工具（shadcn/ui 标准实现）
 * 结合 clsx 与 tailwind-merge，处理条件类名并解决 Tailwind 冲突
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
