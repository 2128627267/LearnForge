/**
 * 本地访问令牌获取接口
 *
 * 安全约束：
 *   - 仅当请求 Host 为 localhost / 127.0.0.1 / ::1 时返回令牌
 *     （本机浏览器页面同源加载用；外部访问者无法从非本地 Host 获取）
 *   - 未配置 LOCAL_ACCESS_TOKEN 时返回 404（认证未启用，无需令牌）
 *
 * 说明：此路由由 middleware 放行（PUBLIC_PATHS），因此不会造成死循环；
 * 其本身已通过 localhost Host 校验限制访问来源。
 */
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const hostname = host.split(":")[0].toLowerCase();
  const isLocal =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]";

  if (!isLocal) {
    return new NextResponse(null, { status: 404 });
  }

  const token = process.env.LOCAL_ACCESS_TOKEN?.trim();
  if (!token) {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.json({ token });
}
