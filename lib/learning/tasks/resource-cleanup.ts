/**
 * 资源回收任务
 *
 * 设计依据：.doc/WORD_LEARNING_DESIGN.md §6.2
 *
 * 职责：
 *   - 压缩 ModeHistory：每词保留最近 100 条，删除更早的
 *   - 剔除无效结构片段：WordRelation(structural) 中 evidence.sharedParts 含黑名单片段的删除
 *   - 剔除 weight < 0.1 的 WordRelation（噪声）
 *   - 记录清理数量
 *
 * 性能预算：<1s
 *   - ModeHistory 压缩用 groupBy + cutoff 删除，避免逐条扫描
 *   - structural 黑名单检查复用 structural.ts 导出的 STRUCTURAL_BLACKLIST
 */
import { prisma } from "@/lib/db/prisma";
import { getLogger } from "@/lib/utils/logger";
import { STRUCTURAL_BLACKLIST } from "./structural";

const logger = getLogger("ResourceCleanup");

/** 每个 cardId 保留的 ModeHistory 条数 */
const MODE_HISTORY_KEEP = 100;

/** 噪声权重阈值：低于此值的 WordRelation 视为噪声删除 */
const NOISE_WEIGHT_THRESHOLD = 0.1;

/** 资源回收结果 */
export interface CleanupResult {
  /** ModeHistory 压缩删除的条数 */
  modeHistoryDeleted: number;
  /** 含黑名单片段的 structural 关系删除数 */
  invalidStructuralDeleted: number;
  /** weight<阈值 的噪声关系删除数 */
  noiseRelationsDeleted: number;
}

/** 解析 structural 关系的 evidence JSON */
function parseStructuralEvidence(raw: string): { sharedParts?: string[] } {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object") return obj as { sharedParts?: string[] };
  } catch {
    // JSON 解析失败视为空 evidence
  }
  return {};
}

/**
 * 执行资源回收任务。
 *
 * 流程：
 *   1. ModeHistory 压缩：
 *      - groupBy cardId 统计每词记录数
 *      - 对记录数 > 100 的 cardId，找出第 100 条的 createdAt 作为 cutoff
 *      - 删除该 cardId 下 createdAt < cutoff 的所有记录
 *   2. structural 关系黑名单清理：
 *      - 拉取所有 structural 关系的 evidence
 *      - 解析 sharedParts，命中黑名单的整条删除
 *   3. 噪声关系清理：
 *      - deleteMany where weight < 0.1
 *
 * @returns 清理结果统计
 */
export async function runCleanup(): Promise<CleanupResult> {
  const result: CleanupResult = {
    modeHistoryDeleted: 0,
    invalidStructuralDeleted: 0,
    noiseRelationsDeleted: 0,
  };

  // ===== 1. 压缩 ModeHistory =====
  // 用 groupBy 取每 cardId 的记录数，JS 过滤出超 100 条的 cardId
  // （Prisma groupBy 的 having 语法在不同版本表现不一致，改用 JS 过滤更稳妥）
  const groups = await prisma.modeHistory.groupBy({
    by: ["cardId"],
    _count: { cardId: true },
  });
  const heavyCards = groups.filter((g) => g._count.cardId > MODE_HISTORY_KEEP);

  for (const g of heavyCards) {
    // 找该 cardId 第 100 条（按 createdAt 降序）之后的第 1 条，作为 cutoff
    // cutoff 即"保留边界"：删除 createdAt < cutoff 的记录
    const cutoffRow = await prisma.modeHistory.findMany({
      where: { cardId: g.cardId },
      orderBy: { createdAt: "desc" },
      skip: MODE_HISTORY_KEEP,
      take: 1,
      select: { createdAt: true },
    });
    if (cutoffRow.length === 0) continue;
    const cutoff = cutoffRow[0].createdAt;
    const deleted = await prisma.modeHistory.deleteMany({
      where: { cardId: g.cardId, createdAt: { lt: cutoff } },
    });
    result.modeHistoryDeleted += deleted.count;
  }

  // ===== 2. 剔除含黑名单片段的 structural 关系 =====
  const structuralRels = await prisma.wordRelation.findMany({
    where: { type: "structural" },
    select: { id: true, evidence: true },
  });

  const invalidIds: string[] = [];
  for (const rel of structuralRels) {
    const ev = parseStructuralEvidence(rel.evidence);
    const parts = ev.sharedParts ?? [];
    // 任一片段命中黑名单则整条删除（挖掘时已过滤，此处为兜底）
    if (parts.some((p) => STRUCTURAL_BLACKLIST.has(p))) {
      invalidIds.push(rel.id);
    }
  }
  if (invalidIds.length > 0) {
    const deleted = await prisma.wordRelation.deleteMany({
      where: { id: { in: invalidIds } },
    });
    result.invalidStructuralDeleted = deleted.count;
  }

  // ===== 3. 剔除 weight < 阈值的噪声关系 =====
  const noiseDeleted = await prisma.wordRelation.deleteMany({
    where: { weight: { lt: NOISE_WEIGHT_THRESHOLD } },
  });
  result.noiseRelationsDeleted = noiseDeleted.count;

  // 用展开为新鲜对象字面量传入 logger，避免接口无索引签名导致的类型不兼容
  logger.info("资源回收完成", { ...result });
  return result;
}
