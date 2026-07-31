/**
 * OpenAI 兼容 Provider 实现
 * 支持任何遵循 OpenAI 协议的服务：OpenAI、DeepSeek、智谱、Moonshot、本地 Ollama 等
 */
import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { AIProvider, ChatMessage, ChatOptions } from "./types";
import { loadAIConfig } from "./types";

export class OpenAICompatProvider implements AIProvider {
  readonly name = "openai-compat";
  private model: ReturnType<ReturnType<typeof createOpenAI>["chat"]>;
  private modelName: string;

  constructor(
    config?: Partial<{ apiKey: string; baseUrl: string; model: string }>
  ) {
    const base = loadAIConfig();
    const apiKey = config?.apiKey || base.apiKey;
    const baseUrl = config?.baseUrl || base.baseUrl;
    const openai = createOpenAI({
      apiKey: apiKey || "missing-key",
      baseURL: baseUrl,
    });
    this.modelName = config?.model || base.model;
    this.model = openai.chat(this.modelName);
  }

  /**
   * 流式对话
   * 使用 Vercel AI SDK 的 streamText，逐块产出文本
   */
  async *chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncIterable<string> {
    const result = await streamText({
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: options?.temperature ?? 0.7,
      maxTokens: options?.maxTokens,
      stopSequences: options?.stop,
    });

    for await (const chunk of result.textStream) {
      yield chunk;
    }
  }
}

/**
 * 获取默认 AI Provider（基于环境变量配置）
 */
let _provider: AIProvider | null = null;

export function getAIProvider(): AIProvider {
  if (!_provider) {
    _provider = new OpenAICompatProvider();
  }
  return _provider;
}

/**
 * 重置 Provider（用于测试或配置变更后）
 */
export function resetAIProvider(): void {
  _provider = null;
}
