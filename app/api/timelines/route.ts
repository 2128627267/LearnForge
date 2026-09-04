/**
 * 时间线 API 路由
 * GET    /api/timelines  - 查询所有时间线（含事件数）
 * POST   /api/timelines  - 创建时间线（颜色缺省时自动分配）
 */
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { timelineService } from "@/lib/services/timelines/service";
import { CreateTimelineSchema } from "@/lib/services/timelines/types";
import { getLogger } from "@/lib/utils/logger";
import { errorResponse } from "@/lib/utils/http-error";

const logger = getLogger("TimelinesAPI");

/** 查询时间线列表 */
export async function GET() {
  try {
    const timelines = await timelineService.listTimelines();
    return NextResponse.json(timelines);
  } catch (err) {
    return errorResponse(logger, "查询时间线列表失败", err);
  }
}

/** 创建时间线 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = CreateTimelineSchema.parse(body);
    const timeline = await timelineService.createTimeline(input);
    logger.info("时间线创建成功", { id: timeline.id, name: timeline.name });
    return NextResponse.json(timeline, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "请求体格式错误", detail: err.issues[0]?.message },
        { status: 400 }
      );
    }
    return errorResponse(logger, "创建时间线失败", err);
  }
}
