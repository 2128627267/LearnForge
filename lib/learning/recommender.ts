/**
 * 单词学习系统 - 推荐算法
 *
 * 设计依据：.doc/WORD_LEARNING_DESIGN.md §3
 *
 * 职责：
 *   根据用户最近答题历史，从候选池中选出下一道题的 { cardId, modeId, reason }。
 *
 * 流程（§3.6 伪代码）：
 *   1. buildCandidatePool（§3.2）：到期复习 + 薄弱点 + 关联扩展 + 新词，上限 200
 *   2. 多策略打分（§3.3）：S_review / S_weak / S_assoc / S_novel / S_diff 加权
 *   3. Top-8 + 轮盘赌采样（§3.5）：避免确定性疲劳
 *   4. selectMode（§3.4）：基于正确率/效率/连续惩罚选择考查方式
 *   5. 硬约束：不连续 3 次同 cardId、不连续 3 次同 modeId
 *
 * 性能预算：<200ms（候选池 ~200 条，打分 O(N)，selectMode O(N×M)）
 */
import { prisma } from "@/lib/db/prisma";
import {
  ACTIVE_MODES,
  clamp01,
  DEFAULT_WEIGHTS,
  LearnModeId,
  RecentAnswer,
  RecommendResult,
  RecommendWeights,
  ScoredCandidate,
  sigmoid,
} from "@/lib/learning/types";
import { getLogger } from "@/lib/utils/logger";

const logger = getLogger("Recommender");

const DAY_MS = 24 * 60 * 60 * 1000;

/** 候选池上限（§3.2） */
const CANDIDATE_POOL_LIMIT = 200;
/** Top-K 轮盘赌采样的 K 值（§3.5） */
const TOP_K = 8;
/** 关联扩展相似度阈值（§3.2） */
const ASSOC_SIM_THRESHOLD = 0.5;
/** 薄弱点易错度阈值（§3.2） */
const WEAK_ERROR_PRONENESS_THRESHOLD = 0.6;
/** 近似"已掌握"的连续正确次数阈值（用于关联扩展过滤） */
const MASTERED_STREAK_THRESHOLD = 5;
/** 默认无记录时的正确率假设（§3.4） */
const DEFAULT_ACC = 0.6;
/** 默认无记录时的效率假设（§3.4） */
const DEFAULT_EFFICIENCY = 0.5;

/**
 * 内部候选项类型：携带 WordProfile 关键字段 + 关联相似度 + 同单元计数
 */
interface Candidate {
  cardId: string;
  nextReviewAt: Date | null;
  intervalDays: number;
  errorProneness: number;
  lastResult: boolean | null;
  currentStreak: number;
  studyCount: number;
  repetitions: number;
  difficulty: number;
  commonness: number;
  /** 最近学习时间（用于冷却因子计算） */
  lastStudyTime: Date | null;
  /** 综合学习频率（高频→适度降优先级，防止过度密集学习同一词） */
  studyFrequency: number;
  /** 与最近掌握词的最大相似度（仅 S_assoc 使用） */
  maxAssocSim: number;
  /** 同单元在最近答题中的出现次数（用于 S_novel 衰减） */
  sameUnitRecentCount: number;
}

/**
 * 推荐下一道题。
 *
 * @param userId           学习用户 ID
 * @param recentAnswers    最近答题历史（顺序不限，内部按 timestamp 倒序使用）
 * @param weights          可配置权重（默认 DEFAULT_WEIGHTS）
 * @returns                推荐结果 { cardId, modeId, reason, candidatePoolSize }
 * @throws                 当无任何 word/phrase 候选时抛出 Error("NO_CANDIDATES")
 */
