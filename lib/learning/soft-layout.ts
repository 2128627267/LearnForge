/**
 * 软相关性向量化 - 基于原始导入布局计算词对相似度
 *
 * 设计文档：.doc/WORD_LEARNING_DESIGN.md §5.3
 *
 * 计算规则：
 *   - 同 pack 同 fileName：基础相似度 0.7
 *   - 同 pack 不同 fileName：0.3
 *   - 相邻 itemOrder（差=1）：+0.2
 *   - 最终 sim = min(1, 基础 + 邻接加成)
 *   → 写入 WordRelation(type="soft_layout", weight=sim, evidence={base, adjacencyBonus})
 *
 * 关键约束：
 *   - 只为有 cardId 的 ImportLayout 建立关系（卡片删除后 cardId=null，跳过）
 *   - 使用 upsert 避免重复（依赖 @@unique([fromCardId, toCardId, type])）
 *   - 性能：同 fileName 内做全对，跨 fileName 仅抽样（避免 N^2 爆炸）
 *   - 规范化方向：fromCardId < toCardId，避免 A→B 与 B→A 重复
 *
 * 注意：本模块只生成 WordRelation(soft_layout)，不直接更新 WordProfile.correlationVector。
 * 后续调度器（§6.2 AI 语义分析/共现统计）会聚合所有 WordRelation 子类合并写入
 * correlationVector.neighbors。
 */
import { prisma } from "@/lib/db/prisma";
import { getLogger } from "@/lib/utils/logger";

const logger = getLogger("SoftLayout");

/** WordRelation.type 子类标识 */
const RELATION_TYPE = "soft_layout";

/** 同 fileName 基础相似度（同一单元/课时内的词） */
const SIM_SAME_FILE = 0.7;
/** 同 pack 跨 fileName 基础相似度（同一数据包但不同单元） */
const SIM_CROSS_FILE = 0.3;
/** 相邻 itemOrder 加成（原始布局中相邻的词） */
const ADJACENCY_BONUS = 0.2;
/** 相似度上限 */
const SIM_MAX = 1.0;
/**
 * 跨 fileName 抽样配对数上限。
 * 同 pack 内任意两个 fileName 之间最多抽样 sampleA × sampleB 对关系，
 * 避免在大型数据包中出现 N^2 爆炸。
 */
const CROSS_FILE_SAMPLE_LIMIT = 5;

/** 软相关性证据 JSON 结构（写入 WordRelation.evidence） */
interface SoftLayoutEvidence {
  /** 基础相似度（0.7 或 0.3） */
  base: number;
  /** 邻接加成（0 或 0.2） */
  adjacencyBonus: number;
}

/** 简化的 ImportLayout 行（仅取计算所需字段） */
interface LayoutRow {
  packId: string;
  cardId: string;
  fileName: string;
  itemOrder: number;
}

/**
 * 规范化 cardId 对，确保 fromCardId < toCardId。
 * 这样 A→B 与 B→A 会被合并为同一条记录，避免重复。
 */
function normalizePair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** 计算并 clamp 相似度到 [0, 1] */
function computeSim(base: number, adjacencyBonus: number): number {
  return Math.min(SIM_MAX, base + adjacencyBonus);
}

/**
 * 构建 soft_layout 软相关性关系。
 *
 * 流程：
 *   1. 查询所有有 cardId 的 ImportLayout（指定 packId 或全部）
 *   2. 按 (packId, fileName) 分组
 *   3. 同 fileName 内：全对计算（基础 0.7 + 邻接加成）
 *   4. 同 pack 跨 fileName：抽样配对（基础 0.3，无邻接加成）
 *   5. 批量 upsert 到 WordRelation(type="soft_layout")
 *
 * @param packId 可选，指定数据包 ID；不传则处理所有数据包
 * @returns 写入（upsert）的关系数量
 */
