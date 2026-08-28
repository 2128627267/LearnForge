/**
 * 时间线视图计算（纯函数，无副作用，便于单测）
 *
 * 核心职责：
 * - 计算可视年份边界（左右各外扩 100 年；单事件天然居中）
 * - 计算"像素/年"比例（视口自适应 + 上下限钳制，保证可读性与可滚动性）
 * - 生成刻度（自适应间隔，保证标签不重叠）
 * - 年份格式化（公元前/公元）
 * - 事件卡片上下交错布局（简单贪心防重叠）
 */
import type { TimelineEventDTO } from "@/lib/services/timelines/types";

/** 左右两侧外扩的年数（需求：单侧跨度不超过 100 年） */
export const VIEW_MARGIN_YEARS = 100;

/** 比例上下限（px/年）：下限避免跨度极大时过挤，上限避免跨度极小时单事件占满全屏 */
export const MIN_PX_PER_YEAR = 0.2;
export const MAX_PX_PER_YEAR = 24;

/** 事件卡片宽度（px），用于碰撞检测与定位 */
export const EVENT_CARD_WIDTH = 168;

/** 候选刻度间隔（年）：从中选择使相邻刻度间距像素 >= 最小值的间隔 */
const TICK_INTERVAL_CANDIDATES = [
  1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000,
];

/**
 * 事件色板：用于区分时间上重合的事件
 * 顺序即优先级：不重合的事件统一取第 0 色（基础蓝），
 * 与活跃事件重合时依次取后续颜色，保证重合邻居颜色互异
 */
export const EVENT_PALETTE = [
  "#3b82f6", // blue（基础）
  "#22c55e", // green
  "#f97316", // orange
  "#a855f7", // purple
  "#ec4899", // pink
  "#14b8a6", // teal
  "#eab308", // yellow
  "#ef4444", // red
] as const;

/** 事件的视觉属性（重合事件染色） */
export interface EventVisual {
  /** 显示颜色（hex） */
  color: string;
}

/** 事件的区间终点（point 事件的终点即其开始年份） */
function eventEndYear(
  event: Pick<TimelineEventDTO, "endYear" | "startYear">
): number {
  return event.endYear ?? event.startYear;
}

/**
 * 区间图贪心染色（允许事件重合，用颜色区分）
 *
 * 算法：事件按开始年份升序扫描（扫描线）：
 *   1. 释放已结束的槽位（槽位上事件终点 < 当前事件起点 → 不再重合）
 *   2. 统计仍活跃槽位占用的颜色，从色板取未被占用的第一个颜色
 *
 * 重合定义：区间存在交集（端点相接视为重合，视觉上更安全——
 * 相接的横条共享一个像素点，叠加时完全重合）。
 *
 * 效果：不重合的事件统一基础色；重合链内事件颜色互异。
 * 重合事件在视图中半透明原地叠加，滚轮切换置顶（见 computeStackGroups）。
 */
export function assignEventVisuals(
  events: Array<Pick<TimelineEventDTO, "id" | "startYear" | "endYear">>
): Map<string, EventVisual> {
  const sorted = [...events].sort((a, b) => a.startYear - b.startYear);
  /** 活跃槽位：null = 空闲；{ endYear, colorIndex } = 占用中（用于颜色去重） */
  const slots: Array<{ endYear: number; colorIndex: number } | null> = [];
  const result = new Map<string, EventVisual>();

  for (const ev of sorted) {
    const start = ev.startYear;
    const end = eventEndYear(ev);

    // 1. 释放已结束的槽位（终点早于当前起点 → 不重合）
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] && slots[i]!.endYear < start) slots[i] = null;
    }

    // 2. 活跃颜色集合 → 取色板中未被占用的第一个索引
    const usedColors = new Set<number>();
    for (const slot of slots) {
      if (slot) usedColors.add(slot.colorIndex);
    }
    let colorIndex = 0;
    while (usedColors.has(colorIndex) && colorIndex < EVENT_PALETTE.length - 1) {
      colorIndex++;
    }
    // 色板用尽（8+ 事件同时重合）：按活跃数取模复用（极端场景兜底）
    if (usedColors.has(colorIndex)) {
      colorIndex = slots.filter(Boolean).length % EVENT_PALETTE.length;
    }

    // 放入最小空闲槽位（无空闲则开新槽）
    let slotIndex = slots.indexOf(null);
    if (slotIndex === -1) {
      slotIndex = slots.length;
      slots.push(null);
    }

    slots[slotIndex] = { endYear: end, colorIndex };
    result.set(ev.id, { color: EVENT_PALETTE[colorIndex] });
  }

  return result;
}

