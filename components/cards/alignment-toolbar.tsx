"use client";

import { useReactFlow, type Node } from "reactflow";
import {
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignHorizontalSpaceAround,
  AlignVerticalSpaceAround,
  Group,
  Ungroup,
} from "lucide-react";
import type { FreeCardData } from "./free-card-node";
import { cn } from "@/lib/utils/cn";

/**
 * 对齐工具栏
 *
 * 显示时机：选中 ≥ 2 个节点时浮动显示
 *
 * 功能：
 *   1. 6 种基础对齐：左/右/上/下/水平居中/垂直居中
 *   2. 2 种分布对齐：水平等距分布/垂直等距分布（需 ≥ 3 个节点）
 *   3. 分组/取消分组：将多个节点编组（groupId），同组节点可一起移动
 *
 * 实现要点：
 *   - 对齐操作基于选中节点的 bounding box（包围盒）
 *   - 分布操作按节点中心点排序后等距排列
 *   - 分组仅设置 groupId 字段，由节点组件读取并显示分组标识
 *   - 对齐/分布操作通过 setNodes 更新 position
 */

/** 对齐工具栏的 props */
interface AlignmentToolbarProps {
  /** 当前选中的节点 ID 列表（用于显示分组按钮状态） */
  selectedCount: number;
}

/**
 * 对齐方向配置
 * - icon: lucide 图标
 * - title: 悬浮提示
 * - align: 对齐方式标识
 */
const ALIGN_ACTIONS = [
  { align: "left" as const, icon: AlignStartVertical, title: "左对齐" },
  { align: "hcenter" as const, icon: AlignCenterVertical, title: "水平居中" },
  { align: "right" as const, icon: AlignEndVertical, title: "右对齐" },
  { align: "top" as const, icon: AlignStartHorizontal, title: "顶对齐" },
  { align: "vcenter" as const, icon: AlignCenterHorizontal, title: "垂直居中" },
  { align: "bottom" as const, icon: AlignEndHorizontal, title: "底对齐" },
];

/** 分布对齐配置（需 ≥ 3 个节点） */
const DISTRIBUTE_ACTIONS = [
  {
    distribute: "h" as const,
    icon: AlignHorizontalSpaceAround,
    title: "水平等距分布",
  },
  {
    distribute: "v" as const,
    icon: AlignVerticalSpaceAround,
    title: "垂直等距分布",
  },
];

/** 对齐方式类型 */
type AlignType = "left" | "right" | "top" | "bottom" | "hcenter" | "vcenter";
/** 分布方式类型 */
type DistributeType = "h" | "v";

