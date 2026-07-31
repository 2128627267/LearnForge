/**
 * 共现统计任务
 *
 * 设计依据：.doc/WORD_LEARNING_DESIGN.md §6.2
 *
 * 职责：
 *   - 查询所有 type=word/phrase 的 Card，解析 sentences JSON
 *   - 统计两个词在同一例句中同时出现的频率
 *   - 计算 PMI（点互信息），归一化到 0-1
 *   - 写入 WordRelation(type="cooccurrence", weight, evidence={pmi, count})
 *
 * 性能预算：<500ms
 *   - 限制只处理最近导入的 500 个词（按 createdAt 降序），避免全库 N²
 *   - 倒排索引：token → cardIds，按句聚合共现对，避免逐句全卡扫描
 *
 * PMI 公式：
 *   PMI(a,b) = log( P(a,b) / (P(a) * P(b)) )
 *   其中 P(x) = count(x) / N，N 为句子总数
 *   归一化：weight = clamp01( PMI / log(N) )
 *   （PMI 最大值为 log(N)，当 a、b 完全共现且都很稀有时取得；
 *    PMI<=0 表示共现少于随机期望，不建立关系）
 */
import { prisma } from "@/lib/db/prisma";
import { clamp01 } from "@/lib/learning/types";
import { getLogger } from "@/lib/utils/logger";

const logger = getLogger("CooccurrenceTask");

/** WordRelation.type 子类标识 */
const RELATION_TYPE = "cooccurrence";

/** 处理的最近词数上限（性能预算控制，避免全库 N²） */
const RECENT_CARD_LIMIT = 500;

/** 噪声过滤阈值：归一化权重低于此值不写入 */
const MIN_WEIGHT = 0.1;

/** 例句项（兼容字符串与对象两种格式） */
interface SentenceItem {
  en: string;
  zh?: string;
}

/**
 * 解析 Card.sentences JSON，兼容字符串数组与对象数组两种格式。
 * 对象格式支持 en/english/sentence 键与 zh/cn/chinese/translation 键。
 */
function parseSentences(raw: string | null | undefined): SentenceItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
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
          return { en: String(en), zh: zh ? String(zh) : undefined };
        }
        return { en: String(item) };
      })
      .filter((s) => typeof s.en === "string" && s.en.trim().length > 0);
  } catch {
    return [];
  }
}

/**
 * 规范化 cardId 对，确保 fromCardId < toCardId。
 * 这样 A→B 与 B→A 会被合并为同一条记录，避免重复（依赖 @@unique 复合键）。
 */
function normalizePair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * 执行共现统计任务。
 *
 * 流程：
 *   1. 查询最近导入的 500 个 type=word/phrase 的 Card（含 sentences）
 *   2. 收集所有例句到句池（按 en 文本去重）
 *   3. 构建倒排索引：word 类型用 token→cardIds 映射，phrase 类型线性子串匹配
 *   4. 对每个句子找出匹配的 card 集合，两两配对累加共现次数
 *   5. 计算 PMI 并归一化到 [0,1]
 *   6. 批量 upsert WordRelation(cooccurrence)
 *
 * @param _userId 可选用户 ID（当前统计全局共现，参数预留以便未来按用户分桶）
 * @returns 写入（upsert）的关系数量
 */
