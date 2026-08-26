/**
 * AI Provider 运行时解析器
 *
 * 让"自由选择配置的模型"真正生效：按优先级解析实际使用的模型
 *   1. 请求显式传入的 modelId（来自对话框模型选择器）
 *   2. AITaskBinding(chat) 绑定的主模型
 *   3. 环境变量 AI_MODEL/AI_API_KEY/AI_BASE_URL（原默认行为）
 *
 * 凭据解析：apiKey/apiUrl 支持 ${ENV_VAR} 与 file:// 语法，由 env-resolver 解析
 *
 * 协议分发（AIModelConfig.apiFormat）：
 *   - openai-chat       → OpenAI Chat Completions 兼容（OpenAICompatProvider）
 *   - openai-responses  → OpenAI Responses API（OpenAIResponsesProvider）
 *   - anthropic         → Anthropic Messages API
 *   - gemini            → Google Gemini API
 *   - ollama            → Ollama 原生 /api/chat
 *   - custom            → OpenAI 兼容 + 自定义 headers
 */
import { prisma } from "@/lib/db/prisma";
import { resolveValue } from "@/lib/config/env-resolver";
import {
  getAIProvider,
  OpenAICompatProvider,
  OpenAIResponsesProvider,
} from "./provider-openai";
import {
  AnthropicProvider,
  GeminiProvider,
  OllamaProvider,
  type HttpProviderConfig,
} from "./provider-http";
import type { AIProvider } from "./types";
import { loadAIConfig } from "./types";

/** 解析结果 */
export interface ResolvedChatProvider {
  provider: AIProvider;
  /** 实际使用模型的显示名（日志/提示用） */
  modelLabel: string;
}

/** 支持的 API 协议格式 */
export type ApiFormat =
  | "openai-chat"
  | "openai-responses"
  | "anthropic"
  | "gemini"
  | "ollama"
  | "custom";

/** 旧值兼容：openai → openai-chat */
function normalizeFormat(value: string): ApiFormat {
  if (value === "openai") return "openai-chat";
  const formats: ApiFormat[] = [
    "openai-chat",
    "openai-responses",
    "anthropic",
    "gemini",
    "ollama",
    "custom",
  ];
  return formats.includes(value as ApiFormat)
    ? (value as ApiFormat)
    : "openai-chat";
}

/**
 * 从 metadata JSON 提取自定义请求头（{ headers: { "X-Foo": "bar" } }）
 */
function extractHeaders(metadataJson: string): Record<string, string> {
  try {
    const meta = JSON.parse(metadataJson || "{}") as {
      headers?: Record<string, unknown>;
    };
    const headers: Record<string, string> = {};
    if (meta.headers && typeof meta.headers === "object") {
      for (const [k, v] of Object.entries(meta.headers)) {
        if (typeof v === "string" && v.trim()) headers[k] = v.trim();
      }
    }
    return headers;
  } catch {
    return {};
  }
}

/** 数据库模型配置的最小形状 */
interface ModelConfigLike {
  apiKey: string;
  apiUrl: string;
  modelName: string;
  apiFormat?: string;
  metadata?: string;
}

/**
 * 根据 apiFormat 创建对应协议的 Provider
 */
function createProviderByFormat(
  cfg: ModelConfigLike
): AIProvider {
  const base: HttpProviderConfig = {
    apiKey: resolveValue(cfg.apiKey),
    baseUrl: resolveValue(cfg.apiUrl) || undefined,
    model: cfg.modelName,
    headers: extractHeaders(cfg.metadata || "{}"),
  };
  switch (normalizeFormat(cfg.apiFormat || "openai-chat")) {
    case "openai-responses":
      return new OpenAIResponsesProvider(base);
    case "anthropic":
      return new AnthropicProvider(base);
    case "gemini":
      return new GeminiProvider(base);
    case "ollama":
      return new OllamaProvider(base);
    case "custom":
      return new OpenAICompatProvider(base);
    case "openai-chat":
    default:
      return new OpenAICompatProvider(base);
  }
}

/**
 * 解析 chat 任务实际使用的 Provider
 *
 * @param modelId 请求显式指定的 AIModelConfig.id（可选）
 * @returns 可用的 provider 与模型显示名
 */
export async function resolveChatProvider(
  modelId?: string
): Promise<ResolvedChatProvider> {
  // 1. 显式指定 modelId
  if (modelId) {
    const cfg = await prisma.aIModelConfig.findUnique({ where: { id: modelId } });
    if (cfg && cfg.isActive) {
      return {
        provider: createProviderByFormat(cfg),
        modelLabel: `${cfg.name} (${cfg.modelName})`,
      };
    }
  }

  // 2. 任务绑定 chat 主模型
  const binding = await prisma.aITaskBinding.findUnique({
    where: { taskType: "chat" },
    include: { primaryModel: true },
  });
  if (binding?.primaryModel) {
    const m = binding.primaryModel;
    return {
      provider: createProviderByFormat(m),
      modelLabel: `${m.name} (${m.modelName})`,
    };
  }

  // 3. 环境变量回退
  return { provider: getAIProvider(), modelLabel: loadAIConfig().model };
}
