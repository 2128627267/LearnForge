/**
 * SM-2 间隔重复算法
 * SuperMemo-2 算法实现，用于智能复习计划
 *
 * 算法核心：
 * - 根据用户对卡片的回忆质量（0-5）调整下次复习间隔
 * - 质量越高，间隔越长；连续高质量回忆会指数级增长间隔
 * - easeFactor 反映卡片难度，越低越难
 */

/** 回忆质量评分（0-5） */
export type Quality = 0 | 1 | 2 | 3 | 4 | 5;

/** SM-2 复习状态 */
export interface SM2State {
  /** 已复习次数 */
  repetitions: number;
  /** 间隔天数 */
  interval: number;
  /** 难度系数（最小 1.3） */
  easeFactor: number;
  /** 上次复习时间戳 */
  lastReviewAt: number | null;
}

/** 默认初始状态 */
export const INITIAL_SM2_STATE: SM2State = {
  repetitions: 0,
  interval: 0,
  easeFactor: 2.5,
  lastReviewAt: null,
};

/**
 * 计算 SM-2 下一次复习状态
 * @param prevState 上一次状态
 * @param quality 本次回忆质量（0-5）
 *   5: 完美回忆
 *   4: 正确但稍有犹豫
 *   3: 正确但费较大力气
 *   2: 错误但接近正确
 *   1: 错误，但有印象
 *   0: 完全忘记
 * @returns 新的状态（含 nextReviewAt 时间戳）
 */
export function calculateSM2(
  prevState: SM2State,
  quality: Quality
): SM2State & { nextReviewAt: number } {
  const now = Date.now();

  // 质量低于 3 视为未掌握，重置 repetitions
  if (quality < 3) {
    return {
      repetitions: 0,
      interval: 1, // 明天再复习
      easeFactor: Math.max(1.3, prevState.easeFactor - 0.2),
      lastReviewAt: now,
      nextReviewAt: now + 1 * 24 * 60 * 60 * 1000,
    };
  }

  // 更新难度系数
  const newEaseFactor = Math.max(
    1.3,
    prevState.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  );

  // 计算新间隔
  const newRepetitions = prevState.repetitions + 1;
  let newInterval: number;
  if (newRepetitions === 1) {
    newInterval = 1;
  } else if (newRepetitions === 2) {
    newInterval = 6;
  } else {
    newInterval = Math.round(prevState.interval * newEaseFactor);
  }

  return {
    repetitions: newRepetitions,
    interval: newInterval,
    easeFactor: newEaseFactor,
    lastReviewAt: now,
    nextReviewAt: now + newInterval * 24 * 60 * 60 * 1000,
  };
}

/**
 * 便捷函数：将质量评分映射为可读标签
 */
export function qualityLabel(q: Quality): string {
  return ["完全忘记", "有印象", "接近正确", "费力正确", "略加思索", "完美回忆"][q];
}
