"use client";

/**
 * 设置面板客户端组件
 *
 * 包含三个分区：
 *   A. AI 库配置区 —— AI 提供商、API Key、模型、温度、多 Key 轮换池、RAG 设置
 *   B. 知识库管理区 —— 文档列表、导入（文本/文件）、删除
 *   C. 数据管理区 —— 导出/导入设置 JSON、清空知识库
 *
 * 数据流：
 *   - AI 配置：GET/PUT /api/settings/ai
 *   - 知识库：GET/POST/DELETE /api/settings/knowledge
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/shared/toaster";
import { cn } from "@/lib/utils/cn";
import {
  AlertTriangle,
  Download,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { ModelConfigSection } from "./model-config-section";
import { TaskBindingSection } from "./task-binding-section";
import { CodecSection } from "./codec-section";

// ==================== 类型定义 ====================

/**
 * 多 API Key 轮换池条目
 * 与服务端 AISettings.apiKeys JSON 结构保持一致
 */
interface ApiKeyEntry {
  key: string;
  label: string;
  usage: number;
  limit: number;
  exhausted: boolean;
}

/**
 * AI 配置（前端使用形状，apiKeys 为数组）
 */
interface AISettings {
  id: string;
  activeProvider: string;
  apiKey: string;
  apiUrl: string;
  chatModel: string;
  embeddingModel: string;
  embeddingDims: number;
  apiKeys: ApiKeyEntry[];
  currentKeyIdx: number;
  temperature: number;
  maxTokens: number;
  ragEnabled: boolean;
  ragTopK: number;
  updatedAt: string;
}

/**
 * 知识库文档（列表项形状，不含完整 content）
 */
interface KnowledgeDoc {
  id: string;
  title: string;
  source: string;
  fileType: string;
  status: string;
  chunkCount: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ==================== 常量配置 ====================

/**
 * AI 提供商选项
 */
const PROVIDERS: Array<{ value: string; label: string }> = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "local", label: "本地模型" },
];

/**
 * 知识库文档状态 → Badge variant 与中文标签映射
 */
const STATUS_META: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "success" | "warning" | "outline" }
> = {
  pending: { label: "待处理", variant: "warning" },
  processing: { label: "处理中", variant: "secondary" },
  ready: { label: "就绪", variant: "success" },
  failed: { label: "失败", variant: "destructive" },
};

/**
 * 知识库文档来源 → 中文标签映射
 */
const SOURCE_LABELS: Record<string, string> = {
  file_upload: "文件上传",
  manual: "手动",
  ai_generated: "AI 生成",
};

/**
 * 默认 AI 配置（用于首次加载失败时的兜底）
 */
const DEFAULT_AI_SETTINGS: AISettings = {
  id: "default",
  activeProvider: "openai",
  apiKey: "",
  apiUrl: "",
  chatModel: "gpt-4o-mini",
  embeddingModel: "text-embedding-3-small",
  embeddingDims: 1536,
  apiKeys: [],
  currentKeyIdx: 0,
  temperature: 0.7,
  maxTokens: 2048,
  ragEnabled: false,
  ragTopK: 5,
  updatedAt: new Date().toISOString(),
};

// ==================== 工具函数 ====================

/**
 * 对 API Key 做脱敏显示（仅保留前 4 位与后 4 位）
 * 空字符串返回空
 */
function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

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

