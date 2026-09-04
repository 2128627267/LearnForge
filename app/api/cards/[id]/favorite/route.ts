/**
 * 卡片收藏 API
 * POST /api/cards/[id]/favorite - 收藏/取消收藏（toggle）
 */
import { NextRequest, NextResponse } from "next/server";
import { cardService } from "@/lib/services/cards/service";
import { getLogger } from "@/lib/utils/logger";
import { errorResponse } from "@/lib/utils/http-error";

const logger = getLogger("CardFavoriteAPI");
const TEMP_USER_ID = "dev-user";

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const result = await cardService.toggleFavorite(params.id, TEMP_USER_ID);
    return NextResponse.json(result);
  } catch (err) {
    // B5 修复（审查）：500 不回传内部错误细节，统一走 errorResponse
    return errorResponse(logger, "操作失败", err);
  }
}
