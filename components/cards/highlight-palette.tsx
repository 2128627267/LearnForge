"use client";

import { useEffect, useRef, useState } from "react";
import { Palette, X } from "lucide-react";
import { DEFAULT_HIGHLIGHT_COLORS } from "@/lib/editor/highlight-mark";
import { cn } from "@/lib/utils/cn";

/**
 * 高亮调色板组件（富文本工具栏内嵌）
 *
 * 交互：
 * - 点击调色板按钮展开面板
 * - 预设色块：单击应用并收起
 * - 自定义取色器：拖选即应用（实时预览）
 * - 清除高亮：移除当前高亮标记
 * - 点击面板外部自动收起
 *
 * 视觉：与现有工具栏保持一致（小尺寸图标、hover 反馈、淡色系预设）。
 */
export function HighlightPalette({
  activeColor,
  onApply,
  onClear,
}: {
  /** 当前选中文本的高亮色（无高亮时为 null/undefined） */
  activeColor?: string | null;
  /** 应用指定颜色高亮 */
  onApply: (color: string) => void;
  /** 清除高亮 */
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  // 自定义取色器当前值（默认取预设第一个）
  const [customColor, setCustomColor] = useState<string>(
    DEFAULT_HIGHLIGHT_COLORS[0]
  );
  const rootRef = useRef<HTMLSpanElement>(null);
  // 取色器防抖定时器：拖选过程中仅本地预览，释放后统一提交（避免污染 undo 栈）
  const applyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 打开面板时，将取色器同步为当前高亮色（保持一致）
  useEffect(() => {
    if (open && activeColor) {
      setCustomColor(activeColor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 组件卸载时清理防抖定时器
  useEffect(() => {
    return () => {
      if (applyTimer.current) clearTimeout(applyTimer.current);
    };
  }, []);

  // 点击面板外部时关闭
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  /** 自定义取色：立即更新本地预览，防抖后提交一次（拖选不切碎 undo） */
  const handleCustomColorChange = (value: string) => {
    setCustomColor(value);
    if (applyTimer.current) clearTimeout(applyTimer.current);
    applyTimer.current = setTimeout(() => onApply(value), 150);
  };

  return (
    <span ref={rootRef} className="relative inline-flex items-center">
      {/* 调色板开关按钮 */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="文字高亮"
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "p-1 rounded transition-colors",
          open || activeColor
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
        )}
      >
        <Palette className="w-3 h-3" />
      </button>

      {/* 调色面板 */}
      {open && (
        <span
          role="dialog"
          aria-label="高亮颜色选择"
          className="absolute top-full left-0 mt-1 z-20 p-1.5 rounded-lg border border-border/60 bg-popover shadow-md flex flex-col gap-1.5 w-[152px]"
        >
          {/* 预设色板 */}
          <span className="flex flex-wrap gap-1">
            {DEFAULT_HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  onApply(c);
                  setOpen(false);
                }}
                title={c}
                aria-label={`高亮颜色 ${c}`}
                className={cn(
                  "w-5 h-5 rounded border border-black/10 hover:scale-110 transition-transform",
                  activeColor === c && "ring-2 ring-primary ring-offset-1"
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </span>

          {/* 自定义颜色取色器 */}
          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
            <input
              type="color"
              value={customColor}
              onChange={(e) => handleCustomColorChange(e.target.value)}
              className="w-5 h-5 rounded cursor-pointer border border-border/60 bg-transparent p-0"
              title="自定义颜色"
            />
            <span>自定义</span>
          </label>

          {/* 清除高亮 */}
          <button
            type="button"
            onClick={() => {
              onClear();
              setOpen(false);
            }}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground px-1 py-0.5 rounded hover:bg-accent transition-colors"
          >
            <X className="w-2.5 h-2.5" />
            清除高亮
          </button>
        </span>
      )}
    </span>
  );
}
