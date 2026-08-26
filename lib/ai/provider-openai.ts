/**
 * OpenAI Provider 实现
 * - OpenAICompatProvider：Chat Completions 兼容（/v1/chat/completions）
 *   支持任何遵循 OpenAI 协议的服务：OpenAI、DeepSeek、智谱、Moonshot、本地 Ollama 等
 * - OpenAIResponsesProvider：OpenAI Responses API（/v1/responses）
 */
import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { AIProvider, ChatMessage, ChatOptions } from "./types";
import { loadAIConfig } from "./types";

/** 单次 LLM 调用超时（毫秒），防止外部服务挂起导致请求无限等待 */
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * jsonMode 下的约束指令：追加到最后一条 user 消息，
 * 确保模型输出为纯 JSON（AI SDK v3 的 streamText 无法直接传
 * response_format，故在 prompt 层强制约束）。
 */
export const JSON_MODE_CONSTRAINT =
  "\n\n【输出格式要求】请严格输出 JSON，不要包含任何其他文字、解释或 markdown 代码块标记。";

/**
 * 通用 Provider 配置
 * headers：自定义请求头（如 Azure 的 api-key、网关鉴权头），来自 metadata.headers
 */
export interface OpenAIProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  headers?: Record<string, string>;
}

export class OpenAICompatProvider implements AIProvider {
  readonly name = "openai-chat";
  private model: ReturnType<ReturnType<typeof createOpenAI>["chat"]>;
  private modelName: string;

  constructor(config?: Partial<OpenAIProviderConfig>) {
    const base = loadAIConfig();
    const apiKey = config?.apiKey || base.apiKey;
    const baseUrl = config?.baseUrl || base.baseUrl;
    const openai = createOpenAI({
      apiKey: apiKey || "missing-key",
      baseURL: baseUrl,
      headers: config?.headers,
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
    const msgs = options?.jsonMode
      ? appendJsonConstraint(messages)
      : messages;
    const result = await streamText({
      model: this.model,
      messages: msgs.map((m) => ({ role: m.role, content: m.content })),
      temperature: options?.temperature ?? 0.7,
      maxTokens: options?.maxTokens,
      stopSequences: options?.stop,
      abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    for await (const chunk of result.textStream) {
      yield chunk;
    }
  }
}

/**
 * OpenAI Responses API Provider（/v1/responses）
 * 使用原生 fetch + SSE 解析流式事件
 */
export class OpenAIResponsesProvider implements AIProvider {
  readonly name = "openai-responses";
  private apiKey: string;
  private baseUrl: string;
  private modelName: string;
  private headers: Record<string, string>;

  constructor(config?: Partial<OpenAIProviderConfig>) {
    const base = loadAIConfig();
    this.apiKey = config?.apiKey || base.apiKey;
    this.baseUrl = (config?.baseUrl || base.baseUrl).replace(/\/+$/, "");
    this.modelName = config?.model || base.model;
    this.headers = config?.headers || {};
  }

  async *chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncIterable<string> {
    const msgs = options?.jsonMode
      ? appendJsonConstraint(messages)
      : messages;

    const res = await fetch(`${this.baseUrl}/v1/responses`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey || "missing-key"}`,
        ...this.headers,
      },
      body: JSON.stringify({
        model: this.modelName,
        input: msgs.map((m) => ({
          role: m.role,
          content: [{ type: "input_text" as const, text: m.content }],
        })),
        stream: true,
        temperature: options?.temperature ?? 0.7,
        max_output_tokens: options?.maxTokens,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Responses API ${res.status}: ${text.slice(0, 200)}`);
    }

    for await (const payload of readSSE(res)) {
      try {
        const evt = JSON.parse(payload) as {
          type?: string;
          delta?: string;
          text?: string;
        };
        if (
          evt.type === "response.output_text.delta" &&
          typeof evt.delta === "string"
        ) {
          yield evt.delta;
        }
      } catch {
        /* 忽略非 JSON 行 */
      }
    }
  }
}

/**
 * 读取 SSE 流，产出每条 data: 载荷（跳过 [DONE]）
 */
async function* readSSE(res: Response): AsyncIterable<string> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      yield payload;
    }
  }
}

/**
 * jsonMode 时在最后一条 user 消息上追加 JSON 约束指令。
 * 空消息列表时直接返回原列表（不注入）。
 */
function appendJsonConstraint(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  if (last.role !== "user") return messages;
  return [
    ...messages.slice(0, -1),
    { role: last.role, content: last.content + JSON_MODE_CONSTRAINT },
  ];
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
