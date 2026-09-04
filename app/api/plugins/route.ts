/**
 * 插件管理 API — 集合端点
 *
 * GET  /api/plugins  插件列表（含工具关系，builtin 在前）
 * POST /api/plugins  安装插件（body = manifest JSON）
 *
 * 认证：依赖全局 middleware（LOCAL_ACCESS_TOKEN 配置时校验 x-local-token）
 */
import { NextRequest, NextResponse } from "next/server";
import { getLogger } from "@/lib/utils/logger";
import { InstallError, ensureBuiltinPlugins, installPlugin, listPlugins } from "@/lib/plugins/service";
import { ZodError } from "zod";

const logger = getLogger("PluginsAPI");

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // 首次访问时幂等初始化内置插件（已存在则一次空查询开销）
    await ensureBuiltinPlugins();
    const items = await listPlugins();
    return NextResponse.json({ items });
  } catch (err) {
    logger.error("获取插件列表失败", { error: String(err) });
    return NextResponse.json({ error: "获取插件列表失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // 非法 JSON（缺引号/截断等）解析抛 SyntaxError → 500；容错转 400（审查 G-5）
    const body = await request.json().catch(() => null);
    if (body === null) {
      return NextResponse.json(
        { error: "请求体必须是合法的 JSON" },
        { status: 400 }
      );
    }
    const plugin = await installPlugin(body);
    logger.info("插件已安装", { name: plugin.name, version: plugin.version });
    return NextResponse.json(plugin, { status: 201 });
  } catch (err) {
    // manifest 结构校验失败 → 400（含可读的中文错误信息）
    if (err instanceof ZodError) {
      const detail = err.issues.map((i) => i.message).join("；");
      return NextResponse.json({ error: `manifest 校验失败：${detail}` }, { status: 400 });
    }
    // 业务冲突（name 重复 / 工具名占用）→ 携带 service 层状态码
    if (err instanceof InstallError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    logger.error("安装插件失败", { error: String(err) });
    return NextResponse.json({ error: "安装插件失败" }, { status: 500 });
  }
}
