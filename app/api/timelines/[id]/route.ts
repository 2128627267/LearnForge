/**
 * 时间线详情 API 路由
 * PATCH  /api/timelines/:id  - 更新时间线（名称/描述/颜色/排序）
 * DELETE /api/timelines/:id  - 删除时间线（级联删除事件）
 */
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { timelineService } from "@/lib/services/timelines/service";
import { UpdateTimelineSchema } from "@/lib/services/timelines/types";
import { getLogger } from "@/lib/utils/logger";
import { errorResponse } from "@/lib/utils/http-error";

const logger = getLogger("TimelineDetailAPI");

type RouteContext = { params: { id: string } };

/** 更新时间线 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const body = await request.json();
    const input = UpdateTimelineSchema.parse(body);
    const timeline = await timelineService.updateTimeline(params.id, input);
    if (!timeline) {
      return NextResponse.json({ error: "时间线不存在" }, { status: 404 });
    }
    return NextResponse.json(timeline);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "请求体格式错误", detail: err.issues[0]?.message },
        { status: 400 }
      );
    }
    return errorResponse(logger, "更新时间线失败", err);
  }
}

/** 删除时间线 */
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  try {
    const ok = await timelineService.deleteTimeline(params.id);
    if (!ok) {
      return NextResponse.json({ error: "时间线不存在" }, { status: 404 });
    }
    logger.info("时间线已删除", { id: params.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(logger, "删除时间线失败", err);
  }
}
