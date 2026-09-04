"use client";

/**
 * AI 任务绑定管理组件
 *
 * 功能说明：
 *   - 列出全部 6 种任务类型（chat / embedding / tts / stt / image_gen / image_recognize）
 *   - 每个任务类型一行：任务名 + 主模型下拉 + 备用模型下拉
 *   - 下拉选项来自 GET /api/settings/models（仅 isActive=true），按模型大类分组
 *   - 修改后自动保存（PUT /api/settings/task-bindings，单条 upsert）
 *   - 未绑定的任务类型显示「未配置」提示
 *   - 备用模型可选「无」以清除降级
 *
 * 数据流：
 *   - 加载：并行请求 task-bindings 与 models（includeInactive=true，前端再过滤 isActive）
 *   - 保存：PUT 单条 { taskType, primaryModelId, fallbackModelId }
 *           服务端 upsert by taskType，返回更新后的 DTO
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/shared/toaster";
import {
  Box,
  ImagePlus,
  Loader2,
  MessageSquare,
  Mic,
  ScanEye,
  Volume2,
} from "lucide-react";

// ==================== 类型定义 ====================

/** 任务类型枚举（与服务端 ALLOWED_TASK_TYPES 保持一致） */
type TaskType =
  | "chat"
  | "embedding"
  | "tts"
  | "stt"
  | "image_gen"
  | "image_recognize";

/** 模型大类（与服务端 ModelCategory 保持一致） */
type ModelCategory = "language" | "embedding" | "voice" | "image" | "other";

