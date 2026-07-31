/**
 * AI 语义分析任务
 *
 * 设计依据：.doc/WORD_LEARNING_DESIGN.md §6.4
 *
 * 职责：
 *   - 批量取词（<=20 个/批，避免 token 爆炸）
 *   - 调用 getAIProvider().chat() 流式生成语义相关度
 *   - Prompt：给定一批单词，输出 JSON 数组 [{from, to, score, reason}]，score 0-1
 *   - 解析结果，写入 WordRelation(type="ai_semantic", weight, evidence={aiScore, reason})
 *   - 同时更新 WordProfile.correlationVector.dim（hash 生成 32 维伪向量）
 *
 * 错误降级：
 *   - AI 调用失败/超时 → 跳过该批，记录日志，不影响其他批
 *   - JSON 解析失败 → 跳过该批
 *   - 流式输出需收集完整文本再 JSON.parse（不能边收边解析）
 *
 * 注意：
 *   - correlationVector.dim 采用 FNV-1a hash 生成 32 维单位向量（伪嵌入），
 *     真正的语义关联通过 WordRelation(ai_semantic) 承载；
 *     真正的语义嵌入需要专用 embedding 模型，此处为简化实现。
 *   - correlationVector.neighbors 聚合该 card 所有 WordRelation Top-K。
 */
import { getAIProvider } from "@/lib/ai";
import type { ChatMessage } from "@/lib/ai";
import { prisma } from "@/lib/db/prisma";
import { CorrelationVector, clamp01 } from "@/lib/learning/types";
import { getLogger } from "@/lib/utils/logger";

const logger = getLogger("AISemanticTask");

/** WordRelation.type 子类标识 */
const RELATION_TYPE = "ai_semantic";

/** 单批最大词数（避免 token 爆炸） */
const BATCH_SIZE = 20;

/** AI 流式调用超时（毫秒） */
const AI_TIMEOUT_MS = 30_000;

/** 关联向量维度（伪嵌入） */
const DIM_SIZE = 32;

/** neighbors Top-K */
const NEIGHBOR_TOP_K = 20;

/** 最小相关度阈值：低于此值不写入 */
const MIN_SCORE = 0.3;

/** AI 单批最大输出 token 数 */
const AI_MAX_TOKENS = 2000;

/** WordRelation.type 联合类型别名（用于类型断言） */
type WordRelationType =
  | "ai_semantic"
  | "cooccurrence"
  | "structural"
  | "behavioral"
  | "soft_layout";

/** AI 返回的语义对（1-based 编号） */
interface SemanticPair {
  from: number;
  to: number;
  score: number;
  reason?: string;
}

/**
 * 规范化 cardId 对，确保 fromCardId < toCardId（与 soft-layout.ts 模式一致）。
 * 本文件内局部定义，避免新增共享工具文件。
 */
function normalizePair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** 解析 Card.meanings JSON 字符串数组为可读字符串 */
function parseMeanings(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      return arr
        .map((x) => (typeof x === "string" ? x : String(x)))
        .filter(Boolean)
        .join("; ");
    }
  } catch {
    // 解析失败返回空
  }
  return "";
}

/**
 * 构建语义分析 Prompt。
 * 输入：编号 + 单词 + 释义；要求输出 JSON 数组。
 */
function buildSemanticPrompt(
  cards: Array<{ idx: number; title: string; meaning: string }>
): string {
  const lines = cards
    .map((c) => `${c.idx}. ${c.title}${c.meaning ? " - " + c.meaning : ""}`)
    .join("\n");

  return `你是一个英语词汇语义分析助手。

任务：分析给定的一批英语单词/短语，找出其中语义相关的词对。

输入单词列表（编号 + 单词 + 释义）：
${lines}

请输出 JSON 数组，每项表示一个语义相关词对：
[{"from": 1, "to": 2, "score": 0.85, "reason": "都与警报相关"}]

约束：
- from/to 为单词编号（1-based，必须在输入列表范围内）
- score 为 0-1 的相关度（1=完全同义，0=无关）
- 只输出相关度 >= ${MIN_SCORE} 的词对
- 最多输出 30 个词对
- 只输出 JSON 数组，不要其他文字或解释`;
}

/**
 * 收集流式输出（带超时）。
 *
 * Provider.chat() 返回 AsyncIterable<string>，逐块产出文本。
 * 本函数将其收集为完整字符串，超时则 reject。
 *
 * @param iter AI 流式迭代器
 * @param timeoutMs 超时毫秒
 */
