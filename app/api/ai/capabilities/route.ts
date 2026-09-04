/**
 * AI 能力清单 API（面向模型/Agent 的工具发现端点）
 * GET /api/ai/capabilities
 *
 * F5 插件化改造：工具清单不再硬编码，改为从插件注册表聚合——
 *   1. 读取所有 *启用* 插件的工具（PluginTool）
 *   2. tools/endpoints 平铺聚合（响应顶层结构与 1.0 协议兼容，旧消费者无感）
 *   3. 新增 plugins 字段标注工具归属（调试/选择性注入用）
 *
 * 首次访问时幂等初始化内置插件 builtin-canvas（复用原 4 工具），
 * 保证未做任何插件管理操作的老部署升级后行为不变。
 *
 * 调用方式（外部 AI 客户端）：
 *   - 读取本清单 → 将 tools 注入模型 → 按 endpoints 路由 HTTP 请求
 *   - 以插件身份调用时携带 x-plugin-id header（执行期按权限作用域校验）
 */
import { NextResponse } from "next/server";
import { aggregateCapabilities } from "@/lib/plugins/service";
import { getLogger } from "@/lib/utils/logger";

const logger = getLogger("CapabilitiesAPI");

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { tools, endpoints, plugins } = await aggregateCapabilities();
    return NextResponse.json({
      name: "learnforge-canvas",
      description:
        "LearnForge 学习画布能力接入（类 skill/MCP/plugin）。调用方式：将工具定义注入模型，按 ENDPOINTS 路由 HTTP 请求；以插件身份调用时携带 x-plugin-id header。",
      version: "1.1",
      protocol: "openai-function-tools",
      baseUrl: "/api",
      tools,
      endpoints,
      plugins,
    });
  } catch (err) {
    logger.error("聚合能力清单失败", { error: String(err) });
    return NextResponse.json({ error: "聚合能力清单失败" }, { status: 500 });
  }
}