/** 相邻刻度的最小像素间距（低于该值标签会重叠） */
const MIN_TICK_PX = 88;

/** 无事件时的默认可视范围（公元前 100 ~ 公元 100） */
const EMPTY_RANGE = { left: -100, right: 100 };

/**
 * 年份格式化：
 * 负数 → 公元前 N 年；0 → 公元前 1 年（约定：无公元 0 年，0 视作公元前 1 年）；正数 → 公元 N 年
 */
export function formatYear(year: number): string {
  if (year < 0) return `公元前${-year}`;
  if (year === 0) return "公元前1";
  return `${year}`;
}

/** 事件的"锚点年份"：point 用 startYear，period 用起止中点（用于居中与卡片定位） */
export function eventAnchorYear(event: Pick<TimelineEventDTO, "type" | "startYear" | "endYear">): number {
  if (event.type === "period" && event.endYear !== null) {
    return (event.startYear + event.endYear) / 2;
  }
  return event.startYear;
}

/** 视图范围计算结果 */
export interface ViewRange {
  /** 左边界年份（含） */
  left: number;
  /** 右边界年份（含） */
  right: number;
  /** 像素/年比例 */
  pxPerYear: number;
  /** 内容总宽度（px） */
  contentWidth: number;
}

/**
 * 计算可视范围与比例：
 * - 无事件：返回默认空范围（比例按视口铺满）
 * - 有事件：left = 最早事件开始 - 100，right = 最晚事件结束（或开始）+ 100
 *   单事件时该规则天然使其居中（点：y±100；段：start-100 ~ end+100）
 * - 比例优先按视口铺满计算，再钳制到 [MIN, MAX]；钳制后内容可能超出视口（可滚动）
 */
export function computeViewRange(
  events: Array<Pick<TimelineEventDTO, "type" | "startYear" | "endYear">>,
  viewportWidth: number
): ViewRange {
  let left: number;
  let right: number;

  if (events.length === 0) {
    left = EMPTY_RANGE.left;
    right = EMPTY_RANGE.right;
  } else {
    // 最早开始年份 / 最晚结束年份（point 的结束即其开始）
    left = Math.min(...events.map((e) => e.startYear)) - VIEW_MARGIN_YEARS;
    right =
      Math.max(...events.map((e) => e.endYear ?? e.startYear)) + VIEW_MARGIN_YEARS;
  }

  // 保证跨度至少为 1，避免除零
  const span = Math.max(right - left, 1);
  // 自适应比例：优先铺满视口，再钳制上下限
  const fit = viewportWidth / span;
  const pxPerYear = Math.min(Math.max(fit, MIN_PX_PER_YEAR), MAX_PX_PER_YEAR);

  return {
    left,
    right,
    pxPerYear,
    contentWidth: span * pxPerYear,
  };
}

/** 年份 → 内容区 X 坐标（px） */
export function yearToX(year: number, range: ViewRange): number {
  return (year - range.left) * range.pxPerYear;
}

/** 单个刻度项 */
export interface Tick {
  year: number;
  /** 刻度线的 X 坐标（px） */
  x: number;
  /** 格式化后的年份标签 */
  label: string;
}