export async function recommendNext(
  userId: string,
  recentAnswers: RecentAnswer[],
  weights: RecommendWeights = DEFAULT_WEIGHTS
): Promise<RecommendResult> {
  // 将 recentAnswers 按 timestamp 倒序排列（最新在前），便于"连续 N 次"判定
  const sortedRecent = [...recentAnswers].sort(
    (a, b) => b.timestamp - a.timestamp
  );

  // ===== 1. 候选池生成 =====
  const candidates = await buildCandidatePool(userId, sortedRecent);
  if (candidates.length === 0) {
    logger.warn("候选池为空，无可用 word/phrase 卡片", { userId });
    throw new Error("NO_CANDIDATES");
  }

  // ===== 2. 计算用户近期平均正确率（用于 S_diff 的 target_diff）=====
  const userRecentCorrectRate =
    sortedRecent.length > 0
      ? sortedRecent.filter((a) => a.isCorrect).length / sortedRecent.length
      : 0.5;

  // ===== 3. 多策略打分 =====
  const scored = candidates.map((c) =>
    scoreCandidate(c, sortedRecent, weights, userRecentCorrectRate)
  );

  // ===== 4. 硬约束：过滤会形成"连续 3 次同 cardId"的候选 =====
  const lastTwoCardIds = sortedRecent.slice(0, 2).map((a) => a.cardId);
  const formsThreeSameCard =
    lastTwoCardIds.length === 2 && lastTwoCardIds[0] === lastTwoCardIds[1];
  const filtered = formsThreeSameCard
    ? scored.filter((s) => s.cardId !== lastTwoCardIds[0])
    : scored;

  // 若过滤后为空（极端情况：Top-8 全是同一 cardId），回退到原 scored
  const finalScored = filtered.length > 0 ? filtered : scored;

  // ===== 5. Top-K + 轮盘赌采样 =====
  const topK = finalScored
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);
  const picked = rouletteSample(topK);

  // ===== 6. selectMode：选择考查方式 =====
  const modeId = await selectMode(picked.cardId, sortedRecent);

  // ===== 7. 硬约束：若 modeId 会形成"连续 3 次同 modeId"，则换一个 =====
  const lastTwoModeIds = sortedRecent.slice(0, 2).map((a) => a.modeId);
  const formsThreeSameMode =
    lastTwoModeIds.length === 2 && lastTwoModeIds[0] === lastTwoModeIds[1];
  const finalModeId =
    formsThreeSameMode && modeId === lastTwoModeIds[0]
      ? pickAlternateMode(lastTwoModeIds[0], sortedRecent)
      : modeId;

  logger.debug("推荐完成", {
    userId,
    cardId: picked.cardId,
    modeId: finalModeId,
    candidatePoolSize: candidates.length,
    score: picked.score,
  });

  return {
    cardId: picked.cardId,
    modeId: finalModeId,
    reason: picked.reason,
    candidatePoolSize: candidates.length,
  };
}

// ==================== 候选池生成（§3.2）====================

/**
 * 构建候选池：
 *   1. 到期复习词（nextReviewAt <= now）
 *   2. 薄弱点词（errorProneness > 0.6 或 lastResult=false & currentStreak=0）
 *   3. 关联扩展词（最近掌握词的邻居，sim > 0.5）
 *   4. 新词（studyCount=0，按 commonness 降序）
 *   不足 200 则从全库按 difficulty 平滑采样补足。
 */
async function buildCandidatePool(
  userId: string,
  sortedRecent: RecentAnswer[]
): Promise<Candidate[]> {
  const now = new Date();
  const pool = new Map<string, Candidate>();

  // ---- 1. 到期复习词 ----
  const dueReviews = await prisma.wordProfile.findMany({
    where: { nextReviewAt: { lte: now } },
    take: 100,
  });
  for (const p of dueReviews) {
    pool.set(p.cardId, profileToCandidate(p));
  }

  // ---- 2. 薄弱点词 ----
  const weakWords = await prisma.wordProfile.findMany({
    where: {
      OR: [
        { errorProneness: { gt: WEAK_ERROR_PRONENESS_THRESHOLD } },
        { lastResult: false, currentStreak: 0 },
      ],
    },
    take: 100,
  });
  for (const p of weakWords) {
    if (!pool.has(p.cardId)) {
      pool.set(p.cardId, profileToCandidate(p));
    }
  }

  // ---- 3. 关联扩展词 ----
  await expandAssociations(sortedRecent, pool);

  // ---- 4. 新词（studyCount=0，按 commonness 降序）----
  const newWords = await prisma.wordProfile.findMany({
    where: { studyCount: 0 },
    orderBy: { commonness: "desc" },
    take: 50,
  });
  for (const p of newWords) {
    if (!pool.has(p.cardId)) {
      pool.set(p.cardId, profileToCandidate(p));
    }
  }

  // ---- 5. 不足 200 则从全库按 difficulty 平滑采样补足 ----
  if (pool.size < CANDIDATE_POOL_LIMIT) {
    const existingIds = Array.from(pool.keys());
    const extra = await prisma.wordProfile.findMany({
      where: { cardId: { notIn: existingIds } },
      // 按 difficulty 升序，优先补难度低的（平滑过渡）
      orderBy: { difficulty: "asc" },
      take: CANDIDATE_POOL_LIMIT - pool.size,
    });
    for (const p of extra) {
      pool.set(p.cardId, profileToCandidate(p));
    }
  }

  // ---- 6. 计算同单元最近出现次数（用于 S_novel 衰减）----
  // 简化实现：统计该 cardId 在 sortedRecent 中的出现次数作为 sameUnitRecentCount 近似
  // （严格按"同单元"需要 ImportLayout 关联，这里用 cardId 出现次数近似以控制性能）
  for (const c of pool.values()) {
    c.sameUnitRecentCount = sortedRecent.filter(
      (a) => a.cardId === c.cardId
    ).length;
  }

  // ---- 7. 上限 200 截断 ----
  const arr = Array.from(pool.values()).slice(0, CANDIDATE_POOL_LIMIT);
  return arr;
}

