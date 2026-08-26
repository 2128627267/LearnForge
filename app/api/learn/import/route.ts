/**
 * POST /api/learn/import
 *
 * 设计依据：.doc/WORD_LEARNING_DESIGN.md §5 §7
 *
 * 触发数据包导入（适配后），导入完成后立即构建 soft_layout 软相关性关系。
 *
 * 请求体（两种模式二选一）：
 *   1. 单包导入：{ packDir: string, subjectId?: string }
 *   2. 批量导入：{ datapacksDir: string, subjectId?: string }
 *
 * 响应：
 *   成功 200：
 *     {
 *       imported: number,        // 导入成功的卡片数
 *       skipped: number,         // 跳过的卡片数
 *       packs: number,           // 涉及的数据包数量
 *       packId: string | null,   // 单包导入时的 packId（批量时为 null）
 *       packIds: string[],       // 所有涉及的数据包 ID
 *       relations: number,       // 构建的 soft_layout 关系数
 *     }
 *   失败 400/500：{ error, detail }
 *
 * 认证：复用 lib/learning/auth.ts 的 getLearnUserId()
 *   fallback 链：环境变量 → 首个 User → 创建默认 learn@local User
 *
 * 错误处理：try-catch 包裹，失败返回 500
 */
import { NextRequest, NextResponse } from "next/server";
import { getLearnUserId } from "@/lib/learning/auth";
import { buildSoftLayoutRelations } from "@/lib/learning/soft-layout";
import {
  importAllDataPacks,
  importDataPack,
} from "@/lib/import/legacy-importer";
import {
  DATAPACKS_ROOT,
  resolveWithinDatapacks,
} from "@/lib/import/path-guard";
import { getLogger } from "@/lib/utils/logger";
import { errorResponse } from "@/lib/utils/http-error";

const logger = getLogger("LearnImportAPI");

/**
 * POST /api/learn/import
 *
 * 支持两种模式：
 *   - packDir：单包导入
 *   - datapacksDir：批量导入（每个子目录为一个数据包）
 *
 * 导入完成后会针对本次导入的每个 packId 调用 buildSoftLayoutRelations，
 * 建立 soft_layout 软相关性关系（同 fileName 内全对 + 跨 fileName 抽样）。
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { packDir, datapacksDir, subjectId } = body as {
      packDir?: string;
      datapacksDir?: string;
      subjectId?: string;
    };

    // ===== 1. 参数校验：packDir 或 datapacksDir 至少一个 =====
    if (
      (!packDir || typeof packDir !== "string") &&
      (!datapacksDir || typeof datapacksDir !== "string")
    ) {
      return NextResponse.json(
        { error: "请提供 packDir 或 datapacksDir" },
        { status: 400 }
      );
    }

    // ===== 1.5 路径安全校验：仅允许项目 datapacks/ 目录内（防路径遍历）=====
    let safePackDir: string | null = null;
    let safeDatapacksDir: string | null = null;
    if (packDir) {
      safePackDir = resolveWithinDatapacks(packDir);
      if (!safePackDir) {
        return NextResponse.json(
          {
            error: `packDir 必须位于项目数据包目录内：${DATAPACKS_ROOT}`,
          },
          { status: 400 }
        );
      }
    } else {
      safeDatapacksDir = resolveWithinDatapacks(datapacksDir!);
      if (!safeDatapacksDir) {
        return NextResponse.json(
          {
            error: `datapacksDir 必须位于项目数据包目录内：${DATAPACKS_ROOT}`,
          },
          { status: 400 }
        );
      }
    }

    // ===== 2. 获取学习用户 ID（认证 fallback）=====
    const userId = await getLearnUserId();
    logger.info("学习数据导入请求", { packDir, datapacksDir, subjectId, userId });

    // ===== 3. 执行导入（单包或批量）=====
    // 统一收集 imported/skipped/packIds，便于后续构建软相关性
    let imported: number;
    let skipped: number;
    let packs: number;
    let packIds: string[];

    if (packDir) {
      // 3.1 单包导入（路径已通过白名单校验）
      const result = await importDataPack(safePackDir!, userId, subjectId);
      imported = result.imported;
      skipped = result.skipped;
      packs = result.packId ? 1 : 0;
      packIds = result.packId ? [result.packId] : [];
    } else {
      // 3.2 批量导入（safeDatapacksDir 必然存在，前面已校验）
      const result = await importAllDataPacks(
        safeDatapacksDir!,
        userId,
        subjectId
      );
      imported = result.totalImported;
      skipped = result.totalSkipped;
      packs = result.packs;
      packIds = result.packIds;
    }

    // ===== 4. 构建 soft_layout 软相关性关系 =====
    // 对本次导入涉及的每个 packId 单独构建，避免重新计算已有数据。
    // 若某 packId 因导入失败而未入 packIds，则跳过。
    let relations = 0;
    for (const pid of packIds) {
      try {
        relations += await buildSoftLayoutRelations(pid);
      } catch (err) {
        // 软相关性构建失败不阻塞导入结果返回，仅记录日志
        logger.warn("soft_layout 构建失败（不阻塞导入）", {
          packId: pid,
          error: String(err),
        });
      }
    }

    logger.info("学习数据导入完成", {
      imported,
      skipped,
      packs,
      packIds,
      relations,
    });

    // ===== 5. 返回结果 =====
    // packId 字段：单包导入时为该包 ID，批量导入时为 null（兼容旧调用方）
    return NextResponse.json({
      success: true,
      imported,
      skipped,
      packs,
      packId: packIds.length === 1 ? packIds[0] : null,
      packIds,
      relations,
    });
  } catch (err) {
      return errorResponse(logger, "学习数据导入失败", err);
  }
}
