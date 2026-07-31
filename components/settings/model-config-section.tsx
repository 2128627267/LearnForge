"use client";

/**
 * AI 模型配置管理组件
 *
 * 功能：
 *   - 按大类（语言/嵌入/语音/图片/其他）分组展示模型配置
 *   - 新增模型配置（弹出表单）
 *   - 编辑现有配置（表单预填）
 *   - 删除配置（二次确认）
 *
 * 数据流：
 *   - GET    /api/settings/models?includeInactive=true  → 列表（含禁用项）
 *   - POST   /api/settings/models                       → 新增
 *   - PUT    /api/settings/models/:id                   → 更新
 *   - DELETE /api/settings/models/:id                   → 删除
 *
 * 注意：
 *   - apiKey 字段在服务端已脱敏返回，编辑时若不修改则保留原值
 *   - apiKey 支持 ${ENV_VAR} 环境变量引用与 file:// 本地文件语法
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/shared/toaster";
import { cn } from "@/lib/utils/cn";
import {
  Box,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Settings,
  Trash2,
  Volume2,
  X,
} from "lucide-react";

// ==================== 类型定义 ====================

/** 模型配置大类（与服务端 ModelCategory 对齐） */
type ModelCategory = "language" | "embedding" | "voice" | "image" | "other";

/** 模型配置 DTO（与服务端 AIModelConfigDTO 对齐） */
interface AIModelConfigDTO {
  id: string;
  name: string;
  category: ModelCategory;
  provider: string;
  modelName: string;
  /** API Key（服务端已脱敏，或环境变量/file:// 原样返回） */
  apiKey: string;
  apiUrl: string;
  isActive: boolean;
  order: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** 表单状态 */
interface FormState {
  name: string;
  category: ModelCategory;
  provider: string;
  modelName: string;
  apiKey: string;
  apiUrl: string;
  isActive: boolean;
}

// ==================== 常量配置 ====================

/**
 * 模型大类配置
 * value  - 与服务端 ModelCategory 对齐
 * label  - 中文标签
 * icon   - 大类图标（lucide-react）
 */
const CATEGORY_CONFIG: Array<{
  value: ModelCategory;
  label: string;
  icon: typeof MessageSquare;
}> = [
  { value: "language", label: "语言模型", icon: MessageSquare },
  { value: "embedding", label: "嵌入模型", icon: Box },
  { value: "voice", label: "语音模型", icon: Volume2 },
  { value: "image", label: "图片模型", icon: ImageIcon },
  { value: "other", label: "其他", icon: Settings },
];

/**
 * 提供商选项（用于表单下拉框）
 */
const PROVIDER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "local", label: "本地模型" },
  { value: "custom", label: "自定义" },
];

/**
 * 提供商 value → 中文标签映射（用于卡片展示）
 */
const PROVIDER_LABELS: Record<string, string> = Object.fromEntries(
  PROVIDER_OPTIONS.map((p) => [p.value, p.label])
);

/** 空表单默认值（用于新增） */
const EMPTY_FORM: FormState = {
  name: "",
  category: "language",
  provider: "openai",
  modelName: "",
  apiKey: "",
  apiUrl: "",
  isActive: true,
};

// ==================== 工具函数 ====================

/**
 * 格式化时间为本地可读字符串
 */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ==================== 主组件 ====================

