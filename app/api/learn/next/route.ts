/**
 * GET /api/learn/next
 *
 * 设计依据：.doc/WORD_LEARNING_DESIGN.md §7
 *
 * 流程：
 *   1. 获取学习用户 ID（getLearnUserId）
 *   2. 读取最近 20 条 ModeHistory 作为 recentAnswers
 *   3. 调用 recommendNext 推荐算法
 *   4. 根据 cardId + modeId 构建 QuestionData：
 *      - modeId=1: 例句挖空，anchor.translation 给中文翻译（无则 meanings[0]）
 *      - modeId=2: 缺失字母（挖 30%），anchor 给 phonetic 或 meanings[0]
 *      - modeId=3: prompt=meanings[0]，anchor.partOfSpeech
 *      - modeId=4: 例句语境，options 含正确词 + 3 个干扰词
 *   5. 数据不足时回退 modeId=3（至少有词性/释义对照）
 *   6. 返回 NextQuestionPayload（含 sessionStats）
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getLearnUserId } from "@/lib/learning/auth";
import { recommendNext } from "@/lib/learning/recommender";
import {
  LearnModeId,
  NextQuestionPayload,
  QuestionData,
  RecentAnswer,
  SessionStats,
} from "@/lib/learning/types";
import { getLogger } from "@/lib/utils/logger";

const logger = getLogger("LearnNextAPI");

// 该路由每次请求都需读取最新学习状态并运行推荐算法，强制动态渲染
export const dynamic = "force-dynamic";

/** 读取最近答题历史的条数（与推荐算法输入对齐） */
const RECENT_HISTORY_LIMIT = 20;
/** modeId=4 的干扰词数量 */
const DISTRACTOR_COUNT = 3;
/** modeId=2 挖字母比例 */
const LETTER_MASK_RATIO = 0.3;

/**
 * GET /api/learn/next
 * 返回下一道推荐题目。
 */
export async function GET() {
  try {
    // ===== 1. 获取学习用户 =====
    const userId = await getLearnUserId();

    // ===== 2. 读取最近 20 条 ModeHistory =====
    const recentHistory = await prisma.modeHistory.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: RECENT_HISTORY_LIMIT,
    });
    const recentAnswers: RecentAnswer[] = recentHistory.map((h) => ({
      cardId: h.cardId,
      modeId: h.modeId as LearnModeId,
      isCorrect: h.isCorrect,
      timestamp: h.createdAt.getTime(),
    }));

    // ===== 3. 调用推荐算法 =====
    let recommend;
    try {
      recommend = await recommendNext(userId, recentAnswers);
    } catch (err) {
      // 候选池为空：无任何 word/phrase 卡片可学
      if (err instanceof Error && err.message === "NO_CANDIDATES") {
        return NextResponse.json(
          {
            error: "暂无可学习的单词卡片",
            detail: "请先导入单词数据包（type=word 或 phrase 的 Card）",
          },
          { status: 404 }
        );
      }
      throw err;
    }

    // ===== 4. 查询 Card 与 WordProfile =====
    const card = await prisma.card.findUnique({
      where: { id: recommend.cardId },
    });
    if (!card) {
      logger.error("推荐算法返回了不存在的 cardId", {
        cardId: recommend.cardId,
      });
      return NextResponse.json(
        { error: "推荐数据异常，请重试" },
        { status: 500 }
      );
    }

    // ===== 5. 构建 QuestionData（含回退逻辑）=====
    const { question, fallback } = await buildQuestionData(
      card,
      recommend.modeId
    );
    const finalModeId = question.modeId;

    if (fallback) {
      logger.debug("题目数据不足，回退到 modeId=3", {
        cardId: card.id,
        originalMode: recommend.modeId,
      });
    }

    // ===== 6. 计算 sessionStats =====
    const sessionStats = computeSessionStats(recentHistory);

    // ===== 7. 组装响应 =====
    const payload: NextQuestionPayload = {
      cardId: card.id,
      modeId: finalModeId,
      question,
      sessionStats,
    };

    logger.info("返回下一题", {
      userId,
      cardId: card.id,
      modeId: finalModeId,
      reason: recommend.reason,
      fallback,
    });

    return NextResponse.json(payload);
  } catch (err) {
    logger.error("/api/learn/next 失败", { error: String(err) });
    return NextResponse.json(
      { error: "获取下一题失败", detail: String(err) },
      { status: 500 }
    );
  }
}

