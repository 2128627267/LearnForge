/**
 * 画布布局持久化 API（F3 改造：乐观锁 + 自动快照 + 变更日志）
 *
 * GET    /api/canvas-layout  - 获取最新保存的画布布局（无则返回 null）
 *   响应: { data: CanvasState | null, revision: number | null, updatedAt: string | null }
 *
 * PUT    /api/canvas-layout  - 覆盖保存画布布局（单行 upsert）
 *   请求: { canvas: CanvasState, baseRevision?: number | null, source?: string }
 *   响应: { ok: true, revision, updatedAt }
 *         409 { error: "revision_conflict", revision, data }  // 乐观锁冲突
 *
 * 乐观锁协议（X2 修复 + S1 原子化加固）：
 * - CanvasLayout.version 兼作单调递增 revision，每次成功写入 +1
 * - PUT 携带 baseRevision（客户端上次获知的 revision）；
 *   服务器当前 revision 不一致 → 409 + 服务器最新数据，客户端合并后重试
 * - baseRevision 为 null/缺省 → 无条件写入（兼容 batch / 首次保存等场景）
 * - 写入采用条件原子更新（version 基线进 WHERE），消除并发
 *   "读 → 判 → 写"窗口内的 TOCTOU 覆盖竞态（审查 S1）
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { getLogger } from "@/lib/utils/logger";
import { appendChangeLog, snapshotCurrentLayout } from "@/lib/sync/server-ops";

const logger = getLogger("CanvasLayoutAPI");

const CANVAS_LAYOUT_ID = "default";

/**
 * 画布布局数据校验（宽松校验，仅保证可序列化结构，
 * 具体字段由前端 CanvasState 类型约束）
 */
const CanvasLayoutSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      type: z.string().optional().default("freeCard"),
      position: z.object({ x: z.number(), y: z.number() }),
      data: z.record(z.unknown()),
      width: z.number().optional(),
      zIndex: z.number().optional(),
    })
  ),
  edges: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      target: z.string(),
      sourceHandle: z.string().nullable().optional(),
      targetHandle: z.string().nullable().optional(),
      type: z.string().optional(),
      data: z.object({ label: z.string().optional() }).optional(),
    })
  ),
  tags: z.array(
    z.object({ name: z.string(), color: z.string().optional() })
  ),
  viewport: z
    .object({ x: z.number(), y: z.number(), zoom: z.number() })
    .optional(),
});

/** PUT 请求体：画布 + 乐观锁基线 revision + 来源标识 */
const PutBodySchema = z.object({
  canvas: CanvasLayoutSchema,
  /** 客户端基于的服务器 revision；null/缺省 = 无条件写入 */
  baseRevision: z.number().int().nullable().optional(),
  /** 变更来源（写入变更日志）：web | ai-batch 等 */
  source: z.string().default("web"),
});

/** 乐观锁冲突响应（409 + 服务器最新数据，供客户端合并后重试） */
function conflictResponse(layout: { version: number; data: string }) {
  return NextResponse.json(
    {
      error: "revision_conflict",
      revision: layout.version,
      data: JSON.parse(layout.data),
    },
    { status: 409 }
  );
}

export async function GET() {
  try {
    const layout = await prisma.canvasLayout.findUnique({
      where: { id: CANVAS_LAYOUT_ID },
    });
    if (!layout) {
      return NextResponse.json({ data: null, revision: null, updatedAt: null });
    }
    return NextResponse.json({
      data: JSON.parse(layout.data),
      revision: layout.version,
      updatedAt: layout.updatedAt.toISOString(),
    });
  } catch (err) {
    logger.error("读取画布布局失败", { error: String(err) });
    return NextResponse.json(
      { error: "读取画布布局失败", detail: String(err) },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = PutBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "请求体格式错误", detail: parsed.error.issues[0]?.message },
        { status: 400 }
      );
    }
    const { canvas, baseRevision, source } = parsed.data;
    const serialized = JSON.stringify(canvas);

    const current = await prisma.canvasLayout.findUnique({
      where: { id: CANVAS_LAYOUT_ID },
    });

    // 乐观锁冲突预检（快速失败，省去快照开销；最终原子性由下方条件写入保证）
    if (
      baseRevision != null &&
      current &&
      current.version !== baseRevision
    ) {
      return conflictResponse(current);
    }

    // 覆盖前自动快照（服务器已有数据且内容将变化时）
    if (current && current.data !== serialized) {
      await snapshotCurrentLayout("auto");
    }

    /**
     * S1 修复（审查）：条件原子写入——把读到的 version 基线放进 WHERE，
     * 消除"读 → 判 → upsert"窗口内并发写入（batch/restore/PUT 互相）静默
     * 覆盖且共用同一 revision 的 TOCTOU 竞态。
     * 预检通过后若并发请求抢先提交（version 已变），count=0 → 按冲突返回 409。
     */
    const written = await prisma.canvasLayout.updateMany({
      where: { id: CANVAS_LAYOUT_ID, version: current?.version ?? 0 },
      data: {
        data: serialized,
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    });

    if (written.count === 0) {
      // 并发写入已抢先提交：区分"记录不存在（首次保存竞态）"与"version 已变（冲突）"
      const latest = await prisma.canvasLayout.findUnique({
        where: { id: CANVAS_LAYOUT_ID },
      });
      if (latest) {
        return conflictResponse(latest);
      }
      // 记录不存在：建立初始副本（create 撞并发唯一键时按冲突处理）
      try {
        await prisma.canvasLayout.create({
          data: { id: CANVAS_LAYOUT_ID, data: serialized, version: 1 },
        });
      } catch {
        const raced = await prisma.canvasLayout.findUnique({
          where: { id: CANVAS_LAYOUT_ID },
        });
        if (raced) return conflictResponse(raced);
        throw new Error("初始化画布布局失败");
      }
      await appendChangeLog({
        action: "save",
        revision: 1,
        nodeCount: canvas.nodes.length,
        edgeCount: canvas.edges.length,
        source,
        detail: { baseRevision: baseRevision ?? null },
      });
      return NextResponse.json({ ok: true, revision: 1 });
    }

    const nextRevision = (current?.version ?? 0) + 1;

    // 变更日志（完整性监控/丢失溯源）
    await appendChangeLog({
      action: "save",
      revision: nextRevision,
      nodeCount: canvas.nodes.length,
      edgeCount: canvas.edges.length,
      source,
      detail: { baseRevision: baseRevision ?? null },
    });

    return NextResponse.json({ ok: true, revision: nextRevision });
  } catch (err) {
    logger.error("保存画布布局失败", { error: String(err) });
    return NextResponse.json(
      { error: "保存画布布局失败", detail: String(err) },
      { status: 500 }
    );
  }
}
