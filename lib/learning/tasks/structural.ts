/**
 * 结构片段挖掘任务
 *
 * 设计依据：.doc/WORD_LEARNING_DESIGN.md §6.2 / §6.3
 *
 * 职责：
 *   - 提取所有词的词根/词缀片段（前缀、后缀、子串）
 *   - 约束：长度 3-6 字母，在词库中出现频率 >= 3
 *   - 黑名单过滤无意义片段（字母表/键盘连续序列、元音序列、重复字母）
 *   - 两个词共享某片段 → weight = 0.3 + 0.1*(共享片段数)，上限 0.9
 *   - 写入 WordRelation(type="structural", weight, evidence={sharedParts, count})
 *
 * 性能预算：<300ms
 *   - 用 Map 聚合片段 → 词列表，避免 N²
 *   - 片段频率上限 20：超过视为泛化片段（如 "ing"），不参与配对
 *
 * 导出：
 *   - runStructural(userId?)：执行挖掘任务
 *   - STRUCTURAL_BLACKLIST：黑名单集合，供 resource-cleanup 复用
 */
import { prisma } from "@/lib/db/prisma";
import { getLogger } from "@/lib/utils/logger";

const logger = getLogger("StructuralTask");

/** WordRelation.type 子类标识 */
const RELATION_TYPE = "structural";

/** 片段长度约束 */
const MIN_LEN = 3;
const MAX_LEN = 6;

/** 片段最小出现频率（在词库中出现的不同词数） */
const MIN_OCCURRENCE = 3;

/** 片段最大出现频率上限：超过视为泛化片段（如 "ing"），不参与配对 */
const MAX_OCCURRENCE = 20;

/** 基础权重与每片段加成 */
const BASE_WEIGHT = 0.3;
const PER_PART_BONUS = 0.1;
/** 权重上限 */
const WEIGHT_CAP = 0.9;

/** 噪声过滤阈值 */
const MIN_WEIGHT = 0.1;

/**
 * 无意义片段黑名单。
 * 设计依据：§6.3 STRUCT_RULES.blacklist
 * 包含：字母表连续序列、键盘行连续序列、元音序列、重复字母。
 *
 * 导出供 resource-cleanup.ts 复用，确保挖掘与清理使用同一份名单。
 */
export const STRUCTURAL_BLACKLIST: ReadonlySet<string> = new Set<string>([
  // —— 字母表连续序列（3-6 长度）——
  "abc", "bcd", "cde", "def", "efg", "fgh", "ghi", "hij", "ijk", "jkl",
  "klm", "lmn", "mno", "nop", "opq", "pqr", "qrs", "rst", "stu", "tuv",
  "uvw", "vwx", "wxy", "xyz",
  "abcd", "bcde", "cdef", "defg", "efgh", "fghi", "ghij", "hijk", "ijkl",
  "jklm", "klmn", "lmno", "mnop", "nopq", "opqr", "pqrs", "qrst", "rstu",
  "stuv", "tuvw", "uvwx", "vwxy", "wxyz",
  "abcde", "bcdef", "cdefg", "defgh", "efghi", "fghij", "ghijk", "hijkl",
  "ijklm", "jklmn", "klmno", "lmnop", "mnopq", "nopqr", "opqrs", "pqrst",
  "qrstu", "rstuv", "stuvw", "tuvwx", "uvwxy", "vwxyz",
  "abcdef", "bcdefg", "cdefgh", "defghi", "efghij", "fghijk", "ghijkl",
  "hijklm", "ijklmn", "jklmno", "klmnop", "lmnopq", "mnopqr", "nopqrs",
  "opqrst", "pqrstu", "qrstuv", "rstuvw", "stuvwx", "tuvwxy", "uvwxyz",
  // —— 键盘行连续序列（QWERTY / ASDF / ZXCV）——
  "qwe", "wer", "ert", "rty", "tyu", "yui", "uio", "iop",
  "asd", "sdf", "dfg", "fgh", "ghj", "hjk", "jkl",
  "zxc", "xcv", "cvb", "vbn", "bnm",
  "qwer", "wert", "erty", "rtyu", "tyui", "yuio", "uiop",
  "asdf", "sdfg", "dfgh", "fghj", "ghjk", "hjkl",
  "zxcv", "xcvb", "cvbn", "vbnm",
  "qwert", "werty", "ertyu", "rtyui", "tyuio", "yuiop",
  "asdfg", "sdfgh", "dfghj", "fghjk", "ghjkl",
  "zxcvb", "xcvbn", "cvbnm",
  "qwerty", "wertyu", "ertyui", "rtyuio", "tyuiop",
  "asdfgh", "sdfghj", "dfghjk", "fghjkl",
  "zxcvbn", "xcvbnm",
  // —— 元音序列 ——
  "aei", "eio", "iou", "aeio", "eiou", "aeiou",
  // —— 重复字母（3-6 长度）——
  "aaa", "bbb", "ccc", "ddd", "eee", "fff", "ggg", "hhh", "iii", "jjj",
  "kkk", "lll", "mmm", "nnn", "ooo", "ppp", "qqq", "rrr", "sss", "ttt",
  "uuu", "vvv", "www", "xxx", "yyy", "zzz",
  "aaaa", "bbbb", "cccc", "dddd", "eeee", "ffff", "gggg", "hhhh", "iiii",
  "jjjj", "kkkk", "llll", "mmmm", "nnnn", "oooo", "pppp", "qqqq", "rrrr",
  "ssss", "tttt", "uuuu", "vvvv", "wwww", "xxxx", "yyyy", "zzzz",
  "aaaaa", "bbbbb", "ccccc", "ddddd", "eeeee", "fffff", "ggggg", "hhhhh",
  "iiiii", "jjjjj", "kkkkk", "lllll", "mmmmm", "nnnnn", "ooooo", "ppppp",
  "qqqqq", "rrrrr", "sssss", "ttttt", "uuuuu", "vvvvv", "wwwww", "xxxxx",
  "yyyyy", "zzzzz",
  "aaaaaa", "bbbbbb", "cccccc", "dddddd", "eeeeee", "ffffff", "gggggg",
  "hhhhhh", "iiiiii", "jjjjjj", "kkkkkk", "llllll", "mmmmmm", "nnnnnn",
  "oooooo", "pppppp", "qqqqqq", "rrrrrr", "ssssss", "tttttt", "uuuuuu",
  "vvvvvv", "wwwwww", "xxxxxx", "yyyyyy", "zzzzzz",
]);

