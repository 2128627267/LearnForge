/**
 * POST /api/learn/answer
 *
 * 设计依据：.doc/WORD_LEARNING_DESIGN.md §2.3.4 / §7
 *
 * 流程：
 *   1. 解析 AnswerRequest（zod 校验）
 *   2. 查 Card + WordProfile
 *   3. 判定正确性：
 *      - modeId=4: 比对选项文本（与 card.title 归一化后比较）
 *      - 其他: normalize(answer) === normalize(card.title)
 *        normalize = trim().toLowerCase().replace(/\s+/g, '')
 *   4. 事务写入：
 *      - ModeHistory(cardId, userId, modeId, isCorrect, responseMs)
 *      - StudyLog(action='answer', modeId, responseMs, correct)
 *   5. 调用 FeatureEngine.recalc(cardId, userId) 重算特征
 *   6. 生成 explanation（词根/释义摘要，简单实现）
 *   7. 返回 AnswerResponse（含 updatedProfile 与 sessionStats）
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getLearnUserId } from "@/lib/learning/auth";
import { FeatureEngine } from "@/lib/learning/features";
import {
  AnswerResponse,
  LearnModeId,
  SessionStats,
} from "@/lib/learning/types";
import { getLogger } from "@/lib/utils/logger";
import { errorResponse } from "@/lib/utils/http-error";

const logger = getLogger("LearnAnswerAPI");

/** 最近答题历史条数（用于 sessionStats） */
const RECENT_HISTORY_LIMIT = 20;

/**
 * AnswerRequest zod 校验 schema
 * - cardId: 非空字符串
 * - modeId: 1-5 整数
 * - answer: 字符串（可为空，但需存在）
 * - responseMs: 非负整数
 * - sessionId: 可选
 */
const AnswerRequestSchema = z.object({
  cardId: z.string().min(1),
  modeId: z.number().int().min(1).max(5),
  answer: z.string(),
  responseMs: z.number().int().min(0),
  sessionId: z.string().optional(),
});

/**
 * POST /api/learn/answer
 * 提交答案，返回判定结果与更新后的画像。
 */
export async function POST(request: NextRequest) {
  try {
    // ===== 1. 解析与校验请求体 =====
    const body = await request.json();
    const parsed = AnswerRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "请求参数无效",
          detail: parsed.error.issues,
        },
        { status: 400 }
      );
    }
    const req = parsed.data;

    // ===== 2. 获取学习用户 =====
    const userId = await getLearnUserId();

    // ===== 3. 查询 Card =====
    const card = await prisma.card.findUnique({
      where: { id: req.cardId },
    });
    if (!card) {
      return NextResponse.json(
        { error: `卡片不存在: ${req.cardId}` },
        { status: 404 }
      );
    }

    // ===== 4. 判定正确性 =====
    const correct = judgeAnswer(
      req.answer,
      card.title,
      req.modeId as LearnModeId
    );

    logger.info("答题判定", {
      userId,
      cardId: req.cardId,
      modeId: req.modeId,
      correct,
      responseMs: req.responseMs,
    });

    // ===== 5. 事务写入 ModeHistory + StudyLog =====
    await prisma.$transaction([
      prisma.modeHistory.create({
        data: {
          cardId: req.cardId,
          userId,
          modeId: req.modeId,
          isCorrect: correct,
          responseMs: req.responseMs,
        },
      }),
      prisma.studyLog.create({
        data: {
          userId,
          cardId: req.cardId,
          action: "answer",
          correct,
          modeId: req.modeId,
          responseMs: req.responseMs,
          durationMs: req.responseMs, // 同时记录为学习时长
        },
      }),
    ]);

    // ===== 6. 调用特征引擎重算 WordProfile =====
    // recalc 内部已有 try-catch，失败不会抛出，确保不阻断答题流程
    await FeatureEngine.recalc(req.cardId, userId);

    // ===== 7. 读取最新 WordProfile（用于响应）=====
    const updatedProfile = await prisma.wordProfile.findUnique({
      where: { cardId: req.cardId },
    });

    // ===== 8. 生成 explanation =====
    // 传入 modeId 控制 explanation 内容，避免与题目展示重复
    const explanation = generateExplanation(card, req.modeId as LearnModeId);

    // ===== 9. 计算 sessionStats（从最近 20 条 ModeHistory，含刚写入的）=====
    const recentHistory = await prisma.modeHistory.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: RECENT_HISTORY_LIMIT,
    });
    const sessionStats = computeSessionStats(recentHistory);

    // ===== 10. 组装响应 =====
    const response: AnswerResponse = {
      correct,
      correctAnswer: card.title,
      explanation,
      updatedProfile: {
        studyCount: updatedProfile?.studyCount ?? 0,
        errorProneness: updatedProfile?.errorProneness ?? 0,
        nextReviewAt: updatedProfile?.nextReviewAt?.toISOString() ?? null,
        currentStreak: updatedProfile?.currentStreak ?? 0,
      },
      sessionStats,
    };

    return NextResponse.json(response);
  } catch (err) {
      return errorResponse(logger, "/api/learn/answer 失败", err);
  }
}