/**
 * 生成刻度序列：
 * 从 left 起按所选间隔步进到 right（含边界），间隔取"像素间距达标"的最小候选值。
 */
export function computeTicks(range: ViewRange): Tick[] {
  // 选择使相邻刻度像素间距 >= MIN_TICK_PX 的最小间隔
  let interval = TICK_INTERVAL_CANDIDATES[TICK_INTERVAL_CANDIDATES.length - 1];
  for (const candidate of TICK_INTERVAL_CANDIDATES) {
    if (candidate * range.pxPerYear >= MIN_TICK_PX) {
      interval = candidate;
      break;
    }
  }

  const ticks: Tick[] = [];
  // 起点对齐到 interval 的整数倍（含负数年份的正确取整）
  const start = Math.ceil(range.left / interval) * interval;
  for (let year = start; year <= range.right; year += interval) {
    ticks.push({ year, x: yearToX(year, range), label: formatYear(year) });
  }
  return ticks;
}

/** 事件布局侧别：卡片显示在轴上方或下方 */
export type EventSide = "top" | "bottom";

/** 布局后的事件节点（视图渲染直接消费） */
export interface LaidOutEvent {
  event: TimelineEventDTO;
  /** 卡片锚点 X 坐标（px） */
  x: number;
  /** 时间段事件：横条起止 X 坐标（point 事件为 null） */
  barStartX: number | null;
  barEndX: number | null;
  /** 卡片所在侧 */
  side: EventSide;
  /** 事件显示色（重合事件颜色互异） */
  color: string;
}

/**
 * 事件卡片上下交错布局（贪心防重叠）：
 * - 按锚点年份升序处理
 * - 优先放上方；若与上方已放卡片水平区间重叠则放下方；两侧都重叠时保持当前优先侧（接受重叠）
 * - 重叠判定基于卡片宽度（EVENT_CARD_WIDTH）
 * - 重合事件不做垂直分层：视图层半透明原地叠加 + 滚轮切换置顶（computeStackGroups）
 */
export function layoutEvents(events: TimelineEventDTO[], range: ViewRange): LaidOutEvent[] {
  // 重合事件的染色（颜色输出给渲染层）
  const visuals = assignEventVisuals(events);

  // 按锚点年份排序（稳定排序：同年按创建时间）
  const sorted = [...events].sort((a, b) => {
    const anchorDiff = eventAnchorYear(a) - eventAnchorYear(b);
    return anchorDiff !== 0 ? anchorDiff : a.createdAt.localeCompare(b.createdAt);
  });

  // 已占用区间（左端点 X）按侧别记录
  const topUsed: number[] = [];
  const bottomUsed: number[] = [];

  const result: LaidOutEvent[] = [];
  for (const event of sorted) {
    const anchor = eventAnchorYear(event);
    const x = yearToX(anchor, range);

    // 时间段事件的横条起止坐标
    const barStartX =
      event.type === "period" ? yearToX(event.startYear, range) : null;
    const barEndX =
      event.type === "period" && event.endYear !== null
        ? yearToX(event.endYear, range)
        : null;

    // 卡片左端点（卡片以锚点为中心）
    const cardLeft = x - EVENT_CARD_WIDTH / 2;

    // 与指定侧已放卡片是否重叠
    const overlaps = (used: number[]) =>
      used.some((left) => Math.abs(cardLeft - left) < EVENT_CARD_WIDTH);

    const overlapTop = overlaps(topUsed);
    const overlapBottom = overlaps(bottomUsed);

    let side: EventSide;
    if (!overlapTop) {
      side = "top";
    } else if (!overlapBottom) {
      side = "bottom";
    } else {
      // 两侧都重叠：交替放置，尽量分散（雏形已知限制，极端密集时可接受）
      side = result.length % 2 === 0 ? "top" : "bottom";
    }

    (side === "top" ? topUsed : bottomUsed).push(cardLeft);
    const visual = visuals.get(event.id) ?? { color: EVENT_PALETTE[0] };
    result.push({ event, x, barStartX, barEndX, side, ...visual });
  }

  return result;
}

