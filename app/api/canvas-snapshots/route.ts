/**
 * 画布快照 API（F3-T4）
 *
 * GET  /api/canvas-snapshots?limit=20 - 快照列表（倒序，最新在前）
 *   响应: { data: SnapshotSummary[] }
 *
 * POST /api/canvas-snapshots - 手动创建当前画布快照
 *   请求: { reason?: "manual" }（仅支持 manual，自动快照由保存链路内部触发）
 *   响应: SnapshotSummary
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { getLogger } from "@/lib/utils/logger";
import { snapshotCurrentLayout } from "@/lib/sync/server-ops";

const logger = getLogger("CanvasSnapshotsAPI");

export const dynamic = "force-dynamic";

/** 手动快照请求体（reason 固定 manual，预留扩展） */
const CreateBodySchema = z.object({
  reason: z.literal("manual").default("manual"),
});

export async function GET(request: NextRequest) {
  try {
    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = Math.min(Math.max(Number(limitParam) || 20, 1), 100);
    const snapshots = await prisma.canvasSnapshot.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      // 列表只返回摘要，不含全量 data（快照 JSON 可能很大）
      select: {
        id: true,
        nodeCount: true,
        edgeCount: true,
        reason: true,
        createdAt: true,
      },
    });
    return NextResponse.json({
      data: snapshots.map((s) => ({
        ...s,
        createdAt: s.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    logger.error("读取快照列表失败", { error: String(err) });
    return NextResponse.json(
      { error: "读取快照列表失败", detail: String(err) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = CreateBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "请求体格式错误", detail: "reason 仅支持 manual" },
        { status: 400 }
      );
    }

    const created = await snapshotCurrentLayout("manual");
    if (!created) {
      // 服务器无画布数据（或数据损坏）：无内容可快照
      return NextResponse.json(
        { error: "当前画布为空，无需快照" },
        { status: 400 }
      );
    }

    // 返回最新一份快照（即刚创建的手动快照）
    const latest = await prisma.canvasSnapshot.findFirst({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        nodeCount: true,
        edgeCount: true,
        reason: true,
        createdAt: true,
      },
    });
    return NextResponse.json({
      ...latest,
      createdAt: latest?.createdAt.toISOString(),
    });
  } catch (err) {
    logger.error("创建快照失败", { error: String(err) });
    return NextResponse.json(
      { error: "创建快照失败", detail: String(err) },
      { status: 500 }
    );
  }
}
