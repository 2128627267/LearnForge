"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Node, Edge } from "reactflow";
import type { FreeCardData } from "@/components/cards/free-card-node";
import type { FreeCardEdgeData } from "@/components/cards/free-card-edge";

/**
 * 画布撤销/重做 + 复制粘贴 Hook
 *
 * 设计要点：
 *   1. 快照式历史栈：每次 nodes/edges 变化 debounce 400ms 后入栈
 *      避免拖拽过程中频繁入栈（拖拽会触发大量位置更新）
 *   2. 双栈结构：past（过去）+ future（未来）
 *      - 当前状态不入栈，past 栈顶为上一个状态
 *      - undo：当前 → future，past 栈顶 → 当前
 *      - redo：当前 → past，future 栈顶 → 当前
 *   3. 复制粘贴：
 *      - 复制：序列化选中节点到 clipboardRef（带偏移计数）
 *      - 粘贴：生成新 ID 添加到画布，位置加偏移避免重叠
 *   4. 快捷键：
 *      - Ctrl/Cmd+Z：撤销
 *      - Ctrl/Cmd+Shift+Z 或 Ctrl+Y：重做
 *      - Ctrl/Cmd+C：复制选中节点
 *      - Ctrl/Cmd+V：粘贴
 *
 * 注意：本 hook 不直接修改 React Flow state，
 *       而是通过 setNodes/setEdges 回调让调用方执行实际更新。
 */

/** 历史快照（仅保存序列化所需的最小字段） */
interface Snapshot {
  nodes: Array<{
    id: string;
    position: { x: number; y: number };
    data: FreeCardData;
    type?: string;
    width?: number | null;
    zIndex?: number;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
    type?: string;
    data?: FreeCardEdgeData;
  }>;
}

/** 历史栈最大长度（防止内存无限增长） */
const MAX_HISTORY = 50;

/** 粘贴时的位置偏移（每次累加，避免连续粘贴完全重叠） */
const PASTE_OFFSET = 40;

/**
 * 节点 data 对象的稳定 ID（WeakMap 缓存，避免 JSON 序列化比较）
 * 原理：节点数据遵循 immutable 更新约定（每次编辑生成新对象），
 * 因此对象引用不变 ⇔ 内容未变，可作为轻量指纹的一部分。
 */
const dataIdMap = new WeakMap<object, number>();
let dataIdCounter = 0;
function dataRefId(data: object): number {
  let id = dataIdMap.get(data);
  if (id === undefined) {
    id = ++dataIdCounter;
    dataIdMap.set(data, id);
  }
  return id;
}

/**
 * 生成快照的轻量指纹（替代全量 JSON.stringify 比较）
 * 仅比较影响历史语义的字段：节点 ID/位置/尺寸/层级 + data 对象引用 + 边拓扑。
 * 内容字段（如富文本 HTML）通过 data 引用 ID 隐式覆盖，避免序列化大字符串。
 */
function snapshotFingerprint(snapshot: Snapshot): string {
  const nodePart = snapshot.nodes
    .map(
      (n) =>
        `${n.id}:${n.position.x.toFixed(1)},${n.position.y.toFixed(1)}:${n.width ?? 0}:${n.zIndex ?? 0}:${dataRefId(n.data)}`
    )
    .join("|");
  const edgePart = snapshot.edges
    .map((e) => `${e.id}:${e.source}>${e.target}:${e.sourceHandle ?? ""}:${e.targetHandle ?? ""}:${e.data ? dataRefId(e.data) : 0}`)
    .join("|");
  return `${snapshot.nodes.length};${snapshot.edges.length}:${nodePart}:${edgePart}`;
}

interface UseUndoableCanvasOptions {
  /** 当前节点列表（用于历史快照） */
  nodes: Node<FreeCardData>[];
  /** 当前边列表（用于历史快照） */
  edges: Edge<FreeCardEdgeData>[];
  /** 节点更新函数（由 React Flow 提供） */
  setNodes: (
    updater: (nodes: Node<FreeCardData>[]) => Node<FreeCardData>[]
  ) => void;
  /** 边更新函数（由 React Flow 提供） */
  setEdges: (
    updater: (edges: Edge<FreeCardEdgeData>[]) => Edge<FreeCardEdgeData>[]
  ) => void;
  /** 是否启用快捷键（默认 true） */
  enableShortcuts?: boolean;
}