async function collectStreamWithTimeout(
  iter: AsyncIterable<string>,
  timeoutMs: number
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`AI 流式输出超时 (${timeoutMs}ms)`));
    }, timeoutMs);

    void (async () => {
      try {
        let text = "";
        for await (const chunk of iter) {
          text += chunk;
        }
        clearTimeout(timer);
        resolve(text);
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    })();
  });
}

/**
 * 从 AI 输出文本中提取 JSON 数组（容错解析）。
 *
 * 兼容三种情况：
 *   1. 纯 JSON 数组（直接 parse 成功）
 *   2. 包含在 ```json ... ``` 代码块或额外文字中（截取首 [ 到尾 ]）
 *   3. 解析失败返回空数组
 */
function extractJsonArray(text: string): SemanticPair[] {
  // 1. 直接 parse
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed as SemanticPair[];
  } catch {
    // 继续尝试下面的方法
  }

  // 2. 截取首个 [ 到最后一个 ]
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start >= 0 && end > start) {
    const slice = text.substring(start, end + 1);
    try {
      const parsed = JSON.parse(slice);
      if (Array.isArray(parsed)) return parsed as SemanticPair[];
    } catch {
      // 解析失败
    }
  }

  return [];
}

/**
 * 基于 word 字符串生成 32 维伪向量（unit-normalized）。
 *
 * 简化实现：真正的语义嵌入需要专用 embedding 模型，这里用 FNV-1a hash 提供
 * 稳定的伪向量，保证同词得到同向量、不同词得到不同向量。
 * 真正的语义关联通过 WordRelation(ai_semantic) 承载。
 */
