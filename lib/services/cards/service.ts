/**
 * 卡片服务层 - 业务逻辑
 * 封装卡片 CRUD、查询、收藏、笔记等操作
 */
import { prisma } from "@/lib/db/prisma";
import { getLogger } from "@/lib/utils/logger";
import type { CardQuery, CreateCardInput, UpdateCardInput } from "./types";

const logger = getLogger("CardService");

export class CardService {
  /**
   * 创建卡片
   */
  async create(userId: string, input: CreateCardInput) {
    const { tagIds, metadata, meanings, sentences, latexFormulas, ...cardData } = input;

    logger.info("创建卡片", { userId, title: input.title, type: input.type });

    const card = await prisma.card.create({
      data: {
        ...cardData,
        userId,
        metadata: JSON.stringify(metadata || {}),
        meanings: JSON.stringify(meanings || []),
        sentences: JSON.stringify(sentences || []),
        latexFormulas: JSON.stringify(latexFormulas || []),
        tags: tagIds.length
          ? { create: tagIds.map((tagId) => ({ tagId })) }
          : undefined,
      },
      include: { tags: { include: { tag: true } }, subject: true, category: true },
    });

    // 记录学习日志
    await prisma.studyLog.create({
      data: { userId, cardId: card.id, action: "create" },
    });

    return card;
  }

  /**
   * 更新卡片
   */
  async update(cardId: string, userId: string, input: UpdateCardInput) {
    const { tagIds, metadata, meanings, sentences, latexFormulas, ...cardData } = input;

    logger.info("更新卡片", { cardId, userId });

    // 标签更新需要先删除旧的再创建新的
    if (tagIds) {
      await prisma.cardTag.deleteMany({ where: { cardId } });
    }

    return prisma.card.update({
      where: { id: cardId },
      data: {
        ...cardData,
        ...(metadata ? { metadata: JSON.stringify(metadata) } : {}),
        ...(meanings ? { meanings: JSON.stringify(meanings) } : {}),
        ...(sentences ? { sentences: JSON.stringify(sentences) } : {}),
        ...(latexFormulas ? { latexFormulas: JSON.stringify(latexFormulas) } : {}),
        ...(tagIds
          ? { tags: { create: tagIds.map((tagId) => ({ tagId })) } }
          : {}),
      },
      include: { tags: { include: { tag: true } }, subject: true, category: true },
    });
  }

  /**
   * 删除卡片
   */
  async delete(cardId: string) {
    logger.info("删除卡片", { cardId });
    return prisma.card.delete({ where: { id: cardId } });
  }

  /**
   * 获取单张卡片
   */
  async getById(cardId: string) {
    return prisma.card.findUnique({
      where: { id: cardId },
      include: {
        tags: { include: { tag: true } },
        subject: true,
        category: true,
        relationsFrom: { include: { toCard: { select: { id: true, title: true, type: true } } } },
        relationsTo: { include: { fromCard: { select: { id: true, title: true, type: true } } } },
      },
    });
  }

  /**
   * 查询卡片列表（支持搜索、过滤、排序、分页）
   */
  async list(query: CardQuery, userId?: string) {
    const {
      search,
      type,
      subjectId,
      categoryId,
      status,
      source,
      tagIds,
      difficulty,
      favoriteOnly,
      limit,
      offset,
      sort,
    } = query;

    // 构建查询条件
    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (subjectId) where.subjectId = subjectId;
    if (categoryId) where.categoryId = categoryId;
    if (status) where.status = status;
    if (source) where.source = source;
    if (difficulty?.length) where.difficulty = { in: difficulty };
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { content: { contains: search } },
      ];
    }
    if (tagIds?.length) {
      where.tags = { some: { tagId: { in: tagIds } } };
    }
    if (favoriteOnly && userId) {
      where.favorites = { some: { userId } };
    }

    // 排序映射（使用 Prisma 兼容的排序对象，无需显式类型标注）
    const orderBy = (() => {
      switch (sort) {
        case "createdAt_desc": return { createdAt: "desc" as const };
        case "createdAt_asc": return { createdAt: "asc" as const };
        case "updatedAt_desc": return { updatedAt: "desc" as const };
        case "difficulty_asc": return { difficulty: "asc" as const };
        case "title_asc": return { title: "asc" as const };
        default: return { updatedAt: "desc" as const };
      }
    })();

    const [items, total] = await Promise.all([
      prisma.card.findMany({
        where,
        orderBy,
        take: limit,
        skip: offset,
        include: {
          tags: { include: { tag: true } },
          subject: true,
          ...(userId
            ? { favorites: { where: { userId }, select: { userId: true } } }
            : {}),
        },
      }),
      prisma.card.count({ where }),
    ]);

    return { items, total, limit, offset };
  }

  /**
   * 收藏/取消收藏
   */
  async toggleFavorite(cardId: string, userId: string) {
    const existing = await prisma.cardFavorite.findUnique({
      where: { userId_cardId: { userId, cardId } },
    });

    if (existing) {
      await prisma.cardFavorite.delete({
        where: { userId_cardId: { userId, cardId } },
      });
      return { favorited: false };
    }

    await prisma.cardFavorite.create({ data: { userId, cardId } });
    return { favorited: true };
  }

  /**
   * 添加笔记
   */
  async addNote(cardId: string, userId: string, content: string) {
    return prisma.cardNote.create({
      data: { cardId, userId, content },
    });
  }

  /**
   * 记录学习行为
   */
  async logStudy(userId: string, cardId: string, action: string, durationMs = 0, correct?: boolean) {
    return prisma.studyLog.create({
      data: { userId, cardId, action, durationMs, correct },
    });
  }

  /**
   * 获取卡片关联（用于路线图）
   */
  async getRelations(cardId: string) {
    const [prerequisites, related, extensions] = await Promise.all([
      prisma.cardRelation.findMany({
        where: { fromCardId: cardId, type: "prerequisite" },
        include: { toCard: { select: { id: true, title: true, type: true, difficulty: true } } },
      }),
      prisma.cardRelation.findMany({
        where: { fromCardId: cardId, type: "related" },
        include: { toCard: { select: { id: true, title: true, type: true } } },
      }),
      prisma.cardRelation.findMany({
        where: { fromCardId: cardId, type: { in: ["extends", "example", "application"] } },
        include: { toCard: { select: { id: true, title: true, type: true, difficulty: true } } },
      }),
    ]);

    return { prerequisites, related, extensions };
  }
}

/** 单例 */
export const cardService = new CardService();
