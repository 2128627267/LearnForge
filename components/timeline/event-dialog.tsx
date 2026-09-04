"use client";

/**
 * 事件创建/编辑对话框
 *
 * 三种打开形态：
 * - 创建时间点事件（type 预设为 point）
 * - 创建时间段事件（type 预设为 period）
 * - 编辑已有事件（回填数据，可改类型；period → point 时自动清空结束年份）
 *
 * 年份输入：数字（负数 = 公元前），提供"公元前"快捷开关降低输入门槛
 */
import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import { Textarea } from "@/components/ui/textarea";
import type { TimelineEventDTO } from "@/lib/services/timelines/types";

/** 对话框表单草稿（字符串态，便于受控输入与校验提示） */
interface EventDraft {
  title: string;
  content: string;
  type: "point" | "period";
  startYear: string;
  endYear: string;
}

/** 空草稿（按预设类型生成） */
function emptyDraft(type: "point" | "period"): EventDraft {
  return {
    title: "",
    content: "",
    type,
    startYear: "",
    endYear: "",
  };
}

/** 从已有事件回填草稿 */
function draftFromEvent(event: TimelineEventDTO): EventDraft {
  return {
    title: event.title,
    content: event.content,
    type: event.type,
    startYear: String(event.startYear),
    endYear: event.endYear === null ? "" : String(event.endYear),
  };
}

interface EventDialogProps {
  /** 打开状态 */
  open: boolean;
  /** 预设类型（创建模式）：point | period；编辑模式忽略 */
  defaultType?: "point" | "period";
  /** 编辑目标事件（编辑模式）；创建模式为 null */
  event?: TimelineEventDTO | null;
  /** 关闭回调 */
  onClose: () => void;
  /**
   * 提交回调（创建或更新统一出口）
   * @returns 错误信息（null 表示成功，由父层关闭对话框）
   */
  onSubmit: (draft: {
    title: string;
    content: string;
    type: "point" | "period";
    startYear: number;
    endYear: number | null;
  }) => Promise<string | null>;
  /** 删除事件（仅编辑模式显示按钮） */
  onDelete?: (eventId: string) => Promise<void>;
}

/** 校验草稿：返回首个错误信息（null 表示通过） */
function validateDraft(draft: EventDraft): string | null {
  if (!draft.title.trim()) return "请填写事件标题";

  // 年份非空前置校验（Number("") === 0 会静默通过整数校验，必须显式拦截）
  if (draft.startYear.trim() === "") return "请填写开始年份";
  const start = Number(draft.startYear);
  if (!Number.isInteger(start)) return "开始年份必须是整数";
  if (start < -10000 || start > 9999) return "年份须在公元前 10000 ~ 公元 9999 之间";

  if (draft.type === "period") {
    if (draft.endYear.trim() === "") return "时间段事件必须填写结束年份";
    if (!Number.isInteger(Number(draft.endYear))) {
      return "时间段事件必须填写整数结束年份";
    }
    const end = Number(draft.endYear);
    if (end < -10000 || end > 9999) return "结束年份须在公元前 10000 ~ 公元 9999 之间";
    if (end < start) return "结束年份不能早于开始年份";
  }
  return null;
}

