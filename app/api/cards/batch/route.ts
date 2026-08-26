/**
 * 批量添加卡片到画布 API（面向 AI/Agent 的结构化工具）
 * POST /api/cards/batch
 *
 * 请求体：
 * {
 *   items: [{ id?, title, content, tags?, color?, position?, learningMode?, cardType?, favorite? }],
 *   relations: [{ source, target, label? }]   // 可选，任意连线关系
 * }
 *
 * source/target 解析：
 *   - 本批次 items 的 id 或索引字符串（如 "0"、"1"）
 *   - 画布已有的节点 id（如 "card-xxx"）
 *
 * 说明：
 * - 与画布工作流一致，仅写入服务器端画布布局（CanvasLayout），不写 Card 表
 * - 响应返回画布最新 nodes/edges，便于调用方确认
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { getLogger } from "@/lib/utils/logger";
import { errorResponse } from "@/lib/utils/http-error";

const logger = getLogger("CardsBatchAPI");

export const dynamic = "force-dynamic";

const CANVAS_LAYOUT_ID = "default";

/** 画布布局最小形状（与 /api/canvas-layout 校验一致） */
interface CanvasNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
  width?: number;
  zIndex?: number;
}
interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  type?: string;
  data?: { label?: string };
}
interface CanvasLayout {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  tags: Array<{ name: string; color?: string }>;
  viewport?: { x: number; y: number; zoom: number };
}

/** 校验：source/target 引用是否指向有效节点 */
const RelationSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().optional(),
});

const BatchItemSchema = z.object({
  id: z.string().optional(),
  title: z.string().default("新卡片"),
  content: z.string().default(""),
  tags: z.array(z.string()).optional(),
  color: z.string().optional(),
  position: z
    .object({ x: z.number(), y: z.number() })
    .optional(),
  learningMode: z.string().optional(),
  cardType: z.string().optional(),
  favorite: z.boolean().optional(),
});

const BatchSchema = z.object({
  items: z.array(BatchItemSchema).max(100).default([]),
  relations: z.array(RelationSchema).default([]),
});

/** 读取画布布局（不存在时返回空） */
async function loadLayout(): Promise<CanvasLayout> {
  const layout = await prisma.canvasLayout.findUnique({
    where: { id: CANVAS_LAYOUT_ID },
  });
  if (!layout) {
    return { nodes: [], edges: [], tags: [] };
  }
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

/** 保存画布布局 */
async function saveLayout(layout: CanvasLayout): Promise<void> {
  await prisma.canvasLayout.upsert({
    where: { id: CANVAS_LAYOUT_ID },
    update: { data: JSON.stringify(layout) },
    create: { id: CANVAS_LAYOUT_ID, data: JSON.stringify(layout) },
  });
}

/** 生成节点 id（前端画布节点同格式） */
function makeNodeId(ts: number, i: number): string {
  return `card-${ts}-${i}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = BatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "请求体格式错误", detail: parsed.error.issues[0]?.message },
        { status: 400 }
      );
    }
    const { items, relations } = parsed.data;
    if (items.length === 0 && relations.length === 0) {
      return NextResponse.json(
        { error: "items 与 relations 不能同时为空" },
        { status: 400 }
      );
    }

    const layout = await loadLayout();
    const existingIds = new Set(layout.nodes.map((n) => n.id));

    // 1. 创建节点（冲突 id 跳过创建，仅记录）
    const ts = Date.now();
    const createdNodes: CanvasNode[] = [];
    const idByIndex = new Map<number, string>();
    const skipped: string[] = [];

    items.forEach((item, i) => {
      const id = item.id?.trim() || makeNodeId(ts, i);
      if (existingIds.has(id)) {
        skipped.push(id);
        idByIndex.set(i, id);
        return;
      }
      const node: CanvasNode = {
        id,
        type: "freeCard",
        position: item.position ?? {
          x: 100 + (i % 3) * 340 + Math.random() * 40,
          y: 100 + Math.floor(i / 3) * 260,
        },
        data: {
          title: item.title,
          content: item.content,
          tags: item.tags ?? [],
          learningMode: item.learningMode ?? "deep",
          cardType: item.cardType ?? "general",
          favorite: item.favorite ?? false,
          width: 280,
          ...(item.color ? { color: item.color } : {}),
        },
      };
      idByIndex.set(i, id);
      createdNodes.push(node);
    });

    // 2. 解析引用（批次 id/索引 → 已有节点 id）
    const resolveRef = (ref: string): string | null => {
      const trimmed = ref.trim();
      if (existingIds.has(trimmed) || idByIndex.has(Number(trimmed))) {
        return trimmed;
      }
      const byIndex = idByIndex.get(Number(trimmed));
      if (byIndex) return byIndex;
      return null;
    };

    // 3. 创建连线（校验两端节点均存在）
    const createdEdges: CanvasEdge[] = [];
    const invalidRelations: string[] = [];
    relations.forEach((rel, i) => {
      const source = resolveRef(rel.source);
      const target = resolveRef(rel.target);
      if (!source || !target) {
        invalidRelations.push(rel.label || `#${i} (${rel.source}→${rel.target})`);
        return;
      }
      const edgeId = `edge-${ts}-${i}`;
      createdEdges.push({
        id: edgeId,
        source,
        target,
        type: "freeEdge",
        data: { label: rel.label ?? "" },
      });
    });

    // 4. 合并保存
    layout.nodes.push(...createdNodes);
    layout.edges.push(...createdEdges);
    await saveLayout(layout);

    logger.info("批量创建卡片", {
      created: createdNodes.length,
      skipped: skipped.length,
      edges: createdEdges.length,
      invalidRelations: invalidRelations.length,
    });

    return NextResponse.json({
      ok: true,
      created: createdNodes,
      skipped,
      edges: createdEdges,
      invalidRelations,
      canvas: { nodes: layout.nodes, edges: layout.edges, tags: layout.tags },
    });
  } catch (err) {
    return errorResponse(logger, "批量创建卡片失败", err);
  }
}
