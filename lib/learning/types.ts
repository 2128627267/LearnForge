/**
 * 单词学习系统 - 共享类型定义
 *
 * 设计依据：.doc/WORD_LEARNING_DESIGN.md
 * 约束：禁止删除原始数据 · 必有对照 · 数学化关联 · 考查方式历史分析
 *
 * 本文件为各模块（特征引擎、推荐算法、导入适配、调度器、前端）的契约层，
 * 任何模块都应从这里导入类型，避免重复定义与不一致。
 */

// ==================== 考查方式 ====================

/**
 * 考查方式编号（与 Prisma ModeHistory.modeId 对应）
 * - 1: 缺失单词句子（例句挖空，给整句中文翻译作为对照）
 * - 2: 缺失字母拼写（a__rm，给音标/释义作为对照）
 * - 3: 看释义拼写（给词性作为对照）
 * - 4: ABCD 选择（给句子语境作为对照）
 * - 5: 听写（预留，当前不实现）
 */
export const LEARN_MODES = {
  SENTENCE_GAP: 1,
  LETTER_GAP: 2,
  MEANING_TO_SPELL: 3,
  MULTI_CHOICE: 4,
  DICTATION: 5,
} as const;

export type LearnModeId =
  (typeof LEARN_MODES)[keyof typeof LEARN_MODES];

/** 当前实现的考查方式（5=听写预留） */
export const ACTIVE_MODES: LearnModeId[] = [1, 2, 3, 4];

/** 考查方式元信息：对照锚点要求 */
export interface ModeMeta {
  id: LearnModeId;
  name: string;
  /** 该模式必须提供的对照锚点字段（"必有对照"约束） */
  requiresAnchor: Array<"translation" | "phonetic" | "meaning" | "partOfSpeech" | "sentence">;
}

export const MODE_META: Record<LearnModeId, ModeMeta> = {
  1: {
    id: 1,
    name: "缺失单词句子",
    requiresAnchor: ["translation"], // 必须给整句中文翻译
  },
  2: {
    id: 2,
    name: "缺失字母拼写",
    requiresAnchor: ["phonetic", "meaning"], // 音标或英文释义
  },
  3: {
    id: 3,
    name: "看释义拼写",
    requiresAnchor: ["partOfSpeech"], // 词性
  },
  4: {
    id: 4,
    name: "ABCD 选择",
    requiresAnchor: ["sentence"], // 句子语境
  },
  5: {
    id: 5,
    name: "听写",
    requiresAnchor: ["translation"],
  },
};

// ==================== 推荐算法 ====================

/** 推荐算法可配置权重（便于 A/B 测试） */
export interface RecommendWeights {
  /** 记忆巩固权重 α */
  review: number;
  /** 薄弱点攻击权重 β */
  weak: number;
  /** 关联扩展权重 γ */
  assoc: number;
  /** 新颖性权重 δ */
  novel: number;
  /** 难度平滑权重 ε */
  diff: number;
}

export const DEFAULT_WEIGHTS: RecommendWeights = {
  review: 0.35,
  weak: 0.25,
  assoc: 0.20,
  novel: 0.10,
  diff: 0.10,
};

/** 候选项打分中间结果（可解释性） */
export interface ScoredCandidate {
  cardId: string;
  /** 总评分 S(w) */
  score: number;
  /** 子分明细，便于 explain */
  parts: {
    review: number;
    weak: number;
    assoc: number;
    novel: number;
    diff: number;
  };
  /** 推荐理由（人类可读） */
  reason: string;
}

/** 推荐算法输出 */
export interface RecommendResult {
  cardId: string;
  modeId: LearnModeId;
  reason: string;
  /** 候选池大小（用于调试/可解释） */
  candidatePoolSize: number;
}

/** 最近答题历史项（推荐算法输入） */
export interface RecentAnswer {
  cardId: string;
  modeId: LearnModeId;
  isCorrect: boolean;
  timestamp: number;
}

// ==================== 答题 API 契约 ====================

/** /api/learn/next 响应载荷 */
export interface NextQuestionPayload {
  cardId: string;
  modeId: LearnModeId;
  /** 题目展示数据（由考查方式决定结构） */
  question: QuestionData;
  /** 会话统计（累计） */
  sessionStats: SessionStats;
}

