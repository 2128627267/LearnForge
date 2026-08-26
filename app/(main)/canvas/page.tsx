"use client";

import { useState, useMemo, useCallback } from "react";
import { Brain } from "lucide-react";
import dynamic from "next/dynamic";
import { CardCanvas } from "@/components/cards/card-canvas";
import { SidePanel, type TagInfo } from "@/components/cards/side-panel";
import { useCanvasStorage } from "@/lib/hooks/use-local-storage";
import { useCanvasServerSync } from "@/lib/hooks/use-canvas-server-sync";
import { getColorCounts } from "@/lib/cards/color-categories";
import { cn } from "@/lib/utils/cn";

/**
 * 项目记忆面板（P1 性能优化）：
 * 抽屉式按需打开，动态导入避免其依赖进入画布首屏 bundle。
 */
const ProjectMemoryPanel = dynamic(
  () => import("@/components/ai/project-memory-panel").then((m) => m.ProjectMemoryPanel),
  { ssr: false, loading: () => null }
);

/**
 * 自由卡片画布页面
 *
 * 设计原则：
 * - 画布全屏占满视口（核心交互区域）
 * - 所有非核心功能整合到右侧浮动面板
 * - 圆形伸缩按钮控制面板展开/收起
 * - 收起时画布无遮挡，展开时面板浮于上层
 *
 * 节点交互：
 * - 拖拽：自由排布
 * - 连线：smoothstep 阶梯线（最少拐角）
 * - 编辑：点击卡片编辑按钮
 * - 缩放：滚轮 / Controls
 */
export default function CanvasPage() {
  const [canvas, setCanvas] = useCanvasStorage();
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);

  // 防御性处理：canvas 可能因 localStorage 损坏为 null/undefined
  const safeCanvas = canvas ?? { nodes: [], edges: [], tags: [] };

  // 服务器端持久化同步（SQLite），localStorage 仅作缓存
  useCanvasServerSync(safeCanvas, (value) => setCanvas(value));

  /**
   * 从画布节点中提取所有标签及其使用频率
   */
  const tagInfos: TagInfo[] = useMemo(() => {
    const map = new Map<string, number>();
    safeCanvas.nodes.forEach((n) => {
      const tags = (n.data as { tags?: string[] }).tags || [];
      tags.forEach((t) => {
        map.set(t, (map.get(t) || 0) + 1);
      });
    });
    // 合并已保存的标签颜色信息
    const savedTagColors = new Map(
      (safeCanvas.tags || []).map((t) => [t.name, t.color])
    );
    return Array.from(map.entries()).map(([name, count]) => ({
      name,
      count,
      color: savedTagColors.get(name),
    }));
  }, [safeCanvas.nodes, safeCanvas.tags]);

  /**
   * 标签名到颜色的映射（W3 修复：传递给 CardCanvas，让卡片节点使用存储的颜色）
   */
  const tagColors = useMemo(() => {
    const map: Record<string, string> = {};
    (safeCanvas.tags || []).forEach((t) => {
      if (t.color) map[t.name] = t.color;
    });
    return map;
  }, [safeCanvas.tags]);

  /** 各颜色分类的卡片数统计（供 SidePanel 颜色标签显示） */
  const colorCounts = useMemo(
    () => getColorCounts(safeCanvas.nodes),
    [safeCanvas.nodes]
  );

  /** 切换标签筛选 */
  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }, []);

  /** 添加全局标签（保存颜色） */
  const addTag = useCallback(
    (name: string, color?: string) => {
      setCanvas((prev) => ({
        ...prev,
        tags: [
          ...(prev.tags || []),
          ...(prev.tags?.some((t) => t.name === name)
            ? []
            : [{ name, color }]),
        ],
      }));
    },
    [setCanvas]
  );

  /** 删除标签（从全局标签和所有卡片中移除） */
  const removeTag = useCallback(
    (name: string) => {
      setCanvas((prev) => ({
        ...prev,
        tags: (prev.tags || []).filter((t) => t.name !== name),
        nodes: prev.nodes.map((n) => {
          const data = n.data as { tags?: string[] };
          if (data.tags?.includes(name)) {
            return {
              ...n,
              data: {
                ...data,
                tags: data.tags.filter((t) => t !== name),
              },
            };
          }
          return n;
        }),
      }));
      setSelectedTags((prev) => prev.filter((t) => t !== name));
    },
    [setCanvas]
  );

  /** 清空画布 */
  const handleClear = useCallback(() => {
    setCanvas({ nodes: [], edges: [], tags: [] });
    setSelectedTags([]);
    // 通知 CardCanvas 重置撤销/重做历史栈
    window.dispatchEvent(new CustomEvent("canvas:clear"));
  }, [setCanvas]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* 画布全屏（S2 修复：canvas/setCanvas 单一数据源下传） */}
      <CardCanvas
        canvas={safeCanvas}
        setCanvas={setCanvas}
        selectedTags={selectedTags}
        tagColors={tagColors}
        selectedColor={selectedColor}
      />

      {/* 空状态引导（UX 修复）：画布无卡片时提示创建入口（纯展示，不拦截画布交互） */}
      {safeCanvas.nodes.length === 0 && (
        <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center">
          <div className="pointer-events-none text-center bg-card/80 backdrop-blur border border-border rounded-xl shadow-lg px-8 py-6 max-w-sm mx-4">
            <div className="text-3xl mb-3">🎨</div>
            <p className="font-medium text-foreground">画布还是空的</p>
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
              点击右侧圆形按钮打开面板，添加第一张知识卡片；
              <br />
              或在卡片上双击新建、拖动排布、连线建立关联。
            </p>
          </div>
        </div>
      )}

      {/* 右侧浮动面板（圆形伸缩按钮控制） */}
      <SidePanel
        tags={tagInfos}
        selectedTags={selectedTags}
        onToggleTag={toggleTag}
        onAddTag={addTag}
        onRemoveTag={removeTag}
        onClearSelection={() => setSelectedTags([])}
        onClearCanvas={handleClear}
        cardCount={safeCanvas.nodes.length}
        colorCounts={colorCounts}
        selectedColor={selectedColor}
        onSelectColor={setSelectedColor}
      />

      {/* 项目记忆抽屉（AI 提问上下文来源） */}
      <button
        onClick={() => setMemoryOpen((v) => !v)}
        className={cn(
          "fixed right-4 bottom-8 z-20",
          "w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg hover:scale-110 hover:shadow-xl transition-all duration-300 ease-out border-2 border-background",
          memoryOpen && "rotate-180"
        )}
        title={memoryOpen ? "收起记忆面板" : "项目记忆"}
        aria-label={memoryOpen ? "收起记忆面板" : "项目记忆"}
      >
        <Brain className="w-5 h-5" />
      </button>

      {memoryOpen && (
        <div className="fixed right-4 top-1/2 -translate-y-1/2 z-20 w-80 max-w-[calc(100vw-2.5rem)] mr-16 bg-card border rounded-xl shadow-2xl max-h-[70vh] overflow-y-auto">
          <ProjectMemoryPanel />
        </div>
      )}
    </div>
  );
}
