/**
 * 插件/技能系统 — 权限作用域定义
 *
 * 作用域格式：`资源:操作`（如 cards:write）。
 * 作用域之间无继承关系：cards:write 不隐含 cards:read，需显式声明。
 *
 * 设计说明见 .doc/07-DESIGN-PLUGIN-HARNESS.md 第 4 节。
 */

/** 全部合法权限作用域（manifest 校验的白名单来源） */
export const PLUGIN_SCOPES = [
  "cards:read",
  "cards:write",
  "canvas:read",
  "canvas:write",
  "settings:read",
  "settings:write",
] as const;

/** 权限作用域类型 */
export type PluginScope = (typeof PLUGIN_SCOPES)[number];

/** 作用域 → 中文说明（管理 UI 展示安装/启用时的权限清单） */
export const SCOPE_LABELS: Record<PluginScope, string> = {
  "cards:read": "读取卡片/知识库",
  "cards:write": "创建/修改卡片",
  "canvas:read": "读取画布布局",
  "canvas:write": "修改画布（含连线）",
  "settings:read": "读取设置（预留）",
  "settings:write": "修改设置（预留）",
};

/**
 * 端点 → 必需作用域映射（服务端权威表）
 *
 * 安全约束：
 *   - 执行期权限校验以此表为准，不信任 manifest 中声明的 endpoint/permissions，
 *     防止插件伪造低权限端点映射绕过校验（见规范第 7 节）
 *   - key 格式：`METHOD /path`（path 不含 query）
 *   - 未登记的端点视为"无需插件权限"（现状行为，仅全局 token 认证）
 */
export const ENDPOINT_SCOPES: Record<string, PluginScope[]> = {
  "GET /api/cards": ["cards:read"],
  "POST /api/cards": ["cards:write"],
  "POST /api/cards/batch": ["cards:write", "canvas:write"],
  "POST /api/cards/connect": ["canvas:write"],
  "GET /api/canvas-layout": ["canvas:read"],
  "PUT /api/canvas-layout": ["canvas:write"],
};

/**
 * 查询指定请求的必需作用域
 *
 * @param method   HTTP 方法（大写）
 * @param pathname URL 路径（不含 query，如 /api/cards/batch）
 * @returns 必需作用域数组；未登记端点返回 null（无插件级权限要求）
 */
export function requiredScopesFor(
  method: string,
  pathname: string
): PluginScope[] | null {
  return ENDPOINT_SCOPES[`${method.toUpperCase()} ${pathname}`] ?? null;
}
