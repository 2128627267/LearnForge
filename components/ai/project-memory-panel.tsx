"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/components/shared/toaster";
import {
  Plus,
  Trash2,
  Power,
  Edit3,
  Save,
  X,
  Loader2,
  RefreshCw,
  Database,
  Lock,
} from "lucide-react";

/**
 * 项目记忆管理面板
 *
 * 用于 AI 问答页面，管理持久化的上下文记忆条目。
 * 激活的记忆会在 AI 对话时自动注入系统提示词。
 *
 * 功能：
 *   - 列出所有记忆条目（按优先级降序）
 *   - 创建新记忆（标题 + 内容 + 类型 + 作用域 + 优先级）
 *   - 切换记忆激活/停用状态
 *   - 编辑记忆内容（系统自动记忆仅能切换激活/优先级）
 *   - 删除记忆（系统自动记忆不允许删除）
 *   - 一键刷新各模块的系统自动记忆（聚合 stats/canvas/english/learn）
 */

/** 记忆类型元信息 */
const MEMORY_TYPES: Record<string, { label: string; color: string }> = {
  fact: { label: "事实", color: "bg-blue-100 text-blue-800" },
  preference: { label: "偏好", color: "bg-purple-100 text-purple-800" },
  context: { label: "上下文", color: "bg-gray-100 text-gray-800" },
  summary: { label: "摘要", color: "bg-green-100 text-green-800" },
};

/** 作用域元信息（用于显示标签与筛选） */
const SCOPE_META: Record<string, { label: string; color: string; icon?: string }> = {
  global: { label: "全局", color: "bg-slate-100 text-slate-700" },
  stats: { label: "统计", color: "bg-cyan-100 text-cyan-800" },
  canvas: { label: "画布", color: "bg-indigo-100 text-indigo-800" },
  english: { label: "英语", color: "bg-emerald-100 text-emerald-800" },
  learn: { label: "学习", color: "bg-amber-100 text-amber-800" },
  qa: { label: "问答", color: "bg-rose-100 text-rose-800" },
};

/** 来源元信息 */
const SOURCE_META: Record<string, { label: string; icon?: typeof Lock }> = {
  manual: { label: "手动" },
  ai_extracted: { label: "AI 提取" },
  system: { label: "系统" },
  system_auto: { label: "系统自动", icon: Lock },
};

/** 项目记忆条目类型 */
interface MemoryItem {
  id: string;
  title: string;
  content: string;
  type: string;
  scope: string;
  priority: number;
  active: boolean;
  source: string;
  moduleId: string | null;
  autoRefresh: boolean;
  createdAt: string;
}

