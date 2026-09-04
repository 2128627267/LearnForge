/**
 * 项目记忆聚合服务
 *
 * 职责：
 *   从各业务模块（统计、画布、英语学习、单词学习）自动收集数据，
 *   生成系统级项目记忆（source=system_auto, autoRefresh=true），
 *   为 AI 问答提供丰富的项目上下文。
 *
 * 设计原则：
 *   1. 各模块独立聚合，互不影响（某模块失败不阻断整体）
 *   2. 幂等更新：每次刷新用 upsert，按 scope+moduleId 唯一标识
 *   3. 数据精简：只生成摘要文本，避免注入过多 token
 *   4. 失效缓存：刷新后调用 invalidateMemoryCache
 *
 * 生成的记忆按 scope 分类：
 *   - stats: 学习概览（总卡片数、掌握率、连续学习天数等）
 *   - canvas: 画布数据（节点数、连接数、标签数）
 *   - english: 英语学习（单词数、短语数、待复习数、易错词）
 *   - learn: 学习会话（最近答题分布、薄弱点）
 */
import { prisma } from "@/lib/db/prisma";
import { getLogger } from "@/lib/utils/logger";
import { invalidateMemoryCache } from "@/lib/ai/memory-cache";

const logger = getLogger("MemoryAggregator");

/** 各模块的固定 moduleId（用于 upsert 唯一标识） */
const MODULE_IDS = {
  statsOverview: "stats:overview",
  canvasOverview: "canvas:overview",
  englishOverview: "english:overview",
  learnOverview: "learn:overview",
} as const;

/**
 * 聚合统计模块数据，生成学习概览记忆
 *
 * 收集指标：
 *   - 总卡片数、已掌握数、掌握率
 *   - 今日学习次数、连续学习天数
 *   - 学习行为总数、收藏数
 */