export function EventDialog({
  open,
  defaultType = "point",
  event = null,
  onClose,
  onSubmit,
  onDelete,
}: EventDialogProps) {
  const isEdit = event !== null;
  const [draft, setDraft] = useState<EventDraft>(emptyDraft(defaultType));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 打开时重置草稿（创建 → 空表单；编辑 → 回填）
  useEffect(() => {
    if (open) {
      setDraft(event ? draftFromEvent(event) : emptyDraft(defaultType));
      setError(null);
    }
  }, [open, event, defaultType]);

  /** 切换类型：period → point 时清空结束年份（数据一致性） */
  const switchType = (type: "point" | "period") => {
    setDraft((prev) => ({
      ...prev,
      type,
      endYear: type === "point" ? "" : prev.endYear,
    }));
  };

  /** 公元前快捷切换：正负翻转 */
  const flipStartEra = () => {
    setDraft((prev) => ({
      ...prev,
      startYear: prev.startYear === "" ? "" : String(-Number(prev.startYear)),
    }));
  };

  const flipEndEra = () => {
    setDraft((prev) => ({
      ...prev,
      endYear: prev.endYear === "" ? "" : String(-Number(prev.endYear)),
    }));
  };

  /** 提交（校验 → 组装 → 交给父层） */
  const handleSubmit = async () => {
    const validationError = validateDraft(draft);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    const result = await onSubmit({
      title: draft.title.trim(),
      content: draft.content.trim(),
      type: draft.type,
      startYear: Number(draft.startYear),
      endYear: draft.type === "period" ? Number(draft.endYear) : null,
    });
    setSubmitting(false);
    // 返回错误信息则保持打开并展示；成功由父层关闭
    if (result) setError(result);
  };

  const handleDelete = async () => {
    if (!event || deleting) return;
    setDeleting(true);
    await onDelete?.(event.id);
    setDeleting(false);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? "编辑事件" : draft.type === "period" ? "创建时间段事件" : "创建时间点事件"}
      maxWidth="max-w-md"
      footer={
        <>
          {/* 删除按钮（仅编辑模式） */}
          {isEdit && (
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting || submitting}
              className="mr-auto"
            >
              {deleting ? "删除中..." : "删除"}
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "保存中..." : isEdit ? "保存" : "创建"}
          </Button>
        </>
      }
    >
      <div className="p-5 space-y-4 overflow-y-auto max-h-[65vh]">
        {/* 类型切换（创建模式可选；编辑模式也允许改类型） */}
        <div className="flex rounded-lg border overflow-hidden text-sm">
          <button
            type="button"
            onClick={() => switchType("point")}
            className={cn(
              "flex-1 px-3 py-2 transition-colors",
              draft.type === "point"
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent text-muted-foreground"
            )}
          >
            ● 时间点
          </button>
          <button
            type="button"
            onClick={() => switchType("period")}
            className={cn(
              "flex-1 px-3 py-2 transition-colors border-l",
              draft.type === "period"
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent text-muted-foreground"
            )}
          >
            ▬ 时间段
          </button>
        </div>

        {/* 标题 */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">标题 *</label>
          <Input
            value={draft.title}
            onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))}
            placeholder="如：鸦片战争"
            maxLength={50}
            autoFocus
          />
        </div>

        {/* 年份输入 */}
        <div className={cn("grid gap-3", draft.type === "period" ? "grid-cols-2" : "grid-cols-1")}>
          <div>
            <label className="text-sm font-medium mb-1.5 block">
              {draft.type === "period" ? "开始年份 *" : "年份 *"}
            </label>
            <div className="flex gap-1.5">
              <Input
                type="number"
                value={draft.startYear}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, startYear: e.target.value }))
                }
                placeholder="如 1840 或 -221"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 px-2.5"
                onClick={flipStartEra}
                title="切换公元/公元前（正负翻转）"
              >
                {Number(draft.startYear) < 0 ? "前" : "公元"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              负数 = 公元前（-221 即公元前 221 年）
            </p>
          </div>

          {draft.type === "period" && (
            <div>
              <label className="text-sm font-medium mb-1.5 block">结束年份 *</label>
              <div className="flex gap-1.5">
                <Input
                  type="number"
                  value={draft.endYear}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, endYear: e.target.value }))
                  }
                  placeholder="如 1842"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 px-2.5"
                  onClick={flipEndEra}
                  title="切换公元/公元前（正负翻转）"
                >
                  {Number(draft.endYear) < 0 ? "前" : "公元"}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* 内容描述 */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">描述</label>
          <Textarea
            value={draft.content}
            onChange={(e) => setDraft((p) => ({ ...p, content: e.target.value }))}
            placeholder="地点、人物、背景等信息（可选）"
            rows={4}
            maxLength={2000}
          />
        </div>

        {/* 校验/提交错误提示 */}
        {error && (
          <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
