/**
 * 单词学习系统 - 特征引擎
 *
 * 设计依据：.doc/WORD_LEARNING_DESIGN.md §2.3
 *
 * 职责：
 *   每次答题后调用 FeatureEngine.recalc(cardId, userId) 在一个事务内
 *   重算 WordProfile 的所有时序属性、遗忘曲线参数与派生属性。
 *
 * 性能预算：<50ms（单事务，4-6 次查询 + 1 次 update）
 *
 * 关键计算（按 §2.3.1 / §2.3.2）：
 *   - errorProneness = 0.5*错误率 + 0.3*遗忘概率 + 0.2*响应归一化
 *   - studyFrequency = 0.7*(studyCount/daysSinceFirst) + 0.3*(7日滑窗平均次数)
 *   - SM-2 变体（频率弹性）：f = studyFrequency>1 ? 1.2 : 0.8
 *   - commonness = 0.6*导入频率归一化 + 0.4*(1-errorProneness)
 *   - difficulty = 0.4*(1-首次正确率) + 0.3*响应归一化 + 0.3*errorProneness
 */
import { prisma } from "@/lib/db/prisma";
import { clamp01, sigmoid } from "@/lib/learning/types";
import { getLogger } from "@/lib/utils/logger";

const logger = getLogger("FeatureEngine");

/** 一天的毫秒数，便于阅读 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** 响应时长归一化基准：500ms 起点，5000ms 跨度映射到 [0,1] */
const RESPONSE_NORM_BASE = 500;
const RESPONSE_NORM_SPAN = 5000;

/**
 * 特征引擎：负责 WordProfile 时序属性与遗忘曲线的统一重算。
 *
 * 设计为静态方法集，无需实例化，避免在热路径上分配对象。
 */