export async function buildSoftLayoutRelations(
  packId?: string
): Promise<number> {
  // ===== 1. 查询所有有 cardId 的 ImportLayout =====
  // cardId 为 null 的布局（卡片已删除）跳过，但布局记录仍保留（设计约束）
  const layouts = await prisma.importLayout.findMany({
    where: {
      cardId: { not: null },
      ...(packId ? { packId } : {}),
    },
    select: {
      packId: true,
      cardId: true,
      fileName: true,
      itemOrder: true,
    },
    // 排序确保分组与抽样稳定（便于复现与调试）
    orderBy: [
      { packId: "asc" },
      { fileName: "asc" },
      { itemOrder: "asc" },
    ],
  });

  if (layouts.length === 0) {
    logger.info("无 ImportLayout 可建立软相关性", { packId });
    return 0;
  }

  // ===== 2. 按 (packId, fileName) 分组 =====
  // key = `${packId}||${fileName}`，唯一标识一个"单元/课时"内的布局集合
  const groups = new Map<string, LayoutRow[]>();
  for (const l of layouts) {
    const key = `${l.packId}||${l.fileName}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({
      packId: l.packId,
      cardId: l.cardId!, // 已过滤 cardId: not null，断言非空
      fileName: l.fileName,
      itemOrder: l.itemOrder,
    });
  }

  // ===== 3. 按 packId 分组（用于跨 fileName 配对）=====
  // packs: packId -> Array<{ key, items }>
  const packs = new Map<string, Array<{ key: string; items: LayoutRow[] }>>();
  for (const [key, items] of groups.entries()) {
    const pid = items[0].packId;
    if (!packs.has(pid)) packs.set(pid, []);
    packs.get(pid)!.push({ key, items });
  }

  // ===== 4. 收集所有要 upsert 的关系 =====
  const relations: Array<{
    fromCardId: string;
    toCardId: string;
    weight: number;
    evidence: SoftLayoutEvidence;
  }> = [];

  // 4.1 同 fileName 内：全对计算（数量通常可控，单元内词数有限）
  for (const [, items] of groups.entries()) {
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        // 邻接判定：itemOrder 差为 1（原始布局中相邻）
        const adjacencyBonus =
          Math.abs(a.itemOrder - b.itemOrder) === 1 ? ADJACENCY_BONUS : 0;
        const weight = computeSim(SIM_SAME_FILE, adjacencyBonus);
        const [fromCardId, toCardId] = normalizePair(a.cardId, b.cardId);
        relations.push({
          fromCardId,
          toCardId,
          weight,
          evidence: { base: SIM_SAME_FILE, adjacencyBonus },
        });
      }
    }
  }

  // 4.2 同 pack 跨 fileName：抽样配对（避免 N^2 爆炸）
  // 每个 fileName 取前 CROSS_FILE_SAMPLE_LIMIT 个 item 作为代表，
  // 与其他 fileName 的代表配对，构成跨单元的弱关联。
  for (const [, fileGroups] of packs.entries()) {
    for (let i = 0; i < fileGroups.length; i++) {
      for (let j = i + 1; j < fileGroups.length; j++) {
        const groupA = fileGroups[i].items;
        const groupB = fileGroups[j].items;
        // 抽样：取每个 fileName 的前 N 个（按 itemOrder 升序）
        const sampleA = groupA.slice(0, CROSS_FILE_SAMPLE_LIMIT);
        const sampleB = groupB.slice(0, CROSS_FILE_SAMPLE_LIMIT);
        for (const a of sampleA) {
          for (const b of sampleB) {
            // 跨 fileName 不视为邻接（即便 itemOrder 巧合相邻）
            const weight = computeSim(SIM_CROSS_FILE, 0);
            const [fromCardId, toCardId] = normalizePair(a.cardId, b.cardId);
            relations.push({
              fromCardId,
              toCardId,
              weight,
              evidence: { base: SIM_CROSS_FILE, adjacencyBonus: 0 },
            });
          }
        }
      }
    }
  }

  if (relations.length === 0) {
    logger.info("无需建立 soft_layout 关系", { packId });
    return 0;
  }

  // ===== 5. 批量 upsert 到 WordRelation =====
  // 使用 $transaction 保证原子性；upsert 依赖 @@unique([fromCardId, toCardId, type])
  // 复合唯一键名 Prisma 自动生成为 fromCardId_toCardId_type
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

  logger.info("soft_layout 关系构建完成", {
    packId,
    relationCount: relations.length,
    groupCount: groups.size,
    packCount: packs.size,
  });

  return relations.length;
}
