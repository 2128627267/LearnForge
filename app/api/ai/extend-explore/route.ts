/**
 * AI 延展探索 API（流式）
 * POST /api/ai/extend-explore
 *
 * 从基础知识点出发，AI 推荐进阶内容与应用场景
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveChatProvider } from "@/lib/ai";
import { Prompts } from "@/lib/ai";
import { getLogger } from "@/lib/utils/logger";

const logger = getLogger("AI-ExtendExplore");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { topic, context, modelId } = await request.json();

    if (!topic || typeof topic !== "string") {
      return NextResponse.json(
        { error: "请提供知识点主题" },
        { status: 400 }
      );
    }

    logger.info("AI 延展探索请求", { topic });

    const { provider } = await resolveChatProvider(modelId);
    const userPrompt = context
      ? `知识点：${topic}\n背景信息：${context}\n\n请推荐进阶内容与应用场景。`
      : `知识点：${topic}\n\n请推荐进阶内容与应用场景。`;

    const stream = provider.chat(
      [
        { role: "system", content: Prompts.EXTEND_EXPLORE_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.7, jsonMode: true }
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
          logger.error("AI 延展探索流式失败", { error: String(err) });
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
    logger.error("AI 延展探索失败", { error: String(err) });
    return NextResponse.json(
      { error: "AI 探索失败", detail: String(err) },
      { status: 500 }
    );
  }
}