export class FeatureEngine {
  /**
   * 重算指定 card 的 WordProfile。
   *
   * 算法步骤：
   *   1. 事务内并发查询所需数据（最近 30 条历史、总数、首条、7 日滑窗、布局统计、当前 profile）
   *   2. 计算 errorProneness / studyFrequency / avgResponseMs
   *   3. 计算 SM-2 变体遗忘曲线参数（repetitions / intervalDays / easinessFactor / nextReviewAt）
   *   4. 计算 commonness / difficulty（派生属性）
   *   5. 更新 streak（连续正确计数）
   *   6. 写入 debugSnapshot（调试快照）
   *   7. 单条 update 完成持久化
   *
   * @param cardId  目标卡片 ID
   * @param userId  学习用户 ID（用于未来按用户分桶，当前统计仍以 card 维度）
   */
  static async recalc(cardId: string, userId: string): Promise<void> {
    try {
      await prisma.$transaction(async (tx) => {
        const now = Date.now();

        // ===== 1. 并发查询所需数据 =====
        // 最近 30 条 ModeHistory（按时间倒序），同时承担错误率与 avgResponseMs 计算
        const recent30 = await tx.modeHistory.findMany({
          where: { cardId },
          orderBy: { createdAt: "desc" },
          take: 30,
        });
        // 该 card 的 ModeHistory 总数（即 studyCount）
        const totalCount = await tx.modeHistory.count({ where: { cardId } });
        // 最早一条 ModeHistory（用于 daysSinceFirst 与首次正确率）
        const firstRecord = await tx.modeHistory.findFirst({
          where: { cardId },
          orderBy: { createdAt: "asc" },
          select: { isCorrect: true, createdAt: true },
        });
        // 7 日滑窗 ModeHistory 数量
        const sevenDaysAgo = new Date(now - 7 * DAY_MS);
        const recent7Count = await tx.modeHistory.count({
          where: { cardId, createdAt: { gte: sevenDaysAgo } },
        });
        // 该 card 的 ImportLayout 计数（导入频率归一化的分子）
        const cardLayoutCount = await tx.importLayout.count({ where: { cardId } });
        // 全库 ImportLayout 按 cardId 分组的最大计数（导入频率归一化的分母）
        // 使用 groupBy + take:1 仅取最大组，避免拉取全表
        const maxLayoutGroup = await tx.importLayout.groupBy({
          by: ["cardId"],
          where: { cardId: { not: null } },
          _count: { cardId: true },
          orderBy: { _count: { cardId: "desc" } },
          take: 1,
        });
        const maxLayoutCount = maxLayoutGroup[0]?._count.cardId ?? 0;

        // 当前 WordProfile（含历史 SM-2 参数）
        const profile = await tx.wordProfile.findUnique({ where: { cardId } });
        // 无 profile 则跳过（理论上导入时已创建，此处兜底）
        if (!profile) {
          logger.warn("recalc 跳过：未找到 WordProfile", { cardId });
          return;
        }

        // ===== 2. 计算 errorProneness =====
        const lastRecord = recent30[0];
        const isLastCorrect = lastRecord?.isCorrect ?? false;

        // 错误率：近 30 条中错误数 / 实际条数（数据不足时不放大）
        const errorCount = recent30.filter((r) => !r.isCorrect).length;
        const errorRate = recent30.length > 0 ? errorCount / recent30.length : 0;

        // 遗忘概率：基于 SM-2 间隔的反向 sigmoid
        // 距上次学习越接近/超过 intervalDays，遗忘概率越高
        let forgettingProb = 0.5; // 无记录时的中性值
        if (profile.lastStudyTime && profile.intervalDays > 0) {
          const daysSinceLastStudy =
            (now - profile.lastStudyTime.getTime()) / DAY_MS;
          // delay = (已过去天数 - 间隔天数) / 间隔天数，越超期 delay 越大
          const delay =
            (daysSinceLastStudy - profile.intervalDays) /
            Math.max(1, profile.intervalDays);
          // 超期 → forgettingProb → 1；未到期 → → 0
          forgettingProb = sigmoid(delay);
        }

        // avgResponseMs：最近 20 次 responseMs 均值
        const recent20 = recent30.slice(0, 20);
        const responseTimes = recent20
          .map((r) => r.responseMs)
          .filter((r) => r > 0);
        const avgResponseMs =
          responseTimes.length > 0
            ? Math.round(
                responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
              )
            : profile.avgResponseMs; // 无新数据则保留旧值

        // 响应归一化：500ms-5500ms 映射到 [0,1]
        const responseNorm = clamp01(
          (avgResponseMs - RESPONSE_NORM_BASE) / RESPONSE_NORM_SPAN
        );

        // errorProneness 加权汇总
        const errorProneness = clamp01(
          0.5 * errorRate + 0.3 * forgettingProb + 0.2 * responseNorm
        );

        // ===== 3. 计算 studyFrequency =====
        let studyFrequency = 0;
        if (totalCount > 0 && firstRecord) {
          const daysSinceFirst = Math.max(
            1,
            (now - firstRecord.createdAt.getTime()) / DAY_MS
          );
          const dailyAvg = totalCount / daysSinceFirst; // 日均次数
          const sevenDayAvg = recent7Count / 7; // 7 日滑窗日均
          studyFrequency = 0.7 * dailyAvg + 0.3 * sevenDayAvg;
        }

        // ===== 4. SM-2 变体遗忘曲线（频率弹性）=====
        // q: 答题质量，正确→5，错误→2
        const q = isLastCorrect ? 5 : 2;
        // f: 频率弹性系数，高频词拉长间隔，低频词缩短间隔
        const f = studyFrequency > 1 ? 1.2 : 0.8;

        let newRepetitions: number;
        let newIntervalDays: number;
        if (isLastCorrect) {
          // 正确：repetitions 递增，intervalDays 按 SM-2 阶梯
          newRepetitions = profile.repetitions + 1;
          if (newRepetitions === 1) {
            newIntervalDays = 1;
          } else if (newRepetitions === 2) {
            newIntervalDays = 6;
          } else {
            // round(prevInterval * EF * f)，兜底至少 1 天
            newIntervalDays = Math.max(
              1,
              Math.round(profile.intervalDays * profile.easinessFactor * f)
            );
          }
        } else {
          // 错误：repetitions 归零，intervalDays 重置（受频率调节）
          newRepetitions = 0;
          newIntervalDays = Math.max(1, Math.round(f));
        }

        // easinessFactor: SM-2 公式，最低 1.3
        const newEF = Math.max(
          1.3,
          profile.easinessFactor +
            (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
        );

        // lastStudyTime: 取最近一条 ModeHistory 的时间
        const newLastStudyTime = lastRecord
          ? lastRecord.createdAt
          : new Date();

        // nextReviewAt: lastStudyTime + intervalDays 天
        const newNextReviewAt = new Date(
          newLastStudyTime.getTime() + newIntervalDays * DAY_MS
        );

        // ===== 5. streak 计算 =====
        const newCurrentStreak = isLastCorrect
          ? profile.currentStreak + 1
          : 0;
        const newMaxStreak = Math.max(profile.maxStreak, newCurrentStreak);

        // ===== 6. commonness（导入频率 + 易错反向）=====
        const importFreqNorm =
          maxLayoutCount > 0 ? cardLayoutCount / maxLayoutCount : 0;
        const newCommonness = clamp01(
          0.6 * importFreqNorm + 0.4 * (1 - errorProneness)
        );

        // ===== 7. difficulty（首次正确率反值 + 响应 + 易错）=====
        // 首次正确率：无记录时取 0.5（中性）
        const firstCorrectRate = firstRecord
          ? firstRecord.isCorrect
            ? 1
            : 0
          : 0.5;
        const newDifficulty = clamp01(
          0.4 * (1 - firstCorrectRate) +
            0.3 * responseNorm +
            0.3 * errorProneness
        );

        // ===== 8. debugSnapshot（调试快照，预留开发工具解析）=====
        const debugSnapshot = JSON.stringify({
          lastRecalc: {
            errorRate,
            forgettingProb,
            avgResponseMs,
            responseNorm,
            errorProneness,
            studyFrequency,
            intervalDays: newIntervalDays,
            easinessFactor: newEF,
            repetitions: newRepetitions,
            importFreqNorm,
            firstCorrectRate,
            recentCount: recent30.length,
            totalCount,
            timestamp: new Date().toISOString(),
          },
        });

        // ===== 9. 单条 update 持久化 =====
        await tx.wordProfile.update({
          where: { cardId },
          data: {
            lastStudyTime: newLastStudyTime,
            studyCount: totalCount,
            studyFrequency,
            avgResponseMs,
            errorProneness,
            difficulty: newDifficulty,
            lastResult: lastRecord ? isLastCorrect : null,
            currentStreak: newCurrentStreak,
            maxStreak: newMaxStreak,
            easinessFactor: newEF,
            intervalDays: newIntervalDays,
            repetitions: newRepetitions,
            nextReviewAt: newNextReviewAt,
            commonness: newCommonness,
            debugSnapshot,
            lastRecalcAt: new Date(),
          },
        });

        logger.debug("recalc 完成", {
          cardId,
          userId,
          errorProneness,
          studyFrequency,
          intervalDays: newIntervalDays,
        });
      });
    } catch (err) {
      // 特征重算失败不应阻断答题流程，但需记录以便排查
      logger.error("FeatureEngine.recalc 失败", { cardId, userId, error: String(err) });
      // 不抛出，由调用方决定是否重试（当前 API 选择继续返回）
    }
  }
}
