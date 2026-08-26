/**
 * GET /api/learn/check-missing
 *
 * 检查单词/短语卡片的缺失字段，用于导入后提示 AI 智能补全。
 *
 * 查询参数：
 *   - cardIds: 逗号分隔的卡片 ID 列表（可选，不传则检查所有 word/phrase 卡片）
 *   - limit: 返回上限（默认 50）
 *
 * 返回：
 *   { total, missing: [{ id, title, missingFields: ["phonetic","sentences",...] }] }
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getLogger } from "@/lib/utils/logger";
import { errorResponse } from "@/lib/utils/http-error";

const logger = getLogger("CheckMissingAPI");

// 该路由需读取查询参数并查询数据库，强制动态渲染，避免 Next.js 静态预渲染失败
export const dynamic = "force-dynamic";

/** 检查单个卡片的缺失字段 */
function checkCardMissingFields(card: {
  id: string;
  title: string;
  type: string;
  phonetic: string | null;
  partOfSpeech: string | null;
  meanings: string | null;
  sentences: string | null;
  relatedWords: string | null;
  synonyms: string | null;
  wordRoot: string | null;
}): string[] {
  const missing: string[] = [];

  // 仅检查 word/phrase 类型
  if (card.type !== "word" && card.type !== "phrase") {
    return missing;
  }

  // 音标缺失
  if (!card.phonetic) missing.push("phonetic");

  // 词性缺失
  if (!card.partOfSpeech) missing.push("partOfSpeech");

  // 释义缺失或为空数组
  if (!card.meanings) {
    missing.push("meanings");
  } else {
    try {
      const arr = JSON.parse(card.meanings);
      if (!Array.isArray(arr) || arr.length === 0) missing.push("meanings");
    } catch {
      missing.push("meanings");
    }
  }

  // 例句缺失或为空数组
  if (!card.sentences) {
    missing.push("sentences");
  } else {
    try {
      const arr = JSON.parse(card.sentences);
      if (!Array.isArray(arr) || arr.length === 0) missing.push("sentences");
    } catch {
      missing.push("sentences");
    }
  }

  return missing;
}

export async function GET(request: NextRequest) {
  try {
    // 使用 nextUrl.searchParams 避免在静态分析时触发 request.url 动态检测
    const cardIdsParam = request.nextUrl.searchParams.get("cardIds");
    const limit = Math.min(
      parseInt(request.nextUrl.searchParams.get("limit") || "50", 10),
      200
    );

    // 构建查询条件
    const where = cardIdsParam
      ? { id: { in: cardIdsParam.split(",") }, type: { in: ["word", "phrase"] } }
      : { type: { in: ["word", "phrase"] } };

    const cards = await prisma.card.findMany({
      where,
      select: {
        id: true,
        title: true,
        type: true,
        phonetic: true,
        partOfSpeech: true,
        meanings: true,
        sentences: true,
        relatedWords: true,
        synonyms: true,
        wordRoot: true,
      },
      take: limit,
    });

    // 检查每张卡片的缺失字段
    const missing = cards
      .map((c) => ({
        id: c.id,
        title: c.title,
        missingFields: checkCardMissingFields(c),
      }))
      .filter((c) => c.missingFields.length > 0);

    logger.info("缺失字段检查完成", {
      total: cards.length,
      missingCount: missing.length,
    });

    return NextResponse.json({
      total: cards.length,
      missingCount: missing.length,
      missing,
    });
  } catch (err) {
      return errorResponse(logger, "缺失字段检查失败", err);
  }
}
