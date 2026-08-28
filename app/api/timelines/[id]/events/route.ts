/**
 * 时间线事件 API 路由
 * GET  /api/timelines/:id/events  - 查询该时间线全部事件（按开始年份升序）
 * POST /api/timelines/:id/events  - 创建单个事件（手动创建）
 * PUT  /api/timelines/:id/events  - 批量创建事件（AI 解析结果落库）
 */
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { timelineService } from "@/lib/services/timelines/service";
import {
  CreateTimelineEventSchema,
  CreateTimelineEventsBatchSchema,
} from "@/lib/services/timelines/types";
import { getLogger } from "@/lib/utils/logger";
import { errorResponse } from "@/lib/utils/http-error";

const logger = getLogger("TimelineEventsAPI");

type RouteContext = { params: { id: string } };

/** 查询时间线事件列表 */
export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    // 校验时间线存在性（不存在时返回 404，避免空列表误导前端）
    const timeline = await timelineService.getTimeline(params.id);
    if (!timeline) {
      return NextResponse.json({ error: "时间线不存在" }, { status: 404 });
    }
    const events = await timelineService.listEvents(params.id);
    return NextResponse.json(events);
  } catch (err) {
    return errorResponse(logger, "查询时间线事件失败", err);
  }
}

/** 创建单个事件 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const timeline = await timelineService.getTimeline(params.id);
    if (!timeline) {
      return NextResponse.json({ error: "时间线不存在" }, { status: 404 });
    }

    const body = await request.json();
    const input = CreateTimelineEventSchema.parse(body);
    const event = await timelineService.createEvent(params.id, input);
    logger.info("事件创建成功", { eventId: event.id, timelineId: params.id });
    return NextResponse.json(event, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "请求体格式错误", detail: err.issues[0]?.message },
        { status: 400 }
      );
    }
    return errorResponse(logger, "创建事件失败", err);
  }
}

/** 批量创建事件（AI 解析结果一次性落库） */
export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const timeline = await timelineService.getTimeline(params.id);
    if (!timeline) {
      return NextResponse.json({ error: "时间线不存在" }, { status: 404 });
    }

    const body = await request.json();
    const input = CreateTimelineEventsBatchSchema.parse(body);
    const events = await timelineService.createEventsBatch(params.id, input);
    logger.info("事件批量创建成功", { count: events.length, timelineId: params.id });
    return NextResponse.json(events, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "请求体格式错误", detail: err.issues[0]?.message },
        { status: 400 }
      );
    }
    return errorResponse(logger, "批量创建事件失败", err);
  }
}
