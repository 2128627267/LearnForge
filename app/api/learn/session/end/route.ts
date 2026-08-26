/**
 * POST /api/learn/session/end
 *
 * 设计依据：.doc/WORD_LEARNING_DESIGN.md §6.1 / §7
 *
 * 流程：
 *   1. 接收 { sessionId? }（可选，仅用于日志追踪）
 *   2. 调用 getLearnUserId 获取用户
 *   3. 异步触发 scheduler.runIdleTasks(userId)（不 await，fire-and-forget）
 *   4. 立即返回 { ok: true, message: "会话已结束，后台优化已触发" }
 *
 * 关键：后台优化任务不阻塞响应（§1.2 设计原则 4）
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getLearnUserId } from "@/lib/learning/auth";
import { scheduler } from "@/lib/learning/scheduler";
import { getLogger } from "@/lib/utils/logger";
import { errorResponse } from "@/lib/utils/http-error";

const logger = getLogger("SessionEndAPI");

/**
 * 请求体 schema：
 * - sessionId：可选，用于日志追踪
 */
const RequestSchema = z.object({
  sessionId: z.string().optional(),
});

/**
 * POST /api/learn/session/end
 *
 * 结束学习会话，触发后台空闲优化任务。
 * 后台任务以 fire-and-forget 方式运行，不阻塞响应。
 */
export async function POST(request: NextRequest) {
  try {
    // ===== 1. 解析请求体（容错：空 body 也接受）=====
    const body = await request.json().catch(() => ({}));
    const parsed = RequestSchema.safeParse(body);
    const sessionId = parsed.success ? parsed.data.sessionId : undefined;

    // ===== 2. 获取学习用户 =====
    const userId = await getLearnUserId();

    logger.info("会话结束，触发后台优化", { userId, sessionId });

    // ===== 3. fire-and-forget 触发空闲优化 =====
    // 不 await，立即返回响应；用 void 显式标记意图
    // catch 兜底避免 unhandledRejection
    void scheduler
      .runIdleTasks(userId)
      .catch((err) => {
        logger.error("后台空闲优化任务异常", { userId, sessionId, error: String(err) });
      });

    // ===== 4. 立即返回 =====
    return NextResponse.json({
      ok: true,
      message: "会话已结束，后台优化已触发",
    });
  } catch (err) {
      return errorResponse(logger, "/api/learn/session/end 失败", err);
  }
}