function hashPseudoVector(word: string): number[] {
  const w = word.toLowerCase().replace(/\s+/g, "");
  // FNV-1a hash 初始化
  let hash = 2166136261;
  for (let i = 0; i < w.length; i++) {
    hash ^= w.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // 生成 32 维向量，每维用 hash 派生的伪随机值映射到 [-1, 1]
  const dim: number[] = [];
  for (let i = 0; i < DIM_SIZE; i++) {
    hash = (Math.imul(hash ^ (i + 1), 16777619) >>> 0) || 1;
    // frac(sin(x)*43758.5453) 是常见的 GLSL 伪随机模式
    const v = (Math.sin(hash) * 43758.5453) % 1;
    dim.push(v * 2 - 1);
  }
  // 单位归一化（便于 cosine 相似度计算）
  const norm = Math.sqrt(dim.reduce((s, v) => s + v * v, 0));
  return norm === 0 ? dim : dim.map((v) => v / norm);
}

/**
 * 更新单个 card 的 correlationVector。
 *
 * - dim：基于 card.title 的 hash 伪向量
 * - neighbors：聚合该 card 所有 WordRelation（作为 from 或 to）按 weight 取 Top-K
 *
 * 使用 updateMany 而非 update，避免 WordProfile 不存在时抛错。
 */
async function updateCorrelationVector(cardId: string): Promise<void> {
  // 并发查询该 card 作为 from / to 的所有关系
  const [fromRels, toRels, card] = await Promise.all([
    prisma.wordRelation.findMany({
      where: { fromCardId: cardId },
      orderBy: { weight: "desc" },
      take: NEIGHBOR_TOP_K,
      select: { toCardId: true, weight: true, type: true },
    }),
    prisma.wordRelation.findMany({
      where: { toCardId: cardId },
      orderBy: { weight: "desc" },
      take: NEIGHBOR_TOP_K,
      select: { fromCardId: true, weight: true, type: true },
    }),
    prisma.card.findUnique({
      where: { id: cardId },
      select: { title: true },
    }),
  ]);

  // 合并 from/to 关系，按 weight 降序取 Top-K
  const all = [
    ...fromRels.map((r) => ({ id: r.toCardId, w: r.weight, t: r.type })),
    ...toRels.map((r) => ({ id: r.fromCardId, w: r.weight, t: r.type })),
  ];
  all.sort((a, b) => b.w - a.w);
  const neighbors = all.slice(0, NEIGHBOR_TOP_K).map((n) => ({
    id: n.id,
    w: n.w,
    t: n.t as WordRelationType,
  }));

  // dim：hash 伪向量
  const dim = card ? hashPseudoVector(card.title) : [];

  const vector: CorrelationVector = {
    dim,
    neighbors,
    version: 2,
    updatedAt: new Date().toISOString(),
  };

  await prisma.wordProfile.updateMany({
    where: { cardId },
    data: { correlationVector: JSON.stringify(vector) },
  });
}

/**
 * 执行 AI 语义分析。
 *
 * 流程：
 *   1. 将 cardIds 分批（每批 BATCH_SIZE 个）
 *   2. 每批：查询卡片信息 → 构建 prompt → 调用 AI（流式收集）→ 解析 JSON
 *   3. upsert WordRelation(ai_semantic)
 *   4. 更新每个 card 的 correlationVector
 *   5. 单批失败不影响其他批
 *
 * @param cardIds 要分析的 Card ID 列表
 * @returns 成功写入的关系总数
 */
export async function runAISemantic(cardIds: string[]): Promise<number> {
  if (cardIds.length === 0) return 0;

  let totalRelations = 0;

  // 分批处理
  for (let i = 0; i < cardIds.length; i += BATCH_SIZE) {
    const batchIds = cardIds.slice(i, i + BATCH_SIZE);
    try {
      const count = await processBatch(batchIds);
      totalRelations += count;
    } catch (err) {
      // 单批失败不阻塞其他批
      logger.warn("AI 语义分析批次失败，跳过", {
        batchSize: batchIds.length,
        batchIndex: Math.floor(i / BATCH_SIZE),
        error: String(err),
      });
    }
  }

  logger.info("AI 语义分析完成", {
    totalCards: cardIds.length,
    totalRelations,
  });

  return totalRelations;
}

/**
 * 处理单批 AI 语义分析。
 *
 * @param cardIds 本批 Card ID（<= BATCH_SIZE）
 * @returns 本批写入的关系数
 */
async function processBatch(cardIds: string[]): Promise<number> {
  // ===== 1. 查询卡片信息 =====
  const cards = await prisma.card.findMany({
    where: { id: { in: cardIds } },
    select: { id: true, title: true, meanings: true },
  });

  if (cards.length === 0) return 0;

  // 构建 1-based 编号 → cardId 映射
  const indexed = cards.map((c, i) => ({
    idx: i + 1,
    id: c.id,
    title: c.title,
    meaning: parseMeanings(c.meanings),
  }));
  const idxToId = new Map<number, string>();
  for (const c of indexed) idxToId.set(c.idx, c.id);

  // ===== 2. 构建 Prompt 并调用 AI =====
  const prompt = buildSemanticPrompt(
    indexed.map(({ idx, title, meaning }) => ({ idx, title, meaning }))
  );
  const messages: ChatMessage[] = [
    { role: "system", content: prompt },
    { role: "user", content: "请输出 JSON 数组。" },
  ];

  const provider = getAIProvider();
  let fullText: string;
  try {
    // 流式收集，带超时
    fullText = await collectStreamWithTimeout(
      provider.chat(messages, {
        temperature: 0.3,
        maxTokens: AI_MAX_TOKENS,
      }),
      AI_TIMEOUT_MS
    );
  } catch (err) {
    logger.warn("AI 调用失败/超时", {
      error: String(err),
      batchSize: cards.length,
    });
    return 0;
  }

  // ===== 3. 解析 JSON =====
  const pairs = extractJsonArray(fullText);
  if (pairs.length === 0) {
    logger.warn("AI 输出无法解析为 JSON 数组", {
      batchSize: cards.length,
      outputPreview: fullText.substring(0, 200),
    });
    return 0;
  }

  // ===== 4. 转换为 WordRelation 记录 =====
  const relations: Array<{
    fromCardId: string;
    toCardId: string;
    weight: number;
    evidence: { aiScore: number; reason: string };
  }> = [];

  for (const pair of pairs) {
    // 字段校验：from/to 必须是有效整数编号，score 必须是有效数值
    if (!pair || typeof pair !== "object") continue;
    const from = Number(pair.from);
    const to = Number(pair.to);
    const score = Number(pair.score);
    if (!Number.isInteger(from) || !Number.isInteger(to)) continue;
    if (!Number.isFinite(score)) continue;

    const fromId = idxToId.get(from);
    const toId = idxToId.get(to);
    if (!fromId || !toId || fromId === toId) continue;

    const weight = clamp01(score);
    if (weight < MIN_SCORE) continue;

    const reason = typeof pair.reason === "string" ? pair.reason : "";
    const [a, b] = normalizePair(fromId, toId);
    relations.push({
      fromCardId: a,
      toCardId: b,
      weight: Number(weight.toFixed(4)),
      evidence: { aiScore: weight, reason },
    });
  }

  // ===== 5. 批量 upsert WordRelation(ai_semantic) =====
  if (relations.length > 0) {
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
  }

  // ===== 6. 更新每个 card 的 correlationVector =====
  // 用 allSettled 避免单个失败影响整批
  await Promise.allSettled(cards.map((c) => updateCorrelationVector(c.id)));

  logger.info("AI 语义分析批次完成", {
    batchSize: cards.length,
    relationCount: relations.length,
  });

  return relations.length;
}
