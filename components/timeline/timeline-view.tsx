"use client";

/**
 * 水平时间线视图（核心可视化组件）
 *
 * 布局：从左到右的水平时间轴
 * - 中心横轴 + 自适应刻度（年份标签）
 * - 时间点事件：轴上圆点 + 引线 + 卡片（上下交错防重叠）
 * - 时间段事件：轴上彩色横条（够宽时内嵌标题）+ 卡片
 * - 重合事件：按重叠层次（lane）在轴上方逐层错开 + 事件色板区分颜色
 *
 * 交互：
 * - 鼠标滚轮：左右滚动浏览（纵向滚轮转换为横向滚动）
 * - 按住拖拽：平移浏览
 * - 点击事件卡片：展开显示详情描述（默认仅显示事件名 + 时间）
 * - 展开态点击"编辑"：打开编辑对话框
 */
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from "react";
import { cn } from "@/lib/utils/cn";
import type { TimelineEventDTO } from "@/lib/services/timelines/types";
import {
  computeViewRange,
  computeTicks,
  layoutEvents,
  computeInitialScrollLeft,
  formatYear,
  EVENT_CARD_WIDTH,
  LANE_STEP,
} from "@/lib/timeline/view-scale";

/** 对外暴露的控制句柄（供父组件在创建事件后滚动定位） */
export interface TimelineViewHandle {
  /** 平滑滚动到指定年份 */
  scrollToYear: (year: number) => void;
}

interface TimelineViewProps {
  /** 当前时间线的全部事件 */
  events: TimelineEventDTO[];
  /** 时间线主题色（hex） */
  color: string;
  /** 编辑请求回调（展开态点击"编辑"按钮时触发，打开编辑对话框） */
  onEventClick: (event: TimelineEventDTO) => void;
  /** 滚动位置重置键（时间线切换时变化，触发初始定位） */
  resetKey: string;
}

/** 事件年份区间描述（卡片副标题）：point → 单年份；period → 起~止 */
function formatEventYears(event: TimelineEventDTO): string {
  if (event.type === "period" && event.endYear !== null) {
    return `${formatYear(event.startYear)} ~ ${formatYear(event.endYear)}`;
  }
  return formatYear(event.startYear);
}

