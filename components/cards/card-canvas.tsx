"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  ConnectionMode,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
  type OnConnect,
  type ReactFlowInstance,
  BackgroundVariant,
  ConnectionLineType,
} from "reactflow";
import "reactflow/dist/style.css";
import { FreeCardNode, type FreeCardData } from "./free-card-node";
import { AiReviewBridge } from "./ai-review-bridge";
import type { CardDialogState } from "./card-dialog-types";
import type { CardDialogPayload, CreateNodeItem } from "./card-dialog-types";
import {
  FreeCardEdge,
  createFreeCardEdge,
  type FreeCardEdgeData,
} from "./free-card-edge";
import { CardSearch } from "./card-search";
import { AlignmentToolbar } from "./alignment-toolbar";
import { useUndoableCanvas } from "@/lib/hooks/use-undoable-canvas";
import type { CanvasState } from "@/lib/hooks/use-local-storage";
import { matchesCardColor } from "@/lib/cards/color-categories";
import {
  exportWordTree,
  exportToLearnPack,
  downloadJSON,
  countExportableWords,
} from "@/lib/cards/export-adapters";
import { toast } from "@/components/shared/toaster";
import { Undo2, Redo2, Copy, ClipboardPaste } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import dynamic from "next/dynamic";

/**
 * 卡片对话框（P1 性能优化）：
 * 动态导入以将 Tiptap 富文本编辑器与 AI 面板移出画布页首屏 bundle，
 * 仅在用户打开对话框时按需加载。
 */
const CardDialog = dynamic(
  () => import("./card-dialog").then((m) => m.CardDialog),
  { ssr: false, loading: () => null }
);

/**
 * 卡片画布组件
 * 核心交互：自由拖拽、连线、缩放、编辑
 *
 * 连线类型：smoothstep（最少拐角的阶梯线）
 *
 * 数据流（S2 修复）：
 * - canvas/setCanvas 由父组件传入，单一数据源
 * - CardCanvas 不再自己调用 useCanvasStorage
 *
 * 持久化（S3 修复）：
 * - 使用 useEffect + 防抖响应 nodes/edges 变化
 * - 避免在 change handler 中读取陈旧的闭包值
 *
 * onUpdate 回调（S1 修复）：
 * - 提取 injectOnUpdate 公共函数
 * - 初始化、addCard、importCanvas 统一注入
 */

const nodeTypes = { freeCard: FreeCardNode };
const edgeTypes = { freeEdge: FreeCardEdge };

const defaultEdgeOptions = {
  type: "freeEdge",
  animated: false,
  style: { stroke: "#94a3b8", strokeWidth: 1.5 },
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 16,
    height: 16,
    color: "#94a3b8",
  },
};

interface CardCanvasProps {
  /** 画布状态（由父组件持有，单一数据源） */
  canvas: CanvasState;
  /** 画布状态更新函数 */
  setCanvas: (value: CanvasState | ((prev: CanvasState) => CanvasState)) => void;
  /** 当前选中的筛选标签 */
  selectedTags: string[];
  /** 标签名到颜色的映射（W3 修复：统一标签颜色） */
  tagColors?: Record<string, string>;
  /** 按颜色筛选的选中色（null=不筛选） */
  selectedColor?: string | null;
}

