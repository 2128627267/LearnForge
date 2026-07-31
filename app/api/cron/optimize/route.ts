/**
 * GET /api/cron/optimize
 *
 * 设计依据：.doc/WORD_LEARNING_DESIGN.md §6.1 / §7
 *
 * 流程：
 *   1. 校验 Authorization header（Bearer token，与 process.env.CRON_SECRET 比对）
 *      若未配置 CRON_SECRET 则拒绝（安全默认：未配置不开放）
 *   2. 调用 scheduler.runBatchOptimize() 执行全部优化任务（含 AI 语义分析）
 *   3. 返回优化结果
 *
 * 路由预留：通过外部 cron 服务定时调用
 *   - Vercel Cron: 在 vercel.json 配置 schedule
 *   - systemd timer: crontab -e "0 * * * * curl -H 'Authorization: Bearer xxx' ..."
 *
 * 安全：CRON_SECRET 必须配置，且校验 Bearer token 完全相等
 */
import { NextRequest, NextResponse } from "next/server";
import { scheduler } from "@/lib/learning/scheduler";
import { getLogger } from "@/lib/utils/logger";

const logger = getLogger("CronOptimizeAPI");

/**
 * GET /api/cron/optimize
 *
 * 定时批量优化任务入口。
 * 校验 CRON_SECRET 后执行 scheduler.runBatchOptimize()。
 */
export async function GET(request: NextRequest) {
  try {
    // ===== 1. 校验 CRON_SECRET =====
    // 安全默认：未配置密钥则拒绝执行（避免公网任意触发）
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || cronSecret.trim().length === 0) {
      logger.warn("CRON_SECRET 未配置，拒绝执行定时优化");
      return NextResponse.json(
        { error: "定时优化未配置密钥（CRON_SECRET），拒绝执行" },
        { status: 503 }
      );
    }

    // 提取 Bearer token
    const authHeader = request.headers.get("authorization");
    const provided = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";

    // 校验 token（完全相等才通过）
    if (!provided || provided !== cronSecret) {
      logger.warn("CRON_SECRET 校验失败，拒绝执行");
      return NextResponse.json(
        { error: "未授权" },
        { status: 401 }
      );
    }

    // ===== 2. 执行批量优化 =====
    logger.info("定时批量优化任务开始");
    const result = await scheduler.runBatchOptimize();

    // ===== 3. 返回结果 =====
    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (err) {
    logger.error("/api/cron/optimize 失败", { error: String(err) });
    return NextResponse.json(
      { error: "批量优化失败", detail: String(err) },
      { status: 500 }
    );
  }
}
