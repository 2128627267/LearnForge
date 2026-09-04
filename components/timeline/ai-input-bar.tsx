"use client";

/**
 * AI 快速创建输入栏（页面底部）
 *
 * 流程：
 * 1. 用户输入自然语言（时间 + 内容/地点/人物）
 * 2. POST /api/ai/timeline-parse 解析为结构化事件
 * 3. 预览弹窗展示解析结果（可逐条移除）
 * 4. 确认后批量落库（PUT /api/timelines/:id/events）
 */
import { useRef, useState } from "react";
import { Sparkles, Send, X } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import { formatYear } from "@/lib/timeline/view-scale";
import type { AIParsedEvent } from "@/lib/services/timelines/types";

interface AIInputBarProps {
  /** 当前时间线 ID（未选中时禁用） */
  timelineId: string | null;
  /** 批量创建成功后的回调（父层刷新事件列表） */
  onEventsCreated: (startYear: number) => void;
}

/** 预览条目（AI 解析结果 + 可编辑标记） */
interface PreviewItem {
  /** 前端临时标识 */
  key: string;
  event: AIParsedEvent;
}

export function AIInputBar({ timelineId, onEventsCreated }: AIInputBarProps) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [previewItems, setPreviewItems] = useState<PreviewItem[] | null>(null);
  const [saving, setSaving] = useState(false);
  const keySeqRef = useRef(0);

  /** 解析输入文本 */
  const handleParse = async () => {
    const input = text.trim();
    if (!input || loading || !timelineId) return;

    setLoading(true);
    try {
      const res = await fetch("/api/ai/timeline-parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "AI 解析失败，请稍后重试");
        return;
      }
      const events: AIParsedEvent[] = data.events ?? [];
      if (events.length === 0) {
        toast.error("未能从输入中解析出事件，请补充时间信息");
        return;
      }
      // 进入预览（key 用自增序号保证稳定）
      setPreviewItems(
        events.map((event) => ({ key: `ev-${keySeqRef.current++}`, event }))
      );
    } catch {
      toast.error("网络异常，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  /** 确认创建：批量落库 */
  const handleConfirm = async () => {
    if (!previewItems || previewItems.length === 0 || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/timelines/${timelineId}/events`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: previewItems.map(({ event }) => ({
            ...event,
            source: "ai" as const,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "批量创建失败，请稍后重试");
        return;
      }
      const created: AIParsedEvent[] = await res.json();
      toast.success(`已创建 ${created.length} 个事件`);
      // 定位到最早新事件
      const minYear = Math.min(...created.map((e) => e.startYear));
      setPreviewItems(null);
      setText("");
      onEventsCreated(minYear);
    } catch {
      toast.error("网络异常，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  /** 移除某条预览 */
  const removeItem = (key: string) => {
    setPreviewItems((prev) => prev?.filter((item) => item.key !== key) ?? null);
  };

  const disabled = !timelineId;

  return (
    <>
      {/* 输入栏主体 */}
      <div className="border-t bg-card/60 px-3 md:px-4 py-2.5">
        <div className="flex items-center gap-2 max-w-3xl mx-auto">
          {/* AI 图标 */}
          <span
            className={cn(
              "flex items-center justify-center w-8 h-8 rounded-full shrink-0",
              disabled ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
            )}
            title="AI 解析"
          >
            <Sparkles className="w-4 h-4" />
          </span>

          {/* 输入框 */}
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) handleParse();
            }}
            disabled={disabled}
            placeholder={
              disabled
                ? "请先选择或创建一条时间线"
                : "描述事件：时间 + 内容（地点、人物），如「1840年鸦片战争爆发，地点广东沿海」"
            }
            className="flex-1 h-9 rounded-full border border-input bg-background px-4 text-sm
                       placeholder:text-muted-foreground focus-visible:outline-none
                       focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            maxLength={500}
          />

          {/* 发送按钮 */}
          <button
            type="button"
            onClick={handleParse}
            disabled={disabled || !text.trim() || loading}
            className="flex items-center justify-center w-9 h-9 rounded-full bg-primary text-primary-foreground
                       disabled:opacity-40 hover:opacity-90 transition-opacity shrink-0"
            title="AI 解析并创建"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 解析结果预览对话框 */}
      <Dialog
        open={previewItems !== null}
        onClose={() => setPreviewItems(null)}
        title={`AI 解析结果（${previewItems?.length ?? 0} 个事件）`}
        maxWidth="max-w-lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setPreviewItems(null)} disabled={saving}>
              取消
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={saving || (previewItems?.length ?? 0) === 0}
            >
              {saving ? "创建中..." : `确认创建 ${previewItems?.length ?? 0} 个事件`}
            </Button>
          </>
        }
      >
        <div className="p-5 space-y-2.5 overflow-y-auto max-h-[60vh]">
          <p className="text-xs text-muted-foreground">
            请核对解析结果（不合适的项目可移除后创建）：
          </p>
          {previewItems?.map(({ key, event }) => (
            <div
              key={key}
              className="flex items-start gap-2 rounded-lg border bg-background p-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {/* 类型标记 */}
                  <span
                    className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0",
                      event.type === "period"
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {event.type === "period" ? "时间段" : "时间点"}
                  </span>
                  <span className="text-sm font-medium truncate">{event.title}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1 tabular-nums">
                  {event.type === "period" && event.endYear != null
                    ? `${formatYear(event.startYear)} ~ ${formatYear(event.endYear)}`
                    : formatYear(event.startYear)}
                </div>
                {event.content && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-snug">
                    {event.content}
                  </p>
                )}
              </div>
              {/* 移除按钮 */}
              <button
                type="button"
                onClick={() => removeItem(key)}
                className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-destructive shrink-0"
                title="移除此项"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </Dialog>
    </>
  );
}
