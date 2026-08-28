"use client";

/**
 * 时间线选择器（页面左侧）
 *
 * - 按时间线数量动态生成彩色小格子（显示名称 + 主题色）
 * - 点击格子快捷切换时间线
 * - 底部"+"按钮创建新时间线（弹窗输入名称，颜色自动分配）
 * - 长按/右键删除时间线（雏形：格子尾部小删除按钮，hover 显示）
 */
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TimelineDTO } from "@/lib/services/timelines/types";

interface TimelineSelectorProps {
  /** 全部时间线 */
  timelines: TimelineDTO[];
  /** 当前选中的时间线 ID */
  activeId: string | null;
  /** 切换时间线 */
  onSelect: (id: string) => void;
  /** 创建时间线（返回是否成功） */
  onCreate: (name: string) => Promise<boolean>;
  /** 删除时间线 */
  onDelete: (id: string) => Promise<void>;
}

export function TimelineSelector({
  timelines,
  activeId,
  onSelect,
  onCreate,
  onDelete,
}: TimelineSelectorProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  /** 待删除确认的时间线（雏形：简单二次确认弹窗） */
  const [pendingDelete, setPendingDelete] = useState<TimelineDTO | null>(null);
  const [deleting, setDeleting] = useState(false);

  /** 提交创建 */
  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    const ok = await onCreate(name);
    setCreating(false);
    if (ok) {
      setNewName("");
      setCreateOpen(false);
    }
  };

  /** 确认删除 */
  const handleDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    await onDelete(pendingDelete.id);
    setDeleting(false);
    setPendingDelete(null);
  };

  return (
    <>
      {/* 选择器主体：窄屏收窄为色条 + 首字，宽屏显示名称 */}
      <aside className="flex flex-col h-full w-16 md:w-44 shrink-0 border-r bg-card/50">
        <div className="px-2 md:px-3 py-2 text-xs font-medium text-muted-foreground border-b">
          <span className="hidden md:inline">时间线</span>
          <span className="md:hidden">线</span>
          <span className="ml-1 tabular-nums">({timelines.length})</span>
        </div>

        {/* 时间线格子列表 */}
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {timelines.map((timeline) => {
            const active = timeline.id === activeId;
            return (
              <div key={timeline.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onSelect(timeline.id)}
                  className={cn(
                    "w-full rounded-lg border text-left transition-all",
                    active
                      ? "border-primary/50 shadow-sm"
                      : "border-transparent hover:border-border"
                  )}
                  style={
                    active
                      ? { backgroundColor: `${timeline.color}1a` }
                      : undefined
                  }
                  title={`${timeline.name}（${timeline.eventCount} 个事件）`}
                >
                  {/* 色块 + 名称 */}
                  <div className="flex items-center gap-2 px-2 py-2">
                    <span
                      className="w-4 h-4 rounded shrink-0"
                      style={{ backgroundColor: timeline.color }}
                    />
                    <span
                      className={cn(
                        "text-xs truncate flex-1",
                        active ? "font-semibold" : "text-muted-foreground"
                      )}
                    >
                      {/* 窄屏只显示首字，宽屏显示完整名称 */}
                      <span className="md:hidden">{timeline.name.slice(0, 1)}</span>
                      <span className="hidden md:inline">{timeline.name}</span>
                    </span>
                    <span className="hidden md:inline text-[10px] text-muted-foreground tabular-nums">
                      {timeline.eventCount}
                    </span>
                  </div>
                  {/* 激活态底部色条 */}
                  {active && (
                    <div
                      className="h-0.5 rounded-full"
                      style={{ backgroundColor: timeline.color }}
                    />
                  )}
                </button>

                {/* 删除按钮（hover 显示，避免误触） */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPendingDelete(timeline);
                  }}
                  className="absolute -top-1 -right-1 hidden group-hover:flex items-center justify-center w-[18px] h-[18px] rounded-full bg-destructive text-white shadow"
                  title="删除此时间线"
                  aria-label={`删除时间线 ${timeline.name}`}
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              </div>
            );
          })}

          {/* 空列表提示 */}
          {timelines.length === 0 && (
            <p className="text-xs text-muted-foreground px-1 py-2 leading-relaxed">
              还没有时间线，点击下方 + 创建第一条。
            </p>
          )}
        </div>

        {/* 新建按钮 */}
        <div className="p-2 border-t">
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex items-center justify-center gap-1 w-full rounded-lg border border-dashed border-border px-2 py-2 text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden md:inline">新建时间线</span>
          </button>
        </div>
      </aside>

      {/* 创建时间线对话框 */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="新建时间线"
        maxWidth="max-w-md"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || creating}>
              {creating ? "创建中..." : "创建"}
            </Button>
          </>
        }
      >
        <div className="p-5 space-y-3">
          <div>
            <label className="text-sm font-medium mb-1.5 block">名称</label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="如：中国历史、世界近代史"
              maxLength={50}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              主题色将自动分配；创建后可通过页面顶部重命名（雏形暂未提供改色）。
            </p>
          </div>
        </div>
      </Dialog>

      {/* 删除确认对话框 */}
      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="删除时间线"
        maxWidth="max-w-md"
        footer={
          <>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "删除中..." : "确认删除"}
            </Button>
          </>
        }
      >
        <div className="p-5">
          <p className="text-sm text-muted-foreground leading-relaxed">
            确定删除时间线{" "}
            <span className="font-semibold text-foreground">{pendingDelete?.name}</span> 吗？
            <br />
            其下 {pendingDelete?.eventCount ?? 0} 个事件将一并删除，此操作不可撤销。
          </p>
        </div>
      </Dialog>
    </>
  );
}
