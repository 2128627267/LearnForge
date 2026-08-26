/**
 * 模型配置 CRUD API
 * GET    /api/settings/models        - 列出所有模型配置（可按 category 筛选）
 * POST   /api/settings/models        - 新增模型配置
 *
 * 数据流：
 *   - 前端表单 → POST → prisma.aIModelConfig.create → 返回新记录
 *   - 前端列表 → GET → prisma.aIModelConfig.findMany → 返回数组
 *
 * 安全性：
 *   - apiKey 字段在返回时脱敏（仅保留前 4 位与后 4 位）
 *   - 但如果 apiKey 是 ${ENV_VAR} 或 file:// 语法，则原样返回（不脱敏）
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getLogger } from "@/lib/utils/logger";
import { errorResponse } from "@/lib/utils/http-error";
import { isEnvVarReference, isFileLink } from "@/lib/config/env-resolver";

const logger = getLogger("ModelsAPI");

export const dynamic = "force-dynamic";

// ==================== 类型定义 ====================

/** 模型配置大类 */
export type ModelCategory = "language" | "embedding" | "voice" | "image" | "other";

/** API 协议格式 */
export type ApiFormat =
  | "openai-chat"
  | "openai-responses"
  | "anthropic"
  | "gemini"
  | "ollama"
  | "custom";

/** 模型配置 DTO（对外暴露的形状） */
export interface AIModelConfigDTO {
  id: string;
  name: string;
  category: ModelCategory;
  provider: string;
  /** API 协议格式（openai 兼容 / anthropic / gemini / ollama / custom） */
  apiFormat: ApiFormat;
  modelName: string;
  /** API Key（脱敏或原样返回环境变量引用） */
  apiKey: string;
  apiUrl: string;
  isActive: boolean;
  order: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ==================== 工具函数 ====================

/** 允许的模型大类 */
const ALLOWED_CATEGORIES: ModelCategory[] = [
  "language",
  "embedding",
  "voice",
  "image",
  "other",
];

/** 允许的提供商 */
const ALLOWED_PROVIDERS = [
  "openai",
  "anthropic",
  "deepseek",
  "local",
  "custom",
];

/** 允许的 API 协议格式 */
const ALLOWED_API_FORMATS: ApiFormat[] = [
  "openai-chat",
  "openai-responses",
  "anthropic",
  "gemini",
  "ollama",
  "custom",
];

/** 旧值兼容归一化：openai → openai-chat */
function normalizeApiFormat(value: string): ApiFormat {
  if (value === "openai") return "openai-chat";
  return ALLOWED_API_FORMATS.includes(value as ApiFormat)
    ? (value as ApiFormat)
    : "openai-chat";
}

/**
 * 对 API Key 脱敏
 *
 * 规则：
 *   - 环境变量引用（${VAR}）或 file:// 链接 → 原样返回
 *   - 空字符串 → 原样返回
 *   - 其他 → 仅保留前 4 位与后 4 位
 */
function maskApiKey(key: string): string {
  if (!key) return "";
  if (isEnvVarReference(key) || isFileLink(key)) return key;
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

/**
 * 将数据库记录转换为 DTO
 * - apiKey 脱敏
 * - metadata JSON 解析为对象
 * - 日期转换为 ISO 字符串
 */
function toDTO(record: {
  id: string;
  name: string;
  category: string;
  provider: string;
  apiFormat: string;
  modelName: string;
  apiKey: string;
  apiUrl: string;
  isActive: boolean;
  order: number;
  metadata: string;
  createdAt: Date;
  updatedAt: Date;
}): AIModelConfigDTO {
  let metadata: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(record.metadata || "{}");
    if (parsed && typeof parsed === "object") {
      metadata = parsed as Record<string, unknown>;
    }
  } catch {
    logger.warn("metadata JSON 解析失败", { id: record.id });
  }
  return {
    id: record.id,
    name: record.name,
    category: record.category as ModelCategory,
    provider: record.provider,
    apiFormat: normalizeApiFormat(record.apiFormat),
    modelName: record.modelName,
    apiKey: maskApiKey(record.apiKey),
    apiUrl: record.apiUrl,
    isActive: record.isActive,
    order: record.order,
    metadata,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

// ==================== 路由处理 ====================

/**
 * GET /api/settings/models?category=language
 *
 * 查询参数：
 *   - category: 按大类筛选（可选）
 *   - includeInactive: 是否包含禁用的配置项（默认 false）
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category");
    const includeInactive = searchParams.get("includeInactive") === "true";

    // 构建查询条件
    const where: Record<string, unknown> = {};
    if (category && ALLOWED_CATEGORIES.includes(category as ModelCategory)) {
      where.category = category;
    }
    if (!includeInactive) {
      where.isActive = true;
    }

    const records = await prisma.aIModelConfig.findMany({
      where,
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });

    return NextResponse.json({
      items: records.map(toDTO),
      total: records.length,
    });
  } catch (err) {
      return errorResponse(logger, "读取模型配置列表失败", err);
  }
}

/**
 * POST /api/settings/models
 *
 * 请求体：
 *   - name:      配置名称（必填）
 *   - category:  大类（必填）
 *   - provider:  提供商（必填）
 *   - modelName: 模型标识（必填）
 *   - apiKey:    API Key（可选，支持 ${ENV_VAR} 和 file://）
 *   - apiUrl:    Base URL（可选）
 *   - metadata:  元数据对象（可选）
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // 校验必填字段
    const required = ["name", "category", "provider", "modelName"];
    for (const field of required) {
      if (!body[field] || typeof body[field] !== "string") {
        return NextResponse.json(
          { error: `字段 ${field} 必填且必须为字符串` },
          { status: 400 }
        );
      }
    }

    // 校验 category
    if (!ALLOWED_CATEGORIES.includes(body.category as ModelCategory)) {
      return NextResponse.json(
        {
          error: `category 取值非法，允许值：${ALLOWED_CATEGORIES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // 校验 provider
    if (!ALLOWED_PROVIDERS.includes(body.provider)) {
      return NextResponse.json(
        {
          error: `provider 取值非法，允许值：${ALLOWED_PROVIDERS.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // 校验 apiFormat（可选，默认 openai-chat；旧值 "openai" 兼容为 openai-chat）
    let apiFormat: ApiFormat = "openai-chat";
    if (body.apiFormat !== undefined) {
      const raw = String(body.apiFormat);
      if (
        raw !== "openai" &&
        !ALLOWED_API_FORMATS.includes(raw as ApiFormat)
      ) {
        return NextResponse.json(
          {
            error: `apiFormat 取值非法，允许值：${ALLOWED_API_FORMATS.join(", ")}`,
          },
          { status: 400 }
        );
      }
      apiFormat = normalizeApiFormat(raw);
    }

    // 创建记录
    const created = await prisma.aIModelConfig.create({
      data: {
        name: body.name,
        category: body.category,
        provider: body.provider,
        apiFormat,
        modelName: body.modelName,
        apiKey: typeof body.apiKey === "string" ? body.apiKey : "",
        apiUrl: typeof body.apiUrl === "string" ? body.apiUrl : "",
        isActive: body.isActive !== false,
        order: typeof body.order === "number" ? body.order : 0,
        metadata: JSON.stringify(body.metadata ?? {}),
      },
    });

    logger.info("创建模型配置", {
      id: created.id,
      name: created.name,
      category: created.category,
    });

    return NextResponse.json(toDTO(created), { status: 201 });
  } catch (err) {
      return errorResponse(logger, "创建模型配置失败", err);
  }
}