// ==================== 题目数据构建 ====================

/**
 * 根据 card + modeId 构建 QuestionData。
 * 若数据不足以满足"必有对照"约束，回退到 modeId=3。
 *
 * @returns { question, fallback } fallback=true 表示发生了回退
 */
async function buildQuestionData(
  card: {
    id: string;
    title: string;
    phonetic: string | null;
    partOfSpeech: string | null;
    meanings: string | null;
    sentences: string | null;
  },
  modeId: LearnModeId
): Promise<{ question: QuestionData; fallback: boolean }> {
  const meanings = parseJsonArray<string>(card.meanings);
  const sentences = parseSentences(card.sentences);
  const wordLength = card.title.replace(/\s/g, "").length;

  // 先尝试原 modeId
  const primary = await tryBuildQuestion(card, modeId, meanings, sentences, wordLength);
  if (primary) {
    return { question: primary, fallback: false };
  }

  // 回退到 modeId=3（看释义拼写，最低成本满足"必有对照"）
  logger.debug("原 modeId 数据不足，回退 modeId=3", {
    cardId: card.id,
    modeId,
  });
  const fallback = await tryBuildQuestion(card, 3, meanings, sentences, wordLength);
  if (fallback) {
    return { question: fallback, fallback: true };
  }

  // 极端兜底：连 modeId=3 都建不出来（meanings 也为空）
  // 用 title 作为 prompt，至少能展示
  return {
    question: {
      modeId: 3,
      prompt: meanings[0] ?? `请拼写：${card.title}`,
      anchor: {
        partOfSpeech: card.partOfSpeech ?? undefined,
        meaning: meanings[0],
      },
      wordLength,
    },
    fallback: true,
  };
}

/**
 * 尝试用指定 modeId 构建题目。数据不足返回 null。
 */
async function tryBuildQuestion(
  card: {
    id: string;
    title: string;
    phonetic: string | null;
    partOfSpeech: string | null;
  },
  modeId: LearnModeId,
  meanings: string[],
  sentences: SentenceItem[],
  wordLength: number
): Promise<QuestionData | null> {
  switch (modeId) {
    case 1:
      return buildSentenceGap(card, meanings, sentences);
    case 2:
      return buildLetterGap(card, meanings, wordLength);
    case 3:
      return buildMeaningToSpell(card, meanings, wordLength);
    case 4:
      return buildMultiChoice(card, meanings, sentences);
    default:
      return null;
  }
}

/**
 * modeId=1：缺失单词句子
 * - 从 sentences 取一句，将 title 替换为 ___
 * - anchor.translation 给中文翻译（若无则 meanings[0]）
 * - anchor.meaningInContext 给此单词在此句中的具体释义（若有）
 *
 * 修复说明：
 *   1. 旧版 translation = sent.zh ?? meanings[0]，但 sent.zh 是整句翻译，
 *      而 meanings[0] 是单词释义，二者性质不同，回退会导致语义错位。
 *      新版：sent.zh 为整句翻译，sent.meaningInContext 为单词在句中释义，
 *      二者独立提供，互不替代。
 *   2. 旧版无 meaningInContext，单词多义时用户无法判断此句应使用哪个释义。
 *      新版优先使用 sent.meaningInContext，无则回退到 meanings[0]。
 */
function buildSentenceGap(
  card: { title: string },
  meanings: string[],
  sentences: SentenceItem[]
): QuestionData | null {
  if (sentences.length === 0) return null;
  const sent = sentences[0];
  // 将句子中的 title 替换为 ___（忽略大小写）
  const masked = maskWordInSentence(sent.en, card.title);
  // 若替换后没有变化（title 未出现在句中），仍可作为题目但需保证挖空存在
  const prompt = masked.includes("___")
    ? masked
    : `___ ${sent.en}`;

  // 整句中文翻译：必须有（满足"必有对照"约束）
  // 优先 sent.zh（整句翻译），无则用 meanings[0] 作为最低保障
  const translation = sent.zh ?? meanings[0];
  if (!translation) return null;

  // 单词在此句中的具体释义（可选，提升多义词的学习精准度）
  // 优先 sent.meaningInContext，无则回退到 meanings[0]
  const meaningInContext = sent.meaningInContext ?? meanings[0];

  return {
    modeId: 1,
    prompt,
    anchor: {
      translation,
      meaningInContext,
    },
    wordLength: card.title.replace(/\s/g, "").length,
  };
}

