/**
 * 单词学习系统 - 鉴权辅助
 *
 * 设计依据：.doc/WORD_LEARNING_DESIGN.md §7
 *
 * 当前项目尚未接入 NextAuth（参见 app/api/cards/route.ts 中的 TEMP_USER_ID 模式），
 * 这里为 /api/learn/* 路由提供统一的"默认学习用户"获取逻辑，遵循以下 fallback 链：
 *   1. process.env.LEARN_DEFAULT_USER_ID（显式指定）
 *   2. 数据库中第一个 User 的 id（按 createdAt 升序）
 *   3. 不存在则创建默认 User（email=learn@local, name=学习者）
 *
 * 注意：本模块只用于开发期/单机学习场景，正式生产应替换为 NextAuth session 解析。
 */
import { prisma } from "@/lib/db/prisma";
import { getLogger } from "@/lib/utils/logger";

const logger = getLogger("LearnAuth");

/** 默认学习用户的邮箱（用于自动创建时识别） */
export const DEFAULT_LEARN_USER_EMAIL = "learn@local";

/**
 * 获取学习用户 ID。
 * - 优先使用环境变量 LEARN_DEFAULT_USER_ID
 * - 否则取数据库中第一条 User
 * - 若数据库无任何 User，则创建一个默认 User 并返回其 id
 *
 * @returns userId（cuid 字符串）
 */
export async function getLearnUserId(): Promise<string> {
  // 1. 环境变量优先（便于测试与多用户场景下显式指定）
  const envUserId = process.env.LEARN_DEFAULT_USER_ID;
  if (envUserId && envUserId.trim().length > 0) {
    return envUserId.trim();
  }

  // 2. 取数据库中第一条 User（按创建时间升序，确保稳定）
  const firstUser = await prisma.user.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (firstUser) {
    return firstUser.id;
  }

  // 3. 数据库无 User，创建默认学习用户
  //    passwordHash 设为 "x" 表示不可登录（仅作为占位）
  logger.warn("数据库中未发现任何用户，自动创建默认学习用户 learn@local");
  const created = await prisma.user.create({
    data: {
      email: DEFAULT_LEARN_USER_EMAIL,
      name: "学习者",
      passwordHash: "x",
      role: "user",
    },
    select: { id: true },
  });
  return created.id;
}
