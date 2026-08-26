/**
 * 画布布局持久化 API
 * GET    /api/canvas-layout  - 获取最新保存的画布布局（无则返回 null）
 * PUT    /api/canvas-layout  - 覆盖保存画布布局（单行 upsert）
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { getLogger } from "@/lib/utils/logger";

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

export async function GET() {
  try {
    const layout = await prisma.canvasLayout.findUnique({
      where: { id: CANVAS_LAYOUT_ID },
    });
    if (!layout) {
      return NextResponse.json({ data: null });
    }
    return NextResponse.json({
      data: JSON.parse(layout.data),
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
    const canvas = CanvasLayoutSchema.parse(body);

    await prisma.canvasLayout.upsert({
      where: { id: CANVAS_LAYOUT_ID },
      update: { data: JSON.stringify(canvas) },
      create: { id: CANVAS_LAYOUT_ID, data: JSON.stringify(canvas) },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("保存画布布局失败", { error: String(err) });
    return NextResponse.json(
      { error: "保存画布布局失败", detail: String(err) },
      err instanceof z.ZodError ? { status: 400 } : { status: 500 }
    );
  }
}