/** 任务绑定 DTO（与服务端 AITaskBindingDTO 保持一致） */
interface AITaskBindingDTO {
  id: string;
  taskType: string;
  primaryModelId: string;
  primaryModel?: {
    id: string;
    name: string;
    category: string;
    provider: string;
    modelName: string;
  };
  fallbackModelId: string | null;
  fallbackModel?: {
    id: string;
    name: string;
    category: string;
    provider: string;
    modelName: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

/** 模型配置 DTO（与服务端 AIModelConfigDTO 保持一致，仅保留本组件所需字段） */
interface AIModelConfigDTO {
  id: string;
  name: string;
  category: ModelCategory;
  provider: string;
  modelName: string;
  isActive: boolean;
  order: number;
}

// ==================== 常量配置 ====================

/**
 * 任务类型配置表
 * - value:    任务类型标识
 * - label:    中文显示名
 * - icon:     lucide-react 图标组件
 * - category: 该任务默认对应的模型大类（仅作为视觉提示，不强制过滤下拉选项）
 */
const TASK_TYPES: Array<{
  value: TaskType;
  label: string;
  icon: LucideIcon;
  category: ModelCategory;
}> = [
  { value: "chat", label: "AI 对话/问答", icon: MessageSquare, category: "language" },
  { value: "embedding", label: "向量嵌入", icon: Box, category: "embedding" },
  { value: "tts", label: "语音合成", icon: Volume2, category: "voice" },
  { value: "stt", label: "语音识别", icon: Mic, category: "voice" },
  { value: "image_gen", label: "图片生成", icon: ImagePlus, category: "image" },
  { value: "image_recognize", label: "图片识别", icon: ScanEye, category: "image" },
];

/**
 * 模型大类 → 中文标签映射（用于下拉分组标题）
 */
const CATEGORY_LABELS: Record<ModelCategory, string> = {
  language: "语言模型",
  embedding: "嵌入模型",
  voice: "语音模型",
  image: "图像模型",
  other: "其他模型",
};

/**
 * 模型大类在下拉中的展示顺序（语言模型优先）
 */
const CATEGORY_ORDER: ModelCategory[] = [
  "language",
  "embedding",
  "voice",
  "image",
  "other",
];

/** 备用模型下拉中「无」选项对应的值（空字符串表示清除备用） */
const FALLBACK_NONE = "";

// ==================== 主组件 ====================

export function TaskBindingSection() {
  // ---------- 状态声明 ----------
  const [bindings, setBindings] = useState<AITaskBindingDTO[]>([]);
  const [models, setModels] = useState<AIModelConfigDTO[]>([]);
  const [loading, setLoading] = useState(true);
  /** 当前正在保存的任务类型标识，用于行级 loading 与禁用 */
  const [savingTask, setSavingTask] = useState<string | null>(null);

  // ==================== 数据加载 ====================

  /**
   * 加载任务绑定列表
   * 失败时清空并提示，不抛出（保证 Promise.all 不会中断）
   */
  const loadBindings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/task-bindings");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { items: AITaskBindingDTO[]; total: number } =
        await res.json();
      setBindings(data.items || []);
    } catch (err) {
      toast.error("加载任务绑定失败", { description: String(err) });
      setBindings([]);
    }
  }, []);

  /**
   * 加载可选模型列表
   * 接口传 includeInactive=true 拉取全部，前端再过滤 isActive
   * 这样可兼容接口默认行为，同时确保下拉只展示启用的模型
   */
  const loadModels = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/models?includeInactive=true");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { items: AIModelConfigDTO[]; total: number } =
        await res.json();
      // 仅保留激活项，并按 order 升序排列（接口已排序，此处兜底）
      setModels(
        (data.items || [])
          .filter((m) => m.isActive)
          .sort((a, b) => a.order - b.order)
      );
    } catch (err) {
      toast.error("加载模型列表失败", { description: String(err) });
      setModels([]);
    }
  }, []);

  // 初始并行加载两类数据，完成后统一关闭 loading
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await Promise.all([loadBindings(), loadModels()]);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadBindings, loadModels]);

  // ==================== 派生数据 ====================

  /**
   * 将模型列表按大类分组
   * 结构：{ language: [...], embedding: [...], voice: [...], image: [...], other: [...] }
   * 未知大类归入 other，确保下拉不会遗漏任何模型
   */
  const groupedModels = useMemo(() => {
    const groups: Record<ModelCategory, AIModelConfigDTO[]> = {
      language: [],
      embedding: [],
      voice: [],
      image: [],
      other: [],
    };
    for (const m of models) {
      const cat = (m.category as ModelCategory) || "other";
      if (groups[cat]) {
        groups[cat].push(m);
      } else {
        groups.other.push(m);
      }
    }
    return groups;
  }, [models]);

  /**
   * taskType → binding 映射，便于按任务类型快速查找当前绑定状态
   */
  const bindingMap = useMemo(() => {
    const map = new Map<string, AITaskBindingDTO>();
    for (const b of bindings) {
      map.set(b.taskType, b);
    }
    return map;
  }, [bindings]);

  /**
   * 构建激活模型 ID 集合，用于判断当前绑定模型是否仍可用
   * （模型可能被禁用但绑定未更新，此时需要兜底显示）
   */
  const activeModelIds = useMemo(() => {
    const set = new Set<string>();
    for (const m of models) set.add(m.id);
    return set;
  }, [models]);

  // ==================== 保存操作 ====================

  /**
   * 保存单个任务绑定（upsert 语义）
   *
   * @param taskType        任务类型
   * @param primaryModelId  主模型 ID（必填）
   * @param fallbackModelId 备用模型 ID；传 null 表示清除备用
   */
  const saveBinding = useCallback(
    async (
      taskType: TaskType,
      primaryModelId: string,
      fallbackModelId: string | null
    ) => {
      // 主模型必填，前置校验避免无意义请求
      if (!primaryModelId) {
        toast.error("请先选择主模型");
        return;
      }
      setSavingTask(taskType);
      try {
        const res = await fetch("/api/settings/task-bindings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskType,
            primaryModelId,
            fallbackModelId: fallbackModelId || null,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || err.error || `HTTP ${res.status}`);
        }
        const data: { items: AITaskBindingDTO[]; total: number } =
          await res.json();
        // 用返回的更新后 DTO 同步本地状态，确保展示与服务端一致
        const updated = data.items?.[0];
        if (updated) {
          setBindings((prev) => {
            const idx = prev.findIndex(
              (b) => b.taskType === updated.taskType
            );
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = updated;
              return next;
            }
            return [...prev, updated];
          });
        }
        const label = TASK_TYPES.find((t) => t.value === taskType)?.label;
        toast.success(`「${label}」绑定已保存`);
      } catch (err) {
        toast.error("保存任务绑定失败", { description: String(err) });
      } finally {
        setSavingTask(null);
      }
    },
    []
  );

  /**
   * 主模型变更处理
   * 若新主模型与当前备用模型相同，则清除备用（避免主备相同）
   */
  const handlePrimaryChange = (
    taskType: TaskType,
    newPrimaryId: string
  ) => {
    const binding = bindingMap.get(taskType);
    const fallbackId = binding?.fallbackModelId ?? null;
    const nextFallback =
      fallbackId && fallbackId === newPrimaryId ? null : fallbackId;
    saveBinding(taskType, newPrimaryId, nextFallback);
  };

  /**
   * 备用模型变更处理
   * - 空字符串（FALLBACK_NONE）表示清除备用
   * - 主模型未选时禁止设置备用
   * - 不允许备用与主模型相同
   */
  const handleFallbackChange = (
    taskType: TaskType,
    rawValue: string
  ) => {
    const binding = bindingMap.get(taskType);
    const primaryId = binding?.primaryModelId ?? "";
    if (!primaryId) {
      toast.error("请先选择主模型");
      return;
    }
    const nextFallback = rawValue === FALLBACK_NONE ? null : rawValue;
    if (nextFallback && nextFallback === primaryId) {
      toast.error("备用模型不能与主模型相同");
      return;
    }
    saveBinding(taskType, primaryId, nextFallback);
  };

  // ==================== 渲染 ====================

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">AI 任务绑定</CardTitle>
        <CardDescription>
          为不同 AI 任务（对话、嵌入、语音、图像等）指定主模型与备用模型，修改后自动保存
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* ---------- 加载中 ---------- */}
        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            加载中...
          </div>
        ) : models.length === 0 ? (
          /* ---------- 无可用模型 ---------- */
          <div className="text-center py-8 text-sm text-muted-foreground border rounded-lg border-dashed">
            暂无可用模型，请先在「模型配置」中添加并启用模型
          </div>
        ) : (
          <>
            {/* ---------- 表头（桌面端显示） ---------- */}
            <div className="hidden md:grid grid-cols-[200px_1fr_1fr] gap-3 px-1 text-xs font-medium text-muted-foreground">
              <div>任务类型</div>
              <div>主模型</div>
              <div>备用模型</div>
            </div>

            {/* ---------- 任务类型行 ---------- */}
            {TASK_TYPES.map((task) => {
              const Icon = task.icon;
              const binding = bindingMap.get(task.value);
              const primaryId = binding?.primaryModelId ?? "";
              const fallbackId = binding?.fallbackModelId ?? "";
              const isConfigured = !!primaryId;
              const isSaving = savingTask === task.value;

              // 主模型是否已被禁用（不在激活列表中但绑定仍引用）
              const primaryDisabled =
                !!primaryId && !activeModelIds.has(primaryId);
              // 备用模型是否已被禁用
              const fallbackDisabled =
                !!fallbackId && !activeModelIds.has(fallbackId);

              return (
                <div
                  key={task.value}
                  className="grid grid-cols-1 md:grid-cols-[200px_1fr_1fr] gap-2 md:gap-3 items-center p-3 rounded-lg border bg-background"
                >
                  {/* 任务类型名 + 状态标记 */}
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium">{task.label}</span>
                    {isSaving && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    )}
                    {!isConfigured && !isSaving && (
                      <Badge variant="warning" className="text-xs">
                        未配置
                      </Badge>
                    )}
                  </div>

                  {/* 主模型下拉 */}
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                    value={primaryId}
                    onChange={(e) =>
                      handlePrimaryChange(task.value, e.target.value)
                    }
                    disabled={isSaving}
                  >
                    {/* 占位项：未选择时显示 */}
                    <option value="" disabled>
                      请选择主模型
                    </option>
                    {/* 兜底项：主模型已被禁用但仍被引用，展示原值并标注 */}
                    {primaryDisabled && binding?.primaryModel && (
                      <option value={primaryId} disabled>
                        {binding.primaryModel.name} (
                        {binding.primaryModel.modelName}) — 已禁用
                      </option>
                    )}
                    {/* 按大类分组的可选模型 */}
                    {CATEGORY_ORDER.map((cat) => {
                      const list = groupedModels[cat];
                      if (!list || list.length === 0) return null;
                      return (
                        <optgroup
                          key={cat}
                          label={`-- ${CATEGORY_LABELS[cat]} --`}
                        >
                          {list.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} ({m.modelName})
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>

                  {/* 备用模型下拉 */}
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                    value={fallbackId}
                    onChange={(e) =>
                      handleFallbackChange(task.value, e.target.value)
                    }
                    // 主模型未选或正在保存时禁用备用下拉
                    disabled={isSaving || !primaryId}
                    title={
                      !primaryId ? "请先选择主模型" : undefined
                    }
                  >
                    {/* 「无」选项：清除备用 */}
                    <option value={FALLBACK_NONE}>无</option>
                    {/* 兜底项：备用模型已被禁用但仍被引用 */}
                    {fallbackDisabled && binding?.fallbackModel && (
                      <option value={fallbackId} disabled>
                        {binding.fallbackModel.name} (
                        {binding.fallbackModel.modelName}) — 已禁用
                      </option>
                    )}
                    {/* 按大类分组，排除主模型避免主备相同 */}
                    {CATEGORY_ORDER.map((cat) => {
                      const list = groupedModels[cat];
                      if (!list || list.length === 0) return null;
                      const filtered = list.filter(
                        (m) => m.id !== primaryId
                      );
                      if (filtered.length === 0) return null;
                      return (
                        <optgroup
                          key={cat}
                          label={`-- ${CATEGORY_LABELS[cat]} --`}
                        >
                          {filtered.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} ({m.modelName})
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                </div>
              );
            })}

            {/* ---------- 底部说明 ---------- */}
            <p className="text-xs text-muted-foreground pt-1">
              提示：主模型调用失败时将自动切换到备用模型；备用模型可选择「无」以禁用降级
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