export async function runCooccurrence(_userId?: string): Promise<number> {
  // ===== 1. 查询最近的 word/phrase 卡片 =====
  const cards = await prisma.card.findMany({
    where: { type: { in: ["word", "phrase"] } },
    select: {
      id: true,
      title: true,
      type: true,
      sentences: true,
    },
    orderBy: { createdAt: "desc" },
    take: RECENT_CARD_LIMIT,
  });

  if (cards.length === 0) {
    logger.info("无 word/phrase 卡片可统计共现");
    return 0;
  }

  // ===== 2. 收集所有例句到句池（去重）=====
  const sentencePool: string[] = [];
  const seenSentences = new Set<string>();
  for (const card of cards) {
    const items = parseSentences(card.sentences);
    for (const item of items) {
      const enLower = item.en.toLowerCase();
      if (seenSentences.has(enLower)) continue;
      seenSentences.add(enLower);
      sentencePool.push(enLower);
    }
  }

  if (sentencePool.length === 0) {
    logger.info("无有效例句可统计共现", { cardCount: cards.length });
    return 0;
  }

  // ===== 3. 构建倒排索引 =====
  // word 类型：titleLower → cardIds（token 直接查找，O(1) 命中）
  // phrase 类型：单独列表，对每句做子串匹配（phrase 数量通常少）
  const tokenToCards = new Map<string, string[]>();
  const phraseCards: Array<{ id: string; title: string }> = [];

  for (const card of cards) {
    // 去除非字母字符并小写，得到匹配键
    const titleLower = card.title.toLowerCase().replace(/[^a-z]/g, "");
    if (!titleLower) continue;
    if (card.type === "phrase") {
      phraseCards.push({ id: card.id, title: titleLower });
    } else {
      if (!tokenToCards.has(titleLower)) tokenToCards.set(titleLower, []);
      tokenToCards.get(titleLower)!.push(card.id);
    }
  }

  // ===== 4. 为每个句子找出匹配的 card 集合，并聚合共现对 =====
  // cardSentenceCount: 每个 card 出现在多少句中（用于 PMI 的 P(a)）
  // pairCounts: 每对 card 共同出现在多少句中（用于 PMI 的 P(a,b)）
  const cardSentenceCount = new Map<string, number>();
  const pairCounts = new Map<string, number>(); // key = `${a}|${b}` (a<b)

  for (const sentence of sentencePool) {
    // 分词：按非字母字符切分，得到 token 集合
    const tokens = new Set(sentence.split(/[^a-z]+/).filter(Boolean));
    const matched = new Set<string>();

    // word 类型：token 直接命中
    for (const token of tokens) {
      const list = tokenToCards.get(token);
      if (list) for (const cid of list) matched.add(cid);
    }

    // phrase 类型：子串包含（数量少，线性扫描可接受）
    for (const p of phraseCards) {
      if (sentence.includes(p.title)) matched.add(p.id);
    }

    // 更新单个 card 的句频
    for (const cid of matched) {
      cardSentenceCount.set(cid, (cardSentenceCount.get(cid) ?? 0) + 1);
    }

    // 更新共现对：同句中任意两个 card 配对
    if (matched.size >= 2) {
      // 排序确保 a<b，与 normalizePair 一致
      const ids = Array.from(matched).sort();
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const key = `${ids[i]}|${ids[j]}`;
          pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
        }
      }
    }
  }

  // ===== 5. 计算 PMI 并归一化 =====
  const N = sentencePool.length;
  const logN = Math.log(N);

  const relations: Array<{
    fromCardId: string;
    toCardId: string;
    weight: number;
    evidence: { pmi: number; count: number };
  }> = [];

  for (const [key, count] of pairCounts) {
    const [a, b] = key.split("|");
    const countA = cardSentenceCount.get(a) ?? 0;
    const countB = cardSentenceCount.get(b) ?? 0;
    if (countA === 0 || countB === 0) continue;

    // PMI = log( P(a,b) / (P(a) * P(b)) ) = log( N * count / (countA * countB) )
    const pmi = Math.log((N * count) / (countA * countB));
    // PMI<=0：共现频率低于随机期望，无正相关，跳过
    if (pmi <= 0) continue;

    // 归一化：PMI 最大值为 log(N)（当 a、b 完全共现且各只出现一次时取得）
    const weight = logN > 0 ? clamp01(pmi / logN) : 0;
    if (weight < MIN_WEIGHT) continue; // 噪声过滤

    const [fromCardId, toCardId] = normalizePair(a, b);
    relations.push({
      fromCardId,
      toCardId,
      weight: Number(weight.toFixed(4)),
      evidence: { pmi: Number(pmi.toFixed(4)), count },
    });
  }

  if (relations.length === 0) {
    logger.info("无有效共现关系可写入", {
      cardCount: cards.length,
      sentenceCount: N,
      pairCount: pairCounts.size,
    });
    return 0;
  }

  // ===== 6. 批量 upsert 到 WordRelation =====
  // 使用 $transaction 保证原子性；upsert 依赖 @@unique([fromCardId, toCardId, type])
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

  logger.info("cooccurrence 关系构建完成", {
    cardCount: cards.length,
    sentenceCount: N,
    relationCount: relations.length,
  });

  return relations.length;
}
