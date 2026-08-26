/**
 * 全局 API 认证中间件（可选的本地访问令牌）
 *
 * 安全增强：防止 API 被任意来源调用（成本耗尽 / 数据读取 / 配置篡改）。
 *
 * 行为：
 *   - 未配置 LOCAL_ACCESS_TOKEN → 全部放行（本地单机默认，行为不变）
 *   - 已配置 → 除公开路径外，所有 /api/* 请求必须携带
 *     x-local-token header（常量时间比较），否则返回 401
 *
 * 公开路径（不校验）：
 *   - /api/local-token：本机浏览器获取令牌的入口（仅 localhost Host 返回）
 *
 * 变更记录：
 *   - 移除 ?token= 查询参数支持（令牌会泄漏到服务器日志/浏览器历史）
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { timingSafeEqualStr } from "@/lib/utils/timing-safe-equal";

const TOKEN_HEADER = "x-local-token";

/** 无需校验的路径前缀 */
const PUBLIC_PATHS = ["/api/local-token"];

export async function middleware(req: NextRequest) {
  const token = process.env.LOCAL_ACCESS_TOKEN?.trim();
  // 未配置令牌：保持本地单机默认开放行为
  if (!token) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // Header 校验（常量时间比较，防时序侧信道）
  const headerToken = req.headers.get(TOKEN_HEADER);
  if (headerToken && (await timingSafeEqualStr(headerToken, token))) {
    return NextResponse.next();
  }

  return new NextResponse(
    JSON.stringify({ error: "未授权访问：缺少有效的访问令牌（x-local-token）" }),
    {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }
  );
}

export const config = {
  matcher: ["/api/:path*"],
};