export function AlignmentToolbar({ selectedCount }: AlignmentToolbarProps) {
  const { getNodes, setNodes } = useReactFlow();

  // 至少需要 2 个选中节点才显示工具栏
  // 直接使用 selectedCount prop 判断，避免 getNodes() 在 useMemo 中不同步
  if (selectedCount < 2) return null;

  /**
   * 获取当前选中的节点（实时获取，确保最新状态）
   * 每次对齐/分布操作时调用，避免缓存过期
   */
  const getSelectedNodes = (): Node<FreeCardData>[] => {
    return getNodes().filter(
      (n): n is Node<FreeCardData> =>
        !!n.selected && !!n.data && n.type === "freeCard"
    );
  };

  /**
   * 执行对齐操作
   *
   * 计算逻辑：
   *   - left:   所有节点 x = min(x)
   *   - right:  所有节点 x = max(x + w) - w
   *   - top:    所有节点 y = min(y)
   *   - bottom: 所有节点 y = max(y + h) - h
   *   - hcenter:所有节点 x = (minX + maxX + maxW) / 2 - w / 2
   *   - vcenter:所有节点 y = (minY + maxY + maxH) / 2 - h / 2
   */
  const handleAlign = (align: AlignType) => {
    const nodes = getSelectedNodes();
    if (nodes.length < 2) return;
    // 计算包围盒
    const xs = nodes.map((n) => n.position.x);
    const ys = nodes.map((n) => n.position.y);
    const rights = nodes.map((n) => n.position.x + (n.width ?? 280));
    const bottoms = nodes.map((n) => n.position.y + (n.height ?? 150));
    const minX = Math.min(...xs);
    const maxX = Math.max(...rights);
    const minY = Math.min(...ys);
    const maxY = Math.max(...bottoms);

    setNodes((nds) =>
      nds.map((n) => {
        if (!n.selected) return n;
        const w = n.width ?? 280;
        const h = n.height ?? 150;
        let { x, y } = n.position;
        switch (align) {
          case "left":
            x = minX;
            break;
          case "right":
            x = maxX - w;
            break;
          case "top":
            y = minY;
            break;
          case "bottom":
            y = maxY - h;
            break;
          case "hcenter":
            x = (minX + maxX) / 2 - w / 2;
            break;
          case "vcenter":
            y = (minY + maxY) / 2 - h / 2;
            break;
        }
        return { ...n, position: { x, y } };
      })
    );
  };

  /**
   * 执行分布操作
   *
   * 计算逻辑：
   *   - 水平分布：按 x 排序，首尾不动，中间节点等距分布
   *   - 垂直分布：按 y 排序，首尾不动，中间节点等距分布
   *
   * 需要 ≥ 3 个节点才有意义
   */
  const handleDistribute = (axis: DistributeType) => {
    const nodes = [...getSelectedNodes()];
    if (nodes.length < 3) return;

    // 按轴排序
    nodes.sort((a, b) =>
      axis === "h" ? a.position.x - b.position.x : a.position.y - b.position.y
    );

    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const firstCenter =
      axis === "h"
        ? first.position.x + (first.width ?? 280) / 2
        : first.position.y + (first.height ?? 150) / 2;
    const lastCenter =
      axis === "h"
        ? last.position.x + (last.width ?? 280) / 2
        : last.position.y + (last.height ?? 150) / 2;

    // 计算等距间隔
    const step = (lastCenter - firstCenter) / (nodes.length - 1);
    const selectedIds = new Set(nodes.map((n) => n.id));

    setNodes((nds) =>
      nds.map((n) => {
        if (!selectedIds.has(n.id)) return n;
        const idx = nodes.findIndex((nn) => nn.id === n.id);
        if (idx === -1) return n;
        const w = n.width ?? 280;
        const h = n.height ?? 150;
        const targetCenter = firstCenter + step * idx;
        if (axis === "h") {
          return {
            ...n,
            position: { x: targetCenter - w / 2, y: n.position.y },
          };
        } else {
          return {
            ...n,
            position: { x: n.position.x, y: targetCenter - h / 2 },
          };
        }
      })
    );
  };

  /**
   * 将选中节点编组
   * 生成一个 groupId 并设置到每个节点的 data.groupId
   * 同组节点在卡片组件中会显示分组色条
   */
  const handleGroup = () => {
    const groupId = `group-${Date.now()}`;
    setNodes((nds) =>
      nds.map((n) =>
        n.selected
          ? { ...n, data: { ...n.data, groupId } as FreeCardData }
          : n
      )
    );
  };

  /**
   * 取消选中节点的分组
   */
  const handleUngroup = () => {
    setNodes((nds) =>
      nds.map((n) => {
        if (!n.selected) return n;
        const data = { ...n.data } as FreeCardData;
        delete data.groupId;
        return { ...n, data };
      })
    );
  };

  return (
    <div
      className={cn(
        "absolute top-3 left-1/2 -translate-x-1/2 z-40",
        "flex items-center gap-0.5 px-1.5 py-1",
        "bg-card/95 backdrop-blur border border-border rounded-lg shadow-lg",
        "pointer-events-auto"
      )}
    >
      {/* 6 种基础对齐 */}
      {ALIGN_ACTIONS.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.align}
            onClick={() => handleAlign(action.align)}
            className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-primary transition-colors"
            title={action.title}
          >
            <Icon className="w-4 h-4" />
          </button>
        );
      })}

      {/* 分隔线 */}
      <div className="w-px h-5 bg-border mx-0.5" />

      {/* 2 种分布对齐（需 ≥ 3 个节点） */}
      {DISTRIBUTE_ACTIONS.map((action) => {
        const Icon = action.icon;
        const disabled = selectedCount < 3;
        return (
          <button
            key={action.distribute}
            onClick={() => handleDistribute(action.distribute)}
            disabled={disabled}
            className={cn(
              "p-1.5 rounded transition-colors",
              disabled
                ? "text-muted-foreground/30 cursor-not-allowed"
                : "text-muted-foreground hover:bg-accent hover:text-primary"
            )}
            title={
              disabled
                ? `${action.title}（需选中 ≥ 3 个节点）`
                : action.title
            }
          >
            <Icon className="w-4 h-4" />
          </button>
        );
      })}

      {/* 分隔线 */}
      <div className="w-px h-5 bg-border mx-0.5" />

      {/* 分组/取消分组 */}
      <button
        onClick={handleGroup}
        className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-primary transition-colors"
        title="编组"
      >
        <Group className="w-4 h-4" />
      </button>
      <button
        onClick={handleUngroup}
        className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-primary transition-colors"
        title="取消编组"
      >
        <Ungroup className="w-4 h-4" />
      </button>
    </div>
  );
}