// ==================== 答案判定 ====================

/**
 * 判定用户答案是否正确。
 *
 * - modeId=4（ABCD 选择）：answer 为选项文本，与 card.title 归一化后比较
 * - 其他模式：answer 为用户键入文本，与 card.title 归一化后比较
 *
 * 归一化规则：trim + toLowerCase + 去除所有空白（含单词内空格）
 * 这样 "Alarm " / "ALARM" / "a larm" 都能匹配 "alarm"
 *
 * @param userAnswer  用户提交的答案
 * @param correctTitle 正确答案（Card.title）
 * @param modeId      考查方式
 */
function judgeAnswer(
  userAnswer: string,
  correctTitle: string,
  _modeId: LearnModeId
): boolean {
  // 参数名加 _ 前缀避免 lint 警告（当前所有模式判定逻辑一致，保留参数以便未来扩展）
  const normalizedUser = normalizeAnswer(userAnswer);
  const normalizedCorrect = normalizeAnswer(correctTitle);
  if (!normalizedCorrect) return false;
  return normalizedUser === normalizedCorrect;
}

/** 答案归一化：trim + toLowerCase + 去除所有空白 */
function normalizeAnswer(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "");
}

// ==================== 解释生成 ====================

/**
 * 生成简要解释（词根/释义摘要）。
 *
 * 格式：`音标 词性. 释义`（如有例句则附加）
 * 例如：`/əˈlɑːrm/ n. 闹钟; 警报`
 *
 * modeId 感知策略（避免与题目展示重复）：
 *   - modeId=1（缺失单词句子）：题目已显示挖空英文句+整句中文翻译，
 *     explanation 不再附加完整英文例句，改为显示"此句中释义"（如有）
 *   - modeId=4（ABCD 选择）：题目已显示挖空英文句作为语境，
 *     explanation 也不再附加完整英文例句
 *   - 其他 modeId：保持原行为，附加例句作为参考
 *
 * @param card   卡片数据
 * @param modeId 考查方式编号
 */
function generateExplanation(
  card: {
    title: string;
    phonetic: string | null;
    partOfSpeech: string | null;
    meanings: string | null;
    sentences: string | null;
  },
  modeId: LearnModeId
): string {
  const parts: string[] = [];

  // 音标
  if (card.phonetic) {
    parts.push(card.phonetic);
  }

  // 词性
  if (card.partOfSpeech) {
    parts.push(`${card.partOfSpeech}.`);
  }

  // 释义
  const meanings = parseJsonArray<string>(card.meanings);
  if (meanings.length > 0) {
    parts.push(meanings.join("; "));
  }

  let explanation = parts.filter(Boolean).join(" ");

  // 附加例句/释义（根据 modeId 决定是否显示完整英文例句）
  const sentences = parseSentences(card.sentences);
  if (sentences.length > 0) {
    const sent = sentences[0];

    if (modeId === 1 || modeId === 4) {
      // modeId=1/4：题目已显示挖空英文句，不再重复完整英文例句
      // 仅附加"此句中释义"（如有 meaningInContext），避免重复且解决多义问题
      if (sent.meaningInContext) {
        const line = `此句中释义：${sent.meaningInContext}`;
        explanation = explanation ? `${explanation}\n${line}` : line;
      }
      // 若无 meaningInContext，则不附加任何例句相关内容（避免重复）
    } else {
      // 其他 modeId：保持原行为，附加完整英文例句+中文翻译
      const sentLine = sent.zh
        ? `例：${sent.en}（${sent.zh}）`
        : `例：${sent.en}`;
      explanation = explanation
        ? `${explanation}\n${sentLine}`
        : sentLine;
    }
  }

  // 兜底：无任何信息时给出 title
  return explanation || `单词：${card.title}`;
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

/** 解析 sentences JSON，兼容多种格式（含 meaningInContext 字段） */
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

/** 计算会话统计 */
function computeSessionStats(
  recent: Array<{ isCorrect: boolean; responseMs: number; modeId: number }>
): SessionStats {
  const total = recent.length;
  const correct = recent.filter((r) => r.isCorrect).length;
  const avgResponseMs =
    total > 0
      ? Math.round(recent.reduce((sum, r) => sum + r.responseMs, 0) / total)
      : 0;
  const modeDistribution: Record<number, number> = {};
  for (const r of recent) {
    modeDistribution[r.modeId] = (modeDistribution[r.modeId] ?? 0) + 1;
  }
  return { total, correct, avgResponseMs, modeDistribution };
}
