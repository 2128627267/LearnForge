"use client";

import { memo, useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  Handle,
  Position,
  NodeProps,
  useReactFlow,
  type Node,
} from "reactflow";
import { cn } from "@/lib/utils/cn";
import {
  Edit3,
  X,
  Star,
  CircleDot,
  CircleHelp,
  CircleCheck,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Layers,
  Sparkles,
} from "lucide-react";
import { RichCardContent } from "./rich-card-content";

/**
 * 层级调整操作类型
 *
 * - front:    置顶（设为最高 zIndex + 1）
 * - back:     置底（设为最低 zIndex - 1）
 * - forward:  上移一层（zIndex + 1）
 * - backward: 下移一层（zIndex - 1）
 * - set:      直接设置指定值
 */
type ZIndexAction = "front" | "back" | "forward" | "backward" | "set";

/**
 * 自由卡片节点（React Flow 自定义节点）
 *
 * 视觉设计：
 * - 左侧 4px 色条作为视觉锚点（颜色由首标签决定）
 * - 选中态：ring + 阴影 + 轻微上浮
 * - 连接点：8 方向（上下左右 + 4 斜角），hover 时显示
 * - 标签：彩色圆点 + 文本
 *
 * 交互：
 * - 拖拽（React Flow 内置）
 * - 编辑（点击编辑按钮，富文本编辑器）
 * - 连线（8 方向 Handle，配合 ConnectionMode.Loose）
 * - 层级（重叠时显示前后置按钮，点击调整 z-index）
 * - 学习状态（3 档：新/学习中/已掌握，边框颜色可视化）
 * - 分组（groupId 标识，同组卡片显示分组色条）
 */

export interface FreeCardData {
  title: string;
  /** 内容字段：纯文本（含 LaTeX）或 HTML 字符串（来自 Tiptap） */
  content: string;
  tags: string[];
  /** 卡片主色（用于左侧色条），未指定时根据首标签计算 */
  color?: string;
  width?: number;
  /** 是否收藏 */
  favorite?: boolean;
  /**
   * 卡片类型（决定视觉样式和默认模板）
   * - word: 英语单词
   * - phrase: 英语短语
   * - math: 数学公式/定理
   * - code: 代码片段
   * - concept: 概念知识点
   * - general: 通用卡片（默认）
   */
  cardType?: "word" | "phrase" | "math" | "code" | "concept" | "general";
  /** 学习状态（用于学习状态可视化，0=新/1=学习中/2=已掌握） */
  learningStatus?: 0 | 1 | 2;
  /**
   * 分组 ID（由对齐工具栏的"编组"按钮设置）
   * 同 groupId 的卡片在视觉上显示分组色条
   */
  groupId?: string;
  /** 学习模式：deep 深度学习 / review 复式学习 / both 两者（由对话框设置） */
  learningMode?: "deep" | "review" | "both";
  /** 获取标签颜色（由 CardCanvas 注入，W3 修复：使用存储的颜色） */
  getTagColor?: (tagName: string) => string | undefined;
  [key: string]: unknown;
}

/** 标签颜色调色板（仅保留色值，用于色点/色条） */
const TAG_COLOR_VALUES = [
  "#3b82f6", // 蓝
  "#22c55e", // 绿
  "#a855f7", // 紫
  "#f97316", // 橙
  "#ec4899", // 粉
  "#14b8a6", // 青
  "#ef4444", // 红
  "#6b7280", // 灰
];

/**
 * 卡片类型配置（色条颜色 + 图标 + 中文标签）
 *
 * 用于根据 cardType 显示不同的视觉样式：
 *   - 左侧色条颜色
 *   - 标题旁的类型图标
 *   - 编辑时的类型选择
 */
const CARD_TYPE_CONFIG: Record<
  NonNullable<FreeCardData["cardType"]>,
  { color: string; label: string; icon: string }
> = {
  word: { color: "#3b82f6", label: "单词", icon: "W" },
  phrase: { color: "#22c55e", label: "短语", icon: "P" },
  math: { color: "#a855f7", label: "数学", icon: "∑" },
  code: { color: "#f97316", label: "代码", icon: "</>" },
  concept: { color: "#14b8a6", label: "概念", icon: "C" },
  general: { color: "#6b7280", label: "通用", icon: "·" },
};

/**
 * 学习状态配置（颜色 + 图标 + 中文标签）
 *
 * 0=新（蓝色）、1=学习中（橙色）、2=已掌握（绿色）
 * 用于：
 *   - 卡片边框颜色可视化
 *   - 编辑模式下的状态选择按钮
 *   - 非编辑模式下的快速切换按钮
 */
const LEARNING_STATUS_CONFIG = [
  {
    color: "#3b82f6",
    label: "新",
    icon: CircleHelp,
  },
  {
    color: "#f97316",
    label: "学习中",
    icon: CircleDot,
  },
  {
    color: "#22c55e",
    label: "已掌握",
    icon: CircleCheck,
  },
] as const;

/** 学习状态颜色数组（保持向后兼容，索引 0/1/2 对应状态） */
const LEARNING_STATUS_COLOR = LEARNING_STATUS_CONFIG.map(
  (c) => c.color
) as readonly string[];

/**
 * 根据 groupId 生成稳定的分组颜色
 * 用于在卡片右上角显示分组色条，同组卡片颜色一致
 */