/**
 * modeId=2：缺失字母拼写
 * - 挖掉 30% 字母为 _
 * - anchor 给 phonetic 或 meanings[0]
 */
function buildLetterGap(
  card: { title: string; phonetic: string | null },
  meanings: string[],
  wordLength: number
): QuestionData | null {
  if (wordLength < 3) return null; // 太短无法挖空
  const { maskedWord, segments, missingAnswer } = maskLetters(
    card.title,
    LETTER_MASK_RATIO
  );
  // anchor: phonetic 优先，否则 meanings[0]
  const anchor: QuestionData["anchor"] = {};
  if (card.phonetic) {
    anchor.phonetic = card.phonetic;
  } else if (meanings.length > 0) {
    anchor.meaning = meanings[0];
  } else {
    return null; // 无音标也无释义，无法满足"必有对照"
  }
  return {
    modeId: 2,
    prompt: maskedWord,
    anchor,
    maskedWord,
    maskedSegments: segments,
    missingAnswer,
    wordLength,
  };
}

/**
 * modeId=3：看释义拼写
 * - prompt = meanings[0]（中文释义）
 * - anchor.partOfSpeech = 词性
 */
function buildMeaningToSpell(
  card: { partOfSpeech: string | null },
  meanings: string[],
  wordLength: number
): QuestionData | null {
  if (meanings.length === 0) return null;
  return {
    modeId: 3,
    prompt: meanings[0],
    anchor: {
      partOfSpeech: card.partOfSpeech ?? undefined,
    },
    wordLength,
  };
}

/**
 * modeId=4：ABCD 选择
 * - 从 sentences 取语境
 * - options 含正确词 + 3 个干扰词（同 partOfSpeech 优先）
 */
async function buildMultiChoice(
  card: { id: string; title: string; partOfSpeech: string | null },
  meanings: string[],
  sentences: SentenceItem[]
): Promise<QuestionData | null> {
  // 需要至少有一个句子作为语境
  if (sentences.length === 0) return null;
  const sent = sentences[0];
  // 挖空的句子作为 prompt（与 modeId=1 类似，但这里让用户选择而非键入）
  const masked = maskWordInSentence(sent.en, card.title);
  const prompt = masked.includes("___") ? masked : `___ ${sent.en}`;

  // 收集干扰词
  const distractors = await getDistractors(card, DISTRACTOR_COUNT);
  if (distractors.length < DISTRACTOR_COUNT) {
    // 干扰词不足 3 个，无法构成 4 选项，回退
    return null;
  }

  // 组装选项并打乱顺序
  const options = shuffle([card.title, ...distractors]);

  return {
    modeId: 4,
    prompt,
    anchor: {
      sentence: sent.zh ? `${sent.en}` : sent.en, // 语境句子
      translation: sent.zh, // 若有中文翻译也一并给出
    },
    options,
    wordLength: card.title.replace(/\s/g, "").length,
  };
}

/**
 * 获取干扰词：同 partOfSpeech 优先，不足则从全库 word/phrase 补足。
 */
async function getDistractors(
  card: { id: string; title: string; partOfSpeech: string | null },
  count: number
): Promise<string[]> {
  // 1. 同 partOfSpeech 优先
  let candidates: string[] = [];
  if (card.partOfSpeech) {
    const same = await prisma.card.findMany({
      where: {
        id: { not: card.id },
        type: { in: ["word", "phrase"] },
        partOfSpeech: card.partOfSpeech,
        title: { not: card.title },
      },
      select: { title: true },
      take: 30,
    });
    candidates = same.map((c) => c.title);
  }

  // 2. 不足则从全库 word/phrase 补足
  if (candidates.length < count) {
    const extra = await prisma.card.findMany({
      where: {
        id: { not: card.id },
        type: { in: ["word", "phrase"] },
        title: { not: card.title, notIn: candidates },
      },
      select: { title: true },
      take: 30,
    });
    candidates = [...candidates, ...extra.map((c) => c.title)];
  }

  // 3. 随机打乱并取 count 个
  return shuffle(candidates).slice(0, count);
}

// ==================== 工具函数 ====================

/** 解析 JSON 字符串数组 */
function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as T[];
  } catch {
    return [];
  }
}