export function SettingsPanel() {
  // ---------- AI 配置状态 ----------
  const [aiSettings, setAiSettings] = useState<AISettings>(DEFAULT_AI_SETTINGS);
  const [aiLoading, setAiLoading] = useState(true);
  const [aiSaving, setAiSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  // 多 Key 轮换池：新增条目的输入
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [newKeyValue, setNewKeyValue] = useState("");

  // ---------- 知识库状态 ----------
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [newDocTitle, setNewDocTitle] = useState("");
  const [newDocContent, setNewDocContent] = useState("");
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // 文件导入采用的 fileType（上传时根据扩展名判定）
  const fileImportTypeRef = useRef<string>("text");

  // ---------- 数据管理状态 ----------
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const importSettingsInputRef = useRef<HTMLInputElement | null>(null);

  // ==================== 数据加载 ====================

  /**
   * 加载 AI 配置
   */
  const loadAISettings = useCallback(async () => {
    setAiLoading(true);
    try {
      const res = await fetch("/api/settings/ai");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: AISettings = await res.json();
      setAiSettings(data);
    } catch (err) {
      toast.error("加载 AI 配置失败", { description: String(err) });
      // 失败时使用默认配置，保证页面可用
      setAiSettings(DEFAULT_AI_SETTINGS);
    } finally {
      setAiLoading(false);
    }
  }, []);

  /**
   * 加载知识库文档列表
   */
  const loadDocs = useCallback(async () => {
    setDocsLoading(true);
    try {
      const res = await fetch("/api/settings/knowledge");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: { items: KnowledgeDoc[]; total: number } = await res.json();
      setDocs(data.items || []);
    } catch (err) {
      toast.error("加载知识库列表失败", { description: String(err) });
      setDocs([]);
    } finally {
      setDocsLoading(false);
    }
  }, []);

  // 初始加载
  useEffect(() => {
    loadAISettings();
    loadDocs();
  }, [loadAISettings, loadDocs]);

  // ==================== AI 配置操作 ====================

  /**
   * 通用字段更新：表单输入同步到 aiSettings
   */
  const updateField = <K extends keyof AISettings>(
    key: K,
    value: AISettings[K]
  ) => {
    setAiSettings((prev) => ({ ...prev, [key]: value }));
  };

  /**
   * 保存 AI 配置
   */
  const handleSaveAI = async () => {
    setAiSaving(true);
    try {
      const res = await fetch("/api/settings/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(aiSettings),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data: AISettings = await res.json();
      setAiSettings(data);
      toast.success("AI 配置已保存");
    } catch (err) {
      toast.error("保存 AI 配置失败", { description: String(err) });
    } finally {
      setAiSaving(false);
    }
  };

  /**
   * 向轮换池添加一个 API Key
   */
  const handleAddKey = () => {
    const key = newKeyValue.trim();
    if (!key) {
      toast.error("请输入 API Key");
      return;
    }
    const entry: ApiKeyEntry = {
      key,
      label: newKeyLabel.trim() || `Key ${(aiSettings.apiKeys.length + 1).toString()}`,
      usage: 0,
      limit: 0,
      exhausted: false,
    };
    updateField("apiKeys", [...aiSettings.apiKeys, entry]);
    setNewKeyLabel("");
    setNewKeyValue("");
    toast.success("已添加到轮换池（需保存配置才生效）");
  };

  /**
   * 从轮换池移除指定索引的 API Key
   */
  const handleRemoveKey = (idx: number) => {
    const next = aiSettings.apiKeys.filter((_, i) => i !== idx);
    // 若删除导致 currentKeyIdx 越界，则重置为 0
    const nextIdx = aiSettings.currentKeyIdx >= next.length ? 0 : aiSettings.currentKeyIdx;
    setAiSettings((prev) => ({ ...prev, apiKeys: next, currentKeyIdx: nextIdx }));
    toast.success("已从轮换池移除（需保存配置才生效）");
  };

  // ==================== 知识库操作 ====================

  /**
   * 提交手动粘贴的文本到知识库
   */
  const handleImportText = async () => {
    const title = newDocTitle.trim();
    const content = newDocContent.trim();
    if (!title) {
      toast.error("请填写文档标题");
      return;
    }
    if (!content) {
      toast.error("请填写文档内容");
      return;
    }
    setImporting(true);
    try {
      const res = await fetch("/api/settings/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content,
          fileType: "text",
          source: "manual",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      toast.success("文档已导入（待向量处理）");
      setNewDocTitle("");
      setNewDocContent("");
      await loadDocs();
    } catch (err) {
      toast.error("导入失败", { description: String(err) });
    } finally {
      setImporting(false);
    }
  };

  /**
   * 处理文件上传：仅支持 .txt / .md / .markdown
   * 读取为文本字符串后提交到知识库
   */
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // 无论是否选中文件都重置 input，便于重复选择同一文件
    e.target.value = "";
    if (!file) return;

    // 文件类型校验（通过扩展名判定，并记录 fileType）
    const lower = file.name.toLowerCase();
    let fileType = "text";
    if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
      fileType = "markdown";
    } else if (lower.endsWith(".txt")) {
      fileType = "text";
    } else {
      toast.error("仅支持 .txt 和 .md 文件");
      return;
    }
    fileImportTypeRef.current = fileType;

    setImporting(true);
    try {
      // 读取文件文本内容
      const content = await file.text();
      if (!content.trim()) {
        toast.error("文件内容为空");
        return;
      }
      const title = file.name.replace(/\.[^.]+$/, "");
      const res = await fetch("/api/settings/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content,
          fileType,
          source: "file_upload",
          metadata: { fileSize: file.size, fileName: file.name },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      toast.success(`文件 ${file.name} 已导入（待向量处理）`);
      await loadDocs();
    } catch (err) {
      toast.error("文件导入失败", { description: String(err) });
    } finally {
      setImporting(false);
    }
  };

  /**
   * 删除指定知识库文档
   */
  const handleDeleteDoc = async (id: string, title: string) => {
    if (!confirm(`确定删除文档「${title}」？此操作不可恢复。`)) {
      return;
    }
    try {
      const res = await fetch(`/api/settings/knowledge?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      toast.success("文档已删除");
      await loadDocs();
    } catch (err) {
      toast.error("删除失败", { description: String(err) });
    }
  };

  // ==================== 数据管理操作 ====================

  /**
   * 导出设置：合并 AI 配置与知识库索引为 JSON 文件下载
   * 注意：导出文件包含 API Key 等敏感信息，请妥善保管
   */
  const handleExport = async () => {
    try {
      // 拉取最新的 AI 配置与知识库列表
      const [aiRes, docsRes] = await Promise.all([
        fetch("/api/settings/ai"),
        fetch("/api/settings/knowledge"),
      ]);
      if (!aiRes.ok || !docsRes.ok) {
        throw new Error("拉取数据失败");
      }
      const ai = await aiRes.json();
      const docsData = await docsRes.json();

      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        aiSettings: ai,
        knowledgeIndex: docsData.items,
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `learnforge-settings-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("设置已导出");
    } catch (err) {
      toast.error("导出失败", { description: String(err) });
    }
  };

  /**
   * 导入设置：从 JSON 文件恢复 AI 配置
   * 仅恢复 AI 配置；知识库文档需重新导入（避免 ID 冲突）
   */
  const handleImportSettings = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      const payload = JSON.parse(text);

      // 兼容字段名：payload.aiSettings 或 payload.ai
      const ai = payload.aiSettings || payload.ai;
      if (!ai || typeof ai !== "object") {
        toast.error("JSON 文件格式无效：缺少 aiSettings 字段");
        return;
      }

      // 调用 PUT 恢复 AI 配置
      const res = await fetch("/api/settings/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ai),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data: AISettings = await res.json();
      setAiSettings(data);
      toast.success("AI 配置已从文件恢复");
    } catch (err) {
      toast.error("导入设置失败", { description: String(err) });
    }
  };

  /**
   * 清空知识库：逐个删除所有文档
   * 利用 Promise.all 并发执行以提升速度（文档数通常不多）
   */
  const handleClearAll = async () => {
    setClearing(true);
    try {
      const ids = docs.map((d) => d.id);
      const results = await Promise.allSettled(
        ids.map((id) =>
          fetch(`/api/settings/knowledge?id=${encodeURIComponent(id)}`, {
            method: "DELETE",
          })
        )
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) {
        toast.warning(`部分删除失败（${failed}/${ids.length}）`);
      } else {
        toast.success(`已清空 ${ids.length} 篇文档`);
      }
      await loadDocs();
    } catch (err) {
      toast.error("清空知识库失败", { description: String(err) });
    } finally {
      setClearing(false);
      setClearConfirmOpen(false);
    }
  };

  // ==================== 渲染 ====================

  return (
    <div className="space-y-6">
      {/* ==================== 新版：模型配置区 ==================== */}
      <ModelConfigSection />

      {/* ==================== 新版：任务绑定区 ==================== */}
      <TaskBindingSection />

      {/* ==================== A. AI 库配置区（旧版兼容） ==================== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            AI 库配置
            <Badge variant="secondary" className="text-[10px]">旧版兼容</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {aiLoading ? (
            <div className="flex items-center text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              加载配置中...
            </div>
          ) : (
            <>
              {/* AI 提供商 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    AI 提供商
                  </label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={aiSettings.activeProvider}
                    onChange={(e) =>
                      updateField("activeProvider", e.target.value)
                    }
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* API Base URL */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    API Base URL
                  </label>
                  <Input
                    value={aiSettings.apiUrl}
                    onChange={(e) => updateField("apiUrl", e.target.value)}
                    placeholder="https://api.openai.com/v1（留空使用默认）"
                  />
                </div>
              </div>

              {/* API Key（主 Key） */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  API Key
                </label>
                <div className="flex gap-2">
                  <Input
                    type={showApiKey ? "text" : "password"}
                    value={aiSettings.apiKey}
                    onChange={(e) => updateField("apiKey", e.target.value)}
                    placeholder="sk-..."
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
                  主 Key 用于直接调用；下方轮换池可作为备用/多账号 Key
                </p>
              </div>

              {/* 聊天模型 / 嵌入模型 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    聊天模型
                  </label>
                  <Input
                    value={aiSettings.chatModel}
                    onChange={(e) => updateField("chatModel", e.target.value)}
                    placeholder="gpt-4o-mini"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    嵌入模型
                  </label>
                  <Input
                    value={aiSettings.embeddingModel}
                    onChange={(e) =>
                      updateField("embeddingModel", e.target.value)
                    }
                    placeholder="text-embedding-3-small"
                  />
                </div>
              </div>

              {/* 温度 / 最大 Token */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    温度：{aiSettings.temperature.toFixed(2)}
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={aiSettings.temperature}
                    onChange={(e) =>
                      updateField("temperature", Number(e.target.value))
                    }
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground mt-0.5">
                    <span>0（精确）</span>
                    <span>2（发散）</span>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    最大 Token
                  </label>
                  <Input
                    type="number"
                    min={1}
                    value={aiSettings.maxTokens}
                    onChange={(e) =>
                      updateField("maxTokens", Number(e.target.value) || 0)
                    }
                    placeholder="2048"
                  />
                </div>
              </div>

              {/* 多 API Key 轮换池 */}
              <div className="space-y-3 p-4 rounded-lg border bg-muted/30">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-sm">多 API Key 轮换池</h3>
                  <span className="text-xs text-muted-foreground">
                    当前索引：{aiSettings.currentKeyIdx} / 共{" "}
                    {aiSettings.apiKeys.length} 个
                  </span>
                </div>

                {/* 已有 Key 列表 */}
                {aiSettings.apiKeys.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">
                    暂无轮换 Key，主 Key 将作为唯一调用凭证
                  </p>
                ) : (
                  <div className="space-y-2">
                    {aiSettings.apiKeys.map((entry, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 p-2 rounded border bg-background"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">
                              {entry.label || `Key ${idx + 1}`}
                            </span>
                            {idx === aiSettings.currentKeyIdx && (
                              <Badge variant="default" className="text-xs">
                                当前
                              </Badge>
                            )}
                            {entry.exhausted && (
                              <Badge variant="destructive" className="text-xs">
                                已耗尽
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono truncate">
                            {maskKey(entry.key)}
                            {entry.limit > 0 && (
                              <span className="ml-2">
                                用量：{entry.usage}/{entry.limit}
                              </span>
                            )}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveKey(idx)}
                          title="删除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {/* 新增 Key 输入 */}
                <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-2 items-end">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">
                      标签
                    </label>
                    <Input
                      value={newKeyLabel}
                      onChange={(e) => setNewKeyLabel(e.target.value)}
                      placeholder="如：账号1"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">
                      API Key
                    </label>
                    <Input
                      type="password"
                      value={newKeyValue}
                      onChange={(e) => setNewKeyValue(e.target.value)}
                      placeholder="sk-..."
                      autoComplete="off"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleAddKey}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    添加
                  </Button>
                </div>
              </div>

              {/* RAG 设置 */}
              <div className="space-y-3 p-4 rounded-lg border bg-muted/30">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium text-sm">
                      检索增强生成（RAG）
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      启用后 AI 问答会先检索知识库作为上下文
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={aiSettings.ragEnabled}
                    onClick={() =>
                      updateField("ragEnabled", !aiSettings.ragEnabled)
                    }
                    className={cn(
                      "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                      aiSettings.ragEnabled
                        ? "bg-primary"
                        : "bg-muted-foreground/30"
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block h-4 w-4 transform rounded-full bg-background transition-transform",
                        aiSettings.ragEnabled
                          ? "translate-x-6"
                          : "translate-x-1"
                      )}
                    />
                  </button>
                </div>
                <div className={cn(!aiSettings.ragEnabled && "opacity-50 pointer-events-none")}>
                  <label className="block text-sm font-medium mb-1.5">
                    检索 Top-K：{aiSettings.ragTopK}
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={20}
                    step={1}
                    value={aiSettings.ragTopK}
                    onChange={(e) =>
                      updateField("ragTopK", Number(e.target.value))
                    }
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground mt-0.5">
                    每次问答检索的最相关分块数量
                  </p>
                </div>
              </div>

              {/* 保存按钮 */}
              <div className="flex justify-end pt-2">
                <Button onClick={handleSaveAI} disabled={aiSaving}>
                  {aiSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : null}
                  {aiSaving ? "保存中..." : "保存 AI 配置"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ==================== B. 知识库管理区 ==================== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">知识库管理</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 导入知识 */}
          <div className="space-y-3 p-4 rounded-lg border bg-muted/30">
            <h3 className="font-medium text-sm">导入知识</h3>

            <div className="grid grid-cols-1 md:grid-cols-[2fr_auto] gap-2 items-end">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  标题
                </label>
                <Input
                  value={newDocTitle}
                  onChange={(e) => setNewDocTitle(e.target.value)}
                  placeholder="文档标题"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
              >
                <Upload className="h-4 w-4 mr-1" />
                上传文件
              </Button>
              {/* 隐藏的文件输入，仅支持文本与 Markdown */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.markdown"
                className="hidden"
                onChange={handleFileUpload}
              />
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                内容（支持文本粘贴）
              </label>
              <Textarea
                value={newDocContent}
                onChange={(e) => setNewDocContent(e.target.value)}
                placeholder="粘贴知识内容..."
                rows={5}
              />
            </div>

            <div className="flex justify-end">
              <Button
                type="button"
                onClick={handleImportText}
                disabled={importing}
              >
                {importing ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Plus className="h-4 w-4 mr-1" />
                )}
                {importing ? "导入中..." : "导入文本"}
              </Button>
            </div>
          </div>

          {/* 文档列表 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium text-sm">
                文档列表
                {!docsLoading && (
                  <span className="text-xs text-muted-foreground ml-1">
                    （共 {docs.length} 篇）
                  </span>
                )}
              </h3>
            </div>

            {docsLoading ? (
              <div className="flex items-center text-sm text-muted-foreground py-8 justify-center">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                加载中...
              </div>
            ) : docs.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground border rounded-lg border-dashed">
                暂无知识库文档，请从上方导入
              </div>
            ) : (
              <div className="space-y-2">
                {docs.map((doc) => {
                  const status = STATUS_META[doc.status] || {
                    label: doc.status,
                    variant: "outline" as const,
                  };
                  return (
                    <div
                      key={doc.id}
                      className="flex items-center gap-3 p-3 rounded border bg-background"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate">
                            {doc.title}
                          </span>
                          <Badge variant={status.variant} className="text-xs">
                            {status.label}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {SOURCE_LABELS[doc.source] || doc.source}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {doc.fileType}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          分块数：{doc.chunkCount} · 创建于{" "}
                          {formatTime(doc.createdAt)}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteDoc(doc.id, doc.title)}
                        title="删除文档"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ==================== C. 数据管理区 ==================== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">数据管理</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* 导出设置 */}
            <div className="p-4 rounded-lg border space-y-2">
              <div className="flex items-center gap-2">
                <Download className="h-4 w-4" />
                <h3 className="font-medium text-sm">导出设置</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                将 AI 配置与知识库索引导出为 JSON 文件
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleExport}
              >
                <Download className="h-4 w-4 mr-1" />
                导出 JSON
              </Button>
              <p className="text-xs text-yellow-600">
                注意：导出文件包含 API Key，请妥善保管
              </p>
            </div>

            {/* 导入设置 */}
            <div className="p-4 rounded-lg border space-y-2">
              <div className="flex items-center gap-2">
                <Upload className="h-4 w-4" />
                <h3 className="font-medium text-sm">导入设置</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                从 JSON 文件恢复 AI 配置
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => importSettingsInputRef.current?.click()}
              >
                <Upload className="h-4 w-4 mr-1" />
                选择 JSON 文件
              </Button>
              <input
                ref={importSettingsInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleImportSettings}
              />
              <p className="text-xs text-muted-foreground">
                仅恢复 AI 配置，知识库文档需重新导入
              </p>
            </div>

            {/* 清空知识库 */}
            <div className="p-4 rounded-lg border space-y-2 border-destructive/50">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <h3 className="font-medium text-sm">清空知识库</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                删除所有知识库文档及其向量分块
              </p>
              <Button
                type="button"
                variant="destructive"
                className="w-full"
                onClick={() => setClearConfirmOpen(true)}
                disabled={clearing || docs.length === 0}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                清空全部
              </Button>
              <p className="text-xs text-destructive">
                此操作不可恢复，请谨慎操作
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ==================== D. 文件编解码器 ==================== */}
      <CodecSection />

      {/* ==================== 清空确认对话框 ==================== */}
      <Dialog
        open={clearConfirmOpen}
        onClose={() => {
          if (!clearing) setClearConfirmOpen(false);
        }}
        title="确认清空知识库"
        maxWidth="max-w-md"
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setClearConfirmOpen(false)}
              disabled={clearing}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleClearAll}
              disabled={clearing}
            >
              {clearing ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Trash2 className="h-4 w-4 mr-1" />
              )}
              {clearing ? "清空中..." : "确认清空"}
            </Button>
          </>
        }
      >
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <p className="text-sm text-muted-foreground">
              即将删除全部{" "}
              <span className="font-semibold text-foreground">
                {docs.length}
              </span>{" "}
              篇知识库文档及其所有向量分块。此操作{" "}
              <span className="text-destructive font-semibold">不可恢复</span>
              ，确定继续吗？
            </p>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
