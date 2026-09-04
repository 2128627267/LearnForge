/**
 * 本地访问令牌获取接口
 *
 * 安全约束：
 *   - 仅当请求 Host 为 localhost / 127.0.0.1 / ::1 时返回令牌
 *     （本机浏览器页面同源加载用；外部访问者无法从非本地 Host 获取）
 *   - 未配置 LOCAL_ACCESS_TOKEN 时返回 404（认证未启用，无需令牌）
 *   - 局域网模式（LAN_ACCESS=1，见 start-dev-lan.bat）下直接返回 404：
 *     绑定 0.0.0.0 后局域网内主机可手写 HTTP 请求伪造 Host: localhost
 *     绕过下方的来源校验窃取令牌，此时 Host 校验不再可靠，
 *     令牌一律由浏览器端手动输入（见 app/layout.tsx 引导脚本）
 *
 * 说明：此路由由 middleware 放行（PUBLIC_PATHS），因此不会造成死循环；
 * 其本身已通过 localhost Host 校验限制访问来源。
 */
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  // 局域网模式加固：禁用令牌自动下发，防止伪造 Host 头窃取
  if (process.env.LAN_ACCESS === "1") {
    return new NextResponse(null, { status: 404 });
  }

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
