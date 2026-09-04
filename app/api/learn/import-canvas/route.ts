/**
 * 画布数据直接导入到单词学习系统
 *
 * POST /api/learn/import-canvas
 * Body: { canvas: CanvasState, packName?: string, subjectId?: string }
 *
 * 处理流程：
 * 1. 创建 ImportPack（rawConfig 完整保存画布 JSON，禁止删除）
 * 2. 遍历画布节点：创建 Card(type=word) + WordProfile + ImportLayout
 * 3. 遍历画布边：创建 WordRelation(type="soft_layout") 作为衍生关系
 * 4. 返回导入结果
 *
 * 关键约束：
 * - 原始画布数据完整保存到 ImportPack.rawConfig 和 ImportLayout.rawItem
 * - 画布连线 → WordRelation（衍生关系/软相关性）
 * - 卡片标签 → ImportLayout.hierarchyTags（层级分类）
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getLearnUserId } from "@/lib/learning/auth";
import {
  extractNodeData,
  parseContentToLearnData,
  isWordLikeNode,
} from "@/lib/cards/export-adapters";
import { getLogger } from "@/lib/utils/logger";
import { errorResponse } from "@/lib/utils/http-error";
import { z } from "zod";
import type { CanvasState } from "@/lib/hooks/use-local-storage";

const logger = getLogger("ImportCanvasAPI");

/** 请求体类型 */
interface ImportCanvasRequest {
  canvas: CanvasState;
  packName?: string;
  subjectId?: string;
}

/**
 * 画布节点/边的最小结构校验（zod）。
 * 只校验导入链路实际使用的字段，避免耦合 ReactFlow 完整类型。
 */
const CanvasNodeSchema = z.object({
  id: z.string().min(1),
  position: z
    .object({ x: z.number(), y: z.number() })
    .partial()
    .default({}),
  data: z
    .object({
      title: z.string().optional(),
      content: z.string().optional(),
      tags: z.array(z.string()).optional(),
      favorite: z.boolean().optional(),
    })
    .default({}),
});

const CanvasEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
});

