/**
 * 全局 API 认证中间件（可选的本地访问令牌）
 *
 * 安全增强：防止 API 被任意来源调用（成本耗尽 / 数据读取 / 配置篡改）。
 *
 * 行为：
 *   - 未配置 LOCAL_ACCESS_TOKEN → 全部放行（本地单机默认，行为不变）
 *   - 已配置 → 除公开路径外，所有 /api/* 请求必须携带
 *     x-local-token header 或 ?token= 查询参数，否则返回 401
 *
 * 公开路径（不校验）：
 *   - /api/local-token：本机浏览器获取令牌的入口（仅 localhost Host 返回）
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const TOKEN_HEADER = "x-local-token";

/** 无需校验的路径前缀 */
const PUBLIC_PATHS = ["/api/local-token"];

export function middleware(req: NextRequest) {
  const token = process.env.LOCAL_ACCESS_TOKEN?.trim();
  // 未配置令牌：保持本地单机默认开放行为
  if (!token) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // Header 校验
  if (req.headers.get(TOKEN_HEADER) === token) {
    return NextResponse.next();
  }
  // Query 校验
  if (req.nextUrl.searchParams.get("token") === token) {
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
