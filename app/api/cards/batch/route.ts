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
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { getLogger } from "@/lib/utils/logger";
import { errorResponse } from "@/lib/utils/http-error";
import {
  appendChangeLog,
  snapshotCurrentLayout,
} from "@/lib/sync/server-ops";
import { authorizePluginCall } from "@/lib/plugins/permissions";

const logger = getLogger("CardsBatchAPI");

export const dynamic = "force-dynamic";

const CANVAS_LAYOUT_ID = "default";

/** 数据库客户端类型：全局单例或交互式事务客户端 */
type DbClient = Prisma.TransactionClient | typeof prisma;

/**
 * 并发写入冲突信号（审查 S1）：
 * 事务内条件写入未命中（version 已被并发请求推进）时抛出，
 * 外层捕获后基于最新数据重新计算追加内容并重试。
 */
class ConcurrentWriteError extends Error {
  constructor() {
    super("concurrent write detected");
    this.name = "ConcurrentWriteError";
  }
}

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
  // G4 修复（审查）：relations 与 items 上限对齐——失控的 AI/Agent
  // 可单次提交数万条 relation，海量边写入会拖垮 SQLite 与快照备份
  relations: z.array(RelationSchema).max(500).default([]),
});

/** 读取画布布局（不存在时返回空） */
async function loadLayout(tx: DbClient): Promise<CanvasLayout> {
  const layout = await tx.canvasLayout.findUnique({
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

/**
 * 条件原子写入画布布局（审查 S1）：
 * version 基线进 WHERE——写入未命中说明并发请求已抢先提交，
 * 抛 ConcurrentWriteError 由调用方（事务回滚后）基于最新数据重算。
 * 记录不存在时建立初始副本（create 撞并发唯一键同样视为冲突）。
 * @returns 写入后的服务器 revision
 */
async function saveLayout(
  tx: DbClient,
  layout: CanvasLayout
): Promise<number> {
  const current = await tx.canvasLayout.findUnique({
    where: { id: CANVAS_LAYOUT_ID },
  });
  const serialized = JSON.stringify(layout);

  if (!current) {
    // 首次写入：条件 create（唯一键冲突 = 并发已建立 → 重试）
    try {
      await tx.canvasLayout.create({
        data: { id: CANVAS_LAYOUT_ID, data: serialized, version: 1 },
      });
      return 1;
    } catch (err) {
      // create 失败的现实原因是并发请求已抢先建立记录（唯一键冲突）；
      // 其他原因也统一按冲突重试，外层重读后会走 updateMany 路径
      logger.warn("batch 首次写入撞并发，按冲突重试", { error: String(err) });
      throw new ConcurrentWriteError();
    }
  }

  const written = await tx.canvasLayout.updateMany({
    where: { id: CANVAS_LAYOUT_ID, version: current.version },
    data: {
      data: serialized,
      version: { increment: 1 },
      updatedAt: new Date(),
    },
  });
  if (written.count === 0) {
    throw new ConcurrentWriteError();
  }
  return current.version + 1;
}

/** 生成节点 id（前端画布节点同格式） */
function makeNodeId(ts: number, i: number): string {
  return `card-${ts}-${i}`;
}

export async function POST(request: NextRequest) {
  try {
    // 插件身份校验（F5）：带 x-plugin-id 的请求按插件权限作用域执行
    // （本端点必需 cards:write + canvas:write），否则视为 web 用户直连
    const auth = await authorizePluginCall(
      prisma,
      request,
      "POST",
      "/api/cards/batch"
    );
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const auditSource = auth.context?.auditSource ?? "ai-batch";

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

    const ts = Date.now();

    /**
     * S1 修复（审查）：整个"读最新布局 → 计算追加 → 快照 → 条件写入 → 日志"
     * 包进交互式事务；条件写入未命中（并发抢先提交）时事务回滚并整体重试
     * （基于最新数据重算，节点/边 id 生成幂等），最多 MAX_ATTEMPTS 次。
     */
    const MAX_ATTEMPTS = 3;
    let outcome: BatchOutcome | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !outcome; attempt++) {
      try {
        outcome = await prisma.$transaction(async (tx) => {
          const layout = await loadLayout(tx);
          const existingIds = new Set(layout.nodes.map((n) => n.id));

          // 1. 创建节点（冲突 id 跳过创建，仅记录）
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

          // 2. 解析引用（批次 id/索引 → 节点 id）
          // G6 修复（审查）：原实现命中索引时返回索引字符串本身（如 "0"），
          // 产生指向不存在节点的悬空边；正确语义是返回该索引映射到的节点 id
          const resolveRef = (ref: string): string | null => {
            const trimmed = ref.trim();
            if (!trimmed) return null;
            // 优先：引用画布已有节点 id
            if (existingIds.has(trimmed)) return trimmed;
            // 其次：本批次索引（"0"/"1"/…）→ 映射到实际节点 id
            const byIndex = idByIndex.get(Number(trimmed));
            return byIndex ?? null;
          };

          // 3. 创建连线（校验两端节点均存在）
          const createdEdges: CanvasEdge[] = [];
          const invalidRelations: string[] = [];
          relations.forEach((rel, i) => {
            const source = resolveRef(rel.source);
            const target = resolveRef(rel.target);
            if (!source || !target) {
              invalidRelations.push(
                rel.label || `#${i} (${rel.source}→${rel.target})`
              );
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

          // 4. 合并保存（覆盖前快照 + 条件写入 + 变更日志，同事务原子提交）
          layout.nodes.push(...createdNodes);
          layout.edges.push(...createdEdges);
          if (createdNodes.length > 0 || createdEdges.length > 0) {
            await snapshotCurrentLayout("auto", tx);
          }
          const revision = await saveLayout(tx, layout);

          // 变更日志（AI 批量写入通道；插件调用时 source=plugin:<name> 便于审计溯源）
          await appendChangeLog(
            {
              action: "batch-create",
              revision,
              nodeCount: layout.nodes.length,
              edgeCount: layout.edges.length,
              source: auditSource,
              detail: {
                created: createdNodes.length,
                skipped: skipped.length,
                edges: createdEdges.length,
                invalidRelations: invalidRelations.length,
              },
            },
            tx
          );

          return {
            createdNodes,
            skipped,
            createdEdges,
            invalidRelations,
            layout,
            revision,
          };
        });
      } catch (err) {
        if (err instanceof ConcurrentWriteError) {
          // 并发冲突：本轮事务已回滚，进入下一轮基于最新数据重算
          logger.warn("batch 写入撞并发，重试", { attempt });
          continue;
        }
        throw err;
      }
    }

    if (!outcome) {
      // 连续冲突重试耗尽：返回 409 让调用方（AI/Agent）稍后重试
      return NextResponse.json(
        { error: "画布并发写入冲突，请重试" },
        { status: 409 }
      );
    }

    const { createdNodes, skipped, createdEdges, invalidRelations, layout, revision } =
      outcome;

    logger.info("批量创建卡片", {
      created: createdNodes.length,
      skipped: skipped.length,
      edges: createdEdges.length,
      invalidRelations: invalidRelations.length,
      revision,
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

/** batch 事务成功产物（供重试循环传递） */
interface BatchOutcome {
  createdNodes: CanvasNode[];
  skipped: string[];
  createdEdges: CanvasEdge[];
  invalidRelations: string[];
  layout: CanvasLayout;
  revision: number;
}
