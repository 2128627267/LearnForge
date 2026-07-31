"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * 通用模态对话框
 * 覆盖在画布之上，支持 Esc / 点击遮罩关闭
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  className,
  maxWidth = "max-w-5xl",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  maxWidth?: string;
}) {
  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          "bg-card border rounded-xl shadow-2xl w-full mx-auto flex flex-col max-h-[92vh]",
          maxWidth,
          className
        )}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b shrink-0">
          <h2 className="font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground"
            title="关闭 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {/* 内容区 */}
        <div className="flex-1 overflow-hidden min-h-0">{children}</div>
        {/* 底部操作区 */}
        {footer && (
          <div className="px-5 py-3 border-t shrink-0 flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
