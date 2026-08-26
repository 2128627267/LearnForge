/**
 * 本地访问令牌（最小 API 认证）
 *
 * 背景：本项目为本地单机学习应用，所有 /api/* 默认无认证（TEMP_USER_ID 模式）。
 * 为降低暴露到局域网/公网时的风险，提供可选的访问令牌校验：
 *   - 配置环境变量 LOCAL_ACCESS_TOKEN 后，所有 /api/* 请求必须携带令牌
 *   - 未配置时行为完全不变（本地单机默认开放）
 *
 * 令牌传递方式：
 *   1. Header: x-local-token: <token>
 *      （曾支持 ?token= 查询参数，已移除——令牌会泄漏到服务器日志/浏览器历史）
 *
 * 前端自动携带：根布局内联脚本从 /api/local-token（仅 localhost 可访问）
 * 获取令牌，并拦截 fetch 自动附加 x-local-token header。
 */
import type { NextRequest } from "next/server";
import { timingSafeEqualStr } from "@/lib/utils/timing-safe-equal";

/** 令牌请求头名称 */
export const LOCAL_TOKEN_HEADER = "x-local-token";

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
 *   - 配置后校验 Header（常量时间比较，防时序侧信道）
 */
export async function isRequestAllowed(req: NextRequest | Request): Promise<boolean> {
  const token = getConfiguredLocalToken();
  if (!token) return true;

  // Header 校验
  const headerToken = req.headers.get(LOCAL_TOKEN_HEADER);
  if (headerToken && (await timingSafeEqualStr(headerToken, token))) {
    return true;
  }

  return false;
}