function getGroupColor(groupId: string): string {
  // 复用 TAG_COLOR_VALUES 调色板
  let hash = 0;
  for (let i = 0; i < groupId.length; i++) {
    hash = (hash * 31 + groupId.charCodeAt(i)) | 0;
  }
  return TAG_COLOR_VALUES[Math.abs(hash) % TAG_COLOR_VALUES.length];
}

/** 根据标签名稳定选色（返回十六进制色值），作为无存储颜色时的回退 */
function getHashColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 31 + tag.charCodeAt(i)) | 0;
  }
  return TAG_COLOR_VALUES[Math.abs(hash) % TAG_COLOR_VALUES.length];
}

/** 获取标签颜色：优先用存储的颜色，否则用 hash 计算 */
function resolveTagColor(
  tag: string,
  getTagColor?: (tagName: string) => string | undefined
): string {
  return getTagColor?.(tag) || getHashColor(tag);
}

/**
 * 检测矩形重叠（AABB 碰撞检测）
 *
 * @param a 矩形 A {x, y, w, h}
 * @param b 矩形 B {x, y, w, h}
 * @returns 是否重叠
 */
function isOverlapping(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

/**
 * 8 方向连接点配置
 *
 * 每个方向包含：
 *   - position: React Flow Handle position（正方向）
 *   - style: 绝对定位（斜角用百分比偏移）
 *
 * 配合 ConnectionMode.Loose，source-source 连接也允许，
 * 因此每个方向只需 1 个 source Handle 即可双向连接。
 */
const HANDLES_8_DIR = [
  { id: "top", position: Position.Top, style: { left: "50%", top: "-5px", transform: "translateX(-50%)" } },
  { id: "right", position: Position.Right, style: { right: "-5px", top: "50%", transform: "translateY(-50%)" } },
  { id: "bottom", position: Position.Bottom, style: { left: "50%", bottom: "-5px", transform: "translateX(-50%)" } },
  { id: "left", position: Position.Left, style: { left: "-5px", top: "50%", transform: "translateY(-50%)" } },
  // 4 斜角（用绝对定位放到角落）
  { id: "ne", position: Position.Top, style: { right: "-5px", top: "-5px" } },
  { id: "se", position: Position.Bottom, style: { right: "-5px", bottom: "-5px" } },
  { id: "sw", position: Position.Bottom, style: { left: "-5px", bottom: "-5px" } },
  { id: "nw", position: Position.Top, style: { left: "-5px", top: "-5px" } },
] as const;

/**
 * 获取卡片的主题色（用于缩略图色条）
 *
 * 优先级：data.color > cardType 对应色 > 首标签 hash 色 > 默认蓝
 */
function getCardAccentColor(data: FreeCardData): string {
  if (data.color) return data.color;
  const cardType = data.cardType ?? "general";
  const typeColor = CARD_TYPE_CONFIG[cardType]?.color;
  if (typeColor) return typeColor;
  if (data.tags && data.tags.length > 0) {
    return resolveTagColor(data.tags[0], data.getTagColor);
  }
  return "#3b82f6";
}

/**
 * 可横向滚动的卡片缩略图行
 *
 * 每张卡片以缩略图形式显示（模拟实际卡片外观）：
 * - 左侧色条：与实际卡片的 accentColor 一致
 * - 类型图标：cardType 对应的图标（W/P/∑/</>/C/·）
 * - 卡片标题：点击设为面板内活动卡片
 * - 学习状态点：颜色对应掌握程度
 * - 上移/下移按钮：hover 时显示
 *
 * 选中方式：
 * - 点击缩略图：跳转视角到该卡片 + 选中（不改变 zIndex，面板保持打开）
 * - 双击缩略图：置顶该卡片
 *
 * 横向滚动（卡片过多时）：
 * - 鼠标滚轮：垂直滚轮转换为水平滚动
 * - 左右箭头：内容溢出时显示
 */
function CardListRow({
  cards,
  activeId,
  onSetActive,
  onJumpToCard,
  onAdjustCardZ,
}: {
  cards: Node[];
  /** 面板内当前活动的卡片 ID（高亮显示） */
  activeId: string;
  /** 设置面板内活动卡片（高亮，不跳转视角） */
  onSetActive: (cardId: string) => void;
  /** 跳转视角到指定卡片并选中（不改变 zIndex，面板保持打开） */
  onJumpToCard: (cardId: string) => void;
  onAdjustCardZ: (
    cardId: string,
    action: "up" | "down" | "top" | "bottom"
  ) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // 是否可以向左/向右滚动（用于控制箭头按钮显示）
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  /**
   * 更新滚动状态：检测当前是否可以左右滚动
   * 在 scroll 事件和卡片列表变化时调用
   */
  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(
      el.scrollLeft < el.scrollWidth - el.clientWidth - 1
    );
  }, []);

  // 卡片列表变化时重新检测溢出
  useEffect(() => {
    updateScrollState();
  }, [cards, updateScrollState]);

  /**
   * 平滑滚动指定距离
   * @param delta 水平滚动像素值（正=右移，负=左移）
   */
  const scrollBy = (delta: number) => {
    scrollRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  };

  return (
    <div className="mt-1 relative">
      {/*
        可滚动容器
        - overflow-x-auto 支持原生滚动
        - onWheel 将垂直滚轮转换为水平滚动
        - 隐藏滚动条（跨浏览器方案）
      */}
      <div
        ref={scrollRef}
        onScroll={updateScrollState}
        onWheel={(e) => {
          if (e.deltaY !== 0) {
            e.currentTarget.scrollLeft += e.deltaY;
            e.preventDefault();
          }
        }}
        className="flex gap-1.5 overflow-x-auto py-0.5"
        style={{
          scrollbarWidth: "none",
          msOverflowStyle: "none",
        }}
        data-scrollbar-hide=""
      >
        <style>{`
          [data-scrollbar-hide]::-webkit-scrollbar { display: none; }
        `}</style>
        {cards.map((n) => {
          const cardData = n.data as FreeCardData;
          const nodeTitle = cardData?.title || "未命名";
          const isActiveNode = n.id === activeId;
          // 卡片主题色（色条 + 图标背景）
          const accentColor = getCardAccentColor(cardData);
          // 卡片类型配置
          const cardType = cardData?.cardType ?? "general";
          const typeCfg = CARD_TYPE_CONFIG[cardType];
          // 学习状态颜色
          const statusIdx = cardData?.learningStatus ?? 0;
          const statusColor = LEARNING_STATUS_COLOR[statusIdx];

          return (
            <div
              key={n.id}
              onClick={(e) => {
                // 单击缩略图：跳转视角到该卡片 + 选中（不改变 zIndex）
                // 同时更新面板内活动卡片（高亮），面板保持打开
                e.stopPropagation();
                onSetActive(n.id);
                onJumpToCard(n.id);
              }}
              onDoubleClick={(e) => {
                // 双击：置顶该卡片
                e.stopPropagation();
                onAdjustCardZ(n.id, "top");
              }}
              className={cn(
                "group/thumb inline-flex items-center gap-1 flex-shrink-0",
                "rounded border overflow-hidden cursor-pointer",
                "transition-all duration-150",
                isActiveNode
                  ? "border-primary ring-1 ring-primary/50 bg-primary/5"
                  : "border-border/60 bg-card/60 hover:border-primary/40 hover:bg-accent/30"
              )}
              style={{
                filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.15))",
              }}
              title={`${nodeTitle}（点击跳转选中，双击置顶）`}
            >
              {/*
                左侧色条：与实际卡片视觉一致
                使用 accentColor，宽度 2px
              */}
              <div
                className="self-stretch w-[3px] flex-shrink-0"
                style={{ backgroundColor: accentColor }}
              />

              {/* 类型图标：带半透明背景色 */}
              {cardType !== "general" && (
                <span
                  className="inline-flex items-center justify-center text-[8px] font-bold w-4 h-4 rounded-sm flex-shrink-0 ml-1"
                  style={{
                    backgroundColor: accentColor + "25",
                    color: accentColor,
                  }}
                  title={typeCfg.label}
                >
                  {typeCfg.icon}
                </span>
              )}

              {/* 卡片标题：活动卡片高亮显示 */}
              <span
                className={cn(
                  "text-[11px] py-1 pr-1 truncate max-w-[120px]",
                  isActiveNode
                    ? "text-primary font-medium"
                    : "text-foreground/80"
                )}
              >
                {nodeTitle}
              </span>

              {/* 学习状态指示点：颜色对应掌握程度 */}
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: statusColor }}
                title={`状态：${LEARNING_STATUS_CONFIG[statusIdx].label}`}
              />

              {/*
                操作按钮组：hover 时显示
                - 上移/下移：调整 zIndex
              */}
              <div className="flex items-center gap-0.5 pr-1 opacity-0 group-hover/thumb:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAdjustCardZ(n.id, "up");
                  }}
                  className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-primary transition-colors"
                  title="上移一层"
                >
                  <ChevronUp className="w-3 h-3" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAdjustCardZ(n.id, "down");
                  }}
                  className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-primary transition-colors"
                  title="下移一层"
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/*
        左箭头：内容溢出且可向左滚动时显示
      */}
      {canScrollLeft && (
        <button
          onClick={() => scrollBy(-80)}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 p-0.5 rounded bg-popover/80 hover:bg-accent text-foreground shadow-sm transition-opacity"
          title="向左滚动"
        >
          <ChevronLeft className="w-3 h-3" />
        </button>
      )}
      {/*
        右箭头：内容溢出且可向右滚动时显示
      */}
      {canScrollRight && (
        <button
          onClick={() => scrollBy(80)}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 p-0.5 rounded bg-popover/80 hover:bg-accent text-foreground shadow-sm transition-opacity"
          title="向右滚动"
        >
          <ChevronRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

/**
 * 层级管理面板（覆盖在卡片上方）
 *
 * 管理全部重叠卡片，无需切换 React Flow 选中状态：
 * - 面板内部维护 activeCardId（当前操作的卡片），默认为打开面板时的卡片
 * - 点击缩略图：在面板内切换 activeCardId（不关闭面板，不切换画布选中）
 * - 双击缩略图：置顶该卡片
 * - 上移/下移按钮：直接调整对应卡片的 zIndex
 * - 面板保持打开，直到用户点击关闭或外部遮罩
 *
 * 按层级分组显示：
 * - 将所有重叠卡片按 zIndex 分组，相同 zIndex 的卡片属于同一层
 * - 每层显示"第N层" + 缩略图列表
 * - hover 某层时，该层所有卡片在画布上亮起
 *
 * 支持夜间模式：所有颜色使用 CSS 变量。
 */
function LayerPanel({
  currentId,
  nodes,
  onSwapLayer,
  onAdjustCardZ,
  onJumpToCard,
  onClose,
}: {
  currentId: string;
  /** 所有需要展示的节点（当前卡片 + 重叠卡片） */
  nodes: Node[];
  /** 交换两个层级的 zIndex 值 */
  onSwapLayer: (sourceZ: number, targetZ: number) => void;
  /** 调整单个卡片的 zIndex（up=上移一层, down=下移一层, top=置顶, bottom=置底） */
  onAdjustCardZ: (
    cardId: string,
    action: "up" | "down" | "top" | "bottom"
  ) => void;
  /** 跳转视角到指定卡片并选中（不改变 zIndex，面板保持打开） */
  onJumpToCard: (cardId: string) => void;
  onClose: () => void;
}) {
  /**
   * 面板内当前操作的卡片 ID
   * - 点击缩略图时更新，不切换 React Flow 选中状态
   * - 用于高亮显示当前操作的卡片，以及作为双击置顶的目标
   */
  const [activeCardId, setActiveCardId] = useState(currentId);
  // 按 zIndex 分组，然后按 zIndex 降序排列（最上层为第一层）
  const layers = useMemo(() => {
    const layerMap = new Map<number, Node[]>();
    nodes.forEach((node) => {
      const z = node.zIndex ?? 1;
      if (!layerMap.has(z)) {
        layerMap.set(z, []);
      }
      layerMap.get(z)!.push(node);
    });
    // 按 zIndex 降序排列（最上层在前）
    return Array.from(layerMap.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([z, layerNodes]) => ({ z, nodes: layerNodes }));
  }, [nodes]);

  /**
   * 高亮指定层级的所有卡片
   * 通过 window 自定义事件通知画布上的卡片节点添加亮光效果
   */
  const handleHoverLayer = (nodeIds: string[] | null) => {
    window.dispatchEvent(
      new CustomEvent("canvas:highlight-nodes", { detail: nodeIds })
    );
  };

  return (
    <>
      {/* 透明遮罩：点击外部关闭面板 */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        aria-hidden
      />
      {/*
        面板主体：直接覆盖在卡片上方（inset-0 与卡片完全重合）
        - 半透明毛玻璃效果：bg-popover/70 + backdrop-blur-md
          → 可以透出下层卡片轮廓，同时保证面板内容可读
        - 文字添加 drop-shadow 防止与下层卡片内容混淆
        - z-50 确保浮在卡片所有内容之上
        - 圆角和边框与卡片对齐，视觉上融为一体
      */}
      <div
        className={cn(
          "absolute inset-0 z-50 rounded-lg overflow-hidden",
          "flex flex-col",
          "bg-popover/70 backdrop-blur-md",
          "border border-primary/40",
          "shadow-xl"
        )}
      >
        {/*
          面板头部：标题 + 关闭按钮
          使用更深的半透明背景，增强标题区域对比度
        */}
        <div className="flex items-center justify-between px-3 py-2 bg-popover/80 border-b border-border/50">
          <div
            className="flex items-center gap-1.5 text-sm font-semibold text-foreground"
            style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.3))" }}
          >
            <Layers className="w-4 h-4 text-primary" />
            层级管理
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors"
            title="关闭"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/*
          层级列表（按层级分组）
          - 鼠标离开时清除高亮
          - flex-1 + overflow-y-auto 自适应卡片高度，内容超出滚动
        */}
        <div
          className="flex-1 overflow-y-auto py-1 min-h-0"
          onMouseLeave={() => handleHoverLayer(null)}
        >
          {layers.map((layer, idx) => {
            const layerNumber = idx + 1; // 第一层在最上面
            const nodeIds = layer.nodes.map((n) => n.id);
            const hasCurrent = layer.nodes.some((n) => n.id === activeCardId);
            const canMoveUp = idx > 0; // 不是最上层
            const canMoveDown = idx < layers.length - 1; // 不是最下层
            return (
              <div
                key={layer.z}
                className={cn(
                  "px-3 py-1.5 transition-colors cursor-default border-l-2",
                  hasCurrent
                    ? "bg-primary/20 border-primary"
                    : "border-transparent hover:bg-accent/40"
                )}
                onMouseEnter={() => handleHoverLayer(nodeIds)}
              >
                {/*
                  层级标题行：第N层 + 卡片数量 + 当前标记 + 上移/下移按钮
                  文字添加阴影，确保在半透明背景上清晰
                */}
                <div className="flex items-center justify-between gap-2">
                  <div
                    className="flex items-center gap-1.5 min-w-0"
                    style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.3))" }}
                  >
                    <span className="text-sm font-semibold text-foreground flex-shrink-0">
                      第{layerNumber}层
                    </span>
                    <span className="text-[11px] text-muted-foreground flex-shrink-0">
                      （{layer.nodes.length}张）
                    </span>
                    {hasCurrent && (
                      <span className="text-[10px] text-primary font-medium flex-shrink-0">
                        ● 当前
                      </span>
                    )}
                  </div>
                  {/*
                    上移/下移按钮（与相邻层交换 zIndex）
                    增大点击区域至 p-1，图标 w-4 h-4，提升可点击性
                  */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (canMoveUp) {
                          onSwapLayer(layer.z, layers[idx - 1].z);
                        }
                      }}
                      disabled={!canMoveUp}
                      className={cn(
                        "p-1 rounded transition-colors",
                        canMoveUp
                          ? "hover:bg-accent text-muted-foreground hover:text-primary"
                          : "text-muted-foreground/30 cursor-not-allowed"
                      )}
                      title="上移一层"
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (canMoveDown) {
                          onSwapLayer(layer.z, layers[idx + 1].z);
                        }
                      }}
                      disabled={!canMoveDown}
                      className={cn(
                        "p-1 rounded transition-colors",
                        canMoveDown
                          ? "hover:bg-accent text-muted-foreground hover:text-primary"
                          : "text-muted-foreground/30 cursor-not-allowed"
                      )}
                      title="下移一层"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {/*
                  包含的卡片名称（可横向滚动）
                  - 点击卡片名称：选中该卡片
                  - 名称旁有上移/下移按钮：直接调整该卡片层级
                  - 内容超出时：滚轮横向滚动 + 左右箭头
                */}
                <CardListRow
                  cards={layer.nodes}
                  activeId={activeCardId}
                  onSetActive={setActiveCardId}
                  onJumpToCard={onJumpToCard}
                  onAdjustCardZ={onAdjustCardZ}
                />
              </div>
            );
          })}
        </div>

        {/*
          面板底部说明
          使用更深的半透明背景，与头部呼应
        */}
        <div className="px-3 py-1.5 bg-popover/80 border-t border-border/50 text-[10px] text-muted-foreground">
          点击缩略图跳转选中 · 双击置顶 · 悬停高亮
        </div>
      </div>
    </>
  );
}

