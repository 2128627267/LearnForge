/**
 * 行为聚类任务
 *
 * 设计依据：.doc/WORD_LEARNING_DESIGN.md §6.2
 *
 * 职责：
 *   - 查询最近 7 天的 ModeHistory，按错误模式聚合
 *   - 简单聚类：相同 modeId 下都错误的词对 → weight = 0.4 + 0.1*(共同错误次数)
 *   - 写入 WordRelation(type="behavioral", weight, evidence={sharedErrors, modeId})
 *
 * 性能预算：<2s
 *   - 限制每用户最近 200 条错误记录（避免全库扫描）
 *
 * 共同错误次数定义：
 *   对 (cardA, cardB, modeM)，sharedErrors = min(wrongCount[A,M], wrongCount[B,M])
 *   即两者在该模式下的错误次数取较小值，表示"两者共同被错的会话次数"。
 *   跨多个 mode 时，取 sharedErrors 最大的那个 mode 作为 evidence.modeId。
 */
import { prisma } from "@/lib/db/prisma";
import { clamp01 } from "@/lib/learning/types";
import { getLogger } from "@/lib/utils/logger";

const logger = getLogger("BehavioralTask");

/** WordRelation.type 子类标识 */
const RELATION_TYPE = "behavioral";

/** 一天的毫秒数 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** 回溯天数 */
const RECENT_DAYS = 7;

/** 每用户最近错误记录上限 */
const RECENT_ERROR_LIMIT = 200;

/** 噪声过滤阈值 */
const MIN_WEIGHT = 0.1;

/**
 * 规范化 cardId 对，确保 fromCardId < toCardId（与 soft-layout.ts 模式一致）。
 * 本文件内局部定义，避免新增共享工具文件。
 */
function normalizePair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * 执行行为聚类任务。
 *
 * 流程：
 *   1. 查询最近 7 天 ModeHistory(isCorrect=false)，限制 200 条
 *   2. 按 modeId 分组，统计 (modeId, cardId) → 错误次数
 *   3. 对每个 modeId 内的 card 两两配对，sharedErrors = min(countA, countB)
 *   4. 跨 mode 聚合：取 sharedErrors 最大的 mode 作为 evidence
 *   5. weight = clamp01(0.4 + 0.1 * sharedErrors)
 *   6. 批量 upsert WordRelation(behavioral)
 *
 * @param userId 可选用户 ID。传入时仅处理该用户错误；不传时处理全局（用于批量优化）
 * @returns 写入（upsert）的关系数量
 */
export async function runBehavioral(userId?: string): Promise<number> {
  // ===== 1. 查询近 7 天错误记录 =====
  const sevenDaysAgo = new Date(Date.now() - RECENT_DAYS * DAY_MS);
  const where: {
    isCorrect: boolean;
    createdAt: { gte: Date };
    userId?: string;
  } = {
    isCorrect: false,
    createdAt: { gte: sevenDaysAgo },
  };
  if (userId) where.userId = userId;

  const errors = await prisma.modeHistory.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: RECENT_ERROR_LIMIT,
    select: { cardId: true, modeId: true },
  });

  if (errors.length === 0) {
    logger.info("无近期错误记录可聚类", { userId });
    return 0;
  }

  // ===== 2. 按 modeId 分组，统计 (modeId, cardId) → 错误次数 =====
  // modeCardCount: modeId → (cardId → count)
  const modeCardCount = new Map<number, Map<string, number>>();
  for (const e of errors) {
    if (!modeCardCount.has(e.modeId)) modeCardCount.set(e.modeId, new Map());
    const inner = modeCardCount.get(e.modeId)!;
    inner.set(e.cardId, (inner.get(e.cardId) ?? 0) + 1);
  }

  // ===== 3. 对每个 modeId 内两两配对，跨 mode 聚合 =====
  // pairAgg: pairKey → { sharedErrors, modeId }（取 sharedErrors 最大的 mode）
  const pairAgg = new Map<string, { sharedErrors: number; modeId: number }>();

  for (const [modeId, cardCounts] of modeCardCount) {
    const entries = Array.from(cardCounts.entries());
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [cardA, countA] = entries[i];
        const [cardB, countB] = entries[j];
        const [a, b] = normalizePair(cardA, cardB);
        const key = `${a}|${b}`;
        // 共同错误次数 = min(countA, countB)：两者都被错的最少次数
        const shared = Math.min(countA, countB);
        const existing = pairAgg.get(key);
        if (!existing || shared > existing.sharedErrors) {
          pairAgg.set(key, { sharedErrors: shared, modeId });
        }
      }
    }
  }

  // ===== 4. 生成关系 =====
  const relations: Array<{
    fromCardId: string;
    toCardId: string;
    weight: number;
    evidence: { sharedErrors: number; modeId: number };
  }> = [];

  for (const [key, { sharedErrors, modeId }] of pairAgg) {
    const weight = clamp01(0.4 + 0.1 * sharedErrors);
    if (weight < MIN_WEIGHT) continue;
    const [a, b] = key.split("|");
    relations.push({
      fromCardId: a,
      toCardId: b,
      weight: Number(weight.toFixed(4)),
      evidence: { sharedErrors, modeId },
    });
  }

  if (relations.length === 0) {
    logger.info("无 behavioral 关系可写入", { userId, errorCount: errors.length });
    return 0;
  }

  // ===== 5. 批量 upsert 到 WordRelation =====
  await prisma.$transaction(
    relations.map((r) =>
      prisma.wordRelation.upsert({
        where: {
          fromCardId_toCardId_type: {
            fromCardId: r.fromCardId,
            toCardId: r.toCardId,
            type: RELATION_TYPE,
          },
        },
        create: {
          fromCardId: r.fromCardId,
          toCardId: r.toCardId,
          type: RELATION_TYPE,
          weight: r.weight,
          evidence: JSON.stringify(r.evidence),
        },
        update: {
          weight: r.weight,
          evidence: JSON.stringify(r.evidence),
        },
      })
    )
  );

  logger.info("behavioral 关系构建完成", {
    userId,
    errorCount: errors.length,
    modeCount: modeCardCount.size,
    relationCount: relations.length,
  });

  return relations.length;
}
