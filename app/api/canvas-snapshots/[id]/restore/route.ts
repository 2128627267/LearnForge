/**
 * 画布快照恢复 API（F3-T4 + S1 原子化加固）
 *
 * POST /api/canvas-snapshots/[id]/restore - 恢复指定快照
 *   响应: { canvas: CanvasState, revision: number }
 *
 * 恢复流程：
 * 1. 读取目标快照（不存在 → 404）
 * 2. 恢复前自动备份当前画布（reason=pre-restore，误恢复可再撤销）
 * 3. 覆盖写入快照数据，revision +1（条件原子写入，防并发覆盖）
 * 4. 写入变更日志（action=restore, source=restore:<snapshotId>）
 *
 * S1 修复（审查）：步骤 2~4 包进交互式事务且 version 基线进 WHERE——
 * 并发写入抢先提交时事务回滚并重试（最多 3 次），保证恢复写入不与
 * 其他通道（PUT/batch）互相静默覆盖、revision 单调。
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getLogger } from "@/lib/utils/logger";
import { errorResponse } from "@/lib/utils/http-error";
import {
  appendChangeLog,
  snapshotCurrentLayout,
} from "@/lib/sync/server-ops";

const logger = getLogger("CanvasSnapshotRestoreAPI");

export const dynamic = "force-dynamic";

const CANVAS_LAYOUT_ID = "default";

/** 恢复写入的并发冲突上限（连续冲突时提示用户稍后重试） */
const MAX_ATTEMPTS = 3;

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    // B7 修复（审查）：cuid 格式预检——非法 id 直接 400，
    // 省一次注定落空的 DB 查询，且不把任意输入送进查询层
    if (!/^c[0-9a-z]{20,}$/.test(id)) {
      return NextResponse.json({ error: "快照 id 格式无效" }, { status: 400 });
    }
    const snapshot = await prisma.canvasSnapshot.findUnique({
      where: { id },
    });
    if (!snapshot) {
      return NextResponse.json(
        { error: "快照不存在或已被清理" },
        { status: 404 }
      );
    }

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

    let revision = 0;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        revision = await prisma.$transaction(async (tx) => {
          // 恢复前备份当前画布（当前无数据时跳过备份）；
          // 事务回滚时备份一并撤销，重试不会产生重复备份
          await snapshotCurrentLayout("pre-restore", tx);

          const current = await tx.canvasLayout.findUnique({
            where: { id: CANVAS_LAYOUT_ID },
          });

          // 条件原子写入（S1）：version 基线进 WHERE，并发抢先提交 → 未命中
          if (!current) {
            try {
              await tx.canvasLayout.create({
                data: { id: CANVAS_LAYOUT_ID, data: snapshot.data, version: 1 },
              });
              return 1;
            } catch {
              // 并发已建立记录：回滚重试（下一轮走 update 路径）
              throw new Error("__concurrent__");
            }
          }

          const written = await tx.canvasLayout.updateMany({
            where: { id: CANVAS_LAYOUT_ID, version: current.version },
            data: {
              data: snapshot.data,
              version: { increment: 1 },
              updatedAt: new Date(),
            },
          });
          if (written.count === 0) {
            throw new Error("__concurrent__");
          }

          const nextRevision = current.version + 1;
          await appendChangeLog(
            {
              action: "restore",
              revision: nextRevision,
              nodeCount: snapshot.nodeCount,
              edgeCount: snapshot.edgeCount,
              source: `restore:${id}`,
              detail: { reason: snapshot.reason },
            },
            tx
          );
          return nextRevision;
        });
        break; // 写入成功，退出重试循环
      } catch (err) {
        if (err instanceof Error && err.message === "__concurrent__") {
          logger.warn("恢复写入撞并发，重试", { snapshotId: id, attempt });
          continue;
        }
        throw err;
      }
    }

    if (revision === 0) {
      // 连续冲突重试耗尽：提示稍后重试（快照与当前数据均未受影响）
      return NextResponse.json(
        { error: "画布并发写入冲突，请稍后重试恢复" },
        { status: 409 }
      );
    }

    logger.info("恢复快照", { snapshotId: id, revision });

    return NextResponse.json({ canvas, revision });
  } catch (err) {
    // B5 修复（审查）：500 不回传内部错误细节，统一走 errorResponse
    return errorResponse(logger, "恢复快照失败", err);
  }
}
