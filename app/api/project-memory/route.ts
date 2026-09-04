/**
 * 项目记忆 CRUD API
 *
 * GET    /api/project-memory       - 列出所有记忆条目
 * POST   /api/project-memory       - 创建记忆条目
 * PUT    /api/project-memory?id=xx - 更新记忆条目
 * DELETE /api/project-memory?id=xx - 删除记忆条目
 *
 * 用于 AI 问答页面的项目记忆管理
 *
 * 优化说明：
 *   - 所有写操作后调用 invalidateMemoryCache，保证缓存一致性
 *   - 支持 scope 字段（global | stats | canvas | english | learn | qa）
 *   - 系统自动记忆（source=system_auto）不允许删除，只能切换激活状态
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getLogger } from "@/lib/utils/logger";
import { errorResponse } from "@/lib/utils/http-error";
import { invalidateMemoryCache } from "@/lib/ai/memory-cache";

const logger = getLogger("ProjectMemoryAPI");

/** 记忆类型白名单 */
const VALID_TYPES = new Set(["fact", "preference", "context", "summary"]);
/** 记忆来源白名单 */
const VALID_SOURCES = new Set([
  "manual",
  "ai_extracted",
  "system",
  "system_auto",
]);
/** 作用域白名单 */
const VALID_SCOPES = new Set([
  "global",
  "stats",
  "canvas",
  "english",
  "learn",
  "qa",
]);

/**
 * GET /api/project-memory
 * 列出所有项目记忆条目，按优先级降序排列
 *
 * 查询参数（可选）：
 *   - scope: 仅返回指定作用域的记忆
 *   - source: 仅返回指定来源的记忆
 */
export async function GET(request: NextRequest) {
  try {
    // 构建查询条件
    const where: Record<string, unknown> = {};
    const scopeParam = request.nextUrl.searchParams.get("scope");
    const sourceParam = request.nextUrl.searchParams.get("source");
    if (scopeParam && VALID_SCOPES.has(scopeParam)) {
      where.scope = scopeParam;
    }
    if (sourceParam && VALID_SOURCES.has(sourceParam)) {
      where.source = sourceParam;
    }

    const memories = await prisma.projectMemory.findMany({
      where,
      orderBy: [{ active: "desc" }, { priority: "desc" }, { updatedAt: "desc" }],
    });

    return NextResponse.json({ memories });
  } catch (err) {
      return errorResponse(logger, "获取项目记忆列表失败", err);
  }
}

/**
 * POST /api/project-memory
 * 创建新的项目记忆条目
 *
 * 请求体：{ title, content, type?, priority?, source?, scope?, tags? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // 校验必填字段
    if (!body.title || typeof body.title !== "string") {
      return NextResponse.json({ error: "title 为必填项" }, { status: 400 });
    }
    if (!body.content || typeof body.content !== "string") {
      return NextResponse.json({ error: "content 为必填项" }, { status: 400 });
    }

    // 校验与规范化各字段
    const type = VALID_TYPES.has(body.type) ? body.type : "context";
    const source = VALID_SOURCES.has(body.source) ? body.source : "manual";
    const scope = VALID_SCOPES.has(body.scope) ? body.scope : "global";
    const priority =
      typeof body.priority === "number" && body.priority >= 0 && body.priority <= 1
        ? body.priority
        : 0.5;
    const tags = Array.isArray(body.tags) ? JSON.stringify(body.tags) : "[]";

    const memory = await prisma.projectMemory.create({
      data: {
        title: body.title,
        content: body.content,
        type,
        scope,
        source,
        priority,
        tags,
        active: true,
        autoRefresh: source === "system_auto",
      },
    });

    // 失效缓存
    invalidateMemoryCache();

    logger.info("创建项目记忆", {
      id: memory.id,
      title: memory.title,
      scope: memory.scope,
    });
    return NextResponse.json({ memory });
  } catch (err) {
      return errorResponse(logger, "创建项目记忆失败", err);
  }
}

/**
 * PUT /api/project-memory?id=xxx
 * 更新项目记忆条目（支持部分更新）
 *
 * 请求体：{ title?, content?, type?, priority?, active?, tags?, scope? }
 *
 * 注意：系统自动记忆（source=system_auto）的 title/content 由聚合服务管理，
 *      此处仅允许更新 active/priority 等用户偏好字段
 */
export async function PUT(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "缺少 id 参数" }, { status: 400 });
    }

    const body = await request.json();

    // 查询现有记忆，判断是否系统自动记忆
    const existing = await prisma.projectMemory.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "记忆条目不存在" }, { status: 404 });
    }

    const isSystemAuto = existing.source === "system_auto";

    // 构建更新数据（仅更新提供的字段）
    const data: Record<string, unknown> = {};

    // 系统自动记忆：仅允许更新 active/priority/scope
    // 用户记忆：允许更新所有字段
    if (!isSystemAuto) {
      if (typeof body.title === "string") data.title = body.title;
      if (typeof body.content === "string") data.content = body.content;
      if (VALID_TYPES.has(body.type)) data.type = body.type;
      if (Array.isArray(body.tags)) data.tags = JSON.stringify(body.tags);
    }

    // 所有记忆都可更新的字段
    if (VALID_SCOPES.has(body.scope)) data.scope = body.scope;
    if (
      typeof body.priority === "number" &&
      body.priority >= 0 &&
      body.priority <= 1
    ) {
      data.priority = body.priority;
    }
    if (typeof body.active === "boolean") data.active = body.active;
    data.lastUsedAt = new Date(); // 更新最近使用时间

    if (Object.keys(data).length <= 1) {
      // 只有 lastUsedAt，无其他字段
      return NextResponse.json({ error: "无更新字段" }, { status: 400 });
    }

    const memory = await prisma.projectMemory.update({
      where: { id },
      data,
    });

    // 失效缓存
    invalidateMemoryCache();

    logger.info("更新项目记忆", {
      id,
      fields: Object.keys(data),
      isSystemAuto,
    });
    return NextResponse.json({ memory });
  } catch (err) {
      return errorResponse(logger, "更新项目记忆失败", err);
  }
}

/**
 * DELETE /api/project-memory?id=xxx
 * 删除项目记忆条目
 *
 * 安全约束：系统自动记忆（source=system_auto）不允许删除
 *           如需清理，请使用 /api/project-memory/aggregate 的 DELETE 方法
 */
export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "缺少 id 参数" }, { status: 400 });
    }

    // 查询现有记忆，判断是否系统自动记忆
    const existing = await prisma.projectMemory.findUnique({
      where: { id },
      select: { source: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "记忆条目不存在" }, { status: 404 });
    }

    // 系统自动记忆不允许删除（保护机制）
    if (existing.source === "system_auto") {
      return NextResponse.json(
        {
          error: "系统自动记忆不允许删除",
          detail: "请通过 /api/project-memory/aggregate 的 DELETE 方法清理",
        },
        { status: 403 }
      );
    }

    await prisma.projectMemory.delete({ where: { id } });

    // 失效缓存
    invalidateMemoryCache();

    logger.info("删除项目记忆", { id });
    return NextResponse.json({ success: true });
  } catch (err) {
      return errorResponse(logger, "删除项目记忆失败", err);
  }
}
