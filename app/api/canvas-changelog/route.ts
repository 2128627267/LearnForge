/**
 * 画布数据变更日志 API（F3-T5）
 *
 * GET /api/canvas-changelog?limit=50 - 变更日志列表（倒序，最新在前）
 *   响应: { data: ChangeLogEntry[] }
 *
 * 用途：数据完整性监控与丢失溯源（谁在何时通过什么渠道改了画布）。
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getLogger } from "@/lib/utils/logger";
import { errorResponse } from "@/lib/utils/http-error";

const logger = getLogger("CanvasChangeLogAPI");

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = Math.min(Math.max(Number(limitParam) || 50, 1), 200);
    const entries = await prisma.dataChangeLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return NextResponse.json({
      data: entries.map((e) => ({
        ...e,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    // B5 修复（审查）：500 不回传内部错误细节，统一走 errorResponse
    return errorResponse(logger, "读取变更日志失败", err);
  }
}
