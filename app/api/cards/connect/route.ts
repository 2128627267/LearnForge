/**
 * 画布连线 API（面向 AI/Agent 的结构化工具）
 * POST /api/cards/connect
 *
 * 请求体：
 * {
 *   relations: [{ source, target, label? }]   // 两端引用画布已有节点 id
 * }
 *
 * 说明：
 * - 重复连线（同 source+target+label）自动跳过
 * - 响应返回画布最新 edges，便于调用方确认
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { getLogger } from "@/lib/utils/logger";
import { errorResponse } from "@/lib/utils/http-error";
import { appendChangeLog } from "@/lib/sync/server-ops";
import { authorizePluginCall } from "@/lib/plugins/permissions";

const logger = getLogger("CardsConnectAPI");

export const dynamic = "force-dynamic";

const CANVAS_LAYOUT_ID = "default";

interface CanvasNode {
  id: string;
}
interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  data?: { label?: string };
}
interface CanvasLayout {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  tags: Array<{ name: string; color?: string }>;
  viewport?: unknown;
}

const ConnectSchema = z.object({
  relations: z
    .array(
      z.object({
        source: z.string().min(1),
        target: z.string().min(1),
        label: z.string().optional(),
      })
    )
    .min(1)
    .max(200),
});

async function loadLayout(): Promise<CanvasLayout> {
  const layout = await prisma.canvasLayout.findUnique({
    where: { id: CANVAS_LAYOUT_ID },
  });
  if (!layout) return { nodes: [], edges: [], tags: [] };
  try {
    const parsed = JSON.parse(layout.data) as CanvasLayout;
    return {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      viewport: parsed.viewport,
    };
  } catch {
    return { nodes: [], edges: [], tags: [] };
  }
}

export async function POST(request: NextRequest) {
  try {
    // 插件身份校验（F5）：本端点必需 canvas:write；无 x-plugin-id 时直连放行
    const auth = await authorizePluginCall(
      prisma,
      request,
      "POST",
      "/api/cards/connect"
    );
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const auditSource = auth.context?.auditSource ?? "ai-batch";

    const body = await request.json();
    const parsed = ConnectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "请求体格式错误", detail: parsed.error.issues[0]?.message },
        { status: 400 }
      );
    }

    const layout = await loadLayout();
    const nodeIds = new Set(layout.nodes.map((n) => n.id));
    if (nodeIds.size === 0) {
      return NextResponse.json(
        { error: "画布为空，无法连线" },
        { status: 400 }
      );
    }

    const ts = Date.now();
    const createdEdges: CanvasEdge[] = [];
    const skipped: string[] = [];
    const invalid: string[] = [];

    // 已存在边指纹（source→target + label），避免重复
    const existingKeys = new Set(
      layout.edges.map((e) => `${e.source}|${e.target}|${e.data?.label ?? ""}`)
    );

    parsed.data.relations.forEach((rel, i) => {
      const source = rel.source.trim();
      const target = rel.target.trim();
      if (!nodeIds.has(source) || !nodeIds.has(target)) {
        invalid.push(rel.label || `#${i} (${source}→${target})`);
        return;
      }
      if (source === target) {
        invalid.push(`#${i} (自环 ${source})`);
        return;
      }
      const key = `${source}|${target}|${rel.label ?? ""}`;
      if (existingKeys.has(key)) {
        skipped.push(key);
        return;
      }
      const edge: CanvasEdge = {
        id: `edge-${ts}-${i}`,
        source,
        target,
        data: { label: rel.label ?? "" },
      };
      createdEdges.push(edge);
      existingKeys.add(key);
    });

    if (createdEdges.length === 0) {
      return NextResponse.json({
        ok: true,
        created: [],
        skipped,
        invalid,
        edges: layout.edges,
        message:
          invalid.length > 0 ? "存在无效连线，未创建任何边" : "无新增连线（可能已存在重复）",
      });
    }

    layout.edges.push(...createdEdges);
    await prisma.canvasLayout.upsert({
      where: { id: CANVAS_LAYOUT_ID },
      update: { data: JSON.stringify(layout) },
      create: { id: CANVAS_LAYOUT_ID, data: JSON.stringify(layout) },
    });

    // 变更日志（F5 审计补充）：连线写入与 batch 通道一致落审计；
    // 本端点 upsert 不推进 version，revision 取当前服务器值
    const row = await prisma.canvasLayout.findUnique({
      where: { id: CANVAS_LAYOUT_ID },
      select: { version: true },
    });
    await appendChangeLog({
      action: "connect",
      revision: row?.version ?? 0,
      nodeCount: layout.nodes.length,
      edgeCount: layout.edges.length,
      source: auditSource,
      detail: {
        created: createdEdges.length,
        skipped: skipped.length,
        invalid: invalid.length,
      },
    });

    logger.info("创建画布连线", {
      created: createdEdges.length,
      skipped: skipped.length,
      invalid: invalid.length,
    });

    return NextResponse.json({
      ok: true,
      created: createdEdges,
      skipped,
      invalid,
      edges: layout.edges,
    });
  } catch (err) {
    return errorResponse(logger, "创建画布连线失败", err);
  }
}
