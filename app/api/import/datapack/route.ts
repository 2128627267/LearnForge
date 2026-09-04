/**
 * 数据导入 API
 * POST /api/import/datapack
 *
 * 导入原 LearnForge 数据包格式到新数据库
 */
import { NextRequest, NextResponse } from "next/server";
import { importDataPack } from "@/lib/import/legacy-importer";
import {
  DATAPACKS_ROOT,
  resolveWithinDatapacks,
} from "@/lib/import/path-guard";
import { getLogger } from "@/lib/utils/logger";
import { errorResponse } from "@/lib/utils/http-error";

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

    // 安全：仅允许项目 datapacks/ 目录内的路径（防路径遍历）
    const safePackDir = resolveWithinDatapacks(packDir);
    if (!safePackDir) {
      return NextResponse.json(
        { error: `packDir 必须位于项目数据包目录内：${DATAPACKS_ROOT}` },
        { status: 400 }
      );
    }

    logger.info("数据包导入请求", { packDir: safePackDir });

    const result = await importDataPack(safePackDir, TEMP_USER_ID, subjectId);

    return NextResponse.json({
      success: true,
      imported: result.imported,
      skipped: result.skipped,
    });
  } catch (err) {
      return errorResponse(logger, "数据导入失败", err);
  }
}
