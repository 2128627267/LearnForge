/**
 * POST /api/ai/qa
 *
 * AI 问答对话 API（流式响应）
 *
 * 特性：
 *   1. 读取激活的 ProjectMemory 条目（优先从内存缓存读取），注入系统提示词
 *   2. 创建/复用 QAConversation 会话
 *   3. 保存用户消息到 QAMessage
 *   4. 使用 AI Provider 流式返回回答
 *   5. 流结束后保存 AI 回复
 *   6. 异步触摸已用记忆的 lastUsedAt（LRU）
 *
 * 优化说明：
 *   - 使用内存缓存层（lib/ai/memory-cache）减少数据库查询
 *   - 按 scope 分组注入记忆（stats/canvas/english/learn/global）
 *   - 系统自动记忆提供各模块数据概览，用户记忆提供个性化偏好
 *
 * 请求体：
 *   { message: string, conversationId?: string }
 *
 * 响应：
 *   - 流式文本（text/plain）
 *   - Header: X-Conversation-Id 返回会话 ID
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveChatProvider } from "@/lib/ai";
import { buildQASystemPrompt } from "@/lib/ai/prompts";
import { getActiveMemories, touchMemories } from "@/lib/ai/memory-cache";
import { prisma } from "@/lib/db/prisma";
import { getLogger } from "@/lib/utils/logger";
import { errorResponse } from "@/lib/utils/http-error";

const logger = getLogger("AI-QA");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { message, conversationId, modelId, cardTitle, cardContent, history } =
      await request.json();

    // 参数校验
    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "请提供问题内容" },
        { status: 400 }
      );
    }

    logger.info("AI 问答请求", {
      messageLength: message.length,
      conversationId,
    });

    // ===== 1. 读取激活的项目记忆（从内存缓存，按优先级降序）=====
    const activeMemories = await getActiveMemories();

    // ===== 1.5 注入当前卡片上下文（对话框内针对卡片提问）=====
    const cardContextText =
      cardTitle || cardContent
        ? `\n\n---\n\n## 当前学习的卡片\n\n标题：${cardTitle || ""}\n内容：\n${cardContent || ""}\n\n请优先围绕这张卡片回答，帮助我理解、记忆或扩展其中的知识。\n\n---\n`
        : "";

    const systemPrompt =
      buildQASystemPrompt(
        activeMemories.map((m) => ({
          title: m.title,
          content: m.content,
          type: m.type,
          scope: m.scope,
          source: m.source,
        }))
      ) + cardContextText;

    // ===== 2. 创建或复用会话 =====
    let conversation = conversationId
      ? await prisma.qAConversation.findUnique({ where: { id: conversationId } })
      : null;

    if (!conversation) {
      // 新会话时快照当前激活的记忆 ID 列表
      const memorySnapshot = JSON.stringify(
        activeMemories.map((m) => ({ id: m.id, title: m.title, scope: m.scope }))
      );
      conversation = await prisma.qAConversation.create({
        data: {
          title: message.slice(0, 50),
          memorySnapshot,
        },
      });
    }

    // ===== 3. 保存用户消息 =====
    const memoryIds = activeMemories.map((m) => m.id);
    await prisma.qAMessage.create({
      data: {
        conversationId: conversation.id,
        role: "user",
        content: message,
        memoryUsed: JSON.stringify(memoryIds),
      },
    });

    // ===== 5. 构建 AI 消息列表 =====
    const { provider } = await resolveChatProvider(modelId);
    const historyMessages: { role: "user" | "assistant"; content: string }[] =
      Array.isArray(history)
        ? history
            .slice(-20)
            .filter(
              (m: { role?: string; content?: unknown }) =>
                (m?.role === "user" || m?.role === "assistant") &&
                typeof m?.content === "string" &&
                m.content.length > 0
            )
            .map((m: { role?: string; content?: string }) => ({
              role: m.role === "assistant" ? "assistant" : "user",
              // 单条历史长度上限 4000 字符，防止注入超长上下文
              content: (m.content ?? "").slice(0, 4000),
            }))
        : [];

    const messages = [
      { role: "system" as const, content: systemPrompt },
      ...historyMessages,
      { role: "user" as const, content: message },
    ];

    // ===== 6. 流式响应 =====
    const stream = provider.chat(messages, { temperature: 0.7 });

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

          // ===== 7. 保存 AI 回复 =====
          await prisma.qAMessage.create({
            data: {
              conversationId: conversation!.id,
              role: "assistant",
              content: fullContent,
            },
          });

          // 更新会话消息计数
          await prisma.qAConversation.update({
            where: { id: conversation!.id },
            data: { messageCount: { increment: 2 } }, // 用户+AI 各一条
          });

          // 异步触摸已用记忆的 lastUsedAt（不阻塞响应，支持 LRU）
          await touchMemories(memoryIds);

          logger.info("AI 问答完成", {
            conversationId: conversation!.id,
            responseLength: fullContent.length,
            memoriesUsed: activeMemories.length,
            scopes: Array.from(new Set(activeMemories.map((m) => m.scope))),
          });
        } catch (err) {
          logger.error("AI 问答流式失败", { error: String(err) });
          controller.error(err);
        }
      },
    });

    // 通过 Header 返回会话 ID
    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
        "X-Conversation-Id": conversation.id,
      },
    });
  } catch (err) {
      return errorResponse(logger, "AI 问答失败", err);
  }
}
