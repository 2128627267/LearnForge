"use client";

/**
 * 配置文件（.env.local）查看/编辑弹窗
 *
 * 功能：
 * - 查看配置文件中的 AI 相关键值（敏感键脱敏显示）
 * - 编辑已有键 / 新增键 / 删除键
 * - 保存后提示重启 dev server 生效
 *
 * 数据流：
 * - GET /api/settings/env-config → keys
 * - PUT /api/settings/env-config → { updates, removals }
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/shared/toaster";
import { FileCode2, Loader2, Plus, Trash2, X } from "lucide-react";

interface EnvKey {
  key: string;
  value: string;
  masked: boolean;
}

interface EnvConfigData {
  path: string;
  exists: boolean;
  keys: EnvKey[];
  aiKeys: EnvKey[];
}

export function EnvConfigDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<EnvConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/env-config");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d: EnvConfigData = await res.json();
      setData(d);
    } catch (err) {
      toast.error("读取配置文件失败", { description: String(err) });
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      load();
      setNewKey("");
      setNewValue("");
    }
  }, [open, load]);

  const updateValue = (key: string, value: string) => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            keys: prev.keys.map((k) =>
              k.key === key ? { ...k, value } : k
            ),
            aiKeys: prev.aiKeys.map((k) =>
              k.key === key ? { ...k, value } : k
            ),
          }
        : prev
    );
  };

  const addKey = () => {
    if (!data) return;
    const key = newKey.trim();
    if (!key) {
      toast.error("请填写变量名");
      return;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      toast.error("变量名只能包含字母、数字、下划线，且不能以数字开头");
      return;
    }
    if (data.keys.some((k) => k.key === key)) {
      toast.error(`变量 ${key} 已存在`);
      return;
    }
    setData({
      ...data,
      keys: [...data.keys, { key, value: newValue.trim(), masked: false }],
      aiKeys:
        key.startsWith("AI_") || key === "NEXTAUTH_SECRET" || key === "NEXTAUTH_URL"
          ? [...data.aiKeys, { key, value: newValue.trim(), masked: false }]
          : data.aiKeys,
    });
    setNewKey("");
    setNewValue("");
  };

  const removeKey = (key: string) => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            keys: prev.keys.filter((k) => k.key !== key),
            aiKeys: prev.aiKeys.filter((k) => k.key !== key),
          }
        : prev
    );
  };

  const handleSave = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const original = data.keys; // 当前所有键（含未保存的编辑）
      const res = await fetch("/api/settings/env-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: Object.fromEntries(original.map((k) => [k.key, k.value])),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const result: EnvConfigData & { skipped?: string[] } = await res.json();
      setData(result);
      if (result.skipped?.length) {
        toast.warning(`以下键值含占位符未覆盖：${result.skipped.join(", ")}`);
      } else {
        toast.success("配置文件已保存");
      }
      toast.info("环境变量改动需重启 dev server 后生效", {
        description: "（模型列表配置无需重启）",
      });
    } catch (err) {
      toast.error("保存配置文件失败", { description: String(err) });
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border rounded-lg shadow-lg max-w-2xl w-full mx-4 max-h-[90vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between p-6 pb-4">
          <div className="flex items-center gap-2">
            <FileCode2 className="h-5 w-5 text-muted-foreground" />
            <div>
              <h2 className="text-lg font-semibold">配置文件（.env.local）</h2>
              <p className="text-xs text-muted-foreground mt-0.5 break-all">
                {data?.path || "读取中..."}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            title="关闭"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* 内容 */}
        <div className="px-6 pb-6 flex-1 overflow-y-auto space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              加载中...
            </div>
          ) : !data ? (
            <div className="text-center py-10 text-sm text-muted-foreground">
              配置文件不存在或读取失败
            </div>
          ) : data.keys.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground">
              配置文件为空，可在下方添加变量
            </div>
          ) : (
            <div className="space-y-2">
              {data.keys.map((entry) => (
                <div
                  key={entry.key}
                  className="flex items-center gap-2 p-2 rounded border bg-background"
                >
                  <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-2 items-center">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-xs font-mono truncate">
                        {entry.key}
                      </span>
                      {entry.masked && (
                        <Badge variant="secondary" className="text-[10px]">
                          敏感
                        </Badge>
                      )}
                    </div>
                    <Input
                      type={entry.masked ? "password" : "text"}
                      value={entry.value}
                      onChange={(e) => updateValue(entry.key, e.target.value)}
                      className="font-mono text-xs h-8"
                      autoComplete="off"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeKey(entry.key)}
                    title="删除变量"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* 新增变量 */}
          <div className="flex items-end gap-2 pt-2">
            <div className="flex-1">
              <label className="block text-xs text-muted-foreground mb-1">
                变量名
              </label>
              <Input
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="AI_MODEL"
                className="font-mono text-xs"
              />
            </div>
            <div className="flex-[2]">
              <label className="block text-xs text-muted-foreground mb-1">
                值
              </label>
              <Input
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="变量值"
                className="font-mono text-xs"
                autoComplete="off"
              />
            </div>
            <Button type="button" variant="outline" onClick={addKey}>
              <Plus className="h-4 w-4 mr-1" />
              添加
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            仅 AI_* 与 NEXTAUTH_*、CRON_SECRET 键允许写入；敏感键脱敏显示，含{" "}
            <code className="px-1 py-0.5 bg-muted rounded">****</code>{" "}
            的占位值不会被覆盖。改动环境变量后需重启 dev server 生效。
          </p>
        </div>

        {/* 底部操作 */}
        <div className="flex justify-end gap-2 px-6 pb-6">
          <Button type="button" variant="outline" onClick={onClose}>
            关闭
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || loading}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : null}
            {saving ? "保存中..." : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}