/** 将 WordProfile 转为 Candidate（maxAssocSim / sameUnitRecentCount 初始为 0） */
function profileToCandidate(p: {
  cardId: string;
  nextReviewAt: Date | null;
  intervalDays: number;
  errorProneness: number;
  lastResult: boolean | null;
  currentStreak: number;
  studyCount: number;
  repetitions: number;
  difficulty: number;
  commonness: number;
  lastStudyTime: Date | null;
  studyFrequency: number;
}): Candidate {
  return {
    cardId: p.cardId,
    nextReviewAt: p.nextReviewAt,
    intervalDays: p.intervalDays,
    errorProneness: p.errorProneness,
    lastResult: p.lastResult,
    currentStreak: p.currentStreak,
    studyCount: p.studyCount,
    repetitions: p.repetitions,
    difficulty: p.difficulty,
    commonness: p.commonness,
    lastStudyTime: p.lastStudyTime,
    studyFrequency: p.studyFrequency,
    maxAssocSim: 0,
    sameUnitRecentCount: 0,
  };
}

/**
 * 关联扩展：从最近掌握词出发，沿 WordRelation 边扩展邻居（sim > 0.5）。
 * 同时尝试从 correlationVector.neighbors JSON 中读取稀疏邻接作为补充。
 */
async function expandAssociations(
  sortedRecent: RecentAnswer[],
  pool: Map<string, Candidate>
): Promise<void> {
  // 最近掌握词：最近答题中 isCorrect 的 cardId（去重，最多 10 个）
  const recentCorrectCardIds = Array.from(
    new Set(
      sortedRecent.filter((a) => a.isCorrect).map((a) => a.cardId)
    )
  ).slice(0, 10);
  if (recentCorrectCardIds.length === 0) return;

  // 查 WordRelation 邻居（双向）
  const relations = await prisma.wordRelation.findMany({
    where: {
      OR: [
        { fromCardId: { in: recentCorrectCardIds } },
        { toCardId: { in: recentCorrectCardIds } },
      ],
      weight: { gt: ASSOC_SIM_THRESHOLD },
    },
    take: 200,
  });

  // 收集邻居 cardId 与最大相似度
  const simMap = new Map<string, number>();
  for (const r of relations) {
    let neighborId: string;
    if (recentCorrectCardIds.includes(r.fromCardId)) {
      neighborId = r.toCardId;
    } else {
      neighborId = r.fromCardId;
    }
    // 跳过已掌握词本身
    if (recentCorrectCardIds.includes(neighborId)) continue;
    const cur = simMap.get(neighborId) ?? 0;
    if (r.weight > cur) simMap.set(neighborId, r.weight);
  }

  if (simMap.size === 0) return;

  // 查邻居的 WordProfile
  const neighborProfiles = await prisma.wordProfile.findMany({
    where: { cardId: { in: Array.from(simMap.keys()) } },
  });
  for (const p of neighborProfiles) {
    // 跳过已"掌握"的邻居（currentStreak >= 5 近似 mastered）
    if (p.currentStreak >= MASTERED_STREAK_THRESHOLD) continue;
    const sim = simMap.get(p.cardId) ?? 0;
    const existing = pool.get(p.cardId);
    if (existing) {
      existing.maxAssocSim = Math.max(existing.maxAssocSim, sim);
    } else {
      const c = profileToCandidate(p);
      c.maxAssocSim = sim;
      pool.set(p.cardId, c);
    }
  }
}

// ==================== 多策略打分（§3.3）====================

/**
 * 对单个候选项计算 5 个子分与总评分。
 */
