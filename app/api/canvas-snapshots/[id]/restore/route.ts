/**
 * 画布快照恢复 API（F3-T4）
 *
 * POST /api/canvas-snapshots/[id]/restore - 恢复指定快照
 *   响应: { canvas: CanvasState, revision: number }
 *
 * 恢复流程：
 * 1. 读取目标快照（不存在 → 404）
 * 2. 恢复前自动备份当前画布（reason=pre-restore，误恢复可再撤销）
 * 3. 覆盖写入快照数据，revision +1
 * 4. 写入变更日志（action=restore, source=restore:<snapshotId>）
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getLogger } from "@/lib/utils/logger";
import {
  appendChangeLog,
  snapshotCurrentLayout,
} from "@/lib/sync/server-ops";

const logger = getLogger("CanvasSnapshotRestoreAPI");

export const dynamic = "force-dynamic";

const CANVAS_LAYOUT_ID = "default";

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const snapshot = await prisma.canvasSnapshot.findUnique({
      where: { id },
    });
    if (!snapshot) {
      return NextResponse.json(
        { error: "快照不存在或已被清理" },
        { status: 404 }
      );
    }

    // 恢复前备份当前画布（当前无数据时跳过备份）
    await snapshotCurrentLayout("pre-restore");

    const current = await prisma.canvasLayout.findUnique({
      where: { id: CANVAS_LAYOUT_ID },
    });
    const nextRevision = (current?.version ?? 0) + 1;

    let canvas;
    try {
      canvas = JSON.parse(snapshot.data);
    } catch {
      logger.error("恢复失败：快照数据损坏", { snapshotId: id });
      return NextResponse.json(
        { error: "快照数据损坏，无法恢复" },
        { status: 500 }
      );
    }

    await prisma.canvasLayout.upsert({
      where: { id: CANVAS_LAYOUT_ID },
      update: { data: snapshot.data, version: nextRevision },
      create: {
        id: CANVAS_LAYOUT_ID,
        data: snapshot.data,
        version: nextRevision,
      },
    });

    await appendChangeLog({
      action: "restore",
      revision: nextRevision,
      nodeCount: snapshot.nodeCount,
      edgeCount: snapshot.edgeCount,
      source: `restore:${id}`,
      detail: { reason: snapshot.reason },
    });

    logger.info("恢复快照", { snapshotId: id, revision: nextRevision });

    return NextResponse.json({ canvas, revision: nextRevision });
  } catch (err) {
    logger.error("恢复快照失败", { error: String(err) });
    return NextResponse.json(
      { error: "恢复快照失败", detail: String(err) },
      { status: 500 }
    );
  }
}
