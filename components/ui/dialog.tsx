"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * 通用模态对话框
 * 覆盖在画布之上，支持 Esc / 点击遮罩关闭
 *
 * 可访问性（UX 修复）：
 * - role="dialog" + aria-modal="true" + aria-labelledby（读屏器识别为模态对话框）
 * - 打开时焦点移入对话框，关闭时归还焦点到触发元素
 * - Tab 焦点圈定在对话框内（焦点陷阱），防止焦点逃逸到背景
 * - 关闭按钮带 aria-label
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
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // 记住打开前的焦点元素，关闭时归还
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    lastFocusedRef.current = document.activeElement as HTMLElement | null;

    // 焦点移入对话框（优先首个可聚焦元素，否则面板本身）
    const panel = panelRef.current;
    if (panel) {
      const focusables = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      (focusables[0] ?? panel).focus();
    }

    // Esc 关闭
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      // Tab 焦点圈定
      if (e.key === "Tab") {
        const panel = panelRef.current;
        if (!panel) return;
        const focusables = Array.from(
          panel.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => !el.hasAttribute("disabled"));
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // 关闭时归还焦点到触发元素
      lastFocusedRef.current?.focus?.();
    };
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
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "bg-card border rounded-xl shadow-2xl w-full mx-auto flex flex-col max-h-[92vh]",
          maxWidth,
          className
        )}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b shrink-0">
          <h2 id={titleId} className="font-semibold">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground"
            title="关闭 (Esc)"
            aria-label="关闭对话框"
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
