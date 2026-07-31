/**
 * AI 复式学习转化 API（流式）
 * POST /api/ai/to-review-list
 *
 * 接收画布选中卡片，AI 分析内容并提炼为复式学习可用的结构化条目
 * （单词/句子），前端预览确认后复用 /api/learn/import-canvas 导入学习系统。
 *
 * 请求体：
 *   { cards: [{ id, title, content }], modelId?: string }
 *
 * 响应：
 *   - 流式 JSON 数组（text/plain）
 *     [{ kind: "word", title, phonetic?, partOfSpeech?, meanings[], sentences[], ... }]
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveChatProvider } from "@/lib/ai";
import { getLogger } from "@/lib/utils/logger";

const logger = getLogger("AI-ToReviewList");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 转化系统提示词：将知识内容提炼为记忆单元（单词/句子） */
const TO_REVIEW_LIST_SYSTEM = `你是一个学习内容转化助手，擅长把知识卡片内容提炼为适合测验与复习的记忆单元。

任务：分析给定的卡片内容，提取可用来做"复式学习"（测验+推荐+复习）的条目，输出 JSON 数组。

条目类型由内容性质决定：
- kind: "word"（英语单词/短语）→ 字段：title(单词), phonetic(音标), partOfSpeech(词性), meanings(释义数组), sentences(例句数组，含中文翻译)
- kind: "sentence"（重点句子/公式/定义）→ 字段：title(句子或要点原文), translation(中文翻译/含义), keyPoints(记忆要点数组)

要求：
1. 卡片内容是中文知识则提炼为 sentence（定义/公式/要点）
2. 卡片内容是英文单词则提炼为 word
3. 每条目内容必须能从原文中找到依据，不要编造
4. 只输出 JSON 数组，不要其他文字

格式：
[{"kind":"word","title":"...","phonetic":"...","partOfSpeech":"...","meanings":["..."],"sentences":["..."]}]`;

export async function POST(request: NextRequest) {
  try {
    const { cards, modelId } = await request.json();

    if (!Array.isArray(cards) || cards.length === 0) {
      return NextResponse.json(
        { error: "请提供要转化的卡片内容" },
        { status: 400 }
      );
    }

    logger.info("AI 复式学习转化请求", { cardCount: cards.length });

    const { provider } = await resolveChatProvider(modelId);

    const cardText = cards
      .map(
        (c: { title: string; content: string }, i: number) =>
          `卡片 ${i + 1}：${c.title}\n${c.content || ""}`
      )
      .join("\n\n---\n\n");

    const stream = provider.chat(
      [
        { role: "system", content: TO_REVIEW_LIST_SYSTEM },
        {
          role: "user",
          content: `请将以下卡片内容转化为复式学习条目：\n\n${cardText}`,
        },
      ],
      { temperature: 0.3, jsonMode: true }
    );

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        } catch (err) {
          logger.error("AI 复式学习转化流式失败", { error: String(err) });
          controller.error(err);
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    logger.error("AI 复式学习转化失败", { error: String(err) });
    return NextResponse.json(
      { error: "AI 转化失败", detail: String(err) },
      { status: 500 }
    );
  }
}
