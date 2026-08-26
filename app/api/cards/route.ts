/**
 * 卡片 API 路由
 * GET    /api/cards      - 查询卡片列表（支持搜索/过滤/分页）
 * POST   /api/cards      - 创建卡片
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { cardService } from "@/lib/services/cards/service";
import { CreateCardSchema, CardQuerySchema } from "@/lib/services/cards/types";
import { getLogger } from "@/lib/utils/logger";
import { authorizePluginCall } from "@/lib/plugins/permissions";

const logger = getLogger("CardsAPI");

/**
 * 临时用户 ID（认证模块未完成前使用）
 * TODO: 接入 NextAuth 后从 session 获取
 */
const TEMP_USER_ID = "dev-user";

/**
 * 查询卡片列表
 * 支持查询参数：search, type, subjectId, categoryId, status, source, tagIds, difficulty, favoriteOnly, limit, offset, sort
 */
export async function GET(request: NextRequest) {
  try {
    // 插件身份校验（F5）：本端点必需 cards:read；无 x-plugin-id 时直连放行
    const auth = await authorizePluginCall(
      prisma,
      request,
      "GET",
      "/api/cards"
    );
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const params = Object.fromEntries(request.nextUrl.searchParams.entries()) as Record<string, unknown>;
    // tagIds 可能是逗号分隔
    if (typeof params.tagIds === "string" && params.tagIds) {
      params.tagIds = (params.tagIds as string).split(",");
    }
    // difficulty 可能是逗号分隔
    if (typeof params.difficulty === "string" && params.difficulty) {
      params.difficulty = (params.difficulty as string).split(",").map(Number);
    }

    const query = CardQuerySchema.parse({
      ...params,
      limit: params.limit ? Number(params.limit) : 50,
      offset: params.offset ? Number(params.offset) : 0,
    });

    const result = await cardService.list(query, TEMP_USER_ID);
    return NextResponse.json(result);
  } catch (err) {
    logger.error("查询卡片列表失败", { error: String(err) });
    return NextResponse.json(
      { error: "查询失败", detail: String(err) },
      { status: 400 }
    );
  }
}

/**
 * 创建卡片
 */
export async function POST(request: NextRequest) {
  try {
    // 插件身份校验（F5 审查 S-1）：本端点必需 cards:write；
    // 未接线时插件可绕过 batch 通道直接走单卡创建，形成权限缺口
    const auth = await authorizePluginCall(
      prisma,
      request,
      "POST",
      "/api/cards"
    );
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json();
    const input = CreateCardSchema.parse(body);
    const card = await cardService.create(TEMP_USER_ID, input);
    logger.info("卡片创建成功", { cardId: card.id, title: card.title });
    return NextResponse.json(card, { status: 201 });
  } catch (err) {
    logger.error("创建卡片失败", { error: String(err) });
    return NextResponse.json(
      { error: "创建失败", detail: String(err) },
      { status: 400 }
    );
  }
}
