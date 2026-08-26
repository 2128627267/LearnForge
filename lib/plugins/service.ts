/**
 * 插件/技能系统 — 注册表服务
 *
 * 职责：
 *   - 内置插件幂等初始化（ensureBuiltinPlugins）
 *   - 安装/更新/启停/卸载（manifest 校验 + 跨插件工具名冲突检查 + 事务写入）
 *   - capabilities 聚合（启用插件工具平铺，保持既有响应结构兼容）
 *
 * 所有函数依赖 prisma 单例（lib/db/prisma），路由层直接调用。
 */
import { Prisma, type Plugin, type PluginTool } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { BUILTIN_CANVAS_MANIFEST, BUILTIN_PLUGIN_NAME } from "./builtin";
import { parseManifest } from "./manifest";
import type {
  AggregatedPluginInfo,
  AggregatedTool,
  PluginManifest,
} from "./types";

// ==================== 内置插件初始化 ====================

/** 判断是否为 Prisma 唯一约束冲突（P2002） */
function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

/**
 * 幂等写入内置插件
 *
 * - 不存在 → 创建（enabled=true）
 * - 已存在 → 跳过（不覆盖用户对 enabled 的修改，也不强制升级版本）
 * - 已存在但 source 非 builtin（注册表被外部篡改的异常态）→ 同样跳过，
 *   不覆盖该行；恢复正常的方法是删除该行后重新触发初始化
 *
 * 并发防护（审查 G-1）：两个请求同时发现"不存在"并竞相写入时，
 * 后落库的一方触发 P2002 唯一约束冲突——此时对方已写入，视为幂等成功。
 *
 * 调用时机：plugins 管理 API 与 capabilities 聚合首次访问时（各一次查询开销）
 */
export async function ensureBuiltinPlugins(): Promise<void> {
  const existing = await prisma.plugin.findUnique({
    where: { name: BUILTIN_PLUGIN_NAME },
    select: { id: true },
  });
  if (existing) return;

  try {
    await installManifest(BUILTIN_CANVAS_MANIFEST, "builtin");
  } catch (err) {
    if (isUniqueViolation(err)) return; // 并发初始化，对方已完成写入
    throw err;
  }
}

// ==================== 内部写入辅助 ====================

/**
 * 将已校验的 manifest 写入注册表（Plugin + PluginTool 行，事务）
 *
 * @param manifest 已通过 parseManifest 校验的清单
 * @param source   来源标记（builtin | user）
 * @returns 创建的 Plugin（含 tools 关系）
 */
async function installManifest(
  manifest: PluginManifest,
  source: "builtin" | "user"
): Promise<Plugin & { tools: PluginTool[] }> {
  return prisma.$transaction(async (tx) => {
    const plugin = await tx.plugin.create({
      data: {
        name: manifest.name,
        displayName: manifest.displayName,
        description: manifest.description ?? "",
        version: manifest.version,
        author: manifest.author ?? "",
        source,
        enabled: true,
        manifest: JSON.stringify(manifest),
        tools: {
          create: manifest.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parametersSchema: JSON.stringify(tool.parameters ?? {}),
            method: tool.endpoint.method,
            url: tool.endpoint.url,
            permissions: JSON.stringify(tool.permissions),
          })),
        },
      },
      include: { tools: true },
    });
    return plugin;
  });
}

// ==================== 查询 ====================

/** 插件列表（含工具关系） */
export async function listPlugins(): Promise<
  Array<Plugin & { tools: PluginTool[] }>
> {
  return prisma.plugin.findMany({
    include: { tools: true },
    orderBy: [{ source: "asc" }, { createdAt: "asc" }], // builtin 在前，同来源按安装时间
  });
}

/** 插件详情（含工具关系） */
export async function getPlugin(
  id: string
): Promise<(Plugin & { tools: PluginTool[] }) | null> {
  return prisma.plugin.findUnique({ where: { id }, include: { tools: true } });
}

// ==================== 安装 / 更新 / 启停 / 卸载 ====================

/**
 * 安装插件
 *
 * @param raw 请求提交的 manifest JSON
 * @returns 创建的 Plugin（含 tools）
 * @throws InstallError 结构校验失败 / name 已存在 / 工具名跨插件冲突
 */
export class InstallError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

export async function installPlugin(
  raw: unknown
): Promise<Plugin & { tools: PluginTool[] }> {
  const manifest = parseManifest(raw);

  // 保留名（审查 G-6）：builtin-canvas 由系统初始化通道写入，
  // 用户通道禁止占用——否则会在 ensureBuiltinPlugins 幂等检查处造成身份混淆
  if (manifest.name === BUILTIN_PLUGIN_NAME) {
    throw new InstallError(
      `插件名 ${BUILTIN_PLUGIN_NAME} 为内置插件保留名`,
      409
    );
  }

  // name 重复 → 提示走更新通道
  const byName = await prisma.plugin.findUnique({
    where: { name: manifest.name },
    select: { id: true },
  });
  if (byName) {
    throw new InstallError(
      `插件 ${manifest.name} 已存在，如需更新请使用 PUT`,
      409
    );
  }

  // 工具名跨插件冲突（PluginTool.name 全局唯一，提前给出可读错误而非裸 P2002）
  const conflicts = await prisma.pluginTool.findMany({
    where: { name: { in: manifest.tools.map((t) => t.name) } },
    select: { name: true, pluginId: true },
  });
  if (conflicts.length > 0) {
    throw new InstallError(
      `工具名已被其他插件占用：${conflicts.map((c) => c.name).join(", ")}`,
      409
    );
  }

  try {
    return await installManifest(manifest, "user");
  } catch (err) {
    // 并发窗口兜底（审查 G-2）：预检通过到事务落库之间 name/工具名被
    // 并发请求抢占 → 数据库唯一约束触发 P2002，统一转为可读的 409
    if (isUniqueViolation(err)) {
      throw new InstallError(
        "插件名或工具名已被并发操作占用，请重试",
        409
      );
    }
    throw err;
  }
}

