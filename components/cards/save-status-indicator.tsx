"use client";

import { cn } from "@/lib/utils/cn";
import type { SaveStatus } from "@/lib/sync/types";
import {
  Check,
  Clock,
  Loader2,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";

/**
 * 画布保存状态指示器（F3-T3 完整性监控）
 *
 * 非阻塞徽标，固定在画布左上角：
 * - pending：存在未保存变更（防抖等待中）
 * - saving：保存请求进行中（旋转图标）
 * - saved：已保存（绿色 + 保存时刻）
 * - error：保存失败（红色，点击可手动重试）
 * - idle：无未保存变更（不渲染，保持画布简洁）
 */
interface StatusConfig {
  text: string;
  icon: LucideIcon;
  iconClass?: string;
  textClass: string;
  clickable: boolean;
  title: string;
}

export function SaveStatusIndicator({
  status,
  retry,
}: {
  status: SaveStatus;
  retry: () => void;
}) {
  // 无未保存变更：不渲染任何内容
  if (status.phase === "idle") return null;

  let config: StatusConfig;
  switch (status.phase) {
    case "pending":
      config = {
        text: "待保存",
        icon: Clock,
        textClass: "text-muted-foreground",
        clickable: false,
        title: "存在未保存变更，稍后自动保存",
      };
      break;
    case "saving":
      config = {
        text: "保存中…",
        icon: Loader2,
        iconClass: "animate-spin",
        textClass: "text-muted-foreground",
        clickable: false,
        title: "正在保存到本地数据库",
      };
      break;
    case "saved":
      config = {
        text: `已保存 ${new Date(status.at).toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        })}`,
        icon: Check,
        textClass: "text-emerald-600 dark:text-emerald-400",
        clickable: false,
        title: `已持久化（版本 r${status.revision}）`,
      };
      break;
    case "error":
      config = {
        text: status.canRetry ? "保存失败 · 点击重试" : "保存失败",
        icon: AlertTriangle,
        textClass: "text-destructive",
        clickable: status.canRetry,
        title: status.canRetry
          ? `自动重试 ${status.attempt} 次未成功，点击手动重试`
          : "请求被拒绝，请检查数据后重试",
      };
      break;
  }

  const Icon = config.icon;

  return (
    <div
      className={cn(
        "fixed left-4 top-4 z-20",
        "flex items-center gap-1.5 px-2.5 py-1 rounded-full",
        "bg-card/80 backdrop-blur border shadow-sm text-xs",
        config.clickable && "cursor-pointer hover:bg-accent",
        config.clickable && "animate-pulse"
      )}
      title={config.title}
      role={config.clickable ? "button" : undefined}
      aria-label={config.text}
      onClick={config.clickable ? retry : undefined}
    >
      <Icon className={cn("w-3.5 h-3.5", config.iconClass, config.textClass)} />
      <span className={config.textClass}>{config.text}</span>
    </div>
  );
}
