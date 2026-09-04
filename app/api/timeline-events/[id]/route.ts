/**
 * 时间线事件详情 API 路由
 * PATCH  /api/timeline-events/:id  - 更新事件
 * DELETE /api/timeline-events/:id  - 删除事件
 */
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { timelineService } from "@/lib/services/timelines/service";
import { UpdateTimelineEventSchema } from "@/lib/services/timelines/types";
import { getLogger } from "@/lib/utils/logger";
import { errorResponse } from "@/lib/utils/http-error";

const logger = getLogger("TimelineEventDetailAPI");

type RouteContext = { params: { id: string } };

/** 更新事件 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const body = await request.json();
    const input = UpdateTimelineEventSchema.parse(body);
    const event = await timelineService.updateEvent(params.id, input);
    if (!event) {
      return NextResponse.json({ error: "事件不存在" }, { status: 404 });
    }
    return NextResponse.json(event);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "请求体格式错误", detail: err.issues[0]?.message },
        { status: 400 }
      );
    }
    return errorResponse(logger, "更新事件失败", err);
  }
}

/** 删除事件 */
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  try {
    const ok = await timelineService.deleteEvent(params.id);
    if (!ok) {
      return NextResponse.json({ error: "事件不存在" }, { status: 404 });
    }
    logger.info("事件已删除", { id: params.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(logger, "删除事件失败", err);
  }
}