/** 句子项（兼容字符串与对象两种格式） */
interface SentenceItem {
  en: string;
  zh?: string;
  /** 此单词在此句子中的具体释义（解决多义词与句子释义对不上的问题） */
  meaningInContext?: string;
}

/**
 * 解析 sentences JSON，兼容多种格式：
 * - 字符串数组：["I have an alarm.", ...]
 * - 对象数组（基础）：[{en, zh}, {english, chinese}, ...]
 * - 对象数组（增强）：[{en, zh, meaningInContext}, ...]
 *
 * meaningInContext 字段用于解决多义词问题：
 *   单词 "bank" 有"银行/河岸"两义，句子 "I deposited money in the bank." 中是"银行"，
 *   此时 meaningInContext = "银行"，与 meanings[0]（可能是"河岸"）解耦。
 */
function parseSentences(raw: string | null | undefined): SentenceItem[] {
  const arr = parseJsonArray<unknown>(raw);
  return arr
    .map((item) => {
      if (typeof item === "string") return { en: item };
      if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        const en =
          (obj.en as string) ??
          (obj.english as string) ??
          (obj.sentence as string) ??
          "";
        const zh =
          (obj.zh as string) ??
          (obj.cn as string) ??
          (obj.chinese as string) ??
          (obj.translation as string) ??
          undefined;
        // 单词在此句中的具体释义（可选字段）
        const meaningInContext =
          (obj.meaningInContext as string) ??
          (obj.meaning as string) ??
          (obj.wordMeaning as string) ??
          undefined;
        return {
          en: String(en),
          zh: zh ? String(zh) : undefined,
          meaningInContext: meaningInContext ? String(meaningInContext) : undefined,
        };
      }
      return { en: String(item) };
    })
    .filter((s) => s.en.length > 0);
}

/** 将句子中的目标词替换为 ___（忽略大小写） */
function maskWordInSentence(sentence: string, word: string): string {
  if (!word) return sentence;
  const escaped = escapeRegex(word);
  const re = new RegExp(escaped, "gi");
  return sentence.replace(re, "___");
}

/** 转义正则特殊字符 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 将 word 挖掉 ratio 比例的字母为 _ */
/**
 * 挖空字母：返回 maskedWord + 分段信息 + 缺失字母答案
 * @returns { maskedWord, segments, missingAnswer }
 */
function maskLetters(
  word: string,
  ratio: number
): {
  maskedWord: string;
  segments: Array<{ char: string; masked: boolean }>;
  missingAnswer: string;
} {
  const clean = word.replace(/\s/g, "");
  const len = clean.length;
  if (len < 3) {
    return {
      maskedWord: clean,
      segments: clean.split("").map((ch) => ({ char: ch, masked: false })),
      missingAnswer: "",
    };
  }
  const maskCount = Math.max(1, Math.round(len * ratio));
  // 随机选择 maskCount 个不同位置
  const positions = new Set<number>();
  let attempts = 0;
  while (positions.size < maskCount && attempts < 20) {
    positions.add(Math.floor(Math.random() * len));
    attempts++;
  }

  const segments: Array<{ char: string; masked: boolean }> = [];
  const missingChars: string[] = [];
  for (let i = 0; i < len; i++) {
    if (positions.has(i)) {
      segments.push({ char: clean[i], masked: true });
      missingChars.push(clean[i]);
    } else {
      segments.push({ char: clean[i], masked: false });
    }
  }

  const maskedWord = segments
    .map((s) => (s.masked ? "_" : s.char))
    .join("");

  return {
    maskedWord,
    segments,
    missingAnswer: missingChars.join(""),
  };
}

/** Fisher-Yates 洗牌 */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 计算会话统计 */
function computeSessionStats(
  recent: Array<{ isCorrect: boolean; responseMs: number; modeId: number }>
): SessionStats {
  const total = recent.length;
  const correct = recent.filter((r) => r.isCorrect).length;
  const avgResponseMs =
    total > 0
      ? Math.round(
          recent.reduce((sum, r) => sum + r.responseMs, 0) / total
        )
      : 0;
  const modeDistribution: Record<number, number> = {};
  for (const r of recent) {
    modeDistribution[r.modeId] = (modeDistribution[r.modeId] ?? 0) + 1;
  }
  return { total, correct, avgResponseMs, modeDistribution };
}
