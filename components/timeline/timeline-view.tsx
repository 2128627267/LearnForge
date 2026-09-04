"use client";

/**
 * 水平时间线视图（核心可视化组件）
 *
 * 布局：从左到右的水平时间轴
 * - 中心横轴 + 自适应刻度（年份标签）
 * - 时间点事件：轴上圆点 + 引线 + 卡片（上下交错防重叠）
 * - 时间段事件：轴上彩色横条（够宽时内嵌标题）+ 卡片
 * - 重合事件：半透明原地叠加（不做垂直错开），事件色板区分颜色
 *
 * 交互（地图式）：
 * - 鼠标滚轮：以光标为中心缩放时间轴；悬停在堆叠卡片上时改为
 *   切换该堆叠组的置顶事件（指哪儿切哪儿，与缩放互不干扰）
 * - 按住拖拽：平移浏览；触控板横扫同理
 * - 点击事件卡片：展开显示详情描述（默认仅显示事件名 + 时间）
 * - 展开态点击"编辑"：打开编辑对话框
 * - 右下角缩放控件：放大 / 缩小 / 重置
 */
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
} from "react";
import { cn } from "@/lib/utils/cn";
import type { TimelineEventDTO } from "@/lib/services/timelines/types";
import {
  computeViewRange,
  computeTicks,
  layoutEvents,
  computeStackGroups,
  resolveStackFronts,
  computeInitialScrollLeft,
  applyZoom,
  anchorZoomScrollLeft,
  formatYear,
  EVENT_CARD_WIDTH,
  MIN_PX_PER_YEAR,
  MAX_PX_PER_YEAR,
  type StackGroup,
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
    // 缩放状态（zoom 为相对基准比例的倍率，1 = 适配视口）
    // 实际比例经 applyZoom 钳制；切换时间线时重置
    // --------------------------------------------------------------
    const [zoom, setZoom] = useState(1);
    useEffect(() => {
      setZoom(1);
    }, [resetKey]);

    // --------------------------------------------------------------
    // 视图计算（纯函数：基准范围 → 缩放 → 刻度 / 事件布局）
    // --------------------------------------------------------------
    const baseRange = useMemo(
      () => computeViewRange(events, viewportWidth || 800),
      [events, viewportWidth]
    );
    const range = useMemo(() => applyZoom(baseRange, zoom), [baseRange, zoom]);
    const ticks = useMemo(() => computeTicks(range), [range]);
    const laidOut = useMemo(() => layoutEvents(events, range), [events, range]);

    // --------------------------------------------------------------
    // 堆叠分组与置顶状态（重合事件半透明叠加，滚轮切换置顶）
    // - groups：同侧卡片横向重叠的事件链（EVENT_CARD_WIDTH 判定）
    // - frontIndex：各组当前置顶游标（滚轮滚动产生，state 持久化）
    // --------------------------------------------------------------
    const groups = useMemo(() => computeStackGroups(laidOut), [laidOut]);
    const [frontIndex, setFrontIndex] = useState<Record<string, number>>({});
    const stackFronts = useMemo(
      () => resolveStackFronts(groups, frontIndex),
      [groups, frontIndex]
    );

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
    // 滚轮（地图式交互，wheel 事件需 passive:false 才能 preventDefault）：
    // - 默认：以光标为中心缩放时间轴
    // - 悬停在多事件堆叠卡片（[data-stack]）上：切换该组置顶事件
    // - 触控板横扫（deltaX 为主）：交给浏览器原生横向滚动
    // 例外：展开卡片的详情区（data-inner-scroll）自身可纵向滚动，放行不拦截
    // --------------------------------------------------------------
    const groupsRef = useRef<StackGroup[]>([]);
    groupsRef.current = groups;
    const zoomRef = useRef(zoom);
    zoomRef.current = zoom;
    const basePxRef = useRef(baseRange.pxPerYear);
    basePxRef.current = baseRange.pxPerYear;
    const rangeRef = useRef(range);
    rangeRef.current = range;
    /** 缩放提交后待应用的锚点（useLayoutEffect 在新宽度渲染完成后回填 scrollLeft） */
    const pendingAnchorRef = useRef<{
      cursorX: number;
      prevPxPerYear: number;
      prevScrollLeft: number;
    } | null>(null);

    /** 依据当前倍率与期望倍率计算钳制后的新倍率（实际比例不越界） */
    const clampZoom = useCallback((raw: number) => {
      const basePx = basePxRef.current;
      const eff = Math.min(
        Math.max(basePx * raw, MIN_PX_PER_YEAR),
        MAX_PX_PER_YEAR
      );
      return eff / basePx;
    }, []);

    const commitZoom = useCallback((newZoom: number, cursorX: number) => {
      const el = containerRef.current;
      if (!el) return;
      pendingAnchorRef.current = {
        cursorX,
        prevPxPerYear: rangeRef.current.pxPerYear,
        prevScrollLeft: el.scrollLeft,
      };
      setZoom(newZoom);
    }, []);

    /** 视口中心 X（缩放控件按钮的锚点） */
    const centerCursorX = useCallback(
      () => (containerRef.current?.clientWidth ?? 0) / 2,
      []
    );

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const onWheel = (e: WheelEvent) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest?.("[data-inner-scroll]")) return;
        // 触控板横扫 → 原生横向滚动
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
        e.preventDefault();

        // 悬停堆叠卡片：滚轮切换该组置顶事件
        if (target?.closest?.("[data-stack]")) {
          const rect = el.getBoundingClientRect();
          const side =
            e.clientY - rect.top < rect.height / 2 ? "top" : "bottom";
          const contentX = e.clientX - rect.left + el.scrollLeft;
          const group = groupsRef.current.find(
            (g) =>
              g.side === side &&
              g.members.length > 1 &&
              contentX >= g.left &&
              contentX <= g.right
          );
          if (group) {
            const step = e.deltaY > 0 ? 1 : -1;
            setFrontIndex((prev) => ({
              ...prev,
              [group.key]: (prev[group.key] ?? 0) + step,
            }));
            return;
          }
        }

        // 缩放（滚轮向下缩小、向上放大，指数步进手感均匀）
        const factor = Math.exp(-e.deltaY * 0.002);
        const cursorX = e.clientX - el.getBoundingClientRect().left;
        commitZoom(clampZoom(zoomRef.current * factor), cursorX);
      };
      el.addEventListener("wheel", onWheel, { passive: false });
      return () => el.removeEventListener("wheel", onWheel);
    }, [clampZoom, commitZoom]);

    // 缩放渲染完成后应用锚点：保持光标下年份不动
    useLayoutEffect(() => {
      const el = containerRef.current;
      const pending = pendingAnchorRef.current;
      if (!el || !pending) return;
      pendingAnchorRef.current = null;
      el.scrollLeft = anchorZoomScrollLeft(
        range,
        pending.prevPxPerYear,
        pending.prevScrollLeft,
        pending.cursorX
      );
    }, [range]);

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

    // 切换时间线时重置：收起展开卡片 + 归零置顶游标
    useEffect(() => {
      setExpandedId(null);
      setFrontIndex({});
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

          {/* 事件渲染（重合事件半透明叠加 + 颜色区分 + 滚轮切换置顶） */}
          {laidOut.map(({ event, x, barStartX, barEndX, side, color: eventColor }) => {
            const isTop = side === "top";
            /** 是否为所在堆叠组的置顶事件（非置顶半透明沉底） */
            const isFront = stackFronts.get(event.id)?.isFront ?? true;
            const barWidth =
              barStartX !== null && barEndX !== null ? barEndX - barStartX : 0;
            return (
              <div key={event.id}>
                {/* 时间段事件：横条（重合时原地叠加，非置顶半透明） */}
                {event.type === "period" && barStartX !== null && barEndX !== null && (
                  <div
                    className="absolute h-3 rounded-full shadow-sm flex items-center px-1.5 overflow-hidden transition-opacity"
                    style={{
                      left: barStartX,
                      width: Math.max(barWidth, 4),
                      // 横条中心位于轴心，高度 12px 故 top 偏移 6px
                      top: "calc(50% - 6px)",
                      backgroundColor: eventColor,
                      opacity: isFront ? 1 : 0.5,
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

                {/* 时间点事件：圆点（重合时原地叠加，非置顶半透明） */}
                {event.type === "point" && (
                  <div
                    className="absolute w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background shadow transition-opacity"
                    style={{
                      left: x,
                      top: "50%",
                      backgroundColor: eventColor,
                      opacity: isFront ? 1 : 0.5,
                    }}
                  />
                )}

                {/* 引线：从事件锚点（轴心）连到卡片 */}
                <div
                  className="absolute w-px"
                  style={
                    isTop
                      ? {
                          // top 侧：卡片底边 = 轴心上方 24px，引线恒 24px
                          left: x,
                          top: "calc(50% - 24px)",
                          height: 24,
                          backgroundColor: `${eventColor}66`,
                        }
                      : {
                          // bottom 侧：卡片顶边 = 轴心下方 24px
                          left: x,
                          top: "50%",
                          height: 24,
                          backgroundColor: `${eventColor}66`,
                        }
                  }
                />

                {/* 事件卡片（上下交错）：默认仅基础信息，点击展开详情；重合时叠加，滚轮切换置顶 */}
                {(() => {
                  const expanded = expandedId === event.id;
                  const stack = stackFronts.get(event.id);
                  const stacked = (stack?.groupSize ?? 1) > 1;
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
                      data-stack={stacked ? "" : undefined}
                      className={cn(
                        "absolute text-left rounded-lg border bg-card shadow-sm p-2.5 pl-3",
                        "cursor-pointer outline-none transition-all",
                        expanded
                          ? "z-20 shadow-md border-primary/40"
                          : isFront
                            ? "z-10 hover:shadow-md hover:border-primary/40"
                            : "opacity-60 hover:opacity-90 hover:shadow-md hover:border-primary/40"
                      )}
                      style={{
                        left: x - EVENT_CARD_WIDTH / 2,
                        width: EVENT_CARD_WIDTH,
                        // 左侧色条呼应事件颜色（重合事件一眼可辨）
                        borderLeft: `3px solid ${eventColor}`,
                        // top 侧向上生长；bottom 侧向下生长
                        ...(isTop
                          ? { bottom: "calc(50% + 24px)" }
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

                      {/* 堆叠位置角标：n/m 提示可滚轮切换（展开态让位给编辑区） */}
                      {stacked && isFront && !expanded && (
                        <span className="absolute bottom-1.5 right-2 text-[9px] leading-none text-muted-foreground/70 tabular-nums">
                          {(stack?.frontCursor ?? 0) + 1}/{stack?.groupSize}
                        </span>
                      )}

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

        {/* 缩放控件（右下角）：放大 / 缩小 / 重置，以视口中心为锚点 */}
        <div className="absolute bottom-4 right-4 z-30 flex flex-col rounded-lg border border-border bg-card/90 backdrop-blur shadow-md overflow-hidden">
          {([
            { label: "+", title: "放大", action: () => commitZoom(clampZoom(zoomRef.current * 1.5), centerCursorX()) },
            { label: "−", title: "缩小", action: () => commitZoom(clampZoom(zoomRef.current / 1.5), centerCursorX()) },
          ].map(({ label, title, action }) => (
            <button
              key={title}
              type="button"
              title={title}
              onClick={action}
              className="w-8 h-8 flex items-center justify-center text-foreground/80 hover:bg-primary/10 hover:text-primary transition-colors text-base leading-none"
            >
              {label}
            </button>
          )))}
          <button
            type="button"
            title="重置缩放"
            onClick={() => commitZoom(1, centerCursorX())}
            disabled={zoom === 1}
            className="w-8 h-8 flex items-center justify-center text-[10px] text-foreground/80 hover:bg-primary/10 hover:text-primary transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
          >
            1:1
          </button>
        </div>
      </div>
    );
  }
);