interface UseUndoableCanvasReturn {
  /** 是否可撤销 */
  canUndo: boolean;
  /** 是否可重做 */
  canRedo: boolean;
  /** 撤销 */
  undo: () => void;
  /** 重做 */
  redo: () => void;
  /** 复制当前选中的节点 */
  copySelected: () => void;
  /** 粘贴剪贴板中的节点 */
  paste: () => void;
  /** 是否有剪贴板内容 */
  hasClipboard: boolean;
  /** 重置历史栈（导入/清空画布时调用） */
  resetHistory: () => void;
  /** 主动提交一个快照（重大操作前后调用） */
  commit: () => void;
}

/**
 * 生成唯一 ID（用于粘贴时给新节点分配 ID）
 * 使用时间戳 + 随机数确保唯一性
 */
function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useUndoableCanvas({
  nodes,
  edges,
  setNodes,
  setEdges,
  enableShortcuts = true,
}: UseUndoableCanvasOptions): UseUndoableCanvasReturn {
  // 历史栈：past 栈顶是最近的过去状态，future 栈顶是最近的未来状态
  const pastRef = useRef<Snapshot[]>([]);
  const futureRef = useRef<Snapshot[]>([]);
  // 触发 re-render 以更新 canUndo/canRedo
  const [, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  // 防抖入栈定时器
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 上次入栈的快照（用于跳过无变化的情况）
  const lastSnapshotRef = useRef<string>("");

  // 剪贴板：保存复制的节点（含 data，粘贴时生成新 ID）
  const clipboardRef = useRef<Snapshot["nodes"]>([]);
  // 粘贴偏移计数（连续粘贴时累加）
  const pasteCountRef = useRef(0);
  const [hasClipboard, setHasClipboard] = useState(false);

  /**
   * 创建当前状态的快照（最小化字段）
   * data 采用引用共享：节点数据遵循 immutable 更新，旧对象不会被原地修改，
   * 快照无需深拷贝内容字段（富文本 HTML 等大字符串），显著降低内存与 GC 压力
   */
  const createSnapshot = useCallback((): Snapshot => {
    return {
      nodes: nodes.map((n) => ({
        id: n.id,
        position: { ...n.position },
        data: n.data,
        type: n.type,
        width: n.width ?? undefined,
        zIndex: n.zIndex,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
        type: e.type,
        data: e.data,
      })),
    };
  }, [nodes, edges]);

  /**
   * 将快照推入 past 栈（清除 future 栈）
   * 用于新的修改发生时
   */
  const pushHistory = useCallback(
    (snapshot: Snapshot) => {
      // 轻量指纹比较，跳过无变化的快照（避免全量 JSON.stringify 大内容字段）
      const key = snapshotFingerprint(snapshot);
      if (key === lastSnapshotRef.current) return;
      lastSnapshotRef.current = key;

      pastRef.current.push(snapshot);
      // 限制历史栈长度
      if (pastRef.current.length > MAX_HISTORY) {
        pastRef.current.shift();
      }
      // 新修改发生时清空 future 栈
      futureRef.current = [];
      bump();
    },
    [bump]
  );

  /**
   * 防抖入栈：监听 nodes/edges 变化
   * 拖拽过程中会触发大量变化，防抖避免每个像素都入栈
   */
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pushHistory(createSnapshot());
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  /**
   * 撤销：当前状态 → future，past 栈顶 → 当前
   */
  const undo = useCallback(() => {
    if (pastRef.current.length === 0) return;
    const prev = pastRef.current.pop()!;
    // 当前状态入 future 栈
    futureRef.current.push(createSnapshot());
    // 恢复节点和边
    setNodes(() =>
      prev.nodes.map((n) => ({
        id: n.id,
        type: n.type || "freeCard",
        position: n.position,
        data: n.data,
        width: n.width ?? undefined,
        zIndex: n.zIndex,
      } as Node<FreeCardData>))
    );
    setEdges(() =>
      prev.edges.map((e) => ({
        ...e,
        type: e.type || "freeEdge",
      } as Edge<FreeCardEdgeData>))
    );
    lastSnapshotRef.current = snapshotFingerprint(prev);
    bump();
  }, [createSnapshot, setNodes, setEdges, bump]);

  /**
   * 重做：当前状态 → past，future 栈顶 → 当前
   */
  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    const next = futureRef.current.pop()!;
    pastRef.current.push(createSnapshot());
    setNodes(() =>
      next.nodes.map((n) => ({
        id: n.id,
        type: n.type || "freeCard",
        position: n.position,
        data: n.data,
        width: n.width ?? undefined,
        zIndex: n.zIndex,
      } as Node<FreeCardData>))
    );
    setEdges(() =>
      next.edges.map((e) => ({
        ...e,
        type: e.type || "freeEdge",
      } as Edge<FreeCardEdgeData>))
    );
    lastSnapshotRef.current = snapshotFingerprint(next);
    bump();
  }, [createSnapshot, setNodes, setEdges, bump]);

  /**
   * 复制当前选中的节点到剪贴板
   * 仅复制节点，不复制边（边依赖源/目标 ID，粘贴后无法直接连接）
   */
  const copySelected = useCallback(() => {
    const selected = nodes.filter((n) => n.selected);
    if (selected.length === 0) return;
    clipboardRef.current = selected.map((n) => ({
      id: n.id,
      position: { ...n.position },
      data: { ...n.data } as FreeCardData,
      type: n.type,
      width: n.width ?? undefined,
      zIndex: n.zIndex,
    }));
    pasteCountRef.current = 0;
    setHasClipboard(true);
  }, [nodes]);

  /**
   * 粘贴剪贴板中的节点
   * 生成新 ID，位置加偏移（连续粘贴累加偏移）
   */
  const paste = useCallback(() => {
    if (clipboardRef.current.length === 0) return;
    pasteCountRef.current += 1;
    const offset = pasteCountRef.current * PASTE_OFFSET;

    // 为粘贴的节点生成新 ID，并建立旧 ID → 新 ID 映射
    const idMap = new Map<string, string>();
    const newNodes: Node<FreeCardData>[] = clipboardRef.current.map((n) => {
      const newId = genId("card");
      idMap.set(n.id, newId);
      return {
        id: newId,
        type: n.type || "freeCard",
        position: {
          x: n.position.x + offset,
          y: n.position.y + offset,
        },
        data: { ...n.data } as FreeCardData,
        width: n.width ?? undefined,
        // 新粘贴的节点设为选中
        selected: true,
      } as Node<FreeCardData>;
    });

    // 取消其他节点的选中状态，并添加新节点
    setNodes((nds) => [
      ...nds.map((n) => ({ ...n, selected: false })),
      ...newNodes,
    ]);
  }, [setNodes]);

  /**
   * 重置历史栈（导入/清空画布时调用）
   */
  const resetHistory = useCallback(() => {
    pastRef.current = [];
    futureRef.current = [];
    lastSnapshotRef.current = "";
    bump();
  }, [bump]);

  /**
   * 主动提交一个快照（重大操作前后调用）
   * 例如：导入数据前、批量删除前
   */
  const commit = useCallback(() => {
    pushHistory(createSnapshot());
  }, [pushHistory, createSnapshot]);

  /**
   * 快捷键监听
   * 注意：在 input/textarea/contentEditable 中不触发（避免与文本编辑冲突）
   */
  useEffect(() => {
    if (!enableShortcuts) return;
    const handler = (e: KeyboardEvent) => {
      // 文本输入元素中不触发
      const target = e.target as HTMLElement;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }

      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;

      if (e.key === "z" || e.key === "Z") {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if (e.key === "y" || e.key === "Y") {
        e.preventDefault();
        redo();
      } else if (e.key === "c" || e.key === "C") {
        // 仅在有选中节点时拦截（避免阻止页面复制）
        const hasSelected = nodes.some((n) => n.selected);
        if (hasSelected) {
          e.preventDefault();
          copySelected();
        }
      } else if (e.key === "v" || e.key === "V") {
        if (clipboardRef.current.length > 0) {
          e.preventDefault();
          paste();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enableShortcuts, undo, redo, copySelected, paste, nodes]);

  return {
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
    undo,
    redo,
    copySelected,
    paste,
    hasClipboard,
    resetHistory,
    commit,
  };
}