/**
 * 规范化 cardId 对，确保 fromCardId < toCardId（与 soft-layout.ts 模式一致）。
 * 本文件内局部定义，避免新增共享工具文件。
 */
function normalizePair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * 从单个词中提取所有合法长度的子串片段（同一词内去重）。
 * 仅保留 a-z 字符，过滤掉含非字母的片段。
 */
function extractFragments(word: string): Set<string> {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, "");
  const fragments = new Set<string>();
  const len = cleaned.length;
  for (let size = MIN_LEN; size <= MAX_LEN; size++) {
    if (len < size) break;
    for (let i = 0; i + size <= len; i++) {
      fragments.add(cleaned.substring(i, i + size));
    }
  }
  return fragments;
}

/**
 * 执行结构片段挖掘任务。
 *
 * 流程：
 *   1. 查询所有 type=word/phrase 的 Card（仅 id 与 title）
 *   2. 对每个词提取 3-6 长度子串，聚合 fragment → cardIds
 *   3. 过滤：频率 < MIN_OCCURRENCE 或 > MAX_OCCURRENCE 或命中黑名单
 *   4. 对每个有效片段，将其所在的所有词两两配对，累加共享片段数
 *   5. weight = min(WEIGHT_CAP, BASE_WEIGHT + PER_PART_BONUS * sharedCount)
 *   6. 批量 upsert WordRelation(structural)
 *
 * @param _userId 可选用户 ID（当前统计全局结构关系，参数预留）
 * @returns 写入（upsert）的关系数量
 */
export async function runStructural(_userId?: string): Promise<number> {
  // ===== 1. 查询所有 word/phrase 卡片 =====
  const cards = await prisma.card.findMany({
    where: { type: { in: ["word", "phrase"] } },
    select: { id: true, title: true },
  });

  if (cards.length === 0) {
    logger.info("无 word/phrase 卡片可挖掘结构片段");
    return 0;
  }

  // ===== 2. 聚合 fragment → cardIds =====
  const fragmentToCards = new Map<string, string[]>();
  for (const card of cards) {
    const fragments = extractFragments(card.title);
    for (const frag of fragments) {
      // 黑名单片段直接跳过（不进入聚合）
      if (STRUCTURAL_BLACKLIST.has(frag)) continue;
      if (!fragmentToCards.has(frag)) fragmentToCards.set(frag, []);
      fragmentToCards.get(frag)!.push(card.id);
    }
  }

  // ===== 3. 过滤有效片段 =====
  // MIN_OCCURRENCE: 片段至少出现在 3 个不同词中才有意义
  // MAX_OCCURRENCE: 出现在 >20 个词中视为泛化片段（如 "ing"），不参与配对
  const validFragments = new Map<string, string[]>();
  for (const [frag, cardIds] of fragmentToCards) {
    if (cardIds.length < MIN_OCCURRENCE) continue;
    if (cardIds.length > MAX_OCCURRENCE) continue;
    validFragments.set(frag, cardIds);
  }

  if (validFragments.size === 0) {
    logger.info("无有效结构片段", { cardCount: cards.length, rawFragCount: fragmentToCards.size });
    return 0;
  }

  // ===== 4. 聚合每对词的共享片段列表 =====
  // pairSharedParts: key=`${a}|${b}` (a<b) → sharedParts: string[]
  const pairSharedParts = new Map<string, string[]>();
  for (const [frag, cardIds] of validFragments) {
    // 排序确保 a<b，与 normalizePair 一致
    const sorted = [...cardIds].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = `${sorted[i]}|${sorted[j]}`;
        if (!pairSharedParts.has(key)) pairSharedParts.set(key, []);
        pairSharedParts.get(key)!.push(frag);
      }
    }
  }

  // ===== 5. 生成关系 =====
  const relations: Array<{
    fromCardId: string;
    toCardId: string;
    weight: number;
    evidence: { sharedParts: string[]; count: number };
  }> = [];

  for (const [key, parts] of pairSharedParts) {
    const [a, b] = key.split("|");
    const sharedCount = parts.length;
    const weight = Math.min(WEIGHT_CAP, BASE_WEIGHT + PER_PART_BONUS * sharedCount);
    if (weight < MIN_WEIGHT) continue;
    const [fromCardId, toCardId] = normalizePair(a, b);
    relations.push({
      fromCardId,
      toCardId,
      weight: Number(weight.toFixed(4)),
      evidence: { sharedParts: parts, count: sharedCount },
    });
  }

  if (relations.length === 0) {
    logger.info("无 structural 关系可写入", {
      cardCount: cards.length,
      validFragCount: validFragments.size,
    });
    return 0;
  }

  // ===== 6. 批量 upsert 到 WordRelation =====
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

  logger.info("structural 关系构建完成", {
    cardCount: cards.length,
    validFragCount: validFragments.size,
    relationCount: relations.length,
  });

  return relations.length;
}