export function ProjectMemoryPanel() {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // 表单状态
  const [formTitle, setFormTitle] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formType, setFormType] = useState("context");
  const [formScope, setFormScope] = useState("global");
  const [formPriority, setFormPriority] = useState(0.5);
  const [saving, setSaving] = useState(false);

  /** 加载记忆列表 */
  const loadMemories = useCallback(async () => {
    try {
      const res = await fetch("/api/project-memory");
      if (!res.ok) throw new Error("加载失败");
      const data = await res.json();
      setMemories(data.memories || []);
    } catch (err) {
      toast.error("加载项目记忆失败", { description: String(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMemories();
  }, [loadMemories]);

  /** 提交表单（创建或更新） */
  const handleSubmit = async () => {
    if (!formTitle.trim() || !formContent.trim()) {
      toast.error("标题和内容不能为空");
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        // 更新
        const res = await fetch(`/api/project-memory?id=${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: formTitle,
            content: formContent,
            type: formType,
            scope: formScope,
            priority: formPriority,
          }),
        });
        if (!res.ok) throw new Error("更新失败");
        toast.success("记忆已更新");
      } else {
        // 创建
        const res = await fetch("/api/project-memory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: formTitle,
            content: formContent,
            type: formType,
            scope: formScope,
            priority: formPriority,
          }),
        });
        if (!res.ok) throw new Error("创建失败");
        toast.success("记忆已创建");
      }
      // 重置表单
      resetForm();
      await loadMemories();
    } catch (err) {
      toast.error("保存失败", { description: String(err) });
    } finally {
      setSaving(false);
    }
  };

  /** 切换记忆激活状态 */
  const toggleActive = async (id: string, current: boolean) => {
    try {
      const res = await fetch(`/api/project-memory?id=${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !current }),
      });
      if (!res.ok) throw new Error("切换失败");
      // 局部更新
      setMemories((prev) =>
        prev.map((m) => (m.id === id ? { ...m, active: !current } : m))
      );
    } catch (err) {
      toast.error("切换状态失败", { description: String(err) });
    }
  };

  /** 删除记忆（系统自动记忆不允许删除） */
  const handleDelete = async (m: MemoryItem) => {
    if (m.source === "system_auto") {
      toast.error("系统自动记忆不允许删除", {
        description: "可通过下方『刷新系统记忆』按钮清理",
      });
      return;
    }
    if (!confirm("确定删除这条记忆吗？")) return;
    try {
      const res = await fetch(`/api/project-memory?id=${m.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("删除失败");
      toast.success("已删除");
      setMemories((prev) => prev.filter((item) => item.id !== m.id));
    } catch (err) {
      toast.error("删除失败", { description: String(err) });
    }
  };

  /** 开始编辑（系统自动记忆仅能切换激活/优先级，不能编辑内容） */
  const startEdit = (m: MemoryItem) => {
    if (m.source === "system_auto") {
      toast.info("系统自动记忆", {
        description: "内容由系统聚合生成，仅支持切换激活/优先级",
      });
      return;
    }
    setEditingId(m.id);
    setFormTitle(m.title);
    setFormContent(m.content);
    setFormType(m.type);
    setFormScope(m.scope);
    setFormPriority(m.priority);
    setShowForm(true);
  };

  /** 重置表单 */
  const resetForm = () => {
    setFormTitle("");
    setFormContent("");
    setFormType("context");
    setFormScope("global");
    setFormPriority(0.5);
    setEditingId(null);
    setShowForm(false);
  };

  /** 刷新系统自动记忆（聚合各模块数据） */
  const handleRefreshSystem = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/project-memory/aggregate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("刷新失败");
      const data = await res.json();
      if (data.success) {
        toast.success("系统记忆已刷新", {
          description: "已从统计/画布/英语/学习模块重新聚合",
        });
      } else {
        toast.warning("部分模块刷新失败", { description: data.message });
      }
      await loadMemories();
    } catch (err) {
      toast.error("刷新系统记忆失败", { description: String(err) });
    } finally {
      setRefreshing(false);
    }
  };

  const activeCount = memories.filter((m) => m.active).length;
  const systemAutoCount = memories.filter((m) => m.source === "system_auto").length;

  return (
    <div className="flex flex-col h-full border rounded-lg bg-card">
      {/* 头部 */}
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <div>
          <h3 className="font-medium text-sm">项目记忆</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            激活 {activeCount} / 共 {memories.length} 条
            {systemAutoCount > 0 && `（系统自动 ${systemAutoCount}）`}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {/* 刷新系统记忆按钮 */}
          <Button
            size="sm"
            variant="ghost"
            onClick={handleRefreshSystem}
            disabled={refreshing}
            title="从统计/画布/英语/学习模块聚合生成系统记忆"
          >
            {refreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
          {!showForm && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowForm(true)}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              添加
            </Button>
          )}
        </div>
      </div>

      {/* 表单区 */}
      {showForm && (
        <div className="p-3 border-b space-y-2 bg-muted/30">
          <Input
            value={formTitle}
            onChange={(e) => setFormTitle(e.target.value)}
            placeholder="记忆标题（如：用户正在学习高考英语）"
            className="text-sm"
          />
          <Textarea
            value={formContent}
            onChange={(e) => setFormContent(e.target.value)}
            placeholder="详细内容（AI 对话时会参考此内容）"
            rows={3}
            className="text-sm"
          />
          <div className="flex items-center gap-2">
            <select
              value={formType}
              onChange={(e) => setFormType(e.target.value)}
              className="text-xs border rounded px-2 py-1 bg-background"
            >
              {Object.entries(MEMORY_TYPES).map(([key, val]) => (
                <option key={key} value={key}>
                  {val.label}
                </option>
              ))}
            </select>
            <select
              value={formScope}
              onChange={(e) => setFormScope(e.target.value)}
              className="text-xs border rounded px-2 py-1 bg-background"
            >
              {Object.entries(SCOPE_META).map(([key, val]) => (
                <option key={key} value={key}>
                  {val.label}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1 flex-1">
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                优先级
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={formPriority}
                onChange={(e) => setFormPriority(parseFloat(e.target.value))}
                className="flex-1 h-1"
              />
              <span className="text-xs text-muted-foreground w-6 text-right">
                {formPriority.toFixed(1)}
              </span>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={resetForm}>
              <X className="h-3.5 w-3.5 mr-1" />
              取消
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={saving}>
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <Save className="h-3.5 w-3.5 mr-1" />
              )}
              {editingId ? "更新" : "保存"}
            </Button>
          </div>
        </div>
      )}

      {/* 记忆列表 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : memories.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            暂无项目记忆
            <br />
            <span className="text-xs">
              点击上方刷新按钮从各模块聚合数据，或手动添加记忆
            </span>
          </div>
        ) : (
          memories.map((m) => {
            const typeMeta = MEMORY_TYPES[m.type] || MEMORY_TYPES.context;
            const scopeMeta = SCOPE_META[m.scope] || SCOPE_META.global;
            const sourceMeta = SOURCE_META[m.source] || { label: m.source };
            const isSystemAuto = m.source === "system_auto";
            return (
              <div
                key={m.id}
                className={cn(
                  "p-2 rounded-md border text-sm transition-opacity",
                  m.active ? "opacity-100" : "opacity-50"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                      <span className="font-medium truncate">{m.title}</span>
                      <span
                        className={cn(
                          "text-xs px-1.5 py-0.5 rounded",
                          typeMeta.color
                        )}
                      >
                        {typeMeta.label}
                      </span>
                      <span
                        className={cn(
                          "text-xs px-1.5 py-0.5 rounded",
                          scopeMeta.color
                        )}
                      >
                        {scopeMeta.label}
                      </span>
                      {isSystemAuto && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 inline-flex items-center gap-0.5">
                          <Database className="h-2.5 w-2.5" />
                          自动
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-line">
                      {m.content}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-1 mt-1">
                  <button
                    onClick={() => toggleActive(m.id, m.active)}
                    className={cn(
                      "p-1 rounded hover:bg-accent transition-colors",
                      m.active ? "text-green-600" : "text-muted-foreground"
                    )}
                    title={m.active ? "停用" : "激活"}
                  >
                    <Power className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => startEdit(m)}
                    className={cn(
                      "p-1 rounded hover:bg-accent transition-colors",
                      isSystemAuto
                        ? "text-muted-foreground/40 cursor-not-allowed"
                        : "text-muted-foreground"
                    )}
                    title={isSystemAuto ? "系统自动记忆不可编辑内容" : "编辑"}
                  >
                    {isSystemAuto ? (
                      <Lock className="h-3.5 w-3.5" />
                    ) : (
                      <Edit3 className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    onClick={() => handleDelete(m)}
                    className={cn(
                      "p-1 rounded hover:bg-accent transition-colors",
                      isSystemAuto
                        ? "text-muted-foreground/40 cursor-not-allowed"
                        : "text-red-500"
                    )}
                    title={isSystemAuto ? "系统自动记忆不可删除" : "删除"}
                  >
                    {isSystemAuto ? (
                      <Lock className="h-3.5 w-3.5" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
