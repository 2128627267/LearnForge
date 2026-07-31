/**
 * 本地访问令牌（最小 API 认证）
 *
 * 背景：本项目为本地单机学习应用，所有 /api/* 默认无认证（TEMP_USER_ID 模式）。
 * 为降低暴露到局域网/公网时的风险，提供可选的访问令牌校验：
 *   - 配置环境变量 LOCAL_ACCESS_TOKEN 后，所有 /api/* 请求必须携带令牌
 *   - 未配置时行为完全不变（本地单机默认开放）
 *
 * 令牌传递方式（二选一）：
 *   1. Header: x-local-token: <token>
 *   2. Query:  ?token=<token>
 *
 * 前端自动携带：根布局内联脚本从 /api/local-token（仅 localhost 可访问）
 * 获取令牌，并拦截 fetch 自动附加 x-local-token header。
 */
import type { NextRequest } from "next/server";

/** 令牌请求头名称 */
export const LOCAL_TOKEN_HEADER = "x-local-token";

/** 查询参数名 */
export const LOCAL_TOKEN_QUERY = "token";

/** 未授权响应 */
export const LOCAL_TOKEN_UNAUTHORIZED = JSON.stringify({
  error: "未授权访问：缺少有效的访问令牌（x-local-token）",
});

/**
 * 获取配置的本地访问令牌
 * @returns 配置了则返回 token，否则返回 null（未启用认证）
 */
export function getConfiguredLocalToken(): string | null {
  const t = process.env.LOCAL_ACCESS_TOKEN?.trim();
  return t && t.length > 0 ? t : null;
}

/**
 * 校验请求是否被允许
 *   - 未配置 LOCAL_ACCESS_TOKEN → 恒通过（本地单机默认）
 *   - 配置后校验 Header 或 Query
 */
export function isRequestAllowed(req: NextRequest | Request): boolean {
  const token = getConfiguredLocalToken();
  if (!token) return true;

  // 1. Header 校验
  if (req.headers.get(LOCAL_TOKEN_HEADER) === token) return true;

  // 2. Query 校验
  const url = new URL(req.url);
  if (url.searchParams.get(LOCAL_TOKEN_QUERY) === token) return true;

  return false;
}