/** 堆叠分组：同侧且卡片横向区间重叠的事件链（滚轮切换单位） */
export interface StackGroup {
  /** 组键（side + 首个成员事件 id，用作 frontIndex 状态键） */
  key: string;
  /** 卡片所在侧 */
  side: EventSide;
  /** 成员事件 id（按布局顺序，锚点升序） */
  members: string[];
  /** 组内卡片横向覆盖范围（内容区坐标，用于滚轮命中判定） */
  left: number;
  right: number;
}

/**
 * 计算堆叠分组：
 * 同一侧内，卡片横向区间重叠（含相接）的事件归入同一组。
 * 布局结果按锚点升序，但同侧事件在扫描顺序中可能与另一侧交错
 * （top/bottom/top…），因此按侧别各自维护开放链。
 * 仅含单个成员的组同样返回（渲染层据此判断是否可滚轮切换）。
 */
export function computeStackGroups(laid: LaidOutEvent[]): StackGroup[] {
  const groups: StackGroup[] = [];
  /** 各侧当前开放链（同侧事件按 x 升序，链内单调延伸） */
  const open: Record<EventSide, StackGroup | null> = { top: null, bottom: null };

  for (const { event, side, x } of laid) {
    const cardLeft = x - EVENT_CARD_WIDTH / 2;
    const cardRight = x + EVENT_CARD_WIDTH / 2;
    const chain = open[side];

    if (chain && cardLeft <= chain.right) {
      // 与本侧开放链重叠 → 并入
      chain.members.push(event.id);
      chain.right = Math.max(chain.right, cardRight);
    } else {
      const group: StackGroup = {
        key: `${side}:${event.id}`,
        side,
        members: [event.id],
        left: cardLeft,
        right: cardRight,
      };
      groups.push(group);
      open[side] = group;
    }
  }

  return groups;
}

/** 事件在堆叠组内的置顶状态（渲染层消费） */
export interface StackFrontInfo {
  /** 所属组键 */
  groupKey: string;
  /** 是否为该组当前置顶事件（不透明显示、z 序最高） */
  isFront: boolean;
}

/**
 * 解析每个事件的置顶状态：
 * frontIndex 记录各组的置顶游标（滚轮切换产生），取模防越界；
 * 游标缺失或组只有单成员时，首个成员置顶。
 */
export function resolveStackFronts(
  groups: StackGroup[],
  frontIndex: Record<string, number>
): Map<string, StackFrontInfo> {
  const result = new Map<string, StackFrontInfo>();
  for (const group of groups) {
    const n = group.members.length;
    const cursor = ((frontIndex[group.key] ?? 0) % n + n) % n;
    for (let i = 0; i < n; i++) {
      result.set(group.members[i], {
        groupKey: group.key,
        isFront: i === cursor,
      });
    }
  }
  return result;
}

/**
 * 计算初始滚动位置（px）：
 * - 单事件：使该事件居中（需求：仅一个时间点/时间段时自动居中显示）
 * - 多事件：使最早事件出现在视口左侧 1/4 处（保留后续内容的浏览空间）
 * - 无事件：0（从头开始）
 */
export function computeInitialScrollLeft(
  events: Array<Pick<TimelineEventDTO, "type" | "startYear" | "endYear">>,
  range: ViewRange,
  viewportWidth: number
): number {
  if (events.length === 0) return 0;

  if (events.length === 1) {
    const anchor = eventAnchorYear(events[0]);
    return Math.max(0, yearToX(anchor, range) - viewportWidth / 2);
  }

  // 多事件：定位到最早事件（视口 1/4 处，可回看左侧留白）
  const earliest = Math.min(...events.map((e) => e.startYear));
  return Math.max(0, yearToX(earliest, range) - viewportWidth / 4);
}
