/**
 * AI Provider 运行时解析器
 *
 * 让"自由选择配置的模型"真正生效：按优先级解析实际使用的模型
 *   1. 请求显式传入的 modelId（来自对话框模型选择器）
 *   2. AITaskBinding(chat) 绑定的主模型
 *   3. 环境变量 AI_MODEL/AI_API_KEY/AI_BASE_URL（原默认行为）
 *
 * 凭据解析：apiKey/apiUrl 支持 ${ENV_VAR} 与 file:// 语法，由 env-resolver 解析
 */
import { prisma } from "@/lib/db/prisma";
import { resolveValue } from "@/lib/config/env-resolver";
import { getAIProvider, OpenAICompatProvider } from "./provider-openai";
import type { AIProvider } from "./types";
import { loadAIConfig } from "./types";

/** 解析结果 */
export interface ResolvedChatProvider {
  provider: AIProvider;
  /** 实际使用模型的显示名（日志/提示用） */
  modelLabel: string;
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
        provider: new OpenAICompatProvider({
          apiKey: resolveValue(cfg.apiKey),
          baseUrl: resolveValue(cfg.apiUrl) || undefined,
          model: cfg.modelName,
        }),
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
      provider: new OpenAICompatProvider({
        apiKey: resolveValue(m.apiKey),
        baseUrl: resolveValue(m.apiUrl) || undefined,
        model: m.modelName,
      }),
      modelLabel: `${m.name} (${m.modelName})`,
    };
  }

  // 3. 环境变量回退
  return { provider: getAIProvider(), modelLabel: loadAIConfig().model };
}
