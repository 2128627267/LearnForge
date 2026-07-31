/**
 * 项目记忆聚合 API
 *
 * POST /api/project-memory/aggregate
 *   - 无参数：刷新所有模块（stats/canvas/english/learn）的系统自动记忆
 *   - body: { scope?: string } 仅刷新指定模块
 *
 * GET /api/project-memory/aggregate
 *   - 返回所有系统自动记忆（source=system_auto）的摘要
 *   - 用于前端展示"系统已收集的上下文"
 *
 * 设计意图：
 *   - 让用户能手动触发聚合（导入数据后、学习一段时间后）
 *   - 提供系统记忆的查看入口
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getLogger } from "@/lib/utils/logger";
import {
  refreshAllModuleMemories,
  refreshModuleMemory,
} from "@/lib/services/project-memory-aggregator";
import { invalidateMemoryCache } from "@/lib/ai/memory-cache";

const logger = getLogger("MemoryAggregateAPI");

// 该路由需读写数据库，强制动态渲染
export const dynamic = "force-dynamic";

/**
 * POST /api/project-memory/aggregate
 * 触发模块记忆聚合刷新
 *
 * 请求体（可选）：
 *   { scope?: "stats" | "canvas" | "english" | "learn" }
 *   - 不传 scope：刷新所有模块
 *   - 传 scope：仅刷新指定模块
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const scope = typeof body.scope === "string" ? body.scope : null;

    if (scope) {
      // 仅刷新指定模块
      const ok = await refreshModuleMemory(scope);
      return NextResponse.json({
        success: ok,
        scope,
        message: ok
          ? `模块 ${scope} 记忆已刷新`
          : `模块 ${scope} 刷新失败（未知模块或内部错误）`,
      });
    }

    // 刷新所有模块
    const results = await refreshAllModuleMemories();
    const allOk = Object.values(results).every(Boolean);

    return NextResponse.json({
      success: allOk,
      results,
      message: allOk
        ? "所有模块记忆已刷新"
        : `部分模块刷新失败：${Object.entries(results)
            .filter(([, ok]) => !ok)
            .map(([k]) => k)
            .join("、")}`,
    });
  } catch (err) {
    logger.error("项目记忆聚合失败", { error: String(err) });
    return NextResponse.json(
      { error: "聚合失败", detail: String(err) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/project-memory/aggregate
 * 获取所有系统自动记忆列表（按 scope 分组）
 *
 * 返回：
 *   { byScope: { stats: [...], canvas: [...], ... }, total: number }
 */
export async function GET() {
  try {
    // 查询所有系统自动记忆
    const memories = await prisma.projectMemory.findMany({
      where: { source: "system_auto" },
      orderBy: [{ scope: "asc" }, { priority: "desc" }],
    });

    // 按 scope 分组
    const byScope: Record<string, Array<{
      id: string;
      title: string;
      content: string;
      scope: string;
      moduleId: string | null;
      priority: number;
      active: boolean;
      updatedAt: string;
    }>> = {};

    for (const m of memories) {
      const list = byScope[m.scope] ?? [];
      list.push({
        id: m.id,
        title: m.title,
        content: m.content,
        scope: m.scope,
        moduleId: m.moduleId,
        priority: m.priority,
        active: m.active,
        updatedAt: m.updatedAt.toISOString(),
      });
      byScope[m.scope] = list;
    }

    // 失效缓存，确保下次读取最新
    invalidateMemoryCache();

    return NextResponse.json({
      byScope,
      total: memories.length,
    });
  } catch (err) {
    logger.error("获取系统记忆列表失败", { error: String(err) });
    return NextResponse.json(
      { error: "获取失败", detail: String(err) },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/project-memory/aggregate
 * 清除所有系统自动记忆（用户手动清理）
 *
 * 注意：仅清除 source=system_auto 的记忆，不影响用户手动添加的
 */
export async function DELETE() {
  try {
    const result = await prisma.projectMemory.deleteMany({
      where: { source: "system_auto" },
    });

    invalidateMemoryCache();
    logger.info("清除系统自动记忆", { deleted: result.count });

    return NextResponse.json({
      success: true,
      deleted: result.count,
    });
  } catch (err) {
    logger.error("清除系统记忆失败", { error: String(err) });
    return NextResponse.json(
      { error: "清除失败", detail: String(err) },
      { status: 500 }
    );
  }
}
