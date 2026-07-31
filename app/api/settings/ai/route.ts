/**
 * AI 配置 API 路由
 * GET    /api/settings/ai  - 读取 AI 配置（id="default"，不存在则自动创建）
 * PUT    /api/settings/ai  - 更新 AI 配置
 *
 * 说明：
 * - AISettings 为单行配置表，id 固定为 "default"
 * - apiKeys 字段在数据库中以 JSON 字符串形式存储
 * - 返回数据时将 apiKeys 解析为数组，便于前端使用
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getLogger } from "@/lib/utils/logger";
import { isEnvVarReference, isFileLink } from "@/lib/config/env-resolver";

const logger = getLogger("SettingsAPI");

// 该路由读写数据库中的 AI 配置，强制动态渲染
export const dynamic = "force-dynamic";

/**
 * 对 API Key 脱敏（与 /api/settings/models 的 maskApiKey 规则一致）
 *   - 环境变量引用（${VAR}）或 file:// 链接 → 原样返回
 *   - 空字符串 → 原样返回
 *   - 其他 → 仅保留前 4 位与后 4 位
 *
 * 安全：防止 GET 响应把明文密钥暴露给前端/任何无认证调用方。
 */
function maskApiKey(key: string): string {
  if (!key) return "";
  if (isEnvVarReference(key) || isFileLink(key)) return key;
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

/**
 * 判断该值是否为脱敏占位（PUT 回传时应忽略，避免覆盖真实 Key）
 *   - 非空且含 "****"（脱敏格式）
 *   - 且不是 ${ENV_VAR} / file:// 引用（引用原样返回，不算占位）
 */
function isMaskedPlaceholder(value: string): boolean {
  if (!value) return false;
  if (isEnvVarReference(value) || isFileLink(value)) return false;
  return value.includes("****");
}

/**
 * 多 API Key 轮换池条目结构
 * - key:    API Key 明文
 * - label:  标签（便于识别，如 "账号1"）
 * - usage:  已用额度（估算）
 * - limit:  额度上限（估算）
 * - exhausted: 是否已耗尽
 */
export interface ApiKeyEntry {
  key: string;
  label: string;
  usage: number;
  limit: number;
  exhausted: boolean;
}

/**
 * AISettings 对外暴露的形状（apiKeys 已解析为数组）
 */
export interface AISettingsDTO {
  id: string;
  activeProvider: string;
  apiKey: string;
  apiUrl: string;
  chatModel: string;
  embeddingModel: string;
  embeddingDims: number;
  apiKeys: ApiKeyEntry[];
  currentKeyIdx: number;
  temperature: number;
  maxTokens: number;
  ragEnabled: boolean;
  ragTopK: number;
  updatedAt: string;
}

/**
 * 将数据库记录转换为 DTO（解析 apiKeys JSON 字符串）
 * 解析失败时回退为空数组，避免脏数据阻塞前端
 */
function toDTO(record: {
  id: string;
  activeProvider: string;
  apiKey: string;
  apiUrl: string;
  chatModel: string;
  embeddingModel: string;
  embeddingDims: number;
  apiKeys: string;
  currentKeyIdx: number;
  temperature: number;
  maxTokens: number;
  ragEnabled: boolean;
  ragTopK: number;
  updatedAt: Date;
}): AISettingsDTO {
  let apiKeys: ApiKeyEntry[] = [];
  try {
    const parsed = JSON.parse(record.apiKeys || "[]");
    if (Array.isArray(parsed)) {
      apiKeys = parsed as ApiKeyEntry[];
    }
  } catch {
    // 脏数据：JSON 解析失败，回退为空数组并记录警告
    logger.warn("apiKeys 字段 JSON 解析失败，已回退为空数组", {
      id: record.id,
    });
  }
  return {
    id: record.id,
    activeProvider: record.activeProvider,
    // 安全：返回脱敏后的 Key（避免明文泄漏）
    apiKey: maskApiKey(record.apiKey),
    apiUrl: record.apiUrl,
    chatModel: record.chatModel,
    embeddingModel: record.embeddingModel,
    embeddingDims: record.embeddingDims,
    // 轮换池条目同样脱敏
    apiKeys: apiKeys.map((k) => ({ ...k, key: maskApiKey(k.key) })),
    currentKeyIdx: record.currentKeyIdx,
    temperature: record.temperature,
    maxTokens: record.maxTokens,
    ragEnabled: record.ragEnabled,
    ragTopK: record.ragTopK,
    updatedAt: record.updatedAt.toISOString(),
  };
}

/**
 * 读取 AI 配置
 * 若 "default" 记录不存在则自动创建一条默认配置
 */
export async function GET() {
  try {
    // upsert 保证幂等：首次调用自动创建，后续直接返回
    const settings = await prisma.aISettings.upsert({
      where: { id: "default" },
      update: {},
      create: { id: "default" },
    });
    return NextResponse.json(toDTO(settings));
  } catch (err) {
    logger.error("读取 AI 配置失败", { error: String(err) });
    return NextResponse.json(
      { error: "读取 AI 配置失败", detail: String(err) },
      { status: 500 }
    );
  }
}

/**
 * 更新 AI 配置
 * 接收字段：activeProvider, apiKey, apiUrl, chatModel, embeddingModel,
 *           embeddingDims, apiKeys(数组), currentKeyIdx, temperature,
 *           maxTokens, ragEnabled, ragTopK
 *
 * 注意：
 * - 仅更新请求中明确提供的字段（未提供字段保持原值）
 * - apiKeys 数组会序列化为 JSON 字符串存储
 * - 数值字段会做范围校验，避免异常值
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    // 校验并构造更新数据
    const data: Record<string, unknown> = {};

    if (typeof body.activeProvider === "string") {
      const allowed = ["openai", "anthropic", "deepseek", "local"];
      if (!allowed.includes(body.activeProvider)) {
        return NextResponse.json(
          { error: "activeProvider 取值非法" },
          { status: 400 }
        );
      }
      data.activeProvider = body.activeProvider;
    }

    if (typeof body.apiKey === "string") {
      // 安全：脱敏占位（含 ****）回传时忽略，避免把真实 Key 覆盖为占位
      if (!isMaskedPlaceholder(body.apiKey)) {
        data.apiKey = body.apiKey;
      }
    }

    if (typeof body.apiUrl === "string") {
      data.apiUrl = body.apiUrl;
    }

    if (typeof body.chatModel === "string") {
      data.chatModel = body.chatModel;
    }

    if (typeof body.embeddingModel === "string") {
      data.embeddingModel = body.embeddingModel;
    }

    if (typeof body.embeddingDims === "number") {
      // 嵌入维度需为正整数
      if (!Number.isInteger(body.embeddingDims) || body.embeddingDims <= 0) {
        return NextResponse.json(
          { error: "embeddingDims 必须为正整数" },
          { status: 400 }
        );
      }
      data.embeddingDims = body.embeddingDims;
    }

    if (Array.isArray(body.apiKeys)) {
      // 过滤无效条目与脱敏占位条目，保证存储结构合法且不覆盖真实 Key
      const cleaned: ApiKeyEntry[] = body.apiKeys
        .filter(
          (k: unknown): k is ApiKeyEntry =>
            !!k &&
            typeof k === "object" &&
            typeof (k as ApiKeyEntry).key === "string" &&
            // 跳过脱敏占位（未修改的旧 Key 回传）
            !isMaskedPlaceholder((k as ApiKeyEntry).key)
        )
        .map((k: ApiKeyEntry) => ({
          key: k.key,
          label: typeof k.label === "string" ? k.label : "",
          usage: typeof k.usage === "number" ? k.usage : 0,
          limit: typeof k.limit === "number" ? k.limit : 0,
          exhausted: !!k.exhausted,
        }));
      data.apiKeys = JSON.stringify(cleaned);
    }

    if (typeof body.currentKeyIdx === "number") {
      if (
        !Number.isInteger(body.currentKeyIdx) ||
        body.currentKeyIdx < 0
      ) {
        return NextResponse.json(
          { error: "currentKeyIdx 必须为非负整数" },
          { status: 400 }
        );
      }
      data.currentKeyIdx = body.currentKeyIdx;
    }

    if (typeof body.temperature === "number") {
      // 温度范围 0-2，超出则裁剪
      data.temperature = Math.max(0, Math.min(2, body.temperature));
    }

    if (typeof body.maxTokens === "number") {
      if (!Number.isInteger(body.maxTokens) || body.maxTokens <= 0) {
        return NextResponse.json(
          { error: "maxTokens 必须为正整数" },
          { status: 400 }
        );
      }
      data.maxTokens = body.maxTokens;
    }

    if (typeof body.ragEnabled === "boolean") {
      data.ragEnabled = body.ragEnabled;
    }

    if (typeof body.ragTopK === "number") {
      if (!Number.isInteger(body.ragTopK) || body.ragTopK <= 0) {
        return NextResponse.json(
          { error: "ragTopK 必须为正整数" },
          { status: 400 }
        );
      }
      data.ragTopK = body.ragTopK;
    }

    // 第一步：保证 "default" 记录存在（不存在则用默认值创建）
    await prisma.aISettings.upsert({
      where: { id: "default" },
      update: {},
      create: { id: "default" },
    });

    // 第二步：应用本次更新（data 仅包含已校验的字段）
    // 使用类型断言：data 中的键均为 AISettings 合法字段，运行时安全
    const updated = await prisma.aISettings.update({
      where: { id: "default" },
      data: data as {
        activeProvider?: string;
        apiKey?: string;
        apiUrl?: string;
        chatModel?: string;
        embeddingModel?: string;
        embeddingDims?: number;
        apiKeys?: string;
        currentKeyIdx?: number;
        temperature?: number;
        maxTokens?: number;
        ragEnabled?: boolean;
        ragTopK?: number;
      },
    });

    logger.info("AI 配置已更新", {
      activeProvider: updated.activeProvider,
      ragEnabled: updated.ragEnabled,
    });

    return NextResponse.json(toDTO(updated));
  } catch (err) {
    logger.error("更新 AI 配置失败", { error: String(err) });
    return NextResponse.json(
      { error: "更新 AI 配置失败", detail: String(err) },
      { status: 500 }
    );
  }
}
