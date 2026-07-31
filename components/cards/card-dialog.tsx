"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import { RichTextEditor } from "./rich-text-editor";
import { CardDialogAiPanel } from "./card-dialog-ai-panel";
import type { FreeCardData } from "./free-card-node";
import {
  DEFAULT_DRAFT,
  useCardDialogDraft,
  type CardDraft,
  type LearningMode,
} from "@/lib/hooks/use-card-dialog-draft";
import { toast } from "@/components/shared/toaster";
import { Plus, X } from "lucide-react";
import type {
  CardDialogPayload,
  CardDialogState,
  CreateNodeItem,
} from "./card-dialog-types";

/** 学习模式选项（Select 用） */
export const LEARNING_MODE_OPTIONS: Array<{
  value: LearningMode;
  label: string;
}> = [
  { value: "deep", label: "深度学习（画布+AI+关系线）" },
  { value: "review", label: "复式学习（测验+推荐+复习）" },
  { value: "both", label: "两者兼顾（先理解后记忆）" },
];

/** 颜色色板（与画布标签色一致） */
const COLOR_PALETTE = [
  "#3b82f6",
  "#22c55e",
  "#a855f7",
  "#f97316",
  "#ec4899",
  "#14b8a6",
  "#ef4444",
  "#6b7280",
];

/** 宽度选项 */
const WIDTH_OPTIONS = [240, 280, 320, 360].map((w) => ({
  value: String(w),
  label: `${w}px`,
}));

/** 由节点数据构建初始草稿（无保存草稿时使用） */
export function buildInitialDraft(node?: FreeCardData | null): CardDraft {
  return {
    title: node?.title ?? "",
    content: node?.content ?? "",
    tags: node?.tags ?? [],
    color: node?.color ?? "#3b82f6",
    learningMode: node?.learningMode ?? "deep",
    width: node?.width ?? 280,
    ai: { ...DEFAULT_DRAFT.ai },
  };
}

export function CardDialog({
  state,
  node,
  onClose,
  onSave,
  onCreateNodes,
}: {
  state: CardDialogState;
  node?: FreeCardData | null;
  onClose: () => void;
  onSave: (payload: CardDialogPayload) => void;
  onCreateNodes: (items: CreateNodeItem[]) => void;
}) {
  const cardId = state.mode === "create" ? null : state.nodeId;
  const { draft, setDraft, clearDraft } = useCardDialogDraft(cardId);

  // 草稿优先恢复，否则用节点/默认值初始化
  const current: CardDraft = draft ?? buildInitialDraft(node);

  // 表单字段
  const form: CardDialogPayload = {
    title: current.title,
    content: current.content,
    tags: current.tags,
    color: current.color,
    learningMode: current.learningMode,
    width: current.width,
  };

  const updateForm = (patch: Partial<CardDialogPayload>) => {
    setDraft((prev) => ({ ...(prev ?? buildInitialDraft(node)), ...patch }));
  };

  const updateAi = (patch: Partial<CardDraft["ai"]>) => {
    setDraft((prev) => {
      const base = prev ?? buildInitialDraft(node);
      return { ...base, ai: { ...base.ai, ...patch } };
    });
  };

  // 恢复草稿提示（仅在确有保存草稿且非新建时提示一次）
  const toastShown = useRef(false);
  useEffect(() => {
    if (draft && state.mode !== "create" && !toastShown.current) {
      toastShown.current = true;
      toast.info("已恢复上次未保存的内容");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 本地标签输入
  const [newTag, setNewTag] = useState("");

  const addTag = () => {
    const t = newTag.trim();
    if (t && !form.tags.includes(t)) {
      updateForm({ tags: [...form.tags, t] });
      setNewTag("");
    }
  };

  const removeTag = (tag: string) => {
    updateForm({ tags: form.tags.filter((t) => t !== tag) });
  };

  const handleSave = () => {
    onSave({
      title: form.title.trim() || "未命名卡片",
      content: form.content,
      tags: form.tags,
      color: form.color,
      learningMode: form.learningMode,
      width: form.width,
    });
    clearDraft();
  };

  const title = state.mode === "create" ? "新建卡片" : "编辑卡片";

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      maxWidth="max-w-6xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSave}>保存卡片</Button>
        </>
      }
    >
      <div className="flex h-full">
        {/* ===== 左侧：编辑表单 ===== */}
        <div className="w-[54%] border-r border-border flex flex-col">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* 标题 */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">标题</label>
              <Input
                value={form.title}
                onChange={(e) => updateForm({ title: e.target.value })}
                placeholder="卡片标题"
              />
            </div>

            {/* 学习方式 */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">学习方式</label>
              <Select
                value={form.learningMode}
                onChange={(v) =>
                  updateForm({ learningMode: v as LearningMode })
                }
                options={LEARNING_MODE_OPTIONS}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">
                深度学习：画布 + AI 提问/扩展 + 关系线，用于理解与构建知识体系；
                复式学习：导入后经测验、推荐、复习巩固记忆与运用。
              </p>
            </div>

            {/* 内容 */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">内容</label>
              <RichTextEditor
                content={form.content}
                onChange={(html) => updateForm({ content: html })}
                minHeight={160}
                placeholder="输入卡片内容... 支持 LaTeX：$x^2$ 行内，$$\int$$ 块级"
              />
            </div>

            {/* 标签 */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">标签</label>
              <div className="flex items-center gap-2">
                <Input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="输入标签后回车添加"
                />
                <Button type="button" variant="outline" size="sm" onClick={addTag}>
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  添加
                </Button>
              </div>
              {form.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {form.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary"
                    >
                      {tag}
                      <button
                        onClick={() => removeTag(tag)}
                        className="hover:text-destructive"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* 颜色 + 宽度 */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium">卡片颜色</label>
                <div className="flex flex-wrap gap-1.5">
                  {COLOR_PALETTE.map((c) => (
                    <button
                      key={c}
                      onClick={() => updateForm({ color: c })}
                      className={cn(
                        "w-6 h-6 rounded-full transition-transform",
                        form.color === c
                          ? "ring-2 ring-offset-1 ring-primary scale-110"
                          : "hover:scale-110"
                      )}
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="block text-sm font-medium">卡片宽度</label>
                <Select
                  value={String(form.width)}
                  onChange={(v) => updateForm({ width: Number(v) })}
                  options={WIDTH_OPTIONS}
                  className="w-full"
                />
              </div>
            </div>
          </div>
        </div>

        {/* ===== 右侧：AI 侧栏 ===== */}
        <CardDialogAiPanel
          ai={current.ai}
          updateAi={updateAi}
          form={form}
          updateForm={updateForm}
          onCreateNodes={onCreateNodes}
          sourceId={state.mode === "create" ? undefined : state.nodeId}
        />
      </div>
    </Dialog>
  );
}