/** 题目展示数据（按 modeId 区分） */
export interface QuestionData {
  modeId: LearnModeId;
  /** 主展示文本（如挖空句子、缺失字母单词、中文释义） */
  prompt: string;
  /** 对照锚点（必有，满足"必有对照"约束） */
  anchor: {
    translation?: string;
    phonetic?: string;
    meaning?: string;
    partOfSpeech?: string;
    sentence?: string;
    /**
     * 当前单词在此句子中的具体释义（modeId=1/4 使用）
     *
     * 解决问题：单词若有多个意思，整句翻译无法体现此单词在句中的具体释义。
     * 例如 "bank" 有"银行/河岸"两义，句子 "I deposited money in the bank." 中是"银行"，
     * 此时 meaningInContext = "银行"，避免与 meanings[0] 不一致。
     *
     * 数据来源：sentences JSON 中的 meaningInContext 字段
     */
    meaningInContext?: string;
  };
  /** ABCD 模式的选项 */
  options?: string[];
  /** 缺失字母模式的占位符（如 "a__rm"） */
  maskedWord?: string;
  /**
   * 缺失字母模式的分段表示（合并为一行渲染用）
   * 每段：{ char: 显示的字符, masked: 是否为缺失位 }
   * 例如 "a__rm" → [{char:"a",masked:false},{char:"l",masked:true},{char:"a",masked:true},{char:"r",masked:false},{char:"m",masked:false}]
   */
  maskedSegments?: Array<{ char: string; masked: boolean }>;
  /** 缺失字母的正确答案（如 "la"），用于前端只填缺失部分 */
  missingAnswer?: string;
  /** 单词长度（用于键入框提示） */
  wordLength?: number;
}

/** /api/learn/answer 请求 */
export interface AnswerRequest {
  cardId: string;
  modeId: LearnModeId;
  /** 用户答案（键入文本或选项） */
  answer: string;
  /** 答题响应时长（毫秒） */
  responseMs: number;
  /** 会话标识（用于统计） */
  sessionId?: string;
}

/** /api/learn/answer 响应 */
export interface AnswerResponse {
  correct: boolean;
  /** 正确答案 */
  correctAnswer: string;
  /** 简要解释（词根/词缀/释义） */
  explanation: string;
  /** 更新后的画像摘要 */
  updatedProfile: {
    studyCount: number;
    errorProneness: number;
    nextReviewAt: string | null;
    currentStreak: number;
  };
  /** 会话统计 */
  sessionStats: SessionStats;
}

/** 会话统计 */
export interface SessionStats {
  total: number;
  correct: number;
  /** 平均响应时长 */
  avgResponseMs: number;
  /** 各考查方式出现次数 */
  modeDistribution: Record<number, number>;
}

// ==================== 关联集（数学化表达） ====================

/**
 * 关联向量（存储于 WordProfile.correlationVector JSON 字段）
 * - dim: 降维嵌入向量（32 维，AI 或结构哈希生成）
 * - neighbors: 稀疏邻接 Top-K（K=20），按权重排序
 */
export interface CorrelationVector {
  /** 嵌入向量 */
  dim: number[];
  /** 稀疏邻接 */
  neighbors: Array<{
    id: string;
    /** 关联权重 0-1 */
    w: number;
    /** 关联类型 */
    t: "ai_semantic" | "cooccurrence" | "structural" | "behavioral" | "soft_layout";
  }>;
  /** 向量版本（结构变更时递增） */
  version: number;
  updatedAt: string;
}

export const EMPTY_VECTOR: CorrelationVector = {
  dim: [],
  neighbors: [],
  version: 1,
  updatedAt: new Date(0).toISOString(),
};

// ==================== 软相关性（原始布局）====================

/** 层级标签（导入时从原始布局提取） */
export interface HierarchyTags {
  /** 数据包名 */
  pack: string;
  /** 文件名（单元/课时） */
  unit: string;
  /** 文件类型 */
  fileType: string;
  /** 在文件中的顺序 */
  order: number;
}

// ==================== 工具函数 ====================

/** sigmoid 函数 */
export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** 余弦相似度 */
export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** 限定到 [0,1] */
export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
