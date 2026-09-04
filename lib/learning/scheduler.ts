/**
 * 学习调度器
 *
 * 设计依据：.doc/WORD_LEARNING_DESIGN.md §6.1
 *
 * 职责：
 *   - runIdleTasks(userId)：会话结束时触发，顺序执行
 *     共现统计 → 结构片段挖掘 → 行为聚类 → 资源回收
 *     （AI 语义分析不在此触发，太重）
 *   - runBatchOptimize()：定时触发（每小时），执行全部任务含 AI 语义分析（批量）
 *   - 每个任务 try-catch 独立，失败不阻塞后续
 *   - 记录执行日志（用 logger）
 *   - 返回 { tasks: [{name, success, durationMs, affected}] }
 *
 * 关键约束：后台任务不阻塞学习页面交互
 *   - session/end API 以 fire-and-forget 方式调用 runIdleTasks
 *   - cron/optimize API 由外部定时器触发 runBatchOptimize
 */
import { prisma } from "@/lib/db/prisma";
import { getLogger } from "@/lib/utils/logger";
import { runCooccurrence } from "./tasks/cooccurrence";
import { runStructural } from "./tasks/structural";
import { runBehavioral } from "./tasks/behavioral";
import { runAISemantic } from "./tasks/ai-semantic";
import { runCleanup } from "./tasks/resource-cleanup";

const logger = getLogger("LearningScheduler");

/** 单次任务执行结果 */
export interface TaskResult {
  /** 任务名称 */
  name: string;
  /** 是否成功 */
  success: boolean;
  /** 耗时（毫秒） */
  durationMs: number;
  /** 影响的记录数（写入/删除的关系或记录数） */
  affected: number;
  /** 失败时的错误信息 */
  error?: string;
}

/** 调度器整体执行结果 */
export interface ScheduleResult {
  tasks: TaskResult[];
}

/** AI 批量优化单次处理的卡片数上限（避免 API 账单爆炸） */
const AI_BATCH_CARD_LIMIT = 200;

/**
 * 学习调度器：统一编排各类后台优化任务。
 *
 * 设计为实例方法集，通过 scheduler 单例调用。
 * 顺序执行（SQLite 单写并发性能有限），避免事务冲突。
 */
export class LearningScheduler {
  /**
   * 计时执行单个任务，自动 try-catch。
   *
   * @param name 任务名称（用于日志与结果）
   * @param fn   任务函数，返回影响的记录数
   * @returns 任务执行结果
   */
  private async runTask(
    name: string,
    fn: () => Promise<number>
  ): Promise<TaskResult> {
    const start = Date.now();
    try {
      const affected = await fn();
      const durationMs = Date.now() - start;
      logger.info(`任务完成: ${name}`, { durationMs, affected });
      return { name, success: true, durationMs, affected };
    } catch (err) {
      const durationMs = Date.now() - start;
      const error = String(err);
      logger.error(`任务失败: ${name}`, { durationMs, error });
      return { name, success: false, durationMs, affected: 0, error };
    }
  }

  /**
   * 空闲触发：学习会话结束时调用。
   *
   * 顺序执行（不含 AI 语义分析，太重）：
   *   1. 共现统计（<500ms）
   *   2. 结构片段挖掘（<300ms）
   *   3. 行为聚类（<2s）
   *   4. 资源回收（<1s）
   *
   * 每个任务 try-catch 独立，失败不阻塞后续。
   *
   * @param userId 学习用户 ID
   * @returns 各任务执行结果
   */
  async runIdleTasks(userId: string): Promise<ScheduleResult> {
    logger.info("空闲优化任务开始", { userId });
    const tasks: TaskResult[] = [];

    // 顺序执行，避免并发对 SQLite 造成写锁压力
    tasks.push(await this.runTask("cooccurrence", () => runCooccurrence(userId)));
    tasks.push(await this.runTask("structural", () => runStructural(userId)));
    tasks.push(await this.runTask("behavioral", () => runBehavioral(userId)));
    // 资源回收返回多维度统计，汇总为单一 affected 数
    tasks.push(
      await this.runTask("cleanup", async () => {
        const r = await runCleanup();
        return (
          r.modeHistoryDeleted +
          r.invalidStructuralDeleted +
          r.noiseRelationsDeleted
        );
      })
    );

    const successCount = tasks.filter((t) => t.success).length;
    logger.info("空闲优化任务结束", {
      userId,
      taskCount: tasks.length,
      successCount,
    });
    return { tasks };
  }

  /**
   * 定时触发：每小时由 /api/cron/optimize 调用。
   *
   * 执行全部任务含 AI 语义分析（批量）：
   *   1. 共现统计
   *   2. 结构片段挖掘
   *   3. 行为聚类
   *   4. AI 语义分析（取最近 200 个 word/phrase 卡片，分批处理）
   *   5. 资源回收
   *
   * @returns 各任务执行结果
   */
  async runBatchOptimize(): Promise<ScheduleResult> {
    logger.info("批量优化任务开始");
    const tasks: TaskResult[] = [];

    // 非 AI 任务（全局，不传 userId）
    tasks.push(await this.runTask("cooccurrence", () => runCooccurrence()));
    tasks.push(await this.runTask("structural", () => runStructural()));
    tasks.push(await this.runTask("behavioral", () => runBehavioral()));

    // AI 语义分析：取最近 200 个 word/phrase 卡片
    tasks.push(
      await this.runTask("ai_semantic", async () => {
        const cards = await prisma.card.findMany({
          where: { type: { in: ["word", "phrase"] } },
          select: { id: true },
          orderBy: { createdAt: "desc" },
          take: AI_BATCH_CARD_LIMIT,
        });
        return runAISemantic(cards.map((c) => c.id));
      })
    );

    // 资源回收（放在最后，清理本批产生的低权重噪声）
    tasks.push(
      await this.runTask("cleanup", async () => {
        const r = await runCleanup();
        return (
          r.modeHistoryDeleted +
          r.invalidStructuralDeleted +
          r.noiseRelationsDeleted
        );
      })
    );

    const successCount = tasks.filter((t) => t.success).length;
    logger.info("批量优化任务结束", {
      taskCount: tasks.length,
      successCount,
    });
    return { tasks };
  }
}

/** 调度器单例 */
export const scheduler = new LearningScheduler();
