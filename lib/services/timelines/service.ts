/**
 * 时间线服务层
 *
 * 职责：
 * - 时间线 CRUD（创建时自动分配未占用的调色板颜色）
 * - 事件 CRUD（含批量创建，供 AI 解析结果落库）
 * - DTO 序列化（Prisma Date → ISO 字符串，与 API 输出解耦）
 */
import { prisma } from "@/lib/db/prisma";
import type { Prisma, Timeline, TimelineEvent } from "@prisma/client";
import type {
  CreateTimelineInput,
  UpdateTimelineInput,
  CreateTimelineEventInput,
  CreateTimelineEventsBatchInput,
  UpdateTimelineEventInput,
  TimelineDTO,
  TimelineEventDTO,
} from "./types";

/**
 * 时间线预设调色板（清新风格，与卡片颜色分类系统一致的色系）
 * 创建时间线时按顺序轮询分配，尽量保证每条时间线颜色唯一
 */
export const TIMELINE_PALETTE = [
  "#3b82f6", // blue
  "#22c55e", // green
  "#a855f7", // purple
  "#f97316", // orange
  "#ec4899", // pink
  "#14b8a6", // teal
  "#ef4444", // red
  "#8b5cf6", // violet
  "#eab308", // yellow
  "#06b6d4", // cyan
] as const;

/** Prisma 实体 → API DTO（统一序列化，避免 Date 直接 JSON 化产生歧义） */
function toTimelineDTO(t: Timeline & { _count?: { events: number } }): TimelineDTO {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    color: t.color,
    order: t.order,
    eventCount: t._count?.events ?? 0,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function toEventDTO(e: TimelineEvent): TimelineEventDTO {
  return {
    id: e.id,
    timelineId: e.timelineId,
    title: e.title,
    content: e.content,
    type: e.type as TimelineEventDTO["type"],
    startYear: e.startYear,
    endYear: e.endYear,
    source: e.source as TimelineEventDTO["source"],
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

/** 查询所有时间线（按 order 升序，同序按创建时间），含事件计数 */
async function listTimelines(): Promise<TimelineDTO[]> {
  const rows = await prisma.timeline.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    include: { _count: { select: { events: true } } },
  });
  return rows.map(toTimelineDTO);
}

/**
 * 为新建时间线挑选颜色：
 * 优先挑选调色板中尚未被占用的颜色（按调色板顺序），
 * 全部被占用时按数量取模轮询复用。
 */
async function pickColor(): Promise<string> {
  const used = await prisma.timeline.findMany({ select: { color: true } });
  const usedSet = new Set(used.map((t) => t.color.toLowerCase()));
  for (const color of TIMELINE_PALETTE) {
    if (!usedSet.has(color)) return color;
  }
  // 色板用尽：按现有数量取模轮询（颜色可重复，但尽量分散）
  const count = await prisma.timeline.count();
  return TIMELINE_PALETTE[count % TIMELINE_PALETTE.length];
}

/** 创建时间线 */
async function createTimeline(input: CreateTimelineInput): Promise<TimelineDTO> {
  // order 缺省时排到最后（当前最大 order + 1；表空时从 0 开始）
  const maxOrder = (
    await prisma.timeline.aggregate({ _max: { order: true } })
  )._max.order;
  const order = input.order ?? (maxOrder === null ? 0 : maxOrder + 1);
  const color = input.color ?? (await pickColor());
  const row = await prisma.timeline.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      color,
      order,
    },
    include: { _count: { select: { events: true } } },
  });
  return toTimelineDTO(row);
}

/** 更新时间线（不存在时抛 404 语义的 null，由路由层转换） */
async function updateTimeline(id: string, input: UpdateTimelineInput): Promise<TimelineDTO | null> {
  const data: Prisma.TimelineUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.color !== undefined) data.color = input.color;
  if (input.order !== undefined) data.order = input.order;

  try {
    const row = await prisma.timeline.update({
      where: { id },
      data,
      include: { _count: { select: { events: true } } },
    });
    return toTimelineDTO(row);
  } catch (err) {
    // Prisma P2025 = 记录不存在
    if ((err as { code?: string }).code === "P2025") return null;
    throw err;
  }
}

/** 删除时间线（级联删除其下事件）；不存在返回 false */
async function deleteTimeline(id: string): Promise<boolean> {
  try {
    await prisma.timeline.delete({ where: { id } });
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") return false;
    throw err;
  }
}

/** 获取时间线详情（供路由校验存在性） */
async function getTimeline(id: string): Promise<TimelineDTO | null> {
  const row = await prisma.timeline.findUnique({
    where: { id },
    include: { _count: { select: { events: true } } },
  });
  return row ? toTimelineDTO(row) : null;
}

/** 获取某时间线的全部事件（按开始年份升序） */
async function listEvents(timelineId: string): Promise<TimelineEventDTO[]> {
  const rows = await prisma.timelineEvent.findMany({
    where: { timelineId },
    orderBy: [{ startYear: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toEventDTO);
}

/** 创建单个事件 */
async function createEvent(timelineId: string, input: CreateTimelineEventInput): Promise<TimelineEventDTO> {
  const row = await prisma.timelineEvent.create({
    data: {
      timelineId,
      title: input.title,
      content: input.content,
      type: input.type,
      startYear: input.startYear,
      // point 事件统一存 null，保持数据一致性
      endYear: input.type === "period" ? input.endYear ?? null : null,
      source: input.source,
    },
  });
  return toEventDTO(row);
}

/** 批量创建事件（AI 解析结果一次性落库） */
async function createEventsBatch(
  timelineId: string,
  input: CreateTimelineEventsBatchInput
): Promise<TimelineEventDTO[]> {
  return prisma.$transaction(async (tx) => {
    const created: TimelineEvent[] = [];
    for (const ev of input.events) {
      const row = await tx.timelineEvent.create({
        data: {
          timelineId,
          title: ev.title,
          content: ev.content,
          type: ev.type,
          startYear: ev.startYear,
          endYear: ev.type === "period" ? ev.endYear ?? null : null,
          source: ev.source,
        },
      });
      created.push(row);
    }
    return created.map(toEventDTO);
  });
}

/** 更新事件；不存在返回 null */
async function updateEvent(
  id: string,
  input: UpdateTimelineEventInput
): Promise<TimelineEventDTO | null> {
  const data: Prisma.TimelineEventUpdateInput = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.content !== undefined) data.content = input.content;
  if (input.type !== undefined) data.type = input.type;
  if (input.startYear !== undefined) data.startYear = input.startYear;
  if (input.endYear !== undefined) {
    // point 事件强制清空 endYear；period 保留传入值
    data.endYear = input.endYear ?? null;
  }

  try {
    const row = await prisma.timelineEvent.update({ where: { id }, data });
    return toEventDTO(row);
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") return null;
    throw err;
  }
}

/** 删除事件；不存在返回 false */
async function deleteEvent(id: string): Promise<boolean> {
  try {
    await prisma.timelineEvent.delete({ where: { id } });
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") return false;
    throw err;
  }
}

export const timelineService = {
  listTimelines,
  getTimeline,
  createTimeline,
  updateTimeline,
  deleteTimeline,
  listEvents,
  createEvent,
  createEventsBatch,
  updateEvent,
  deleteEvent,
};