async function aggregateStats(): Promise<void> {
  // 并行查询所有统计指标
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const thirtyDaysAgo = new Date(todayStart);
  thirtyDaysAgo.setDate(todayStart.getDate() - 29);

  const [
    totalCards,
    masteredCount,
    totalLogs,
    totalFavorites,
    todayLogs,
    recent30DaysLogs,
  ] = await Promise.all([
    prisma.card.count(),
    prisma.card.count({ where: { status: "mastered" } }),
    prisma.studyLog.count(),
    prisma.cardFavorite.count(),
    prisma.studyLog.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.studyLog.findMany({
      where: { createdAt: { gte: thirtyDaysAgo } },
      select: { createdAt: true },
    }),
  ]);

  // 计算连续学习天数
  const studyDates = new Set<string>();
  for (const log of recent30DaysLogs) {
    const d = log.createdAt;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    studyDates.add(key);
  }
  let streakDays = 0;
  const cursor = new Date(todayStart);
  if (!studyDates.has(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`)) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (streakDays < 30) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    if (!studyDates.has(key)) break;
    streakDays++;
    cursor.setDate(cursor.getDate() - 1);
  }

  const masteryRate = totalCards > 0 ? ((masteredCount / totalCards) * 100).toFixed(1) : "0";

  const content = [
    `总卡片数：${totalCards}`,
    `已掌握：${masteredCount}（掌握率 ${masteryRate}%）`,
    `今日学习：${todayLogs} 次`,
    `连续学习：${streakDays} 天`,
    `累计学习行为：${totalLogs} 次`,
    `收藏卡片：${totalFavorites} 张`,
  ].join("\n");

  await upsertSystemMemory({
    scope: "stats",
    moduleId: MODULE_IDS.statsOverview,
    title: "学习概览统计",
    content,
    priority: 0.7,
  });

  logger.debug("统计模块记忆已聚合", { totalCards, masteredCount, streakDays });
}

/**
 * 聚合画布模块数据
 *
 * 收集指标：
 *   - 画布卡片总数（按类型分布）
 *   - 卡片关联数（CardRelation）
 *   - 标签数
 *
 * 注意：画布的节点/连线存储在 localStorage（前端），
 *       此处仅聚合数据库中的卡片与关系数据
 */
async function aggregateCanvas(): Promise<void> {
  const [cardsByType, totalRelations, totalTags] = await Promise.all([
    prisma.card.groupBy({ by: ["type"], _count: true }),
    prisma.cardRelation.count(),
    prisma.tag.count(),
  ]);

  const typeBreakdown = cardsByType
    .map((t) => `${t.type}: ${t._count}`)
    .join("、");

  const content = [
    `画布卡片类型分布：${typeBreakdown || "无"}`,
    `卡片关联关系：${totalRelations} 条`,
    `标签总数：${totalTags} 个`,
  ].join("\n");

  await upsertSystemMemory({
    scope: "canvas",
    moduleId: MODULE_IDS.canvasOverview,
    title: "画布数据概览",
    content,
    priority: 0.5,
  });

  logger.debug("画布模块记忆已聚合", { totalRelations, totalTags });
}

/**
 * 聚合英语学习模块数据
 *
 * 收集指标：
 *   - 单词/短语/语法卡片数
 *   - 待复习单词数（WordProfile.nextReviewAt <= now）
 *   - 易错单词 Top 5
 *   - 音标/释义/例句缺失数
 */
async function aggregateEnglish(): Promise<void> {
  const englishSubject = await prisma.subject.findUnique({
    where: { slug: "english" },
  });

  if (!englishSubject) {
    // 英语学科未创建，删除旧记忆（如有）
    await deleteSystemMemory("english", MODULE_IDS.englishOverview);
    return;
  }

  const now = new Date();

  const [
    wordCount,
    phraseCount,
    grammarCount,
    dueReviewCount,
    topErrorProne,
    missingPhonetic,
    missingMeanings,
  ] = await Promise.all([
    prisma.card.count({
      where: { subjectId: englishSubject.id, type: "word" },
    }),
    prisma.card.count({
      where: { subjectId: englishSubject.id, type: "phrase" },
    }),
    prisma.card.count({
      where: { subjectId: englishSubject.id, type: "grammar" },
    }),
    prisma.wordProfile.count({
      where: { nextReviewAt: { not: null, lte: now } },
    }),
    prisma.wordProfile.findMany({
      orderBy: { errorProneness: "desc" },
      take: 5,
      include: { card: { select: { title: true } } },
    }),
    prisma.card.count({
      where: { subjectId: englishSubject.id, type: "word", phonetic: null },
    }),
    prisma.card.count({
      where: { subjectId: englishSubject.id, type: "word", meanings: null },
    }),
  ]);

  const weakWords = topErrorProne
    .map((w) => `${w.card.title}(${(w.errorProneness * 100).toFixed(0)}%)`)
    .join("、");

  const content = [
    `英语单词：${wordCount} 个`,
    `英语短语：${phraseCount} 个`,
    `语法卡片：${grammarCount} 张`,
    `待复习单词：${dueReviewCount} 个`,
    `易错词 Top5：${weakWords || "暂无"}`,
    `缺失音标：${missingPhonetic} 个`,
    `缺失释义：${missingMeanings} 个`,
  ].join("\n");

  await upsertSystemMemory({
    scope: "english",
    moduleId: MODULE_IDS.englishOverview,
    title: "英语学习概览",
    content,
    priority: 0.8, // 英语学习是核心场景，优先级高
  });

  logger.debug("英语模块记忆已聚合", { wordCount, dueReviewCount });
}

/**
 * 聚合单词学习会话数据
 *
 * 收集指标：
 *   - 最近 20 次答题的正确率
 *   - 各考查方式分布
 *   - 最近学习卡片数（去重）
 */
async function aggregateLearn(): Promise<void> {
  const recentHistory = await prisma.modeHistory.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { isCorrect: true, modeId: true, cardId: true },
  });

  if (recentHistory.length === 0) {
    await deleteSystemMemory("learn", MODULE_IDS.learnOverview);
    return;
  }

  const total = recentHistory.length;
  const correct = recentHistory.filter((h) => h.isCorrect).length;
  const accuracy = ((correct / total) * 100).toFixed(1);

  const modeDistribution: Record<number, number> = {};
  for (const h of recentHistory) {
    modeDistribution[h.modeId] = (modeDistribution[h.modeId] ?? 0) + 1;
  }
  const modeNames: Record<number, string> = {
    1: "缺失单词句子",
    2: "缺失字母拼写",
    3: "看释义拼写",
    4: "ABCD选择",
  };
  const modeBreakdown = Object.entries(modeDistribution)
    .map(([m, c]) => `${modeNames[Number(m)] ?? m}: ${c}`)
    .join("、");

  const uniqueCards = new Set(recentHistory.map((h) => h.cardId)).size;

  const content = [
    `最近 ${total} 次答题正确率：${accuracy}%`,
    `考查方式分布：${modeBreakdown}`,
    `涉及单词：${uniqueCards} 个`,
  ].join("\n");

  await upsertSystemMemory({
    scope: "learn",
    moduleId: MODULE_IDS.learnOverview,
    title: "学习会话概览",
    content,
    priority: 0.75,
  });

  logger.debug("学习模块记忆已聚合", { total, accuracy });
}

// ==================== 内部工具函数 ====================

/**
 * 幂等写入系统自动记忆
 *
 * 策略：按 scope + moduleId 查找现有记忆
 *   - 存在：更新 title/content/priority，保留 active 状态
 *   - 不存在：创建新记忆
 *
 * @param params.scope     作用域
 * @param params.moduleId  模块标识
 * @param params.title     记忆标题
 * @param params.content   记忆内容
 * @param params.priority  优先级
 */
async function upsertSystemMemory(params: {
  scope: string;
  moduleId: string;
  title: string;
  content: string;
  priority: number;
}): Promise<void> {
  // 查找现有记忆（scope + moduleId 唯一）
  const existing = await prisma.projectMemory.findFirst({
    where: { scope: params.scope, moduleId: params.moduleId },
  });

  if (existing) {
    // 更新（保留 active 状态，由用户控制是否启用）
    await prisma.projectMemory.update({
      where: { id: existing.id },
      data: {
        title: params.title,
        content: params.content,
        priority: params.priority,
        lastUsedAt: new Date(),
      },
    });
  } else {
    // 创建新的系统自动记忆
    await prisma.projectMemory.create({
      data: {
        title: params.title,
        content: params.content,
        type: "summary",
        scope: params.scope,
        moduleId: params.moduleId,
        source: "system_auto",
        autoRefresh: true,
        priority: params.priority,
        active: true,
        tags: "[]",
      },
    });
  }
}

/**
 * 删除指定 scope + moduleId 的系统记忆
 * 用于模块无数据时清理旧记忆
 */
async function deleteSystemMemory(
  scope: string,
  moduleId: string
): Promise<void> {
  await prisma.projectMemory.deleteMany({
    where: { scope, moduleId, source: "system_auto" },
  });
}

// ==================== 对外入口 ====================

/**
 * 刷新所有模块的系统自动记忆
 *
 * 流程：
 *   1. 并行聚合各模块数据
 *   2. 任一模块失败不阻断其他模块
 *   3. 完成后失效缓存
 *
 * @returns 各模块聚合结果（成功/失败）
 */
export async function refreshAllModuleMemories(): Promise<{
  stats: boolean;
  canvas: boolean;
  english: boolean;
  learn: boolean;
}> {
  logger.info("开始刷新所有模块项目记忆");

  // 并行执行各模块聚合，单个失败不影响其他
  const results = await Promise.allSettled([
    aggregateStats(),
    aggregateCanvas(),
    aggregateEnglish(),
    aggregateLearn(),
  ]);

  const labels = ["stats", "canvas", "english", "learn"] as const;
  const status: Record<string, boolean> = {};
  results.forEach((r, i) => {
    const label = labels[i];
    status[label] = r.status === "fulfilled";
    if (r.status === "rejected") {
      logger.warn(`${label} 模块聚合失败`, { error: String(r.reason) });
    }
  });

  // 失效缓存，下次读取时重新加载
  invalidateMemoryCache();

  logger.info("所有模块项目记忆刷新完成", status);
  return status as {
    stats: boolean;
    canvas: boolean;
    english: boolean;
    learn: boolean;
  };
}

/**
 * 仅刷新指定模块的记忆（用于精准刷新）
 *
 * @param scope 模块作用域：stats | canvas | english | learn
 */
export async function refreshModuleMemory(
  scope: string
): Promise<boolean> {
  logger.info("刷新指定模块项目记忆", { scope });

  try {
    switch (scope) {
      case "stats":
        await aggregateStats();
        break;
      case "canvas":
        await aggregateCanvas();
        break;
      case "english":
        await aggregateEnglish();
        break;
      case "learn":
        await aggregateLearn();
        break;
      default:
        logger.warn("未知的模块作用域", { scope });
        return false;
    }
    invalidateMemoryCache();
    return true;
  } catch (err) {
    logger.error("刷新模块记忆失败", { scope, error: String(err) });
    return false;
  }
}
