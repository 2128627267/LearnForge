"use client";

/**
 * 插件/技能管理组件（F5）
 *
 * 功能：
 *   - 插件列表：元信息（名称/版本/来源/工具数）+ 权限徽章 + 启停开关
 *   - 详情展开：工具清单（名称/端点/权限）+ manifest 查看/编辑
 *   - 安装：粘贴 manifest JSON（校验错误由服务端返回中文提示）
 *   - 更新：编辑 manifest 后 PUT（name 不可变）
 *   - 卸载：user 插件可删，builtin 拒绝（服务端约束）
 *
 * 数据流：
 *   - GET    /api/plugins          → 列表（含 tools 关系）
 *   - POST   /api/plugins          → 安装
 *   - PUT    /api/plugins/:id      → 更新
 *   - PATCH  /api/plugins/:id      → 启停
 *   - DELETE /api/plugins/:id      → 卸载
 */

import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/shared/toaster";
import { cn } from "@/lib/utils/cn";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Package,
  Puzzle,
  RefreshCw,
  Trash2,
} from "lucide-react";

// ==================== 类型定义 ====================

/** 权限作用域（与服务端 lib/plugins/scopes.ts 对齐） */
const SCOPE_LABELS: Record<string, string> = {
  "cards:read": "读取卡片",
  "cards:write": "写入卡片",
  "canvas:read": "读取画布",
  "canvas:write": "写入画布",
  "settings:read": "读取设置",
  "settings:write": "写入设置",
};

/** 插件工具行（与服务端 PluginTool 对齐，仅取 UI 所需字段） */
interface PluginToolDTO {
  id: string;
  name: string;
  description: string;
  method: string;
  url: string;
  /** JSON 数组字符串 */
  permissions: string;
}

/** 插件（与服务端 Plugin 对齐，仅取 UI 所需字段） */
interface PluginDTO {
  id: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  author: string;
  source: string;
  enabled: boolean;
  /** 完整 manifest JSON 字符串 */
  manifest: string;
  tools: PluginToolDTO[];
}

// ==================== 辅助函数 ====================