export function ModelConfigSection() {
  // ---------- 列表状态 ----------
  const [models, setModels] = useState<AIModelConfigDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // ---------- 编辑器状态 ----------
  // editorOpen 控制表单弹层显隐
  const [editorOpen, setEditorOpen] = useState(false);
  // editingId 为 null 表示新增，否则为编辑模式
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  // apiKey 显示/隐藏切换
  const [showApiKey, setShowApiKey] = useState(false);

  // ---------- 删除确认状态 ----------
  const [deleteTarget, setDeleteTarget] = useState<AIModelConfigDTO | null>(null);

  // ==================== 数据加载 ====================

  /**
   * 加载模型配置列表（包含禁用项）
   */
  const loadModels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/models?includeInactive=true");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: { items: AIModelConfigDTO[]; total: number } =
        await res.json();
      setModels(data.items || []);
    } catch (err) {
      toast.error("加载模型配置失败", { description: String(err) });
      setModels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始加载
  useEffect(() => {
    loadModels();
  }, [loadModels]);

  // ==================== 派生数据 ====================

  /**
   * 按大类分组：language/embedding/voice/image/other
   * 顺序与 CATEGORY_CONFIG 保持一致；未知大类兜底归入 other
   */
  const groupedModels = useMemo(() => {
    const map: Record<ModelCategory, AIModelConfigDTO[]> = {
      language: [],
      embedding: [],
      voice: [],
      image: [],
      other: [],
    };
    for (const m of models) {
      if (map[m.category]) {
        map[m.category].push(m);
      } else {
        // 兜底：未知大类归入 other
        map.other.push(m);
      }
    }
    return map;
  }, [models]);

  // ==================== 表单操作 ====================

  /**
   * 通用字段更新：表单输入同步到 form 状态
   */
  const updateField = <K extends keyof FormState>(
    key: K,
    value: FormState[K]
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  /**
   * 打开新增表单
   */
  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowApiKey(false);
    setEditorOpen(true);
  };

  /**
   * 打开编辑表单（预填已有数据）
   *
   * 注意：apiKey 在服务端已脱敏，编辑时输入框留空，
   *       placeholder 提示"留空则保留原 Key"。
   *       用户不输入则提交时不传 apiKey（保留原值），输入新值则覆盖。
   */
  const openEdit = (item: AIModelConfigDTO) => {
    setEditingId(item.id);
    setForm({
      name: item.name,
      category: item.category,
      provider: item.provider,
      modelName: item.modelName,
      apiKey: "", // 留空：未修改则保留原 Key
      apiUrl: item.apiUrl,
      isActive: item.isActive,
    });
    setShowApiKey(false);
    setEditorOpen(true);
  };

  /**
   * 关闭表单弹层并重置状态
   */
  const closeEditor = () => {
    setEditorOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  /**
   * 提交表单（新增或更新）
   */
  const handleSubmit = async () => {
    // 校验必填字段
    if (!form.name.trim()) {
      toast.error("请填写配置名称");
      return;
    }
    if (!form.modelName.trim()) {
      toast.error("请填写模型标识");
      return;
    }

    setSaving(true);
    try {
      const isEdit = editingId !== null;

      // 构建请求体：编辑模式下 apiKey 为空则不传（保留原值）
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        category: form.category,
        provider: form.provider,
        modelName: form.modelName.trim(),
        apiUrl: form.apiUrl.trim(),
        isActive: form.isActive,
      };
      if (form.apiKey.trim() !== "") {
        payload.apiKey = form.apiKey.trim();
      }

      // 编辑模式用 PUT /models/:id，新增用 POST /models
      const url = isEdit
        ? `/api/settings/models/${encodeURIComponent(editingId as string)}`
        : "/api/settings/models";
      const method = isEdit ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || err.error || `HTTP ${res.status}`);
      }

      toast.success(isEdit ? "模型配置已更新" : "模型配置已创建");
      closeEditor();
      await loadModels();
    } catch (err) {
      toast.error("保存模型配置失败", { description: String(err) });
    } finally {
      setSaving(false);
    }
  };

  // ==================== 删除操作 ====================

  /**
   * 确认删除指定模型配置
   * deleteTarget 由"删除"按钮点击时设置，此处执行实际删除
   */
  const handleDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      const res = await fetch(
        `/api/settings/models/${encodeURIComponent(target.id)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || err.error || `HTTP ${res.status}`);
      }
      toast.success(`已删除「${target.name}」`);
      await loadModels();
    } catch (err) {
      toast.error("删除失败", { description: String(err) });
    } finally {
      setDeleteTarget(null);
    }
  };

  // ==================== 渲染 ====================

  return (
    <Card>
      {/* 头部：标题 + 新增按钮 */}
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">AI 模型配置</CardTitle>
          <Button type="button" size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" />
            新增配置
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {loading ? (
          // 加载中状态
          <div className="flex items-center text-sm text-muted-foreground py-8 justify-center">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            加载中...
          </div>
        ) : models.length === 0 ? (
          // 空状态
          <div className="text-center py-8 text-sm text-muted-foreground border rounded-lg border-dashed">
            暂无模型配置，请点击「新增配置」添加
          </div>
        ) : (
          // 按大类分组渲染
          CATEGORY_CONFIG.map(({ value, label, icon: Icon }) => {
            const items = groupedModels[value];
            return (
              <div key={value} className="space-y-2">
                {/* 大类标题 */}
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-medium">{label}</h3>
                  <Badge variant="outline" className="text-xs">
                    {items.length}
                  </Badge>
                </div>

                {/* 大类下配置项列表（空大类也展示标题，便于了解所有可配置类别） */}
                {items.length === 0 ? (
                  <p className="text-xs text-muted-foreground pl-6 py-1">
                    暂无{label}配置
                  </p>
                ) : (
                  <div className="space-y-2 pl-6">
                    {items.map((item) => (
                      <ModelCard
                        key={item.id}
                        item={item}
                        onEdit={() => openEdit(item)}
                        onDelete={() => setDeleteTarget(item)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>

      {/* ==================== 新增/编辑表单弹层 ==================== */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border rounded-lg shadow-lg max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
            {/* 弹层头部 */}
            <div className="flex items-center justify-between p-6 pb-4">
              <h2 className="text-lg font-semibold">
                {editingId ? "编辑模型配置" : "新增模型配置"}
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={closeEditor}
                title="关闭"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* 表单内容 */}
            <div className="px-6 pb-6 space-y-4">
              {/* 配置名称 */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  配置名称 <span className="text-destructive">*</span>
                </label>
                <Input
                  value={form.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  placeholder="如：默认聊天模型"
                />
              </div>

              {/* 大类 + 提供商 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    大类 <span className="text-destructive">*</span>
                  </label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.category}
                    onChange={(e) =>
                      updateField("category", e.target.value as ModelCategory)
                    }
                  >
                    {CATEGORY_CONFIG.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    提供商 <span className="text-destructive">*</span>
                  </label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.provider}
                    onChange={(e) => updateField("provider", e.target.value)}
                  >
                    {PROVIDER_OPTIONS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 模型标识 */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  模型标识 <span className="text-destructive">*</span>
                </label>
                <Input
                  value={form.modelName}
                  onChange={(e) => updateField("modelName", e.target.value)}
                  placeholder="如：gpt-4o-mini"
                />
              </div>

              {/* API Key */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  API Key
                </label>
                <div className="flex gap-2">
                  <Input
                    type={showApiKey ? "text" : "password"}
                    value={form.apiKey}
                    onChange={(e) => updateField("apiKey", e.target.value)}
                    placeholder={
                      editingId
                        ? "留空则保留原 Key（已脱敏存储）"
                        : "sk-... 或 ${ENV_VAR} 或 file://..."
                    }
                    autoComplete="off"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setShowApiKey((v) => !v)}
                    title={showApiKey ? "隐藏" : "显示"}
                  >
                    {showApiKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  支持{" "}
                  <code className="px-1 py-0.5 bg-muted rounded">
                    {"${ENV_VAR}"}
                  </code>{" "}
                  环境变量或{" "}
                  <code className="px-1 py-0.5 bg-muted rounded">file://</code>{" "}
                  本地文件
                </p>
              </div>

              {/* API URL */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  API URL
                </label>
                <Input
                  value={form.apiUrl}
                  onChange={(e) => updateField("apiUrl", e.target.value)}
                  placeholder="https://api.openai.com/v1（留空使用默认）"
                />
              </div>

              {/* 启用开关 */}
              <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                <div>
                  <span className="text-sm font-medium">启用此配置</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    禁用后该模型不会被业务调用
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.isActive}
                  onClick={() => updateField("isActive", !form.isActive)}
                  className={cn(
                    "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                    form.isActive ? "bg-primary" : "bg-muted-foreground/30"
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-4 w-4 transform rounded-full bg-background transition-transform",
                      form.isActive ? "translate-x-6" : "translate-x-1"
                    )}
                  />
                </button>
              </div>

              {/* 操作按钮 */}
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeEditor}
                  disabled={saving}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={saving}
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : null}
                  {saving ? "保存中..." : "保存"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 删除确认对话框 ==================== */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border rounded-lg shadow-lg max-w-md w-full mx-4 p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              <h2 className="text-lg font-semibold">确认删除</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              即将删除模型配置{" "}
              <span className="font-semibold text-foreground">
                「{deleteTarget.name}」
              </span>
              。此操作{" "}
              <span className="text-destructive font-semibold">不可恢复</span>
              ，确定继续吗？
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteTarget(null)}
              >
                取消
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                确认删除
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ==================== 子组件 ====================

/**
 * 单个模型配置卡片
 *
 * 展示：名称、状态徽章、提供商、模型标识、API Key（脱敏）、URL、更新时间
 * 操作：编辑、删除
 */
function ModelCard({
  item,
  onEdit,
  onDelete,
}: {
  item: AIModelConfigDTO;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded border bg-background">
      <div className="flex-1 min-w-0 space-y-1.5">
        {/* 第一行：名称 + 状态徽章 + 提供商 */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{item.name}</span>
          {!item.isActive && (
            <Badge variant="secondary" className="text-xs">
              已禁用
            </Badge>
          )}
          <Badge variant="outline" className="text-xs">
            {PROVIDER_LABELS[item.provider] || item.provider}
          </Badge>
        </div>

        {/* 第二行：模型标识 */}
        <div className="text-xs text-muted-foreground font-mono truncate">
          模型：{item.modelName}
        </div>

        {/* 第三行：API Key + URL */}
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          <div className="font-mono truncate">
            Key：{item.apiKey || "（未设置）"}
          </div>
          {item.apiUrl && (
            <div className="font-mono truncate">URL：{item.apiUrl}</div>
          )}
        </div>

        {/* 第四行：更新时间 */}
        <div className="text-xs text-muted-foreground">
          更新于 {formatTime(item.updatedAt)}
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onEdit}
          title="编辑"
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onDelete}
          title="删除"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
