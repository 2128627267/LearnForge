/**
 * AI 数学解题对话 API（流式）
 * POST /api/ai/math-solve
 *
 * 接收数学题目，AI 分步解题 + 知识点关联，支持追问
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveChatProvider } from "@/lib/ai";
import { Prompts } from "@/lib/ai";
import { prisma } from "@/lib/db/prisma";
import { getLogger } from "@/lib/utils/logger";
import { errorResponse } from "@/lib/utils/http-error";

const logger = getLogger("AI-MathSolve");
const TEMP_USER_ID = "dev-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { problem, conversationId, cardId, modelId } = await request.json();

    if (!problem || typeof problem !== "string") {
      return NextResponse.json(
        { error: "请提供数学题目" },
        { status: 400 }
      );
    }

    logger.info("AI 数学解题请求", { problemLength: problem.length, conversationId });

    // 创建或复用对话会话
    let conversation = conversationId
      ? await prisma.aIConversation.findUnique({ where: { id: conversationId } })
      : null;

    if (!conversation) {
      conversation = await prisma.aIConversation.create({
        data: {
          userId: TEMP_USER_ID,
          cardId: cardId || null,
          type: "math_solve",
          title: problem.slice(0, 50),
        },
      });
    }

    // 保存用户消息
    await prisma.aIMessage.create({
      data: {
        conversationId: conversation.id,
        role: "user",
        content: problem,
      },
    });

    // 获取历史消息构建上下文
    const history = await prisma.aIMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
      take: 20,
    });

    const { provider } = await resolveChatProvider(modelId);
    const messages = [
      { role: "system" as const, content: Prompts.MATH_SOLVE_SYSTEM },
      ...history.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    const stream = provider.chat(messages, { temperature: 0.5 });

    // 流式响应 + 收集完整内容用于保存
    const encoder = new TextEncoder();
    let fullContent = "";

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            fullContent += chunk;
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();

          // 保存 AI 回复
          await prisma.aIMessage.create({
            data: {
              conversationId: conversation!.id,
              role: "assistant",
              content: fullContent,
            },
          });
        } catch (err) {
          logger.error("AI 数学解题流式失败", { error: String(err) });
          controller.error(err);
        }
      },
    });

    // 通过 Header 返回 conversationId
    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
        "X-Conversation-Id": conversation.id,
      },
    });
  } catch (err) {
      return errorResponse(logger, "AI 数学解题失败", err);
  }
}
