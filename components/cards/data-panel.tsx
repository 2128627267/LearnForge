"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/components/shared/toaster";
import { LocalSyncAdapter } from "@/lib/sync/local-sync-adapter";
import type { ChangeLogEntry, SnapshotSummary } from "@/lib/sync/types";
import { History, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";

/**
 * 数据管理面板（F3-T4/T5：快照恢复 + 变更日志）
 *
 * 嵌入 SidePanel 的"数据"标签页：
 * - 手动创建当前画布快照
 * - 快照列表（最近 10 份）+ 一键恢复（恢复前自动备份当前数据）
 * - 变更日志（最近 15 条）：谁在何时通过什么渠道改了画布
 *
 * 恢复采用整页刷新：让同步 hook 重新初始化 revision 基线，
 * 避免恢复后的旧 revision 触发无意义的 409 合并流程。
 */

/** 快照来源显示名 */
const REASON_LABELS: Record<string, string> = {
  auto: "自动",
  manual: "手动",
  "pre-restore": "恢复前备份",
};

/** 变更动作显示名 */
const ACTION_LABELS: Record<string, string> = {
  save: "保存",
  "batch-create": "AI 批量",
  restore: "恢复快照",
};

/** 格式化时间（面板内统一风格） */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DataPanel() {
  const [snapshots, setSnapshots] = useState<SnapshotSummary[] | null>(null);
  const [log, setLog] = useState<ChangeLogEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  /** 操作进行中（创建快照/恢复），防重复点击 */
  const [busy, setBusy] = useState(false);

  const adapterRef = useRef<LocalSyncAdapter | null>(null);
  if (!adapterRef.current) adapterRef.current = new LocalSyncAdapter();

  /** 拉取快照列表 + 变更日志 */
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [snapshotList, logList] = await Promise.all([
        adapterRef.current!.listSnapshots(10),
        adapterRef.current!.listChangeLog(15),
      ]);
      setSnapshots(snapshotList);
      setLog(logList);
    } catch (err) {
      toast.error("加载历史数据失败", { description: String(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  // 面板挂载（tab 切换到"数据"）时拉取最新数据
  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** 手动创建当前画布快照 */
  const handleCreateSnapshot = async () => {
    setBusy(true);
    try {
      await adapterRef.current!.createSnapshot("manual");
      toast.success("已创建当前画布快照");
      await refresh();
    } catch (err) {
      toast.error("创建快照失败", { description: String(err) });
    } finally {
      setBusy(false);
    }
  };

  /** 恢复指定快照（恢复前服务器自动备份当前数据） */
  const handleRestore = async (id: string) => {
    if (
      !window.confirm(
        "确定恢复该快照？\n当前画布会先自动备份（可从快照列表再次恢复）。"
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await adapterRef.current!.restoreSnapshot(id);
      toast.success("快照已恢复，正在刷新画布…");
      // 稍等 toast 展示后整页刷新，重建同步基线
      window.setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      toast.error("恢复快照失败", { description: String(err) });
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* ---- 快照区 ---- */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <History className="w-3 h-3" />
            画布快照
          </p>
          <button
            onClick={handleCreateSnapshot}
            disabled={busy}
            className={cn(
              "text-xs px-2 py-1 rounded-md border border-input",
              "hover:bg-accent transition-colors",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
            title="将当前画布保存为快照"
          >
            创建快照
          </button>
        </div>

        {loading && snapshots === null ? (
          <p className="text-xs text-muted-foreground text-center py-3">
            加载中…
          </p>
        ) : !snapshots || snapshots.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-3">
            暂无快照（画布每次覆盖保存前会自动备份）
          </p>
        ) : (
          <div className="space-y-1">
            {snapshots.map((s) => (
              <div
                key={s.id}
                className={cn(
                  "group flex items-center gap-2 px-2 py-1.5 rounded-md",
                  "hover:bg-accent transition-colors"
                )}
              >
                <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs truncate">
                    {formatTime(s.createdAt)}
                    <span className="text-muted-foreground">
                      {" "}
                      · {s.nodeCount} 卡片 · {s.edgeCount} 连线
                    </span>
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {REASON_LABELS[s.reason] ?? s.reason}
                  </p>
                </div>
                <button
                  onClick={() => handleRestore(s.id)}
                  disabled={busy}
                  className={cn(
                    "flex items-center gap-1 text-xs px-1.5 py-1 rounded",
                    "opacity-0 group-hover:opacity-100 max-sm:opacity-100",
                    "focus-visible:opacity-100",
                    "border border-input hover:bg-accent",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                  title={`恢复到 ${formatTime(s.createdAt)} 的快照`}
                >
                  <RotateCcw className="w-3 h-3" />
                  恢复
                </button>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">
              自动保留最近 20 份快照（覆盖保存前备份）
            </p>
          </div>
        )}
      </div>

      {/* ---- 变更日志区 ---- */}
      <div className="space-y-2 pt-2 border-t border-border/40">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">
            变更日志
          </p>
          <button
            onClick={() => void refresh()}
            disabled={loading}
            className="text-xs text-primary hover:underline disabled:opacity-50"
            title="刷新"
          >
            <RefreshCw
              className={cn("w-3 h-3", loading && "animate-spin")}
            />
          </button>
        </div>

        {!log || log.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-3">
            暂无变更记录
          </p>
        ) : (
          <div className="space-y-0.5">
            {log.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-2 px-2 py-1 rounded-md text-xs"
              >
                <span className="text-muted-foreground w-20 flex-shrink-0 text-[10px]">
                  {formatTime(e.createdAt)}
                </span>
                <span className="w-14 flex-shrink-0">
                  {ACTION_LABELS[e.action] ?? e.action}
                </span>
                <span className="text-muted-foreground flex-shrink-0 text-[10px]">
                  r{e.revision}
                </span>
                <span className="text-muted-foreground truncate text-[10px]">
                  {e.nodeCount} 卡片 · {e.source}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