export function CardCanvas({
  canvas,
  setCanvas,
  selectedTags,
  tagColors = {},
  selectedColor = null,
}: CardCanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  /** React Flow 实例引用（新建卡片 / AI 生成节点时获取视口中心，确保新卡片可见） */
  const rfInstance = useRef<ReactFlowInstance | null>(null);

  // 防御性处理：canvas 可能因 localStorage 损坏为 null/undefined
  const safeCanvas: CanvasState = canvas ?? { nodes: [], edges: [], tags: [] };

  // 搜索匹配状态：null 表示未搜索，Set<string> 表示匹配的节点 ID 集合
  // 用于搜索时高亮匹配卡片、暗化非匹配卡片
  const [searchMatchIds, setSearchMatchIds] = useState<Set<string> | null>(null);

  /** 卡片对话框状态（null = 关闭） */
  const [dialog, setDialog] = useState<CardDialogState | null>(null);
  /** AI 复式学习桥接对话框开关 */
  const [bridgeOpen, setBridgeOpen] = useState(false);

  // 保持 tagColorsRef 最新（供 injectOnUpdate 内部使用，避免重建回调）
  const tagColorsRef = useRef(tagColors);
  tagColorsRef.current = tagColors;

  /**
   * 用于在节点 data 中注入 onUpdate 回调
   * 通过 ref 持有 setNodes，使 injectOnUpdate 引用稳定（无依赖）
   */
  const setNodesRef = useRef<
    (updater: (nodes: Node<FreeCardData>[]) => Node<FreeCardData>[]) => void
  >(() => {});

  /**
   * 为节点注入 onUpdate 回调（S1 修复）
   * 该回调在节点编辑时触发，更新对应节点的 data
   */
  const injectOnUpdate = useCallback(
    (node: {
      id: string;
      type?: string;
      position: { x: number; y: number };
      data: FreeCardData;
      width?: number | null;
      zIndex?: number;
    }): Node<FreeCardData> => {
      const nodeId = node.id;
      return {
        id: node.id,
        type: node.type || "freeCard",
        position: node.position,
        width: node.width ?? undefined,
        zIndex: node.zIndex,
        data: {
          ...node.data,
          // 注入 onUpdate 回调（S1 修复）
          onUpdate: (d: Partial<FreeCardData>) => {
            setNodesRef.current((nds) =>
              nds.map((n) =>
                n.id === nodeId ? { ...n, data: { ...n.data, ...d } } : n
              )
            );
          },
          // 注入 tagColorsGetter（W3 修复：让节点使用存储的标签颜色）
          // 使用 getter 函数，每次渲染读取最新的 tagColorsRef
          getTagColor: (tagName: string) => tagColorsRef.current[tagName],
        },
      };
    },
    []
  );

  /**
   * 保持 setEdgesRef 最新（供 injectOnEdgeUpdate 内部使用，避免重建回调）
   */
  const setEdgesRef = useRef<
    (updater: (edges: Edge<FreeCardEdgeData>[]) => Edge<FreeCardEdgeData>[]) => void
  >(() => {});

  /**
   * 为边注入 onEdit/onDelete 回调
   * - onEdit: 编辑边标签文字（空字符串表示无文字）
   * - onDelete: 删除该边（切断连线）
   *
   * 通过 ref 持有 setEdges，使回调引用稳定（无依赖）
   */
  const injectOnEdgeUpdate = useCallback(
    (edge: Edge<FreeCardEdgeData>): Edge<FreeCardEdgeData> => {
      const existingData = (edge.data ?? {}) as FreeCardEdgeData;
      return {
        ...edge,
        type: edge.type || "freeEdge",
        data: {
          ...existingData,
          // 注入 onEdit 回调：更新边标签
          onEdit: (id: string, label: string) => {
            setEdgesRef.current((eds) =>
              eds.map((e) =>
                e.id === id
                  ? { ...e, data: { ...(e.data ?? {}), label } }
                  : e
              )
            );
          },
          // 注入 onDelete 回调：删除边（切断连线）
          onDelete: (id: string) => {
            setEdgesRef.current((eds) => eds.filter((e) => e.id !== id));
          },
        },
      };
    },
    []
  );

  // React Flow 节点/边状态
  // 初始化时即注入 onUpdate（S1 修复：刷新后仍可编辑）
  const initialNodes = useMemo(
    () =>
      (safeCanvas.nodes as Array<{
        id: string;
        type?: string;
        position: { x: number; y: number };
        data: FreeCardData;
        width?: number | null;
        zIndex?: number;
      }>).map(injectOnUpdate),
    // 仅初始化时执行（safeCanvas.nodes 来自父组件 localStorage 读取）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  // 边初始化：注入 onEdit/onDelete 回调，确保刷新后仍可编辑/删除
  const initialEdges = useMemo(
    () =>
      (safeCanvas.edges as Edge<FreeCardEdgeData>[]).map(injectOnEdgeUpdate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  // 保持 nodesRef 最新（供 handleCreateNodes 解析已有节点 id，避免回调依赖 nodes 频繁重建）
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // 保持 setNodesRef / setEdgesRef 最新（供注入回调内部使用）
  setNodesRef.current = setNodes;
  setEdgesRef.current = setEdges;

  /**
   * 撤销/重做 + 复制粘贴
   *
   * 集成 useUndoableCanvas hook，提供：
   *   - undo/redo：历史栈管理，快捷键 Ctrl+Z/Ctrl+Y
   *   - copySelected/paste：剪贴板，快捷键 Ctrl+C/Ctrl+V
   *   - resetHistory：导入/清空时重置历史
   *   - commit：重大操作前主动提交快照
   */
  const {
    canUndo,
    canRedo,
    undo,
    redo,
    copySelected,
    paste,
    hasClipboard,
    resetHistory,
    commit,
  } = useUndoableCanvas({
    nodes,
    edges,
    setNodes: setNodes as (
      updater: (nodes: Node<FreeCardData>[]) => Node<FreeCardData>[]
    ) => void,
    setEdges: setEdges as (
      updater: (edges: Edge<FreeCardEdgeData>[]) => Edge<FreeCardEdgeData>[]
    ) => void,
  });

  /**
   * 选中节点数量（用于 AlignmentToolbar 显示）
   * 选中 ≥ 2 个节点时显示对齐工具栏
   */
  const selectedCount = useMemo(
    () => nodes.filter((n) => n.selected).length,
    [nodes]
  );

  /**
   * 持久化（S3 修复）：使用 useEffect + 防抖响应 nodes/edges 变化
   * 避免在 change handler 中读取陈旧闭包值
   */
  const isInitialMount = useRef(true);
  const persistTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // 跳过首次挂载（避免初始化时多余写入）
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    if (persistTimeout.current) clearTimeout(persistTimeout.current);
    persistTimeout.current = setTimeout(() => {
      setCanvas((prev) => ({
        ...prev,
        nodes: nodes.map((n) => ({
          id: n.id,
          type: n.type || "freeCard",
          position: n.position,
          data: n.data,
          // React Flow 的 width 可能为 null，转换为 undefined 以匹配类型
          width: n.width ?? undefined,
          zIndex: n.zIndex,
        })),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
          targetHandle: e.targetHandle,
          // 持久化边类型和标签（FreeCardEdge 的 label 存在 data 中）
          type: e.type || "freeEdge",
          data: e.data
            ? { label: (e.data as FreeCardEdgeData).label ?? "" }
            : { label: "" },
        })),
      }));
    }, 400);
    return () => {
      if (persistTimeout.current) clearTimeout(persistTimeout.current);
    };
  }, [nodes, edges, setCanvas]);

  /**
   * 连线处理：创建 FreeCardEdge 类型的边并注入回调
   * 持久化由 useEffect 响应
   */
  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      const newEdge = injectOnEdgeUpdate(
        createFreeCardEdge({
          ...connection,
          ...defaultEdgeOptions,
        } as Edge<FreeCardEdgeData>)
      );
      setEdges((eds) => [...eds, newEdge]);
    },
    [setEdges, injectOnEdgeUpdate]
  );

  /**
   * 打开新建卡片对话框（取代直接创建空白卡片）
   * 位置在保存时计算（视口中心），保证新卡片可见
   */
  const openCreateDialog = useCallback(() => {
    setDialog({ mode: "create" });
  }, []);

  /** 计算视口中心坐标（用于新建/批量创建卡片定位） */
  const viewportCenter = useCallback(() => {
    let position = {
      x: 100 + Math.random() * 200,
      y: 100 + Math.random() * 100,
    };
    const inst = rfInstance.current;
    const wrapper = reactFlowWrapper.current;
    if (inst && wrapper) {
      const rect = wrapper.getBoundingClientRect();
      const center = inst.screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });
      position = {
        x: center.x + (Math.random() - 0.5) * 60,
        y: center.y + (Math.random() - 0.5) * 60,
      };
    }
    return position;
  }, []);

  /** 对话框保存：新建节点或更新已有节点 */
  const handleDialogSave = useCallback(
    (payload: CardDialogPayload) => {
      if (!dialog) return;
      if (dialog.mode === "create") {
        const newNode = injectOnUpdate({
          id: `card-${Date.now()}`,
          type: "freeCard",
          position: viewportCenter(),
          data: {
            ...payload,
            tags: payload.tags ?? [],
            favorite: false,
          },
        });
        setNodes((nds) => [...nds, newNode]);
      } else {
        const nodeId = dialog.nodeId;
        setNodes((nds) =>
          nds.map((n) =>
            n.id === nodeId ? { ...n, data: { ...n.data, ...payload } } : n
          )
        );
      }
      setDialog(null);
    },
    [dialog, injectOnUpdate, setNodes, viewportCenter]
  );

  /**
   * AI 批量创建节点（生成/扩展 Tab）
   * 支持从 sourceId 创建关系线，以及 items.relations 任意连线关系
   * （from/to 支持本批次索引字符串或画布已有节点 id，缺省引用当前卡片）
   */
  const handleCreateNodes = useCallback(
    (items: CreateNodeItem[]) => {
      if (items.length === 0) return;
      const base = viewportCenter();
      const baseId = Date.now();
      const created = items.map((it, i) => {
        const id = `card-${baseId}-${i}`;
        const pos = it.position ?? {
          x: base.x + (i % 3) * 340 + (Math.random() - 0.5) * 40,
          y: base.y + Math.floor(i / 3) * 260,
        };
        return {
          id,
          index: i,
          sourceId: it.sourceId,
          relationLabel: it.relationLabel,
          relations: it.relations,
          node: injectOnUpdate({
            id,
            type: "freeCard",
            position: pos,
            data: {
              title: "新卡片",
              content: "",
              tags: [],
              width: 280,
              favorite: false,
              ...it.data,
            },
          }),
        };
      });
      const createdIds = new Map(created.map((c) => [c.id, c]));

      // 解析连线引用：本批次索引（"0"）或已有节点 id
      const resolveRef = (ref: string, fallback?: string): string | null => {
        const trimmed = ref.trim();
        const byIndex = createdIds.get(`card-${baseId}-${trimmed}`);
        if (byIndex) return byIndex.id;
        if (createdIds.has(trimmed)) return trimmed;
        if (nodesRef.current.some((n) => n.id === trimmed)) return trimmed;
        return fallback ?? null;
      };

      // 收集连线：优先 items.relations，其次兼容 sourceId+relationLabel
      const pendingEdges: Array<{ source: string; target: string; label: string }> = [];
      for (const c of created) {
        const fallbackSource = c.sourceId
          ? resolveRef(c.sourceId)
          : null;
        if (c.relations && c.relations.length > 0) {
          for (const rel of c.relations) {
            const source = resolveRef(rel.from ?? "", fallbackSource ?? c.sourceId ?? "");
            const target = resolveRef(rel.to ?? "", c.id);
            if (source && target && source !== target) {
              pendingEdges.push({ source, target, label: rel.label ?? "" });
            }
          }
        } else if (fallbackSource && fallbackSource !== c.id) {
          pendingEdges.push({
            source: fallbackSource,
            target: c.id,
            label: c.relationLabel ?? "",
          });
        }
      }

      setNodes((nds) => [...nds, ...created.map((c) => c.node)]);
      if (pendingEdges.length > 0) {
        const newEdges = pendingEdges.map((e, i) =>
          injectOnEdgeUpdate({
            id: `edge-${baseId}-${i}`,
            source: e.source,
            target: e.target,
            data: { label: e.label },
            ...defaultEdgeOptions,
          } as Edge<FreeCardEdgeData>)
        );
        setEdges((eds) => [...eds, ...newEdges]);
      }
    },
    [injectOnUpdate, injectOnEdgeUpdate, setNodes, setEdges, viewportCenter]
  );

  /**
   * 导入画布数据
   * 通过 injectOnUpdate 重新注入 onUpdate 回调
   * 导入后重置历史栈（避免导入操作被撤销）
   */
  const importCanvas = useCallback(
    (data: CanvasState) => {
      // 先提交当前状态快照（允许撤销导入操作）
      commit();
      const restoredNodes = (
        (data.nodes || []) as Array<{
          id: string;
          type?: string;
          position: { x: number; y: number };
          data: FreeCardData;
          width?: number | null;
          zIndex?: number;
        }>
      ).map(injectOnUpdate);
      setNodes(restoredNodes);
      setEdges(data.edges as Edge[]);
      setCanvas(data);
    },
    [setNodes, setEdges, setCanvas, injectOnUpdate, commit]
  );

  /**
   * 导出画布数据（含 tags，来自父组件单一数据源）
   */
  const exportCanvas = useCallback((): CanvasState => {
    return {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type || "freeCard",
        position: n.position,
        data: n.data,
        width: n.width ?? undefined,
        zIndex: n.zIndex,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
      })),
      tags: safeCanvas.tags,
    };
  }, [nodes, edges, safeCanvas.tags]);

  /**
   * 通过 window 自定义事件暴露 add-card/export/import
   * canvas:add-card 事件打开新建卡片对话框；export/import 供 SidePanel 调用
   *
   * 性能优化（P4）：处理器经 eventHandlersRef 间接调用，
   * 监听器仅注册一次（空依赖），避免拖拽时 nodes 每帧变化导致 15 个监听器反复重挂。
   */
  const eventHandlersRef = useRef<Record<string, (e: Event) => void>>({});

  useEffect(() => {
    const handleAdd = () => openCreateDialog();
    const handleExport = () => {
      const data = exportCanvas();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `learnforge-canvas-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    };
    const handleImport = (e: Event) => {
      const detail = (e as CustomEvent).detail as CanvasState;
      if (detail) importCanvas(detail);
    };

    // 导出单词树（保留节点+连接关系，体现衍生结构）
    const handleExportTree = () => {
      const canvas = exportCanvas();
      const tree = exportWordTree(canvas);
      downloadJSON(tree, "word-tree");
    };

    // 导出学习数据包（兼容 data_packs.json 格式，可被 importDataPack 导入）
    const handleExportPack = () => {
      const canvas = exportCanvas();
      const wordCount = countExportableWords(canvas);
      if (wordCount === 0) {
        toast.warning("画布中没有可导出的单词卡片", {
          description: "请添加标题为英文单词的卡片，或在标签中标注『单词』",
        });
        return;
      }
      const pack = exportToLearnPack(canvas);
      downloadJSON(pack, "learn-pack");
    };

    // 直接导入到单词学习系统（创建 Card + WordProfile + 衍生关系）
    const handleImportLearn = async () => {
      const canvas = exportCanvas();
      const wordCount = countExportableWords(canvas);
      if (wordCount === 0) {
        toast.warning("画布中没有可导入的单词卡片");
        return;
      }
      try {
        const res = await fetch("/api/learn/import-canvas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ canvas }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || `HTTP ${res.status}`);
        }
        const result = await res.json();
        toast.success(result.message || `已导入 ${result.imported} 个卡片`, {
          description: `衍生关系 ${result.relations} 条，可前往 /learn 开始学习`,
        });
      } catch (err) {
        toast.error("导入学习系统失败", {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    };

    // 撤销/重做/复制/粘贴事件（供 SidePanel 按钮触发）
    const handleUndo = () => undo();
    const handleRedo = () => redo();
    const handleCopy = () => {
      copySelected();
      toast.info("已复制选中卡片");
    };
    const handlePaste = () => {
      paste();
      toast.info("已粘贴卡片");
    };
    // 清空画布时重置历史
    const handleClear = () => {
      resetHistory();
    };

    /**
     * 跳转视角到指定卡片并选中（由层级面板缩略图点击触发）
     *
     * 使用 rfInstance.fitView 将目标卡片精确居中到屏幕中央：
     * - nodes: 只适配目标节点（单个节点会居中显示）
     * - padding: 视口周围留 50% 空间
     * - maxZoom: 限制最大缩放为 1
     *
     * 同时更新 selected 属性（受控模式下使用 useNodesState 的 setNodes）
     * 选中不改变 zIndex，卡片不会跳到最前层。
     */
    const handleJumpToCard = (e: Event) => {
      const cardId = (e as CustomEvent).detail as string;
      if (!cardId) return;

      // 使用 rfInstance.fitView 跳转视角到目标卡片
      if (rfInstance.current) {
        rfInstance.current.fitView({
          nodes: [{ id: cardId }],
          padding: 0.5,
          maxZoom: 1,
          duration: 600,
        });
      }

      // 选中目标卡片（不改变 zIndex）
      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          selected: n.id === cardId,
        }))
      );
    };

    /** 编辑卡片（由卡片编辑按钮触发） */
    const handleEditCard = (e: Event) => {
      const nodeId = (e as CustomEvent).detail as string;
      if (!nodeId) return;
      setDialog({ mode: "edit", nodeId });
    };

    /** AI 提问卡片（由卡片 AI 按钮触发） */
    const handleAiCard = (e: Event) => {
      const nodeId = (e as CustomEvent).detail as string;
      if (!nodeId) return;
      setDialog({ mode: "ai", nodeId });
    };

    /** AI 转化复式学习（由侧边栏按钮触发） */
    const handleAiBridge = () => {
      const sel = nodes.filter((n) => n.selected);
      if (sel.length === 0) {
        toast.warning("请先选中要转化的卡片");
        return;
      }
      setBridgeOpen(true);
    };

    // 统一保存最新处理器供事件注册 effect 使用
    eventHandlersRef.current = {
      add: handleAdd,
      export: handleExport,
      import: handleImport,
      exportTree: handleExportTree,
      exportPack: handleExportPack,
      importLearn: handleImportLearn,
      undo: handleUndo,
      redo: handleRedo,
      copy: handleCopy,
      paste: handlePaste,
      clear: handleClear,
      jumpToCard: handleJumpToCard,
      editCard: handleEditCard,
      aiCard: handleAiCard,
      aiBridge: handleAiBridge,
    };
  }, [openCreateDialog, exportCanvas, importCanvas, undo, redo, copySelected, paste, resetHistory, setNodes, nodes]);

  // 事件监听只注册一次（依赖 eventHandlersRef，处理器始终为最新版本）
  useEffect(() => {
    const bindings: Array<[string, string]> = [
      ["canvas:add-card", "add"],
      ["canvas:export", "export"],
      ["canvas:import", "import"],
      ["canvas:export-tree", "exportTree"],
      ["canvas:export-pack", "exportPack"],
      ["canvas:import-learn", "importLearn"],
      ["canvas:undo", "undo"],
      ["canvas:redo", "redo"],
      ["canvas:copy", "copy"],
      ["canvas:paste", "paste"],
      ["canvas:clear", "clear"],
      ["canvas:jump-to-card", "jumpToCard"],
      ["canvas:edit-card", "editCard"],
      ["canvas:ai-card", "aiCard"],
      ["canvas:ai-bridge", "aiBridge"],
    ];
    const listeners = bindings.map(([eventName, key]) => {
      const fn = (e: Event) => eventHandlersRef.current[key]?.(e);
      window.addEventListener(eventName, fn);
      return [eventName, fn] as const;
    });
    return () => {
      for (const [eventName, fn] of listeners) {
        window.removeEventListener(eventName, fn);
      }
    };
  }, []);

  /**
   * 根据选中标签 + 搜索结果过滤节点（高亮匹配，淡化不匹配）
   *
   * 两层过滤叠加：
   *   1. 标签过滤：selectedTags 选中的标签高亮，其他暗化
   *   2. 搜索过滤：searchMatchIds 匹配的节点高亮，其他暗化
   * 任一过滤条件不满足则暗化
   */
  const displayNodes = useMemo(() => {
    // 无任何过滤条件时直接返回原节点
    if (selectedTags.length === 0 && !selectedColor && !searchMatchIds)
      return nodes;

    return nodes.map((n) => {
      // 标签匹配
      const nodeTags = (n.data.tags as string[]) || [];
      const tagMatched =
        selectedTags.length === 0 ||
        selectedTags.some((t) => nodeTags.includes(t));

      // 颜色匹配（按有效分类色；与卡片实际渲染一致）
      const colorMatched = matchesCardColor(
        n.data as FreeCardData,
        selectedColor,
        tagColors
      );

      // 搜索匹配
      const searchMatched = !searchMatchIds || searchMatchIds.has(n.id);

      const matched = tagMatched && colorMatched && searchMatched;

      // 搜索匹配时额外添加高亮 ring
      const searchHighlight =
        searchMatchIds && searchMatched ? "ring-2 ring-blue-400" : "";

      return {
        ...n,
        className: [
          n.className ?? "",
          matched ? searchHighlight : "opacity-30",
        ]
          .filter(Boolean)
          .join(" "),
      } as Node<FreeCardData>;
    });
    // 依赖含 tagColors：标签色映射变化时需重算颜色过滤（否则结果陈旧）
  }, [nodes, selectedTags, selectedColor, searchMatchIds, tagColors]);

  return (
    <ReactFlowProvider>
    <div
      ref={reactFlowWrapper}
      className="w-full h-full relative"
      // 内联样式确保初始渲染时容器有尺寸，避免 React Flow 警告
      // "parent container needs a width and a height"（CSS 类可能在首帧前未应用）
      style={{ width: "100%", height: "100%" }}
      onDoubleClick={(e) => {
        // 双击卡片不触发新建
        if ((e.target as HTMLElement).closest(".react-flow__node")) return;
        openCreateDialog();
      }}
    >
      <ReactFlow
        nodes={displayNodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        connectionMode={ConnectionMode.Loose}
        connectionLineType={ConnectionLineType.SmoothStep}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        onInit={(inst) => {
          rfInstance.current = inst;
        }}
        minZoom={0.2}
        maxZoom={2.5}
        defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={["Backspace", "Delete"]}
        multiSelectionKeyCode={["Meta", "Control"]}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="#e2e8f0"
        />
        <Controls
          position="bottom-right"
          showInteractive={false}
          className="!bg-card/80 !backdrop-blur !border !border-border/60 !rounded-lg !shadow-md !overflow-hidden"
        />
        <MiniMap
          position="bottom-left"
          className="!bg-card/80 !backdrop-blur !border !border-border/60 !rounded-lg !shadow-md"
          nodeColor="rgba(59, 130, 246, 0.3)"
          nodeStrokeColor="#3b82f6"
          nodeStrokeWidth={1.5}
          maskColor="rgba(0,0,0,0.08)"
          pannable
          zoomable
        />
      </ReactFlow>

      {/* 搜索框（浮在画布左上角，z-50 确保高于 React Flow 控件） */}
      <div className="absolute top-3 left-3 z-50 pointer-events-auto">
        <CardSearch onSearchResults={setSearchMatchIds} />
      </div>

      {/* 对齐工具栏（选中 ≥ 2 个节点时显示在顶部居中） */}
      <AlignmentToolbar selectedCount={selectedCount} />

      {/* 浮动操作工具栏（撤销/重做/复制/粘贴，左下角） */}
      <div className="absolute bottom-3 left-3 z-50 pointer-events-auto flex items-center gap-0.5 px-1.5 py-1 bg-card/95 backdrop-blur border border-border rounded-lg shadow-lg">
        <FloatingActionButton
          icon={Undo2}
          title="撤销 (Ctrl+Z)"
          onClick={undo}
          disabled={!canUndo}
        />
        <FloatingActionButton
          icon={Redo2}
          title="重做 (Ctrl+Y)"
          onClick={redo}
          disabled={!canRedo}
        />
        <div className="w-px h-5 bg-border mx-0.5" />
        <FloatingActionButton
          icon={Copy}
          title="复制选中 (Ctrl+C)"
          onClick={copySelected}
          disabled={selectedCount === 0}
        />
        <FloatingActionButton
          icon={ClipboardPaste}
          title="粘贴 (Ctrl+V)"
          onClick={paste}
          disabled={!hasClipboard}
        />
      </div>
      </div>

      {/* 卡片对话框（新建/编辑/AI 提问） */}
      {dialog && (
        <CardDialog
          state={dialog}
          node={
            dialog.mode === "create"
              ? null
              : (nodes.find((n) => n.id === dialog.nodeId)?.data as FreeCardData | undefined) ?? null
          }
          onClose={() => setDialog(null)}
          onSave={handleDialogSave}
          onCreateNodes={handleCreateNodes}
        />
      )}

      {/* AI 复式学习桥接对话框 */}
      <AiReviewBridge
        open={bridgeOpen}
        onClose={() => setBridgeOpen(false)}
        nodes={nodes
          .filter((n) => n.selected)
          .map((n) => ({ id: n.id, title: n.data.title, content: n.data.content }))}
      />
    </ReactFlowProvider>
  );
}

/**
 * 浮动操作按钮（撤销/重做/复制/粘贴）
 * 简洁的图标按钮，支持 disabled 状态
 */
function FloatingActionButton({
  icon: Icon,
  title,
  onClick,
  disabled,
}: {
  icon: LucideIcon;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={[
        "p-1.5 rounded transition-colors",
        disabled
          ? "text-muted-foreground/30 cursor-not-allowed"
          : "text-muted-foreground hover:bg-accent hover:text-primary",
      ].join(" ")}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}
