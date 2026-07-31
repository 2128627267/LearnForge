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
import type { CanvasState } from "@/lib/hooks/use-local-storage";

/** 请求体类型 */
interface ImportCanvasRequest {
  canvas: CanvasState;
  packName?: string;
  subjectId?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ImportCanvasRequest;

    // 参数校验
    if (!body.canvas?.nodes || !Array.isArray(body.canvas.nodes)) {
      return NextResponse.json(
        { error: "画布数据格式不正确：缺少 nodes 数组" },
        { status: 400 }
      );
    }

    const userId = await getLearnUserId();
    const packName = body.packName || `canvas-${Date.now()}`;
    const canvas = body.canvas;

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

    // 节点 ID 映射：画布节点 ID → 数据库 Card ID
    const nodeIdMap = new Map<string, string>();

    // 2. 遍历画布节点，创建 Card + WordProfile + ImportLayout
    for (const node of canvas.nodes) {
      const data = extractNodeData(node.data);
      const isWord = isWordLikeNode(data);

      try {
        // 从 content 解析释义/例句
        const { mean, sentence } = parseContentToLearnData(data.content);

        // 创建 Card
        const card = await prisma.card.create({
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
              canvasNodeId: node.id,
              canvasPosition: node.position,
              tags: data.tags,
              favorite: data.favorite,
            }),
            userId,
            // 英语专属字段（仅单词类卡片填充）
            meanings: isWord ? JSON.stringify(mean) : "[]",
            sentences: isWord ? JSON.stringify(sentence) : "[]",
          },
        });

        nodeIdMap.set(node.id, card.id);

        // 创建 WordProfile（仅 word/phrase 类型）
        if (isWord) {
          await prisma.wordProfile.create({
            data: {
              cardId: card.id,
              length: data.title.replace(/\s/g, "").length,
              commonness: 0.5,
            },
          });
        }

        // 创建 ImportLayout（保留原始布局作为软相关性）
        await prisma.importLayout.create({
          data: {
            packId: pack.id,
            cardId: card.id,
            fileName: data.tags.length > 0 ? data.tags[0] : "canvas",
            fileType: isWord ? "word" : "concept",
            itemOrder: imported, // 按导入顺序
            hierarchyTags: JSON.stringify(
              data.tags.length > 0 ? data.tags : ["画布导入"]
            ),
            rawItem: JSON.stringify(node), // 完整保存原始节点（禁止删除）
          },
        });

        imported++;
      } catch (err) {
        console.error(`[import-canvas] 节点 ${node.id} 导入失败:`, err);
        skipped++;
      }
    }

    // 3. 遍历画布边，创建 WordRelation（衍生关系）
    for (const edge of canvas.edges) {
      const fromCardId = nodeIdMap.get(edge.source);
      const toCardId = nodeIdMap.get(edge.target);

      if (!fromCardId || !toCardId || fromCardId === toCardId) continue;

      try {
        // 规范化 ID 顺序，避免重复
        const [a, b] =
          fromCardId < toCardId
            ? [fromCardId, toCardId]
            : [toCardId, fromCardId];

        await prisma.wordRelation.upsert({
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
      } catch (err) {
        console.error(`[import-canvas] 连线 ${edge.id} 创建关系失败:`, err);
      }
    }

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
    console.error("[import-canvas] 导入失败:", error);
    return NextResponse.json(
      {
        error: "画布导入失败",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
