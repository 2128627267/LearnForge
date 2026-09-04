/**
 * 卡片类型定义与校验
 * 使用 Zod 进行运行时类型校验，确保数据安全
 */
import { z } from "zod";

/** 卡片类型枚举 */
export const CardTypeEnum = z.enum([
  "concept",  // 概念
  "word",     // 英语单词
  "phrase",   // 英语短语
  "grammar",  // 语法
  "problem",  // 数学题目
  "theorem",  // 定理
  "formula",  // 公式
]);
export type CardType = z.infer<typeof CardTypeEnum>;

/** 卡片状态枚举 */
export const CardStatusEnum = z.enum([
  "new",        // 新建
  "learning",   // 学习中
  "reviewing",  // 复习中
  "mastered",   // 已掌握
]);
export type CardStatus = z.infer<typeof CardStatusEnum>;

/** 卡片来源枚举 */
export const CardSourceEnum = z.enum([
  "manual",    // 手动创建
  "ai",        // AI 生成
  "imported",  // 导入
]);
export type CardSource = z.infer<typeof CardSourceEnum>;

/** 卡片关联类型 */
export const RelationTypeEnum = z.enum([
  "prerequisite", // 前置知识
  "related",      // 相关
  "extends",      // 延展
  "example",      // 例子
  "application",  // 应用
]);
export type RelationType = z.infer<typeof RelationTypeEnum>;

/** 例句条目：兼容纯字符串与 {en, zh} 结构化对象两种格式（与 Prisma schema 及学习链路一致） */
export const SentenceItemSchema = z.union([
  z.string(),
  z.object({
    en: z.string(),
    zh: z.string().optional(),
    meaning: z.string().optional(),
  }),
]);
export type SentenceItem = z.infer<typeof SentenceItemSchema>;

/** 创建卡片输入 Schema */
export const CreateCardSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().default(""),
  type: CardTypeEnum.default("concept"),
  subjectId: z.string().optional(),
  categoryId: z.string().optional(),
  difficulty: z.number().int().min(1).max(5).default(1),
  status: CardStatusEnum.default("new"),
  source: CardSourceEnum.default("manual"),
  metadata: z.record(z.unknown()).default({}),
  // 英语专属
  phonetic: z.string().optional(),
  partOfSpeech: z.string().optional(),
  meanings: z.array(z.string()).default([]),
  sentences: z.array(SentenceItemSchema).default([]),
  // 数学专属
  problemStatement: z.string().optional(),
  solution: z.string().optional(),
  latexFormulas: z.array(z.string()).default([]),
  answer: z.string().optional(),
  // 标签
  tagIds: z.array(z.string()).default([]),
});
export type CreateCardInput = z.infer<typeof CreateCardSchema>;

/** 更新卡片输入 Schema */
export const UpdateCardSchema = CreateCardSchema.partial().omit({ source: true });
export type UpdateCardInput = z.infer<typeof UpdateCardSchema>;

/** 卡片查询过滤 Schema */
export const CardQuerySchema = z.object({
  search: z.string().optional(),          // 关键词搜索（标题+内容）
  type: CardTypeEnum.optional(),          // 类型过滤
  subjectId: z.string().optional(),       // 学科过滤
  categoryId: z.string().optional(),      // 分类过滤
  status: CardStatusEnum.optional(),      // 状态过滤
  source: CardSourceEnum.optional(),      // 来源过滤
  tagIds: z.array(z.string()).optional(), // 标签过滤（任一匹配）
  difficulty: z.array(z.number().int().min(1).max(5)).optional(),
  favoriteOnly: z.boolean().optional(),   // 仅看收藏
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
  sort: z.enum(["createdAt_desc", "createdAt_asc", "updatedAt_desc", "difficulty_asc", "title_asc"]).default("updatedAt_desc"),
});
export type CardQuery = z.infer<typeof CardQuerySchema>;

/** AI 提取卡片结果 Schema */
export const AICardExtractionSchema = z.array(
  z.object({
    title: z.string(),
    type: CardTypeEnum.default("concept"),
    content: z.string(),
    difficulty: z.number().int().min(1).max(5).default(1),
    tags: z.array(z.string()).default([]),
    phonetic: z.string().optional(),
    partOfSpeech: z.string().optional(),
    meanings: z.array(z.string()).optional(),
    sentences: z.array(SentenceItemSchema).optional(),
    problemStatement: z.string().optional(),
    solution: z.string().optional(),
    latexFormulas: z.array(z.string()).optional(),
    answer: z.string().optional(),
  })
);
export type AICardExtraction = z.infer<typeof AICardExtractionSchema>;