export const TimelineView = forwardRef<TimelineViewHandle, TimelineViewProps>(
  function TimelineView({ events, color, onEventClick, resetKey }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    /** 视口宽度（ResizeObserver 跟踪，比例计算的输入） */
    const [viewportWidth, setViewportWidth] = useState(0);
    /** 拖拽状态（ref 存位移数据，state 只控制光标样式） */
    const [isDragging, setIsDragging] = useState(false);
    const dragRef = useRef({ startX: 0, startScrollLeft: 0, didDrag: false });

    // --------------------------------------------------------------
    // 视口宽度跟踪（比例与初始定位依赖容器实际宽度）
    // --------------------------------------------------------------
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setViewportWidth(entry.contentRect.width);
        }
      });
      observer.observe(el);
      setViewportWidth(el.clientWidth);
      return () => observer.disconnect();
    }, []);

    // --------------------------------------------------------------
    // 视图计算（纯函数：范围 / 刻度 / 事件布局）
    // --------------------------------------------------------------
    const range = useMemo(
      () => computeViewRange(events, viewportWidth || 800),
      [events, viewportWidth]
    );
    const ticks = useMemo(() => computeTicks(range), [range]);
    const laidOut = useMemo(() => layoutEvents(events, range), [events, range]);

    // --------------------------------------------------------------
    // 初始滚动定位：时间线切换（resetKey 变化）或首次获得视口宽度时
    // - 单事件居中；多事件定位到最早事件；之后保持用户滚动位置
    // - 依赖数组刻意只含 events.length（事件增删不重置滚动位置）；
    //   最新事件列表经 eventsRef 读取，避免依赖数组膨胀
    // --------------------------------------------------------------
    const appliedResetRef = useRef<string>("");
    const eventsRef = useRef(events);
    eventsRef.current = events;
    useEffect(() => {
      if (!containerRef.current || viewportWidth === 0) return;
      const current = eventsRef.current;
      // 已对该时间线应用过定位且当前有事件 → 保持用户滚动位置
      if (appliedResetRef.current === resetKey && current.length > 0) return;
      appliedResetRef.current = resetKey;

      const scrollLeft = computeInitialScrollLeft(current, range, viewportWidth);
      containerRef.current.scrollLeft = scrollLeft;
    }, [resetKey, events.length, range, viewportWidth]);

    // --------------------------------------------------------------
    // 滚轮：纵向滚动转换为横向浏览（wheel 事件需 passive:false 才能 preventDefault）
    // 例外：展开卡片的详情区（data-inner-scroll）自身可纵向滚动，放行不拦截
    // --------------------------------------------------------------
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const onWheel = (e: WheelEvent) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest?.("[data-inner-scroll]")) return;
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          e.preventDefault();
          el.scrollLeft += e.deltaY;
        }
      };
      el.addEventListener("wheel", onWheel, { passive: false });
      return () => el.removeEventListener("wheel", onWheel);
    }, []);

    // --------------------------------------------------------------
    // 对外句柄：滚动到指定年份（新建事件后定位）
    // --------------------------------------------------------------
    const scrollToYear = useCallback(
      (year: number) => {
        const el = containerRef.current;
        if (!el) return;
        const targetX = (year - range.left) * range.pxPerYear;
        el.scrollTo({
          left: Math.max(0, targetX - el.clientWidth / 2),
          behavior: "smooth",
        });
      },
      [range]
    );
    useImperativeHandle(ref, () => ({ scrollToYear }), [scrollToYear]);

    // --------------------------------------------------------------
    // 拖拽平移（按住空白处或任意位置拖动）
    // --------------------------------------------------------------
    const onPointerDown = useCallback((e: React.PointerEvent) => {
      // 仅主键拖拽；文本选择交给浏览器场景（卡片内不拖拽）
      if (e.button !== 0) return;
      const el = containerRef.current;
      if (!el) return;
      dragRef.current = {
        startX: e.clientX,
        startScrollLeft: el.scrollLeft,
        didDrag: false,
      };
      setIsDragging(true);
    }, []);

    const onPointerMove = useCallback((e: React.PointerEvent) => {
      const el = containerRef.current;
      if (!el || !isDragging) return;
      const dx = e.clientX - dragRef.current.startX;
      if (Math.abs(dx) > 5) dragRef.current.didDrag = true;
      el.scrollLeft = dragRef.current.startScrollLeft - dx;
    }, [isDragging]);

    const endDrag = useCallback(() => {
      setIsDragging(false);
      // 延迟清除 didDrag 标记：让紧随其后的 click 事件可判断抑制
      setTimeout(() => {
        dragRef.current.didDrag = false;
      }, 50);
    }, []);

    // --------------------------------------------------------------
    // 卡片展开状态：默认仅显示基础信息（事件名 + 时间），
    // 点击展开显示详情描述与编辑入口；同一时刻仅一张卡片展开
    // --------------------------------------------------------------
    const [expandedId, setExpandedId] = useState<string | null>(null);

    // 切换时间线时收起展开卡片
    useEffect(() => {
      setExpandedId(null);
    }, [resetKey]);

    /** 卡片点击：拖拽后抑制误触；点击切换展开/收起 */
    const handleEventClick = useCallback((event: TimelineEventDTO) => {
      if (dragRef.current.didDrag) return;
      setExpandedId((prev) => (prev === event.id ? null : event.id));
    }, []);

    // --------------------------------------------------------------
    // 渲染
    // --------------------------------------------------------------
    return (
      <div
        ref={containerRef}
        className={cn(
          "relative h-full w-full overflow-x-auto overflow-y-hidden select-none",
          isDragging ? "cursor-grabbing" : "cursor-grab"
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        {/* 内容层：宽度由年份跨度 × 比例决定 */}
        <div className="relative h-full" style={{ width: range.contentWidth, minWidth: "100%" }}>
          {/* 中心轴线 */}
          <div
            className="absolute left-0 right-0 top-1/2 h-0.5 -translate-y-1/2 rounded"
            style={{ backgroundColor: `${color}55` }}
          />

          {/* 刻度：竖线 + 年份标签（底部） */}
          {ticks.map((tick) => (
            <div key={tick.year} className="absolute top-1/2 bottom-6 pointer-events-none" style={{ left: tick.x }}>
              {/* 刻度竖线（从轴延伸到底部刻度区） */}
              <div
                className="absolute top-1/2 w-px h-6 -translate-x-1/2"
                style={{ backgroundColor: `${color}33` }}
              />
              {/* 年份标签 */}
              <div className="absolute top-full left-0 -translate-x-1/2 mt-1.5 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                {tick.label}
              </div>
            </div>
          ))}

          {/* 事件渲染（重合事件按 lane 分层 + 颜色区分） */}
          {laidOut.map(({ event, x, barStartX, barEndX, side, color: eventColor, lane }) => {
            const isTop = side === "top";
            /** lane 垂直偏移（px）：重合事件锚点在轴心上方逐层错开 */
            const laneOffset = lane * LANE_STEP;
            const barWidth =
              barStartX !== null && barEndX !== null ? barEndX - barStartX : 0;
            return (
              <div key={event.id}>
                {/* 时间段事件：横条（lane 分层错开，够宽时内嵌标题） */}
                {event.type === "period" && barStartX !== null && barEndX !== null && (
                  <div
                    className="absolute h-3 rounded-full shadow-sm flex items-center px-1.5 overflow-hidden"
                    style={{
                      left: barStartX,
                      width: Math.max(barWidth, 4),
                      // 横条中心位于"轴心 - laneOffset"，高度 12px 故 top 偏移 6px
                      top: `calc(50% - ${laneOffset + 6}px)`,
                      backgroundColor: eventColor,
                    }}
                    title={`${event.title}（${formatEventYears(event)}）`}
                  >
                    {/* 横条足够宽时直接内嵌事件名（空间不足则仅悬浮提示） */}
                    {barWidth >= 56 && (
                      <span
                        className="text-[10px] leading-none whitespace-nowrap truncate text-white"
                        style={{ textShadow: "0 1px 2px rgba(0,0,0,0.35)" }}
                      >
                        {event.title}
                      </span>
                    )}
                  </div>
                )}

                {/* 时间点事件：圆点（lane 分层错开） */}
                {event.type === "point" && (
                  <div
                    className="absolute w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background shadow"
                    style={{
                      left: x,
                      top: `calc(50% - ${laneOffset}px)`,
                      backgroundColor: eventColor,
                    }}
                  />
                )}

                {/* 引线：从事件锚点（含 lane 偏移）连到卡片 */}
                <div
                  className="absolute w-px"
                  style={
                    isTop
                      ? {
                          // top 侧：卡片底边 = 轴心上方 (24 + laneOffset)，引线恒 24px
                          left: x,
                          top: `calc(50% - ${24 + laneOffset}px)`,
                          height: 24,
                          backgroundColor: `${eventColor}66`,
                        }
                      : {
                          // bottom 侧：卡片顶边 = 轴心下方 24px，引线跨越 laneOffset + 24
                          left: x,
                          top: `calc(50% - ${laneOffset}px)`,
                          height: 24 + laneOffset,
                          backgroundColor: `${eventColor}66`,
                        }
                  }
                />

                {/* 事件卡片（上下交错）：默认仅基础信息，点击展开详情 */}
                {(() => {
                  const expanded = expandedId === event.id;
                  return (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => handleEventClick(event)}
                      onKeyDown={(e) => {
                        // 键盘可访问性：Enter/空格切换展开
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleEventClick(event);
                        }
                      }}
                      className={cn(
                        "absolute text-left rounded-lg border bg-card shadow-sm p-2.5 pl-3",
                        "cursor-pointer outline-none transition-all",
                        expanded
                          ? "z-20 shadow-md border-primary/40"
                          : "hover:shadow-md hover:border-primary/40 hover:-translate-y-0.5"
                      )}
                      style={{
                        left: x - EVENT_CARD_WIDTH / 2,
                        width: EVENT_CARD_WIDTH,
                        // 左侧色条呼应事件颜色（重合事件一眼可辨）
                        borderLeft: `3px solid ${eventColor}`,
                        // top 侧向上生长且随 lane 上移；bottom 侧向下生长
                        ...(isTop
                          ? { bottom: `calc(50% + ${24 + laneOffset}px)` }
                          : { top: "calc(50% + 24px)" }),
                      }}
                      aria-expanded={expanded}
                    >
                      {/* 来源角标：AI 创建的事件显示小标记 */}
                      {event.source === "ai" && (
                        <span className="absolute top-1.5 right-1.5 text-[10px] text-primary/60 font-medium">
                          AI
                        </span>
                      )}
                      {/* 基础信息：标题 + 年份（始终显示） */}
                      <div className="text-xs font-semibold truncate pr-5">{event.title}</div>
                      <div
                        className="text-[11px] font-medium mt-0.5 tabular-nums"
                        style={{ color: eventColor }}
                      >
                        {formatEventYears(event)}
                      </div>

                      {/* 详情区：仅展开态显示（完整描述 + 编辑入口） */}
                      {expanded && (
                        <>
                          {event.content && (
                            <div
                              data-inner-scroll
                              className="text-[11px] text-muted-foreground mt-1.5 pt-1.5 border-t whitespace-pre-wrap leading-snug max-h-40 overflow-y-auto select-text"
                            >
                              {event.content}
                            </div>
                          )}
                          <div className="mt-1.5 pt-1.5 border-t flex justify-end">
                            <button
                              type="button"
                              onClick={(e) => {
                                // 阻止冒泡：避免触发卡片展开/收起切换
                                e.stopPropagation();
                                onEventClick(event);
                              }}
                              className="text-[11px] px-2 py-0.5 rounded text-primary hover:bg-primary/10 transition-colors"
                            >
                              编辑
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}

          {/* 空状态引导 */}
          {events.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center bg-card/80 backdrop-blur border border-border rounded-xl shadow-lg px-8 py-6 max-w-sm mx-4">
                <div className="text-3xl mb-3">🕐</div>
                <p className="font-medium text-foreground">这条时间线还是空的</p>
                <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                  使用顶部按钮创建时间点 / 时间段事件，
                  <br />
                  或在下方输入框用 AI 快速录入。
                </p>
              </div>
            </div>
          )}
        </div>

        {/* 右侧渐隐提示：内容可横向滚动 */}
        <div className="absolute right-0 top-0 bottom-0 w-10 bg-gradient-to-l from-background to-transparent pointer-events-none" />
      </div>
    );
  }
);