/** 解析 JSON 数组字符串（权限/失败回退空数组） */
function parseJsonArray(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** manifest JSON 格式化展示（解析失败原样返回） */
function prettyJson(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

// ==================== 主组件 ====================

export function PluginSection() {
  const [plugins, setPlugins] = useState<PluginDTO[]>([]);
  const [loading, setLoading] = useState(true);
  /** 当前展开详情的插件 id */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** 安装区 manifest 输入 */
  const [installJson, setInstallJson] = useState("");
  const [installing, setInstalling] = useState(false);
  /** 更新区 manifest 输入（按插件 id 记录） */
  const [updateJsons, setUpdateJsons] = useState<Record<string, string>>({});
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // ---------- 数据加载 ----------

  const loadPlugins = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/plugins");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { items: PluginDTO[] } = await res.json();
      setPlugins(data.items || []);
    } catch (err) {
      toast.error("加载插件列表失败", { description: String(err) });
      setPlugins([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPlugins();
  }, [loadPlugins]);

  // ---------- 安装 ----------

  const handleInstall = async () => {
    const text = installJson.trim();
    if (!text) {
      toast.error("请粘贴插件 manifest JSON");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      toast.error("JSON 解析失败，请检查格式");
      return;
    }
    setInstalling(true);
    try {
      const res = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const plugin: PluginDTO = await res.json();
      toast.success(`插件 ${plugin.displayName} 已安装`);
      setInstallJson("");
      await loadPlugins();
    } catch (err) {
      toast.error("安装失败", { description: String(err) });
    } finally {
      setInstalling(false);
    }
  };

  // ---------- 启停 ----------

  const handleToggle = async (plugin: PluginDTO) => {
    const next = !plugin.enabled;
    // 乐观更新：失败时回滚（重载列表）
    setPlugins((prev) =>
      prev.map((p) => (p.id === plugin.id ? { ...p, enabled: next } : p))
    );
    try {
      const res = await fetch(`/api/plugins/${plugin.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      toast.success(`插件 ${plugin.displayName} 已${next ? "启用" : "禁用"}`);
    } catch (err) {
      toast.error("启停失败", { description: String(err) });
      await loadPlugins();
    }
  };

  // ---------- 更新 ----------

  const handleUpdate = async (plugin: PluginDTO) => {
    const text = (updateJsons[plugin.id] ?? "").trim();
    if (!text) {
      toast.error("请先编辑 manifest");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      toast.error("JSON 解析失败，请检查格式");
      return;
    }
    setUpdatingId(plugin.id);
    try {
      const res = await fetch(`/api/plugins/${plugin.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      toast.success(`插件 ${plugin.displayName} 已更新`);
      await loadPlugins();
    } catch (err) {
      toast.error("更新失败", { description: String(err) });
    } finally {
      setUpdatingId(null);
    }
  };

  // ---------- 卸载 ----------

  const handleDelete = async (plugin: PluginDTO) => {
    if (
      !confirm(
        `确定卸载插件「${plugin.displayName}」？其工具将从能力清单移除。`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/plugins/${plugin.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      toast.success(`插件 ${plugin.displayName} 已卸载`);
      await loadPlugins();
    } catch (err) {
      toast.error("卸载失败", { description: String(err) });
    }
  };

  // ---------- 渲染 ----------

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Puzzle className="h-4 w-4" />
          插件 / 技能系统
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          管理暴露给外部 AI 的工具插件。启用插件自动聚合到{" "}
          <code className="px-1 rounded bg-muted">/api/ai/capabilities</code>{" "}
          能力清单；外部调用携带 <code className="px-1 rounded bg-muted">x-plugin-id</code>{" "}
          header 时按权限作用域校验并写入审计日志。
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* —— 安装区 —— */}
        <div className="space-y-2 p-4 rounded-lg border bg-muted/30">
          <h3 className="font-medium text-sm">安装插件</h3>
          <p className="text-xs text-muted-foreground">
            粘贴 manifest JSON（结构规范见{" "}
            <code className="px-1 rounded bg-muted">docs/PLUGIN_DEV.md</code>）
          </p>
          <Textarea
            value={installJson}
            onChange={(e) => setInstallJson(e.target.value)}
            placeholder='{
  "name": "my-plugin",
  "displayName": "我的插件",
  "version": "1.0.0",
  "permissions": ["cards:read"],
  "tools": [ ... ]
}'
            rows={5}
            className="font-mono text-xs"
          />
          <div className="flex justify-end">
            <Button type="button" onClick={handleInstall} disabled={installing}>
              {installing ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Package className="h-4 w-4 mr-1" />
              )}
              {installing ? "安装中..." : "安装"}
            </Button>
          </div>
        </div>

        {/* —— 插件列表 —— */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-medium text-sm">
              已安装插件
              {!loading && (
                <span className="text-xs text-muted-foreground ml-1">
                  （共 {plugins.length} 个，启用{" "}
                  {plugins.filter((p) => p.enabled).length} 个）
                </span>
              )}
            </h3>
          </div>

          {loading ? (
            <div className="flex items-center text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              加载中...
            </div>
          ) : plugins.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground border rounded-lg border-dashed">
              暂无插件
            </div>
          ) : (
            <div className="space-y-2">
              {plugins.map((plugin) => {
                const expanded = expandedId === plugin.id;
                const manifestScopes = (() => {
                  try {
                    return (JSON.parse(plugin.manifest).permissions ??
                      []) as string[];
                  } catch {
                    return [];
                  }
                })();
                return (
                  <div
                    key={plugin.id}
                    className="border rounded-lg bg-background"
                  >
                    {/* 插件头行：元信息 + 启停 + 操作 */}
                    <div className="flex items-center gap-3 p-3 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate">
                            {plugin.displayName}
                          </span>
                          <Badge
                            variant="outline"
                            className="text-xs font-mono"
                          >
                            {plugin.name}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            v{plugin.version}
                          </Badge>
                          {plugin.source === "builtin" ? (
                            <Badge variant="secondary" className="text-xs">
                              内置
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs">
                              用户安装
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-xs">
                            {plugin.tools.length} 工具
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 truncate">
                          {plugin.description}
                        </div>
                        {/* 权限徽章 */}
                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                          <span className="text-xs text-muted-foreground">
                            权限：
                          </span>
                          {manifestScopes.length === 0 ? (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          ) : (
                            manifestScopes.map((scope) => (
                              <Badge
                                key={scope}
                                variant="warning"
                                className="text-[10px] font-mono"
                                title={SCOPE_LABELS[scope] ?? scope}
                              >
                                {scope}
                              </Badge>
                            ))
                          )}
                        </div>
                      </div>

                      {/* 启停开关 */}
                      <button
                        type="button"
                        role="switch"
                        aria-checked={plugin.enabled}
                        aria-label={`${plugin.enabled ? "禁用" : "启用"}插件 ${plugin.displayName}`}
                        onClick={() => handleToggle(plugin)}
                        className={cn(
                          "relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0",
                          plugin.enabled
                            ? "bg-primary"
                            : "bg-muted-foreground/30"
                        )}
                      >
                        <span
                          className={cn(
                            "inline-block h-4 w-4 transform rounded-full bg-background transition-transform",
                            plugin.enabled
                              ? "translate-x-6"
                              : "translate-x-1"
                          )}
                        />
                      </button>

                      {/* 展开详情 */}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title={expanded ? "收起详情" : "展开详情"}
                        onClick={() => {
                          setExpandedId(expanded ? null : plugin.id);
                          // 首次展开时预填更新区文本
                          if (!expanded && !updateJsons[plugin.id]) {
                            setUpdateJsons((prev) => ({
                              ...prev,
                              [plugin.id]: prettyJson(plugin.manifest),
                            }));
                          }
                        }}
                      >
                        {expanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>

                      {/* 卸载（builtin 不显示） */}
                      {plugin.source !== "builtin" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title="卸载插件"
                          onClick={() => handleDelete(plugin)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>

                    {/* —— 详情展开区：工具清单 + manifest 更新 —— */}
                    {expanded && (
                      <div className="border-t px-3 py-3 space-y-3">
                        {/* 工具清单 */}
                        <div>
                          <h4 className="text-xs font-medium text-muted-foreground mb-1.5">
                            工具清单
                          </h4>
                          {plugin.tools.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              无工具
                            </p>
                          ) : (
                            <div className="space-y-1">
                              {plugin.tools.map((tool) => (
                                <div
                                  key={tool.id}
                                  className="flex items-start gap-2 text-xs p-2 rounded bg-muted/40 flex-wrap"
                                >
                                  <code className="font-mono font-medium">
                                    {tool.name}
                                  </code>
                                  <span className="text-muted-foreground">
                                    {tool.method} {tool.url}
                                  </span>
                                  <span className="flex gap-1 flex-wrap">
                                    {parseJsonArray(tool.permissions).map(
                                      (s) => (
                                        <Badge
                                          key={s}
                                          variant="outline"
                                          className="text-[10px] font-mono"
                                          title={SCOPE_LABELS[s] ?? s}
                                        >
                                          {s}
                                        </Badge>
                                      )
                                    )}
                                  </span>
                                  <p className="w-full text-muted-foreground truncate">
                                    {tool.description}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* manifest 更新 */}
                        <div className="space-y-2">
                          <h4 className="text-xs font-medium text-muted-foreground">
                            manifest（编辑后点击更新，name 不可变）
                          </h4>
                          <Textarea
                            value={updateJsons[plugin.id] ?? ""}
                            onChange={(e) =>
                              setUpdateJsons((prev) => ({
                                ...prev,
                                [plugin.id]: e.target.value,
                              }))
                            }
                            rows={8}
                            className="font-mono text-xs"
                          />
                          <div className="flex justify-end">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleUpdate(plugin)}
                              disabled={updatingId === plugin.id}
                            >
                              {updatingId === plugin.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                              ) : (
                                <RefreshCw className="h-3.5 w-3.5 mr-1" />
                              )}
                              {updatingId === plugin.id ? "更新中..." : "更新插件"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
