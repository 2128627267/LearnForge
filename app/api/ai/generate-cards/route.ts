/**
 * AI 卡片生成 API（流式）
 * POST /api/ai/generate-cards
 *
 * 接收用户输入的文本，调用 AI 提取知识点并生成结构化卡片
 * 返回流式响应，最终输出 JSON 格式的卡片数组
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveChatProvider } from "@/lib/ai";
import { Prompts } from "@/lib/ai";
import { getLogger } from "@/lib/utils/logger";

const logger = getLogger("AI-GenerateCards");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 流式生成卡片
 * 使用 AI 从文本提取知识点，返回 JSON 数组
 */
export async function POST(request: NextRequest) {
  try {
    const { text, hint, modelId } = await request.json();

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return NextResponse.json(
        { error: "请提供待提取的文本内容" },
        { status: 400 }
      );
    }

    logger.info("AI 卡片生成请求", { textLength: text.length, hint });

    const { provider } = await resolveChatProvider(modelId);
    const userPrompt = hint
      ? `学习资料类型提示：${hint}\n\n请从以下文本中提取知识点卡片：\n\n${text}`
      : `请从以下文本中提取知识点卡片：\n\n${text}`;

    const stream = provider.chat(
      [
        { role: "system", content: Prompts.CARD_EXTRACTION_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.3, jsonMode: true }
    );

    // 转换为标准 SSE 流
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        } catch (err) {
          logger.error("AI 流式生成失败", { error: String(err) });
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
    logger.error("AI 卡片生成失败", { error: String(err) });
    return NextResponse.json(
      { error: "AI 生成失败", detail: String(err) },
      { status: 500 }
    );
  }
}
