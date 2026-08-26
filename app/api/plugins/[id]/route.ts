/**
 * 插件管理 API — 单项端点
 *
 * GET    /api/plugins/[id]  插件详情（含完整 manifest 与工具）
 * PUT    /api/plugins/[id]  更新（body = 新 manifest，name 不可变）
 * PATCH  /api/plugins/[id]  启停（body = { enabled: boolean }）
 * DELETE /api/plugins/[id]  卸载（builtin 拒绝）
 *
 * 认证：依赖全局 middleware（LOCAL_ACCESS_TOKEN 配置时校验 x-local-token）
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ZodError } from "zod";
import { getLogger } from "@/lib/utils/logger";
import {
  InstallError,
  deletePlugin,
  getPlugin,
  setPluginEnabled,
  updatePlugin,
} from "@/lib/plugins/service";

const logger = getLogger("PluginsAPI");

export const dynamic = "force-dynamic";

/** PATCH 启停请求体 schema */
const PatchSchema = z.object({ enabled: z.boolean() });

type RouteContext = { params: { id: string } };

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const plugin = await getPlugin(params.id);
    if (!plugin) {
      return NextResponse.json({ error: "插件不存在" }, { status: 404 });
    }
    return NextResponse.json(plugin);
  } catch (err) {
    logger.error("获取插件详情失败", { id: params.id, error: String(err) });
    return NextResponse.json({ error: "获取插件详情失败" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    // 非法 JSON 容错（审查 G-5）：SyntaxError → 400 而非 500
    const body = await request.json().catch(() => null);
    if (body === null) {
      return NextResponse.json(
        { error: "请求体必须是合法的 JSON" },
        { status: 400 }
      );
    }
    const plugin = await updatePlugin(params.id, body);
    logger.info("插件已更新", { name: plugin.name, version: plugin.version });
    return NextResponse.json(plugin);
  } catch (err) {
    if (err instanceof ZodError) {
      const detail = err.issues.map((i) => i.message).join("；");
      return NextResponse.json({ error: `manifest 校验失败：${detail}` }, { status: 400 });
    }
    if (err instanceof InstallError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    logger.error("更新插件失败", { id: params.id, error: String(err) });
    return NextResponse.json({ error: "更新插件失败" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    // 非法 JSON 容错（审查 G-5）：SyntaxError → 400 而非 500
    const body = await request.json().catch(() => null);
    if (body === null) {
      return NextResponse.json(
        { error: "请求体必须是合法的 JSON" },
        { status: 400 }
      );
    }
    const { enabled } = PatchSchema.parse(body);
    const plugin = await setPluginEnabled(params.id, enabled);
    logger.info("插件启停已变更", { name: plugin.name, enabled });
    return NextResponse.json(plugin);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "请求体必须为 { enabled: boolean }" },
        { status: 400 }
      );
    }
    if (err instanceof InstallError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    logger.error("启停插件失败", { id: params.id, error: String(err) });
    return NextResponse.json({ error: "启停插件失败" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  try {
    await deletePlugin(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof InstallError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    logger.error("卸载插件失败", { id: params.id, error: String(err) });
    return NextResponse.json({ error: "卸载插件失败" }, { status: 500 });
  }
}
