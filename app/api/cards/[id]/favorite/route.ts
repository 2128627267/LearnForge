/**
 * 卡片收藏 API
 * POST /api/cards/[id]/favorite - 收藏/取消收藏（toggle）
 */
import { NextRequest, NextResponse } from "next/server";
import { cardService } from "@/lib/services/cards/service";

const TEMP_USER_ID = "dev-user";

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const result = await cardService.toggleFavorite(params.id, TEMP_USER_ID);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: "操作失败", detail: String(err) },
      { status: 500 }
    );
  }
}