function scoreCandidate(
  c: Candidate,
  sortedRecent: RecentAnswer[],
  weights: RecommendWeights,
  userRecentCorrectRate: number
): ScoredCandidate {
  const now = Date.now();

  // ---- S_review：记忆巩固 ----
  // delay = (now - nextReviewAt) / intervalDays，超期比
  // S_review = sigmoid(delay) * (1 + errorProneness)
  let sReview = 0;
  if (c.nextReviewAt) {
    const delayMs = now - c.nextReviewAt.getTime();
    const intervalMs = Math.max(1, c.intervalDays * DAY_MS);
    const delay = delayMs / intervalMs;
    sReview = sigmoid(delay) * (1 + c.errorProneness);
  }

  // ---- S_weak：薄弱点攻击 ----
  // mastery = sigmoid(repetitions - 3)，repetitions 越大掌握度越高
  // S_weak = errorProneness * (lastResult错?1.3:1) * (1 - mastery)
  const mastery = sigmoid(c.repetitions - 3);
  const weakMultiplier = c.lastResult === false ? 1.3 : 1.0;
  const sWeak = c.errorProneness * weakMultiplier * (1 - mastery);

  // ---- S_assoc：关联扩展 ----
  // 仅对最近掌握词的邻居生效；已学过的词衰减 50%
  const sAssoc = c.maxAssocSim * (c.studyCount > 0 ? 0.5 : 1.0);

  // ---- S_novel：新颖性 ----
  // 新词优先；同单元出现次数多则衰减
  const sNovelBase = c.studyCount === 0 ? 1.0 : 0.3;
  const sNovel = sNovelBase * (1 - 0.5 * clamp01(c.sameUnitRecentCount / 10));

  // ---- S_diff：难度平滑 ----
  // target_diff = 1 - 用户近期平均正确率（正确率高→难度升）
  // S_diff = 1 - |difficulty - target_diff|
  const targetDiff = clamp01(1 - userRecentCorrectRate);
  const sDiff = 1 - Math.abs(c.difficulty - targetDiff);

  // ---- 总评分 ----
  const rawScore = clamp01(
    weights.review * sReview +
      weights.weak * sWeak +
      weights.assoc * sAssoc +
      weights.novel * sNovel +
      weights.diff * sDiff
  );

  // ---- 冷却因子（智能降优先级）----
  // 核心思想：当学习频率高、上次学习时间过近时，即使答错也降低优先级，
  // 避免过度密集地重复学习同一单词，让其他单词有机会出现。
  //
  // 时间冷却：lastStudyTime 距今越近，冷却越强
  //   cooldown = sigmoid((elapsed - COOLDOWN_MS) / COOLDOWN_HALF_LIFE)
  //   elapsed << COOLDOWN_MS → cooldown ≈ 0（几乎不推荐）
  //   elapsed >> COOLDOWN_MS → cooldown ≈ 1（正常推荐）
  //
  // 频率衰减：studyFrequency 越高，适度降低（防止高频词霸占）
  //   freqDecay = 1 / (1 + studyFrequency * FREQ_DECAY_FACTOR)
  let cooldown = 1.0;
  if (c.lastStudyTime) {
    const elapsedMs = now - c.lastStudyTime.getTime();
    // 冷却窗口：5 分钟内几乎不推荐同一词
    const COOLDOWN_MS = 5 * 60 * 1000;
    // 半衰期：控制冷却曲线陡峭度
    const COOLDOWN_HALF_LIFE = 3 * 60 * 1000;
    cooldown = sigmoid((elapsedMs - COOLDOWN_MS) / COOLDOWN_HALF_LIFE);
  }

  // 频率衰减：高频词适度降权（但不完全压制）
  const FREQ_DECAY_FACTOR = 0.3;
  const freqDecay = 1 / (1 + c.studyFrequency * FREQ_DECAY_FACTOR);

  // 最终评分 = 原始评分 × 冷却因子 × 频率衰减
  const score = clamp01(rawScore * cooldown * freqDecay);

  // ---- 生成可解释 reason ----
  const reasons: string[] = [];
  if (sReview > 0.5) reasons.push("到期复习");
  if (sWeak > 0.3) reasons.push("易错词");
  if (sAssoc > 0.3) reasons.push("关联扩展");
  if (c.studyCount === 0) reasons.push("新词");
  if (reasons.length === 0) reasons.push("难度匹配");
  // 附加易错修饰
  if (c.errorProneness > 0.6 && !reasons.includes("易错词")) {
    reasons.push("易错");
  }
  const reason = reasons.join("+");

  return {
    cardId: c.cardId,
    score,
    parts: {
      review: sReview,
      weak: sWeak,
      assoc: sAssoc,
      novel: sNovel,
      diff: sDiff,
    },
    reason,
  };
}

// ==================== 轮盘赌采样（§3.5）====================