function FreeCardNodeComponent({ id, data, selected, zIndex, xPos, yPos }: NodeProps<FreeCardData>) {
  const [learningStatus, setLearningStatus] =
    useState<NonNullable<FreeCardData["learningStatus"]>>(
      data.learningStatus ?? 0
    );
  // 层级面板是否展开（点击"层级面板"按钮切换）
  const [layerPanelOpen, setLayerPanelOpen] = useState(false);
  // 当前被高亮的卡片 ID 集合（由层级面板 hover 触发，用于画布上亮光效果）
  const [highlightedIds, setHighlightedIds] = useState<Set<string> | null>(null);
  const cardWidth = data.width || 280;
  const { getNodes, setNodes } = useReactFlow();

  // 面板打开时提升当前卡片到最上层（修复：内层 style.zIndex 无法跨越 React Flow
  // 外层容器的层叠上下文，必须通过 setNodes 提升 node.zIndex 才能让面板覆盖其他卡片）
  // 仅在当前卡片不是最高层时提升，避免循环更新
  useEffect(() => {
    if (!layerPanelOpen) return;
    setNodes((nds) => {
      const maxZ = nds.reduce(
        (max, n) => Math.max(max, n.zIndex ?? 1),
        -Infinity
      );
      const current = nds.find((n) => n.id === id);
      const currentZ = current?.zIndex ?? 1;
      // 已经是最高层则无需修改，避免不必要的 state 更新
      if (currentZ >= maxZ) return nds;
      return nds.map((n) => (n.id === id ? { ...n, zIndex: maxZ + 1 } : n));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerPanelOpen]);

  // 监听层级面板的 hover 高亮事件
  // 当用户在层级面板中 hover 某层时，该层所有卡片在画布上亮起
  useEffect(() => {
    const handleHighlight = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail === null) {
        setHighlightedIds(null);
      } else if (Array.isArray(detail)) {
        setHighlightedIds(new Set(detail as string[]));
      }
    };
    window.addEventListener("canvas:highlight-nodes", handleHighlight);
    return () =>
      window.removeEventListener("canvas:highlight-nodes", handleHighlight);
  }, []);

  // 当前卡片是否被高亮（在层级面板中 hover 时）
  const isHighlighted = highlightedIds?.has(id) ?? false;

  // 同步外部数据变更（学习状态由对话框等外部途径更新时同步到本地状态）
  useEffect(() => {
    setLearningStatus(data.learningStatus ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.learningStatus]);

  /**
   * 快速切换学习状态（卡片上直接可用）
   *
   * 点击循环切换：0 → 1 → 2 → 0
   * 直接通过 onUpdate 提交，无需进入编辑模式
   */
  const cycleLearningStatus = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = ((learningStatus + 1) % 3) as 0 | 1 | 2;
    setLearningStatus(next);
    const onUpdate = (data as FreeCardData & {
      onUpdate?: (d: Partial<FreeCardData>) => void;
    }).onUpdate;
    if (typeof onUpdate === "function") {
      onUpdate({ learningStatus: next });
    }
  };

  /**
   * 检测当前卡片与其他卡片的重叠情况
   *
   * 通过 React Flow 的 getNodes() 获取所有节点位置和尺寸，
   * 使用 AABB 碰撞检测判断当前节点与哪些其他节点重叠。
   *
   * 返回：
   *   - isOverlapping:    是否存在重叠
   *   - overlappingNodes: 重叠卡片列表（按 zIndex 降序，最上层在前）
   *
   * 仅在 selected 时检测（减少性能开销）。
   */
  const overlappingInfo = useMemo(() => {
    const allNodes = getNodes();
    const currentNode = allNodes.find((n) => n.id === id);
    if (!currentNode) {
      return { isOverlapping: false, overlappingNodes: [] as Node[] };
    }
    // 使用当前卡片的已知尺寸作为默认值（React Flow 测量前 width/height 为 undefined）
    // 避免因尺寸未测量导致重叠检测始终为 false
    const cw = currentNode.width ?? cardWidth;
    const ch = currentNode.height ?? 200;
    const overlappingNodes = allNodes.filter((n) => {
      if (n.id === id) return false;
      // 对每个其他节点也使用合理的默认尺寸
      const nw = n.width ?? (n.data as FreeCardData)?.width ?? 280;
      const nh = n.height ?? 200;
      return isOverlapping(
        { x: currentNode.position.x, y: currentNode.position.y, w: cw, h: ch },
        { x: n.position.x, y: n.position.y, w: nw, h: nh }
      );
    });
    // 按 zIndex 降序排列（最上层在前）；zIndex 相同时按 id 稳定排序
    overlappingNodes.sort((a, b) => {
      const za = a.zIndex ?? 1;
      const zb = b.zIndex ?? 1;
      if (za !== zb) return zb - za;
      return a.id.localeCompare(b.id);
    });
    return { isOverlapping: overlappingNodes.length > 0, overlappingNodes };
    // 依赖 xPos/yPos：拖动当前卡片时实时更新重叠检测；
    // 依赖 zIndex：层级调整后更新；selected：选中时重新计算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, getNodes, cardWidth, xPos, yPos, zIndex, selected]);

  // 解构以便在 JSX 中直接使用
  const { isOverlapping: overlapping, overlappingNodes } = overlappingInfo;

  /**
   * 调整卡片的 z-index（支持五种操作模式）
   *
   * - front:    置顶（设为所有节点最高 zIndex + 1）
   * - back:     置底（设为所有节点最低 zIndex - 1）
   * - forward:  上移一层（zIndex + 1）
   * - backward: 下移一层（zIndex - 1）
   * - set:      直接设置指定值
   *
   * @param action    操作类型
   * @param targetId  目标卡片 ID（默认当前卡片，层级面板中可能操作其他卡片）
   * @param value     指定值（仅 set 模式使用）
   */
  const adjustZIndex = (
    action: ZIndexAction,
    targetId?: string,
    value?: number
  ) => {
    const tid = targetId ?? id;
    setNodes((nds) => {
      const target = nds.find((n) => n.id === tid);
      if (!target) return nds;
      const currentZ = target.zIndex ?? 1;
      let newZ: number;
      switch (action) {
        case "front": {
          // 设为所有节点最高 zIndex + 1
          const maxZ = nds.reduce(
            (max, n) => Math.max(max, n.zIndex ?? 1),
            -Infinity
          );
          newZ = (isFinite(maxZ) ? maxZ : 0) + 1;
          break;
        }
        case "back": {
          // 设为所有节点最低 zIndex - 1
          const minZ = nds.reduce(
            (min, n) => Math.min(min, n.zIndex ?? 1),
            Infinity
          );
          newZ = (isFinite(minZ) ? minZ : 0) - 1;
          break;
        }
        case "forward":
          newZ = currentZ + 1;
          break;
        case "backward":
          newZ = currentZ - 1;
          break;
        case "set":
          newZ = value ?? currentZ;
          break;
        default:
          return nds;
      }
      return nds.map((n: Node) =>
        n.id === tid ? { ...n, zIndex: newZ } : n
      );
    });
  };

  /**
   * 交换两个层级的 zIndex 值
   *
   * 将所有 zIndex === sourceZ 的卡片设为 targetZ，
   * 所有 zIndex === targetZ 的卡片设为 sourceZ。
   * 用于层级面板中"上移/下移"操作（与相邻层交换位置）。
   */
  const swapLayerZIndex = (sourceZ: number, targetZ: number) => {
    setNodes((nds) =>
      nds.map((n: Node) => {
        const z = n.zIndex ?? 1;
        if (z === sourceZ) return { ...n, zIndex: targetZ };
        if (z === targetZ) return { ...n, zIndex: sourceZ };
        return n;
      })
    );
  };

  /**
   * 调整单个卡片的 zIndex（在层级面板中点击单卡上移/下移按钮时调用）
   *
   * 将 CardListRow 的简化 action 映射到 adjustZIndex 的 ZIndexAction：
   * - "up"     → "forward"（上移一层，zIndex + 1）
   * - "down"   → "backward"（下移一层，zIndex - 1）
   * - "top"    → "front"（置顶）
   * - "bottom" → "back"（置底）
   *
   * @param cardId 目标卡片 ID
   * @param action 移动方向
   */
  const handleAdjustCardZ = useCallback(
    (cardId: string, action: "up" | "down" | "top" | "bottom") => {
      const actionMap: Record<typeof action, ZIndexAction> = {
        up: "forward",
        down: "backward",
        top: "front",
        bottom: "back",
      };
      adjustZIndex(actionMap[action], cardId);
    },
    // adjustZIndex 依赖 setNodes（来自 useReactFlow，稳定引用）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  /**
   * 跳转视角到指定卡片并选中（在层级面板中点击缩略图时调用）
   *
   * 行为：
   * 1. 使用 fitView 将画布视角平滑移动到目标卡片正中央
   * 2. 通过自定义事件通知 card-canvas 选中目标卡片（更新 selected 属性）
   * 3. 面板保持打开（不关闭）
   *
   * 注意：
   * - 选中不改变 zIndex，卡片不会跳到最前层
   * - 使用自定义事件而非 useReactFlow.setNodes，
   *   因为受控模式下 useReactFlow.setNodes 不会触发组件重渲染
   *
   * @param cardId 目标卡片 ID
   */
  const handleJumpToCard = useCallback((cardId: string) => {
    // 通过自定义事件通知 card-canvas 执行跳转 + 选中
    // 在 card-canvas 中使用 rfInstance.fitView（受控模式下可靠），
    // 而非 useReactFlow.fitView（受控模式下可能不生效）
    window.dispatchEvent(
      new CustomEvent("canvas:jump-to-card", { detail: cardId })
    );
  }, []);

  // 卡片主色：优先用 data.color，否则用 cardType 对应颜色，再回退到首标签色
  // 注意：此处使用 data.cardType 而非编辑态 cardType（避免非编辑态颜色闪烁）
  const currentCardType = data.cardType ?? "general";
  const typeConfig =
    CARD_TYPE_CONFIG[currentCardType] ?? CARD_TYPE_CONFIG.general;
  const accentColor =
    data.color ||
    typeConfig.color ||
    ((data.tags ?? []).length > 0
      ? resolveTagColor((data.tags ?? [])[0], data.getTagColor)
      : "#3b82f6");

  // 学习状态边框颜色（learningStatus 可视化）
  const currentStatus = data.learningStatus ?? 0;
  const statusColor = LEARNING_STATUS_COLOR[currentStatus];
  // 当前学习状态的配置（图标 + 标签）
  // 注意：将 icon 赋值给大写变量 StatusIcon，以便在 JSX 中作为组件使用
  const statusConfig = LEARNING_STATUS_CONFIG[currentStatus];
  const StatusIcon = statusConfig.icon;

  // 分组颜色（同组卡片显示同色色条，便于视觉识别）
  const groupColor = data.groupId ? getGroupColor(data.groupId) : null;

  // 从 NodeProps 获取 zIndex（React Flow 节点的层级，用于样式控制）
  // 注意：zIndex 在 NodeProps 上，不在 data 里（之前错误地从 data 取导致总是 undefined）
  const nodeZIndex = zIndex;

  return (
    <div
      className={cn(
        "group relative rounded-lg bg-card shadow-sm",
        "border border-border/60",
        "transition-[box-shadow,transform] duration-200 ease-out",
        "hover:shadow-md hover:border-border",
        selected && "shadow-lg ring-2 ring-primary/70 -translate-y-0.5",
        // 层级面板 hover 时的高亮效果：显眼的亮光
        isHighlighted &&
          "ring-2 ring-amber-400 shadow-lg shadow-amber-400/50 z-[9999]"
      )}
      style={{
        width: cardWidth,
        // 面板打开时提高 zIndex，确保面板覆盖在其他卡片上方
        zIndex: layerPanelOpen
          ? 9999
          : nodeZIndex ?? (selected ? 10 : 1),
        // 学习状态可视化：用边框颜色表示掌握程度（选中时不显示，避免与 ring 冲突）
        ...(!selected
          ? { borderColor: statusColor, borderWidth: "2px" }
          : {}),
      }}
    >
      {/* 左侧色条（视觉锚点） */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg"
        style={{ backgroundColor: accentColor }}
        aria-hidden
      />

      {/* 分组色条（右上角，同组卡片颜色一致） */}
      {groupColor && (
        <div
          className="absolute top-0 right-0 h-1 rounded-tr-lg"
          style={{
            backgroundColor: groupColor,
            width: "30%",
          }}
          aria-hidden
          title={`分组：${data.groupId}`}
        />
      )}

      {/* 8 方向连接点（hover 时显示） */}
      {HANDLES_8_DIR.map((h) => (
        <Handle
          key={h.id}
          id={h.id}
          type="source"
          position={h.position}
          className={cn(
            "!w-2.5 !h-2.5 !border-2 !border-background !bg-muted-foreground/60",
            "opacity-0 group-hover:opacity-100 transition-opacity",
            "hover:!bg-primary hover:!scale-125"
          )}
          style={h.style as React.CSSProperties}
        />
      ))}
      {/* 隐藏的 target Handle（配合 ConnectionMode.Loose 接收连线） */}
      <Handle
        type="target"
        position={Position.Left}
        className="!opacity-0 !w-0 !h-0"
        id="target-hidden"
      />

      {/* 卡片头部 */}
      <div className="flex items-start justify-between gap-2 pl-4 pr-3 pt-3 pb-1">
        <h3 className="font-semibold text-sm flex-1 truncate text-foreground flex items-center gap-1.5">
          {/* 类型标识（小图标 + 颜色点） */}
          {currentCardType !== "general" && (
            <span
              className="inline-flex items-center justify-center text-[9px] font-bold w-4 h-4 rounded flex-shrink-0"
              style={{
                backgroundColor: typeConfig.color + "20",
                color: typeConfig.color,
              }}
              title={typeConfig.label}
            >
              {typeConfig.icon}
            </span>
          )}
          <span className="truncate">{data.title || "未命名卡片"}</span>
          {/* 学习模式徽章 */}
          {data.learningMode === "review" && (
            <span className="text-[9px] px-1 py-0.5 rounded-full bg-accent text-muted-foreground">复式</span>
          )}
          {data.learningMode === "both" && (
            <span className="text-[9px] px-1 py-0.5 rounded-full bg-accent text-muted-foreground">深度+复式</span>
          )}
        </h3>

        <div
          className={cn(
            "flex items-center gap-1 transition-opacity",
            selected
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100"
          )}
        >
          {/*
            层级面板入口（hover 时可见）
            不限制选中 + 重叠条件，即使没有重叠也可以打开面板查看当前层级
            当存在重叠卡片时，徽章显示总卡片数
          */}
          <button
            onClick={() => setLayerPanelOpen((o) => !o)}
            className={cn(
              "p-1 rounded hover:bg-accent text-muted-foreground hover:text-primary relative transition-colors",
              layerPanelOpen && "bg-accent text-primary"
            )}
            title={overlapping ? `管理层级（共 ${overlappingNodes.length + 1} 张重叠卡片）` : "层级管理"}
          >
            <Layers className="w-3.5 h-3.5" />
            {/* 存在重叠时显示卡片数量徽章（含当前卡片，故 +1） */}
            {overlapping && (
              <span className="absolute -top-1 -right-1 text-[8px] bg-primary text-primary-foreground rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold leading-none">
                {overlappingNodes.length + 1}
              </span>
            )}
          </button>
          {/* 学习状态快速切换按钮（循环切换 0→1→2→0） */}
          <button
            onClick={cycleLearningStatus}
            className="p-1 rounded hover:bg-accent transition-colors"
            style={{ color: statusColor }}
            title={`学习状态：${statusConfig.label}（点击切换）`}
          >
            <StatusIcon className="w-3.5 h-3.5" />
          </button>
          {/* AI 提问按钮（打开卡片对话框 AI 面板） */}
          <button
            onClick={() =>
              window.dispatchEvent(new CustomEvent("canvas:ai-card", { detail: id }))
            }
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-primary"
            title="AI 提问"
          >
            <Sparkles className="w-3.5 h-3.5" />
          </button>
          {/* 编辑按钮（打开卡片对话框） */}
          <button
            onClick={() =>
              window.dispatchEvent(new CustomEvent("canvas:edit-card", { detail: id }))
            }
            className="p-1 rounded hover:bg-accent text-muted-foreground"
            title="编辑"
          >
            <Edit3 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 卡片内容 */}
      <div className="pl-4 pr-3 pb-2">
        <div className="text-xs overflow-hidden line-clamp-[8] max-h-[200px] text-foreground/90">
          <RichCardContent content={data.content} />
        </div>
      </div>

      {/* 标签区（色点 + 文本） */}
      {(data.tags ?? []).length > 0 && (
        <div className="pl-4 pr-3 pb-2 flex items-center gap-1.5 flex-wrap">
          {(data.tags ?? []).map((tag) => {
            const color = resolveTagColor(tag, data.getTagColor);
            return (
              <span
                key={tag}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground"
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                {tag}
              </span>
            );
          })}
        </div>
      )}

      {/* 底部信息栏 */}
      {(data.favorite || groupColor) && (
        <div className="pl-4 pr-3 py-1.5 border-t border-border/40 flex items-center justify-end gap-2 text-xs text-muted-foreground">
          {/* 分组标识 */}
          {groupColor && (
            <span
              className="inline-flex items-center gap-1 text-[10px]"
              title={`分组：${data.groupId}`}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: groupColor }}
              />
              分组
            </span>
          )}
          {data.favorite && (
            <Star className="w-3 h-3 fill-yellow-500 text-yellow-500" />
          )}
        </div>
      )}

      {/*
        层级面板（覆盖在卡片上方）
        - 必须作为卡片根元素的直接子元素，这样 absolute inset-0 才能相对于整个卡片定位
        - 不依赖 selected：面板打开后保持打开，用户可以在面板中选中其他卡片（跳转视角）
        - 不依赖 overlapping：即使没有重叠也可以打开面板查看当前层级
        - 面板开启时渲染
      */}
      {layerPanelOpen && (
        <LayerPanel
          currentId={id}
          nodes={[
            // 当前卡片
            ...getNodes()
              .filter((n) => n.id === id)
              .map((n) => ({ ...n, data: n.data as FreeCardData })),
            // 重叠卡片（没有重叠时为空数组）
            ...overlappingNodes,
          ]}
          onSwapLayer={swapLayerZIndex}
          onAdjustCardZ={handleAdjustCardZ}
          onJumpToCard={handleJumpToCard}
          onClose={() => setLayerPanelOpen(false)}
        />
      )}
    </div>
  );
}

export const FreeCardNode = memo(FreeCardNodeComponent);
