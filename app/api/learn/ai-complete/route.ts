/**
 * POST /api/learn/ai-complete
 *
 * 使用 AI 智能补全单词/短语卡片的缺失字段。
 *
 * 请求体：
 *   { cardIds: string[] }  - 需要补全的卡片 ID 列表
 *   { cardId: string }     - 单个卡片 ID（二选一）
 *
 * 流程：
 *   1. 查询指定卡片，确定缺失字段
 *   2. 对每张卡片，调用 AI 生成缺失数据（音标/词性/释义/例句等）
 *   3. 更新卡片到数据库
 *   4. 返回补全结果
 */
import { NextRequest, NextResponse } from "next/server";
import { getAIProvider } from "@/lib/ai";
import { prisma } from "@/lib/db/prisma";
import { getLogger } from "@/lib/utils/logger";
import { errorResponse } from "@/lib/utils/http-error";

const logger = getLogger("AICompleteAPI");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** AI 补全提示词模板 */
function buildCompletionPrompt(
  word: string,
  type: string,
  missingFields: string[]
): string {
  const fieldDescriptions: Record<string, string> = {
    phonetic: "phonetic: 音标（如 /əˈlɑːrm/）",
    partOfSpeech: "partOfSpeech: 词性（如 n. / v. / adj.）",
    meanings:
      "meanings: 中文释义数组（如 [\"闹钟\", \"警报\"]，至少 1 个）",
    sentences:
      "sentences: 例句数组，每项含 en（英文）和 zh（中文翻译），至少 2 个",
    relatedWords: "relatedWords: 相关单词数组（如 [\"alert\", \"warning\"]）",
    synonyms: "synonyms: 同义词数组",
    wordRoot: "wordRoot: 词根信息（如 'alarm = 警报'）",
  };

  const fieldsToFill = missingFields
    .map((f) => fieldDescriptions[f] || f)
    .join("\n");

  return `你是英语词汇专家。请为单词/短语 "${word}"（类型：${type}）补全以下缺失字段。

只返回 JSON 对象，不要其他文字。格式：
{
${fieldsToFill}
}

要求：
- 音标使用 IPA 格式
- 释义为中文，支持多释义
- 例句要自然、常用，含中文翻译
- 同义词和相关单词为英文`;

}

/** 解析 AI 返回的 JSON（容错处理） */
function parseAIResponse(text: string): Record<string, unknown> | null {
  // 尝试提取 JSON 对象
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** 将 AI 返回的字段转换为数据库更新数据 */
function buildUpdateData(
  aiResult: Record<string, unknown>,
  missingFields: string[]
): Record<string, string> {
  const data: Record<string, string> = {};

  for (const field of missingFields) {
    const value = aiResult[field];
    if (value === undefined || value === null) continue;

    if (field === "phonetic" || field === "partOfSpeech" || field === "wordRoot") {
      // 字符串字段
      if (typeof value === "string" && value.trim()) {
        data[field] = value.trim();
      }
    } else if (field === "meanings" || field === "sentences" ||
               field === "relatedWords" || field === "synonyms") {
      // JSON 数组字段
      if (Array.isArray(value) && value.length > 0) {
        data[field] = JSON.stringify(value);
      } else if (typeof value === "string") {
        // 尝试解析为 JSON，失败则包装为数组
        try {
          JSON.parse(value);
          data[field] = value;
        } catch {
          data[field] = JSON.stringify([value]);
        }
      }
    }
  }

  return data;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const cardIds: string[] = body.cardIds || (body.cardId ? [body.cardId] : []);

    if (cardIds.length === 0) {
      return NextResponse.json({ error: "请提供 cardIds" }, { status: 400 });
    }

    // 限制单次补全数量，避免 API 调用过多
    if (cardIds.length > 20) {
      return NextResponse.json(
        { error: "单次最多补全 20 张卡片" },
        { status: 400 }
      );
    }

    // 查询卡片
    const cards = await prisma.card.findMany({
      where: { id: { in: cardIds }, type: { in: ["word", "phrase"] } },
    });

    if (cards.length === 0) {
      return NextResponse.json({ error: "未找到可补全的单词/短语卡片" }, { status: 404 });
    }

    const provider = getAIProvider();
    const results: Array<{ id: string; title: string; completed: boolean; fields: string[] }> = [];

    // 逐张卡片补全（避免并发 API 调用过载）
    for (const card of cards) {
      // 确定缺失字段
      const missingFields: string[] = [];
      if (!card.phonetic) missingFields.push("phonetic");
      if (!card.partOfSpeech) missingFields.push("partOfSpeech");

      if (!card.meanings || card.meanings === "[]") {
        missingFields.push("meanings");
      }
      if (!card.sentences || card.sentences === "[]") {
        missingFields.push("sentences");
      }
      if (!card.relatedWords || card.relatedWords === "[]") {
        missingFields.push("relatedWords");
      }
      if (!card.synonyms || card.synonyms === "[]") {
        missingFields.push("synonyms");
      }
      if (!card.wordRoot) {
        missingFields.push("wordRoot");
      }

      if (missingFields.length === 0) {
        results.push({
          id: card.id,
          title: card.title,
          completed: true,
          fields: [],
        });
        continue;
      }

      try {
        // 调用 AI 补全
        const prompt = buildCompletionPrompt(card.title, card.type, missingFields);
        const messages = [
          { role: "system" as const, content: "你是英语词汇专家，擅长提供单词的音标、释义、例句等信息。只输出 JSON。" },
          { role: "user" as const, content: prompt },
        ];

        let fullText = "";
        for await (const chunk of provider.chat(messages, { temperature: 0.3, maxTokens: 1024 })) {
          fullText += chunk;
        }

        const aiResult = parseAIResponse(fullText);
        if (!aiResult) {
          logger.warn("AI 返回格式异常", { cardId: card.id, title: card.title });
          results.push({
            id: card.id,
            title: card.title,
            completed: false,
            fields: [],
          });
          continue;
        }

        // 构建更新数据
        const updateData = buildUpdateData(aiResult, missingFields);
        if (Object.keys(updateData).length === 0) {
          results.push({
            id: card.id,
            title: card.title,
            completed: false,
            fields: [],
          });
          continue;
        }

        // 更新数据库
        await prisma.card.update({
          where: { id: card.id },
          data: updateData,
        });

        results.push({
          id: card.id,
          title: card.title,
          completed: true,
          fields: Object.keys(updateData),
        });

        logger.info("AI 补全成功", {
          cardId: card.id,
          title: card.title,
          fields: Object.keys(updateData),
        });
      } catch (err) {
        logger.error("AI 补全失败", {
          cardId: card.id,
          title: card.title,
          error: String(err),
        });
        results.push({
          id: card.id,
          title: card.title,
          completed: false,
          fields: [],
        });
      }
    }

    const successCount = results.filter((r) => r.completed).length;
    logger.info("AI 补全批次完成", {
      total: results.length,
      success: successCount,
    });

    return NextResponse.json({
      success: true,
      total: results.length,
      completed: successCount,
      results,
    });
  } catch (err) {
      return errorResponse(logger, "AI 补全接口失败", err);
  }
}