/**
 * 轮盘赌采样：基于 score 的软最大化（softmax with temperature）。
 * 温度参数控制区分度：温度越高，高分项被选中概率越接近均匀；
 * 温度越低，高分项被选中概率越高。这里取 3.0 平衡多样性与质量。
 */
function rouletteSample(topK: ScoredCandidate[]): ScoredCandidate {
  if (topK.length === 1) return topK[0];
  const TEMPERATURE = 3.0;
  // 使用 exp(score * T) 作为权重，避免负数且增强区分度
  const weights = topK.map((c) => Math.exp(c.score * TEMPERATURE));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return topK[0];
  let r = Math.random() * total;
  for (let i = 0; i < topK.length; i++) {
    r -= weights[i];
    if (r <= 0) return topK[i];
  }
  return topK[topK.length - 1]; // 兜底
}

// ==================== 考查方式选择（§3.4）====================

/**
 * 选择考查方式：
 *   score(m) = (1 - acc(m)) + 0.3 * efficiency(m) - 0.5 * penalty(连续3次)
 *   - acc(m): 该词在 m 下的历史正确率（无记录用 0.6）
 *   - efficiency(m): 该词在 m 下错误后下次正确率提升幅度（无记录用 0.5）
 *   - penalty: 最近 3 次中该 mode 出现 >=3 次则 1，否则 0
 *
 * 选择 argmax score(m)，若 max < 0 则随机一个未连续使用的 mode。
 */
async function selectMode(
  cardId: string,
  sortedRecent: RecentAnswer[]
): Promise<LearnModeId> {
  // 查该 card 的所有 ModeHistory（按时间正序，便于"错误后下次"判定）
  const histories = await prisma.modeHistory.findMany({
    where: { cardId },
    orderBy: { createdAt: "asc" },
  });

  // 计算各 mode 的正确率与 efficiency
  const modeScores = new Map<LearnModeId, number>();
  for (const m of ACTIVE_MODES) {
    const mHistory = histories.filter((h) => h.modeId === m);
    const correct = mHistory.filter((h) => h.isCorrect).length;
    const total = mHistory.length;
    const acc = total > 0 ? correct / total : DEFAULT_ACC;

    // efficiency: 错误后下次正确的比例
    let efficiency = DEFAULT_EFFICIENCY;
    if (mHistory.length >= 2) {
      let improvements = 0;
      let opportunities = 0;
      for (let i = 0; i < mHistory.length - 1; i++) {
        if (!mHistory[i].isCorrect) {
          opportunities++;
          if (mHistory[i + 1].isCorrect) improvements++;
        }
      }
      if (opportunities > 0) efficiency = improvements / opportunities;
    }

    // penalty: 最近 3 次全局中该 mode 出现 >=3 次则 1
    const recentModeCount = sortedRecent
      .slice(0, 3)
      .filter((a) => a.modeId === m).length;
    const penalty = recentModeCount >= 3 ? 1 : 0;

    const score = 1 - acc + 0.3 * efficiency - 0.5 * penalty;
    modeScores.set(m, score);
  }

  // argmax
  let bestMode: LearnModeId = 3; // 默认 modeId=3（看释义拼写）
  let bestScore = -Infinity;
  for (const m of ACTIVE_MODES) {
    const s = modeScores.get(m) ?? 0;
    if (s > bestScore) {
      bestScore = s;
      bestMode = m;
    }
  }

  // 若 max < 0，随机选一个未连续使用的 mode
  if (bestScore < 0) {
    bestMode = pickAlternateMode(bestMode, sortedRecent);
  }

  return bestMode;
}

/**
 * 选择一个与最近使用模式不同的 mode（避免连续）。
 * 优先选最近 3 次中出现次数最少的 mode。
 */
function pickAlternateMode(
  excludeMode: LearnModeId,
  sortedRecent: RecentAnswer[]
): LearnModeId {
  // 统计最近 3 次各 mode 出现次数
  const recentModes = sortedRecent.slice(0, 3).map((a) => a.modeId);
  const countMap = new Map<LearnModeId, number>();
  for (const m of ACTIVE_MODES) countMap.set(m, 0);
  for (const m of recentModes) {
    countMap.set(m, (countMap.get(m) ?? 0) + 1);
  }
  // 选出现次数最少的 mode（排除 excludeMode 优先）
  const candidates = ACTIVE_MODES.filter((m) => m !== excludeMode);
  candidates.sort((a, b) => (countMap.get(a) ?? 0) - (countMap.get(b) ?? 0));
  return candidates[0] ?? 3;
}