const ImportCanvasBodySchema = z.object({
  canvas: z.object({
    nodes: z.array(CanvasNodeSchema).default([]),
    edges: z.array(CanvasEdgeSchema).default([]),
  }),
  packName: z.string().max(200).optional(),
  subjectId: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const raw = await request.json();
    const parsed = ImportCanvasBodySchema.safeParse(raw);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "画布数据格式不正确",
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 400 }
      );
    }

    const body = parsed.data as ImportCanvasRequest;
    const canvas = body.canvas as CanvasState;

    const userId = await getLearnUserId();
    const packName = body.packName || `canvas-${Date.now()}`;

    // 确保有 english subject（若未指定）
    let subjectId = body.subjectId;
    if (!subjectId) {
      const subject = await prisma.subject.upsert({
        where: { slug: "english" },
        update: {},
        create: {
          name: "英语",
          slug: "english",
          icon: "BookOpen",
          color: "#3b82f6",
          order: 1,
        },
      });
      subjectId = subject.id;
    }

    // 1. 创建 ImportPack（完整保存原始画布 JSON）
    const pack = await prisma.importPack.create({
      data: {
        name: packName,
        description: `从画布导入（${new Date().toLocaleString("zh-CN")}），${canvas.nodes.length} 个节点，${canvas.edges.length} 条连线`,
        packType: "canvas_export",
        rawConfig: JSON.stringify(canvas), // 完整保存画布数据（禁止删除）
        fileCount: 1,
        wordCount: canvas.nodes.filter((n) =>
          isWordLikeNode(extractNodeData(n.data))
        ).length,
      },
    });

    let imported = 0;
    let skipped = 0;
    let relationCount = 0;

    // 预解析节点数据（事务外，解析失败仅跳过该节点，不阻断整体导入）
    const prepared = new Map<
      string,
      {
        rawNode: unknown;
        position: { x: number; y: number } | undefined;
        data: ReturnType<typeof extractNodeData>;
        isWord: boolean;
        mean: string[];
        sentence: unknown[];
      }
    >();
    for (const node of canvas.nodes) {
      try {
        const data = extractNodeData(node.data);
        const isWord = isWordLikeNode(data);
        const { mean, sentence } = parseContentToLearnData(data.content);
        prepared.set(node.id, {
          rawNode: node,
          position: node.position,
          data,
          isWord,
          mean,
          sentence,
        });
      } catch (err) {
        logger.error(`节点 ${node.id} 数据解析失败`, { error: String(err) });
        skipped++;
      }
    }

    // 节点 ID 映射：画布节点 ID → 数据库 Card ID
    const nodeIdMap = new Map<string, string>();

    // 2+3. 单事务内创建 Card + WordProfile + ImportLayout + WordRelation
    // 性能：显式事务将数百次独立写合并为一次提交（SQLite 下减少大量 fsync）
    // 数据已预解析，事务内创建失败视为异常整体回滚，避免部分导入的脏状态
    await prisma.$transaction(async (tx) => {
      for (const [nodeId, item] of prepared) {
        const { rawNode, position, data, isWord, mean, sentence } = item;

        // 创建 Card
        const card = await tx.card.create({
          data: {
            title: data.title,
            content: data.content || `# ${data.title}`,
            type: isWord ? "word" : "concept",
            subjectId,
            difficulty: 2,
            status: "new",
            source: "imported",
            metadata: JSON.stringify({
              importedFrom: "canvas",
              canvasNodeId: nodeId,
              canvasPosition: position,
              tags: data.tags,
              favorite: data.favorite,
            }),
            userId,
            // 英语专属字段（仅单词类卡片填充）
            meanings: isWord ? JSON.stringify(mean) : "[]",
            sentences: isWord ? JSON.stringify(sentence) : "[]",
          },
        });

        nodeIdMap.set(nodeId, card.id);

        // 创建 WordProfile（仅 word/phrase 类型）
        if (isWord) {
          await tx.wordProfile.create({
            data: {
              cardId: card.id,
              length: data.title.replace(/\s/g, "").length,
              commonness: 0.5,
            },
          });
        }

        // 创建 ImportLayout（保留原始布局作为软相关性）
        await tx.importLayout.create({
          data: {
            packId: pack.id,
            cardId: card.id,
            fileName: data.tags.length > 0 ? data.tags[0] : "canvas",
            fileType: isWord ? "word" : "concept",
            itemOrder: imported, // 按导入顺序
            hierarchyTags: JSON.stringify(
              data.tags.length > 0 ? data.tags : ["画布导入"]
            ),
            rawItem: JSON.stringify(rawNode), // 完整保存原始节点（禁止删除）
          },
        });

        imported++;
      }

      // 遍历画布边，创建 WordRelation（衍生关系）
      for (const edge of canvas.edges) {
        const fromCardId = nodeIdMap.get(edge.source);
        const toCardId = nodeIdMap.get(edge.target);

        if (!fromCardId || !toCardId || fromCardId === toCardId) continue;

        // 规范化 ID 顺序，避免重复
        const [a, b] =
          fromCardId < toCardId
            ? [fromCardId, toCardId]
            : [toCardId, fromCardId];

        await tx.wordRelation.upsert({
          where: {
            fromCardId_toCardId_type: {
              fromCardId: a,
              toCardId: b,
              type: "soft_layout",
            },
          },
          update: {
            weight: 0.8, // 画布连线的衍生权重
            evidence: JSON.stringify({
              source: "canvas_edge",
              canvasEdgeId: edge.id,
              direction: { from: edge.source, to: edge.target },
            }),
          },
          create: {
            fromCardId: a,
            toCardId: b,
            type: "soft_layout",
            weight: 0.8,
            evidence: JSON.stringify({
              source: "canvas_edge",
              canvasEdgeId: edge.id,
              direction: { from: edge.source, to: edge.target },
            }),
          },
        });
        relationCount++;
      }
    });

    return NextResponse.json({
      success: true,
      packId: pack.id,
      packName,
      imported,
      skipped,
      relations: relationCount,
      message: `已导入 ${imported} 个卡片（其中单词 ${canvas.nodes.filter((n) => isWordLikeNode(extractNodeData(n.data))).length} 个），建立 ${relationCount} 条衍生关系`,
    });
  } catch (error) {
    return errorResponse(logger, "画布导入失败", error);
  }
}
