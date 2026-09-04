/**
 * 项目记忆内存缓存层
 *
 * 设计目标：
 *   1. 减少 AI 问答时对 ProjectMemory 表的重复查询（每次对话都会读取激活记忆）
 *   2. 按 scope 分组缓存，支持按模块快速取用
 *   3. TTL 过期策略（默认 5 分钟），兼顾实时性与性能
 *   4. 写入时自动失效缓存，保证一致性
 *
 * 使用方式：
 *   - 读取：const memories = await getActiveMemories();
 *   - 失效：在 POST/PUT/DELETE 后调用 invalidateMemoryCache();
 *
 * 注意：
 *   - 本缓存为进程级（Module-level Map），多实例部署时每个实例独立
 *   - 对于 SQLite 单机部署足够；如未来扩展到多实例，可改用 Redis
 */
import { prisma } from "@/lib/db/prisma";
import { getLogger } from "@/lib/utils/logger";

const logger = getLogger("MemoryCache");

/** 缓存条目结构 */
interface CacheEntry {
  /** 缓存数据：按 scope 分组的项目记忆 */
  byScope: Map<string, Array<MemoryItem>>;
  /** 全量激活记忆（扁平列表，便于 AI 注入） */
  flat: MemoryItem[];
  /** 缓存写入时间戳（ms） */
  cachedAt: number;
}

/** 内存中的记忆条目结构（与 Prisma 记录字段对齐，但已序列化） */
export interface MemoryItem {
  id: string;
  title: string;
  content: string;
  type: string;
  scope: string;
  priority: number;
  source: string;
  moduleId: string | null;
}

/** 缓存 TTL（毫秒），默认 5 分钟 */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** 单例缓存条目（null 表示未缓存） */
let cache: CacheEntry | null = null;

/** 最大的 flat 列表长度（防止上下文爆炸） */
const MAX_FLAT_MEMORIES = 30;

/**
 * 从数据库加载所有激活的项目记忆，并按 scope 分组
 *
 * @returns 分组后的记忆映射
 */
async function loadFromDatabase(): Promise<CacheEntry> {
  // 查询所有激活记忆，按 priority 降序
  const records = await prisma.projectMemory.findMany({
    where: { active: true },
    orderBy: [{ priority: "desc" }, { lastUsedAt: "desc" }],
    take: 100, // 上限保护，避免记忆过多拖慢查询
  });

  // 转换为内存条目
  const items: MemoryItem[] = records.map((r) => ({
    id: r.id,
    title: r.title,
    content: r.content,
    type: r.type,
    scope: r.scope,
    priority: r.priority,
    source: r.source,
    moduleId: r.moduleId,
  }));

  // 按 scope 分组
  const byScope = new Map<string, MemoryItem[]>();
  for (const item of items) {
    const list = byScope.get(item.scope) ?? [];
    list.push(item);
    byScope.set(item.scope, list);
  }

  // 扁平列表取 Top N（按 priority 降序已排好）
  const flat = items.slice(0, MAX_FLAT_MEMORIES);

  logger.debug("项目记忆缓存加载完成", {
    total: items.length,
    scopes: Array.from(byScope.keys()),
  });

  return {
    byScope,
    flat,
    cachedAt: Date.now(),
  };
}

/**
 * 获取所有激活的项目记忆（扁平列表，按 priority 降序）
 *
 * 首次调用或缓存过期时从数据库加载，否则直接返回缓存
 *
 * @returns 激活的项目记忆列表
 */
export async function getActiveMemories(): Promise<MemoryItem[]> {
  if (cache && Date.now() - cache.cachedAt < CACHE_TTL_MS) {
    return cache.flat;
  }
  cache = await loadFromDatabase();
  return cache.flat;
}

/**
 * 按作用域获取项目记忆
 *
 * @param scope 作用域：global | stats | canvas | english | learn | qa
 * @returns 该作用域下的激活记忆列表
 */
export async function getMemoriesByScope(
  scope: string
): Promise<MemoryItem[]> {
  if (!cache || Date.now() - cache.cachedAt >= CACHE_TTL_MS) {
    cache = await loadFromDatabase();
  }
  return cache.byScope.get(scope) ?? [];
}

/**
 * 获取按作用域分组的所有记忆
 *
 * @returns Map<scope, MemoryItem[]>
 */
export async function getMemoriesGroupedByScope(): Promise<
  Map<string, MemoryItem[]>
> {
  if (!cache || Date.now() - cache.cachedAt >= CACHE_TTL_MS) {
    cache = await loadFromDatabase();
  }
  // 返回浅拷贝的 Map，避免外部修改影响缓存
  return new Map(cache.byScope);
}

/**
 * 失效缓存
 *
 * 在项目记忆 CRUD 操作后调用，确保下次读取时从数据库重新加载
 */
export function invalidateMemoryCache(): void {
  cache = null;
  logger.debug("项目记忆缓存已失效");
}

/**
 * 触摸记忆的 lastUsedAt（异步更新，不阻塞调用）
 *
 * @param memoryIds 本次使用的记忆 ID 列表
 */
export async function touchMemories(memoryIds: string[]): Promise<void> {
  if (memoryIds.length === 0) return;
  // 非关键操作，失败不影响主流程
  try {
    await prisma.projectMemory.updateMany({
      where: { id: { in: memoryIds } },
      data: { lastUsedAt: new Date() },
    });
  } catch (err) {
    logger.warn("更新 lastUsedAt 失败", { error: String(err) });
  }
}
