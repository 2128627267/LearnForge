/**
 * 数据导入 API
 * POST /api/import/datapack
 *
 * 导入原 LearnForge 数据包格式到新数据库
 */
import { NextRequest, NextResponse } from "next/server";
import { importDataPack } from "@/lib/import/legacy-importer";
import { getLogger } from "@/lib/utils/logger";

const logger = getLogger("ImportAPI");
const TEMP_USER_ID = "dev-user";

export async function POST(request: NextRequest) {
  try {
    const { packDir, subjectId } = await request.json();

    if (!packDir || typeof packDir !== "string") {
      return NextResponse.json(
        { error: "请提供数据包目录路径" },
        { status: 400 }
      );
    }

    logger.info("数据包导入请求", { packDir });

    const result = await importDataPack(packDir, TEMP_USER_ID, subjectId);

    return NextResponse.json({
      success: true,
      imported: result.imported,
      skipped: result.skipped,
    });
  } catch (err) {
    logger.error("数据导入失败", { error: String(err) });
    return NextResponse.json(
      { error: "导入失败", detail: String(err) },
      { status: 500 }
    );
  }
}
