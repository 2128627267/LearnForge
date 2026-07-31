"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
  type Edge,
} from "reactflow";
import { cn } from "@/lib/utils/cn";
import { Trash2, Edit3, Check, X } from "lucide-react";

/**
 * 自由卡片边（React Flow 自定义边）
 *
 * 功能：
 *   1. 正交绕行路径（smoothstep + 圆角），支持上下左右+斜角连接
 *   2. 边上文字沿线弯曲分布（SVG <textPath>，跟随路径方向旋转）
 *   3. hover 时显示编辑/删除按钮
 *   4. 双击边可编辑标签
 *   5. 编辑面板提供预设标签快捷选择 + 自定义输入
 *   6. 删除按钮可切断连线
 *
 * 标签预设：
 *   单词意义派生、题目派生知识点、派生题目、相关知识、前置知识、延伸拓展
 */

/** 预设标签列表 */
const PRESET_LABELS = [
  "单词意义派生",
  "题目派生知识点",
  "派生题目",
  "相关知识",
  "前置知识",
  "延伸拓展",
] as const;

/** 边的额外数据 */
export interface FreeCardEdgeData {
  /** 边的标签文字（空字符串表示无文字） */
  label?: string;
  [key: string]: unknown;
}

function FreeCardEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<FreeCardEdgeData>) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(data?.label ?? "");
  const editInputRef = useRef<HTMLInputElement>(null);

  // 同步外部 label 变化
  useEffect(() => {
    if (!editing) {
      setInputValue(data?.label ?? "");
    }
  }, [data?.label, editing]);

  // 编辑模式自动聚焦
  useEffect(() => {
    if (editing) editInputRef.current?.focus();
  }, [editing]);

  // 正交折线路径（smoothstep + 圆角），替代之前的贝塞尔曲线
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 12,
  });

  /** 确认编辑 */
  const handleConfirm = useCallback(() => {
    const onEdit = (data as FreeCardEdgeData & {
      onEdit?: (id: string, label: string) => void;
    }).onEdit;
    if (typeof onEdit === "function") {
      onEdit(id, inputValue.trim());
    }
    setEditing(false);
  }, [id, inputValue, data]);

  /** 选择预设标签 */
  const handlePreset = useCallback(
    (preset: string) => {
      setInputValue(preset);
      const onEdit = (data as FreeCardEdgeData & {
        onEdit?: (id: string, label: string) => void;
      }).onEdit;
      if (typeof onEdit === "function") {
        onEdit(id, preset);
      }
      setEditing(false);
    },
    [id, data]
  );

  /** 清除标签 */
  const handleClear = useCallback(() => {
    const onEdit = (data as FreeCardEdgeData & {
      onEdit?: (id: string, label: string) => void;
    }).onEdit;
    if (typeof onEdit === "function") {
      onEdit(id, "");
    }
    setInputValue("");
    setEditing(false);
  }, [id, data]);

  /** 删除边 */
  const handleDelete = useCallback(() => {
    const onDelete = (data as FreeCardEdgeData & {
      onDelete?: (id: string) => void;
    }).onDelete;
    if (typeof onDelete === "function") {
      onDelete(id);
    }
  }, [id, data]);

  /** 双击边进入编辑模式 */
  const handleDoubleClick = useCallback(() => {
    setEditing(true);
  }, []);

  const hasLabel = !!(data?.label && data.label.length > 0);
  // SVG path 的唯一 id（用于 textPath 引用）
  const pathId = `edge-path-${id}`;
  // 标签文字颜色（选中时高亮）
  const labelFill = selected ? "#3b82f6" : "#64748b";

  return (
    <>
      {/* 主路径（可见的连线） */}
      <path
        id={pathId}
        d={edgePath}
        fill="none"
        stroke={selected ? "#3b82f6" : "#94a3b8"}
        strokeWidth={selected ? 2 : 1.5}
        markerEnd="url(#arrow)"
        style={{ cursor: "pointer" }}
      />

      {/* 沿线弯曲的标签文字（SVG textPath，跟随路径方向旋转） */}
      {hasLabel && !editing && (
        <text
          style={{
            fontSize: "11px",
            fill: labelFill,
            pointerEvents: "none",
            userSelect: "none",
          }}
        >
          <textPath
            href={`#${pathId}`}
            startOffset="50%"
            textAnchor="middle"
          >
            {data!.label}
          </textPath>
        </text>
      )}

      {/* 透明加粗路径，扩大点击/hover 区域 */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onDoubleClick={handleDoubleClick}
        style={{ cursor: "pointer" }}
      />

      {/* 编辑面板 + 操作按钮（HTML 层，可自由交互） */}
      <EdgeLabelRenderer>
        <div
          className="absolute pointer-events-auto"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          {editing ? (
            /* ===== 编辑模式 ===== */
            <div className="flex flex-col gap-1.5 bg-popover border border-border rounded-lg shadow-lg p-2 min-w-[200px]">
              <div className="flex items-center gap-1">
                <input
                  ref={editInputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleConfirm();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setEditing(false);
                      setInputValue(data?.label ?? "");
                    }
                  }}
                  placeholder="输入标签文字..."
                  className="flex-1 text-xs bg-transparent border-b border-input focus:outline-none focus:border-primary px-1 py-0.5"
                />
                <button
                  onClick={handleConfirm}
                  className="p-1 rounded hover:bg-accent text-green-600"
                  title="确认"
                >
                  <Check className="w-3 h-3" />
                </button>
                <button
                  onClick={() => {
                    setEditing(false);
                    setInputValue(data?.label ?? "");
                  }}
                  className="p-1 rounded hover:bg-accent text-red-600"
                  title="取消"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>

              {/* 预设标签快捷选择 */}
              <div className="flex flex-wrap gap-1">
                {PRESET_LABELS.map((preset) => (
                  <button
                    key={preset}
                    onClick={() => handlePreset(preset)}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-primary hover:text-primary-foreground text-muted-foreground transition-colors"
                  >
                    {preset}
                  </button>
                ))}
                <button
                  onClick={handleClear}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-destructive hover:text-destructive-foreground text-muted-foreground transition-colors"
                >
                  无文字
                </button>
              </div>
            </div>
          ) : (
            /* ===== 展示模式：hover 操作按钮 ===== */
            <div className="group/edge flex items-center gap-1">
              {/* 无标签时显示一个小圆点作为视觉锚点 */}
              {!hasLabel && (
                <span
                  onDoubleClick={handleDoubleClick}
                  className={cn(
                    "w-1.5 h-1.5 rounded-full transition-colors cursor-pointer",
                    selected
                      ? "bg-primary"
                      : "bg-muted-foreground/40 group-hover/edge:bg-primary"
                  )}
                  title="双击添加标签"
                />
              )}

              {/* hover 操作按钮 */}
              <div className="flex items-center gap-0.5 opacity-0 group-hover/edge:opacity-100 transition-opacity">
                <button
                  onClick={() => setEditing(true)}
                  className="p-0.5 rounded bg-background border border-border/60 shadow-sm hover:bg-accent text-muted-foreground hover:text-foreground"
                  title="编辑标签"
                >
                  <Edit3 className="w-2.5 h-2.5" />
                </button>
                <button
                  onClick={handleDelete}
                  className="p-0.5 rounded bg-background border border-border/60 shadow-sm hover:bg-destructive hover:text-destructive-foreground text-muted-foreground"
                  title="删除连线"
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const FreeCardEdge = FreeCardEdgeComponent;

/** 创建带 FreeCardEdge 类型的边工厂函数 */
export function createFreeCardEdge(
  connection: Edge
): Edge<FreeCardEdgeData> {
  return {
    ...connection,
    type: "freeEdge",
    data: { label: "" },
  };
}