/**
 * 更新插件（提交新 manifest，name 必须与注册表一致）
 *
 * 实现：删除旧 PluginTool 行后按新 manifest 重建（事务）。
 * 工具名全局唯一约束在事务内由数据库保证；与并发安装冲突时按 409 处理。
 */
export async function updatePlugin(
  id: string,
  raw: unknown
): Promise<Plugin & { tools: PluginTool[] }> {
  const manifest = parseManifest(raw);

  const existing = await prisma.plugin.findUnique({ where: { id } });
  if (!existing) {
    throw new InstallError("插件不存在", 404);
  }
  // builtin 保护（审查 G-3）：内置插件由版本升级通道管理，
  // 用户通道修改会破坏其与代码内置 manifest 的一致性（可启停，不可改内容）
  if (existing.source === "builtin") {
    throw new InstallError("内置插件不可修改（可启停）", 400);
  }
  if (existing.name !== manifest.name) {
    throw new InstallError(
      `manifest.name（${manifest.name}）与注册表（${existing.name}）不一致，插件名不可变`,
      400
    );
  }

  // 新工具名与其他插件的冲突（排除本插件自己的旧工具名）
  const conflicts = await prisma.pluginTool.findMany({
    where: {
      name: { in: manifest.tools.map((t) => t.name) },
      pluginId: { not: id },
    },
    select: { name: true },
  });
  if (conflicts.length > 0) {
    throw new InstallError(
      `工具名已被其他插件占用：${conflicts.map((c) => c.name).join(", ")}`,
      409
    );
  }

  try {
    return await prisma.$transaction(async (tx) => {
      // 重建工具行：先删后建（manifest 工具集合可能增删改名）
      await tx.pluginTool.deleteMany({ where: { pluginId: id } });
      return tx.plugin.update({
        where: { id },
        data: {
          displayName: manifest.displayName,
          description: manifest.description ?? "",
          version: manifest.version,
          author: manifest.author ?? "",
          manifest: JSON.stringify(manifest),
          tools: {
            create: manifest.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parametersSchema: JSON.stringify(tool.parameters ?? {}),
              method: tool.endpoint.method,
              url: tool.endpoint.url,
              permissions: JSON.stringify(tool.permissions),
            })),
          },
        },
        include: { tools: true },
      });
    });
  } catch (err) {
    // 并发窗口兜底（审查 G-2）：删除旧工具行后重建时，
    // 与并发安装/更新在 PluginTool.name 唯一约束上冲突 → 409
    if (isUniqueViolation(err)) {
      throw new InstallError(
        "工具名已被并发操作占用，请重试",
        409
      );
    }
    throw err;
  }
}

/** 启停插件（禁用后不聚合到 capabilities，其身份调用被拒绝） */
export async function setPluginEnabled(
  id: string,
  enabled: boolean
): Promise<Plugin & { tools: PluginTool[] }> {
  const existing = await prisma.plugin.findUnique({ where: { id } });
  if (!existing) {
    throw new InstallError("插件不存在", 404);
  }
  return prisma.plugin.update({
    where: { id },
    data: { enabled },
    include: { tools: true },
  });
}

/** 卸载插件（builtin 拒绝；级联删除工具行） */
export async function deletePlugin(id: string): Promise<void> {
  const existing = await prisma.plugin.findUnique({ where: { id } });
  if (!existing) {
    throw new InstallError("插件不存在", 404);
  }
  if (existing.source === "builtin") {
    throw new InstallError("内置插件不可卸载（可禁用）", 400);
  }
  await prisma.plugin.delete({ where: { id } });
}

// ==================== capabilities 聚合 ====================

/** 聚合结果：与既有 /api/ai/capabilities 响应结构兼容 */
export interface CapabilitiesAggregate {
  tools: AggregatedTool[];
  endpoints: Record<string, { method: string; url: string }>;
  plugins: AggregatedPluginInfo[];
}

/**
 * 聚合所有启用插件的工具
 *
 * - tools/endpoints 平铺（顶层结构不变，旧消费者无感）
 * - plugins 字段新增工具归属（调试/选择性注入用）
 * - 全部插件禁用 → 空聚合（合法状态）
 */
export async function aggregateCapabilities(): Promise<CapabilitiesAggregate> {
  await ensureBuiltinPlugins();

  const enabled = await prisma.plugin.findMany({
    where: { enabled: true },
    include: { tools: true },
    orderBy: [{ source: "asc" }, { createdAt: "asc" }],
  });

  const tools: AggregatedTool[] = [];
  const endpoints: Record<string, { method: string; url: string }> = {};
  const plugins: AggregatedPluginInfo[] = [];

  for (const plugin of enabled) {
    for (const tool of plugin.tools) {
      tools.push({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: safeParse(tool.parametersSchema, {}),
        },
      });
      endpoints[tool.name] = { method: tool.method, url: tool.url };
    }
    plugins.push({
      name: plugin.name,
      version: plugin.version,
      tools: plugin.tools.map((t) => t.name),
    });
  }

  return { tools, endpoints, plugins };
}

/** JSON 字符串安全解析（损坏时回退默认值） */
function safeParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
