"use client";

/**
 * 时间线页面主组件（客户端）
 *
 * 结构：
 * - 左侧：时间线选择器（彩色小格子，点击切换）
 * - 右侧上部：工具栏（时间线名 + 创建时间点/时间段按钮）
 * - 右侧中部：水平时间线视图（滚轮/拖拽浏览）
 * - 右侧底部：AI 快速创建输入栏
 *
 * 数据流：
 * - GET /api/timelines → 时间线列表（默认选中第一条）
 * - GET /api/timelines/:id/events → 当前时间线事件
 * - 事件 CRUD → POST / PATCH / DELETE
 * - AI 创建 → 解析（/api/ai/timeline-parse）→ 预览确认 → 批量 PUT
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CircleDot, MoveHorizontal, Clock } from "lucide-react";
import { toast } from "sonner";
import { TimelineSelector } from "@/components/timeline/timeline-selector";
import { TimelineView, type TimelineViewHandle } from "@/components/timeline/timeline-view";
import { EventDialog } from "@/components/timeline/event-dialog";
import { AIInputBar } from "@/components/timeline/ai-input-bar";
import type { TimelineDTO, TimelineEventDTO } from "@/lib/services/timelines/types";

export function TimelinePageClient() {
  // ------------------------------------------------------------------
  // 数据状态
  // ------------------------------------------------------------------
  const [timelines, setTimelines] = useState<TimelineDTO[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [events, setEvents] = useState<TimelineEventDTO[]>([]);
  /** 列表加载中（首次进入） */
  const [loadingTimelines, setLoadingTimelines] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(false);

  // ------------------------------------------------------------------
  // 对话框状态
  // ------------------------------------------------------------------
  /** 事件对话框：null 关闭；{ mode: 'create', type } 创建；{ mode: 'edit', event } 编辑 */
  const [dialogState, setDialogState] = useState<{
    mode: "create" | "edit";
    type: "point" | "period";
    event: TimelineEventDTO | null;
  } | null>(null);

  const viewRef = useRef<TimelineViewHandle>(null);

  // ------------------------------------------------------------------
  // 数据获取
  // ------------------------------------------------------------------
  /** 拉取时间线列表 */
  const refreshTimelines = useCallback(async (): Promise<TimelineDTO[]> => {
    const res = await fetch("/api/timelines");
    if (!res.ok) {
      toast.error("加载时间线列表失败");
      return [];
    }
    const data: TimelineDTO[] = await res.json();
    setTimelines(data);
    return data;
  }, []);

  /** 拉取指定时间线的事件 */
  const refreshEvents = useCallback(async (timelineId: string) => {
    setLoadingEvents(true);
    try {
      const res = await fetch(`/api/timelines/${timelineId}/events`);
      if (!res.ok) {
        toast.error("加载事件失败");
        return;
      }
      const data: TimelineEventDTO[] = await res.json();
      setEvents(data);
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  // 初始化：加载时间线列表并选中第一条
  useEffect(() => {
    (async () => {
      const list = await refreshTimelines();
      if (list.length > 0) {
        setActiveId(list[0].id);
      }
      setLoadingTimelines(false);
    })();
  }, [refreshTimelines]);

  // 选中时间线变化 → 拉取事件
  useEffect(() => {
    if (activeId) {
      refreshEvents(activeId);
    } else {
      setEvents([]);
    }
  }, [activeId, refreshEvents]);

  // ------------------------------------------------------------------
  // 时间线操作
  // ------------------------------------------------------------------
  /** 创建时间线（选择器回调），成功后选中新时间线 */
  const handleCreateTimeline = async (name: string): Promise<boolean> => {
    try {
      const res = await fetch("/api/timelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "创建时间线失败");
        return false;
      }
      const created: TimelineDTO = await res.json();
      await refreshTimelines();
      setActiveId(created.id);
      toast.success(`时间线「${created.name}」已创建`);
      return true;
    } catch {
      toast.error("网络异常，请稍后重试");
      return false;
    }
  };

  /** 删除时间线：切换到相邻时间线或清空选中 */
  const handleDeleteTimeline = async (id: string) => {
    try {
      const res = await fetch(`/api/timelines/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "删除时间线失败");
        return;
      }
      const list = await refreshTimelines();
      // 选中相邻项（优先同位置，否则最后一条）
      if (activeId === id) {
        setActiveId(list.length > 0 ? list[Math.min(0, list.length - 1)].id : null);
      }
      toast.success("时间线已删除");
    } catch {
      toast.error("网络异常，请稍后重试");
    }
  };

  // ------------------------------------------------------------------
  // 事件操作
  // ------------------------------------------------------------------
  /** 创建/更新事件统一提交出口（EventDialog onSubmit） */
  const handleEventSubmit = async (draft: {
    title: string;
    content: string;
    type: "point" | "period";
    startYear: number;
    endYear: number | null;
  }): Promise<string | null> => {
    if (!activeId) return "请先选择时间线";
    const isEdit = dialogState?.mode === "edit" && dialogState.event !== null;
    try {
      const res = await fetch(
        isEdit ? `/api/timeline-events/${dialogState.event!.id}` : `/api/timelines/${activeId}/events`,
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        }
      );
      if (!res.ok) {
        const data = await res.json();
        return data.detail ?? data.error ?? "保存失败";
      }
      const saved: TimelineEventDTO = await res.json();
      await refreshEvents(activeId);
      await refreshTimelines(); // 更新事件计数
      setDialogState(null);
      // 新建事件后平滑定位到该事件
      if (!isEdit) {
        viewRef.current?.scrollToYear(saved.startYear);
      }
      toast.success(isEdit ? "事件已更新" : `事件「${saved.title}」已创建`);
      return null;
    } catch {
      return "网络异常，请稍后重试";
    }
  };

  /** 删除事件（编辑对话框回调） */
  const handleEventDelete = async (eventId: string) => {
    try {
      const res = await fetch(`/api/timeline-events/${eventId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "删除事件失败");
        return;
      }
      if (activeId) {
        await refreshEvents(activeId);
        await refreshTimelines();
      }
      setDialogState(null);
      toast.success("事件已删除");
    } catch {
      toast.error("网络异常，请稍后重试");
    }
  };

  /** AI 批量创建完成：刷新并定位到新事件 */
  const handleEventsCreated = async (startYear: number) => {
    if (!activeId) return;
    await refreshEvents(activeId);
    await refreshTimelines();
    viewRef.current?.scrollToYear(startYear);
  };

  // ------------------------------------------------------------------
  // 派生数据
  // ------------------------------------------------------------------
  const activeTimeline = timelines.find((t) => t.id === activeId) ?? null;

  // ------------------------------------------------------------------
  // 渲染
  // ------------------------------------------------------------------
  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* 左侧：时间线选择器 */}
      <TimelineSelector
        timelines={timelines}
        activeId={activeId}
        onSelect={setActiveId}
        onCreate={handleCreateTimeline}
        onDelete={handleDeleteTimeline}
      />

      {/* 右侧：主区域（工具栏 + 时间线视图 + AI 输入栏） */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 工具栏 */}
        <div className="flex items-center gap-2 px-3 md:px-4 py-2 border-b bg-card/50">
          {/* 当前时间线名称 + 主题色标识 */}
          <div className="flex items-center gap-2 min-w-0">
            <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
            {activeTimeline ? (
              <>
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: activeTimeline.color }}
                />
                <span className="font-medium text-sm truncate">
                  {activeTimeline.name}
                </span>
                <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                  {activeTimeline.eventCount} 个事件
                </span>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">
                {loadingTimelines ? "加载中..." : "请选择或创建时间线"}
              </span>
            )}
          </div>

          {/* 创建按钮（无选中时间线时禁用） */}
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              disabled={!activeId}
              onClick={() => setDialogState({ mode: "create", type: "point", event: null })}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm
                         bg-primary text-primary-foreground hover:opacity-90
                         disabled:opacity-40 transition-opacity"
              title="创建时间点事件（某一时刻发生）"
            >
              <CircleDot className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">时间点</span>
            </button>
            <button
              type="button"
              disabled={!activeId}
              onClick={() => setDialogState({ mode: "create", type: "period", event: null })}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm
                         border border-input bg-background hover:bg-accent
                         disabled:opacity-40 transition-colors"
              title="创建时间段事件（持续一段时间）"
            >
              <MoveHorizontal className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">时间段</span>
            </button>
          </div>
        </div>

        {/* 时间线视图 */}
        <div className="flex-1 min-h-0 relative">
          {activeId ? (
            <TimelineView
              ref={viewRef}
              events={events}
              color={activeTimeline?.color ?? "#3b82f6"}
              onEventClick={(event) =>
                setDialogState({ mode: "edit", type: event.type, event })
              }
              resetKey={activeId}
            />
          ) : (
            // 未选中时间线的占位
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              {loadingTimelines ? "加载时间线列表..." : "从左侧选择一条时间线，或新建一条开始整理历史事件"}
            </div>
          )}

          {/* 事件加载遮罩（轻量提示，不阻塞浏览） */}
          {loadingEvents && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 text-xs text-muted-foreground bg-card/80 border rounded-full px-3 py-1 shadow-sm">
              加载事件中...
            </div>
          )}
        </div>

        {/* AI 快速创建输入栏 */}
        <AIInputBar timelineId={activeId} onEventsCreated={handleEventsCreated} />
      </div>

      {/* 事件创建/编辑对话框 */}
      <EventDialog
        open={dialogState !== null}
        defaultType={dialogState?.type ?? "point"}
        event={dialogState?.event ?? null}
        onClose={() => setDialogState(null)}
        onSubmit={handleEventSubmit}
        onDelete={handleEventDelete}
      />
    </div>
  );
}
