/**
 * 插件/技能系统 — 执行期权限校验
 *
 * 协议（见规范第 7 节）：
 *   - 请求不带 x-plugin-id → 视为 web 用户直连，仅走全局 token 认证（零回归）
 *   - 带 x-plugin-id → 查注册表：插件不存在/未启用 → 403
 *   - 按"端点 → 必需作用域"服务端权威映射校验插件 permissions 覆盖度 → 不足 403
 *   - 通过 → 返回调用上下文（auditSource 用于 DataChangeLog 审计）
 */
import type { PrismaClient } from "@prisma/client";
import { requiredScopesFor } from "./scopes";
import type { PluginCallContext } from "./types";

/** 请求中标识调用来源插件的 header 名 */
export const PLUGIN_ID_HEADER = "x-plugin-id";

/** 授权结果：通过（context=null 表示非插件调用）或拒绝（含状态码与错误信息） */
export type AuthorizeResult =
  | { ok: true; context: PluginCallContext | null }
  | { ok: false; status: number; error: string };

/**
 * 校验请求是否允许以插件身份执行指定端点
 *
 * @param prisma     Prisma 客户端
 * @param request    进入路由的原始请求（读取 x-plugin-id header）
 * @param method     实际 HTTP 方法（以路由判定为准，不信任客户端）
 * @param pathname   实际请求路径（不含 query）
 */
export async function authorizePluginCall(
  prisma: PrismaClient,
  request: Request,
  method: string,
  pathname: string
): Promise<AuthorizeResult> {
  const pluginName = request.headers.get(PLUGIN_ID_HEADER);
  // 未声明插件身份：web 用户直连，走既有全局认证，行为与现状一致
  if (!pluginName) {
    return { ok: true, context: null };
  }

  // 查注册表：一次取齐 id/name/enabled 与 manifest（权限声明在 manifest JSON 内）
  const plugin = await prisma.plugin.findUnique({
    where: { name: pluginName },
    select: { id: true, name: true, enabled: true, manifest: true },
  });

  if (!plugin || !plugin.enabled) {
    return {
      ok: false,
      status: 403,
      error: `插件不存在或未启用：${pluginName}`,
    };
  }

  // 端点必需作用域（服务端权威映射）
  const required = requiredScopesFor(method, pathname);
  if (required && required.length > 0) {
    let granted: string[] = [];
    try {
      granted = (JSON.parse(plugin.manifest).permissions ?? []) as string[];
    } catch {
      // manifest 损坏视为无权限（注册表数据异常时的安全默认）
      granted = [];
    }
    const missing = required.filter((scope) => !granted.includes(scope));
    if (missing.length > 0) {
      return {
        ok: false,
        status: 403,
        error: `插件 ${pluginName} 缺少端点所需权限：${missing.join(", ")}`,
      };
    }
  }

  return {
    ok: true,
    context: {
      pluginId: plugin.id,
      pluginName: plugin.name,
      auditSource: `plugin:${plugin.name}`,
    },
  };
}

/**
 * 权限子集判断（纯函数，供测试与安装期校验复用）
 *
 * @param required 必需作用域
 * @param granted  已授予作用域
 * @returns required 是否为 granted 的子集
 */
export function isScopeSubset(required: string[], granted: string[]): boolean {
  const set = new Set(granted);
  return required.every((scope) => set.has(scope));
}
