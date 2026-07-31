/**
 * 单卡 API 路由
 * GET    /api/cards/[id]  - 获取卡片详情
 * PUT    /api/cards/[id]  - 更新卡片
 * DELETE /api/cards/[id]  - 删除卡片
 */
import { NextRequest, NextResponse } from "next/server";
import { cardService } from "@/lib/services/cards/service";
import { UpdateCardSchema } from "@/lib/services/cards/types";
import { getLogger } from "@/lib/utils/logger";

const logger = getLogger("CardDetailAPI");
const TEMP_USER_ID = "dev-user";

/** 获取卡片详情 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const card = await cardService.getById(params.id);
    if (!card) {
      return NextResponse.json({ error: "卡片不存在" }, { status: 404 });
    }
    // 记录浏览行为
    await cardService.logStudy(TEMP_USER_ID, params.id, "view").catch(() => {});
    return NextResponse.json(card);
  } catch (err) {
    logger.error("获取卡片失败", { id: params.id, error: String(err) });
    return NextResponse.json({ error: "获取失败" }, { status: 500 });
  }
}

/** 更新卡片 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const input = UpdateCardSchema.parse(body);
    const card = await cardService.update(params.id, TEMP_USER_ID, input);
    return NextResponse.json(card);
  } catch (err) {
    logger.error("更新卡片失败", { id: params.id, error: String(err) });
    return NextResponse.json(
      { error: "更新失败", detail: String(err) },
      { status: 400 }
    );
  }
}

/** 删除卡片 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await cardService.delete(params.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("删除卡片失败", { id: params.id, error: String(err) });
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}
