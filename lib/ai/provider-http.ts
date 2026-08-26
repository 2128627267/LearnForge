/**
 * 非 OpenAI 协议 Provider 实现（原生 HTTP + SSE/NDJSON 流式）
 * - AnthropicProvider：Anthropic Messages API（/v1/messages）
 * - GeminiProvider：Google Gemini API（:streamGenerateContent）
 * - OllamaProvider：Ollama 原生（/api/chat，NDJSON）
 *
 * 所有实现共享：
 * - 60s 超时（AbortSignal.timeout）
 * - SSE / NDJSON 解析
 * - 自定义请求头（headers，来自配置 metadata）
 */
import type { AIProvider, ChatMessage, ChatOptions } from "./types";
import { loadAIConfig } from "./types";
import { JSON_MODE_CONSTRAINT } from "./provider-openai";

/** 单次调用超时（毫秒） */
const REQUEST_TIMEOUT_MS = 60_000;

/** 原生 HTTP Provider 通用配置 */
export interface HttpProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /** 自定义请求头（如 Azure api-key、网关鉴权头） */
  headers?: Record<string, string>;
}

/** 归一化后的基础配置 */
interface BaseConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  headers: Record<string, string>;
}

function buildBase(config?: HttpProviderConfig): BaseConfig {
  const base = loadAIConfig();
  return {
    apiKey: config?.apiKey || base.apiKey,
    baseUrl: (config?.baseUrl || base.baseUrl).replace(/\/+$/, ""),
    model: config?.model || base.model,
    headers: config?.headers || {},
  };
}

/** 发起 POST 请求并校验状态 */
async function postJSON(
  url: string,
  headers: Record<string, string>,
  body: unknown
): Promise<Response> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res;
}

/** 读取 SSE 流，产出每条 data: 载荷（跳过 [DONE]） */
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

/** 读取 NDJSON 流，逐行产出 JSON 载荷 */
async function* readNDJSON(res: Response): AsyncIterable<string> {
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
      if (!trimmed) continue;
      yield trimmed;
    }
  }
}

// ==================== Anthropic Messages API ====================

/**
 * Anthropic Claude Messages API（POST /v1/messages）
 * 认证：x-api-key + anthropic-version
 * 流式：SSE 事件 content_block_delta → delta.text
 */
export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  private cfg: BaseConfig;

  constructor(config?: HttpProviderConfig) {
    this.cfg = buildBase(config);
  }

  async *chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncIterable<string> {
    const msgs = options?.jsonMode
      ? appendJsonConstraint(messages)
      : messages;
    const system = msgs
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");
    const rest = msgs
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: m.content,
      }));

    const url = `${this.cfg.baseUrl || "https://api.anthropic.com"}/v1/messages`;
    const res = await postJSON(
      url,
      {
        "x-api-key": this.cfg.apiKey || "missing-key",
        "anthropic-version": "2023-06-01",
        ...this.cfg.headers,
      },
      {
        model: this.cfg.model,
        max_tokens: options?.maxTokens ?? 2048,
        temperature: options?.temperature ?? 0.7,
        system: system || undefined,
        messages: rest,
        stream: true,
      }
    );

    for await (const payload of readSSE(res)) {
      try {
        const evt = JSON.parse(payload) as {
          type?: string;
          delta?: { type?: string; text?: string };
        };
        if (
          evt.type === "content_block_delta" &&
          evt.delta?.type === "text_delta" &&
          typeof evt.delta.text === "string"
        ) {
          yield evt.delta.text;
        }
      } catch {
        /* 忽略非 JSON 行 */
      }
    }
  }
}

// ==================== Google Gemini API ====================

/**
 * Google Gemini API（POST /v1beta/models/{model}:streamGenerateContent?alt=sse）
 * 认证：x-goog-api-key（或 query ?key=）
 * 流式：SSE data 中 candidates[0].content.parts[*].text
 * 角色：user / model（system 消息提取到 systemInstruction）
 */
export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  private cfg: BaseConfig;

  constructor(config?: HttpProviderConfig) {
    this.cfg = buildBase(config);
  }

  async *chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncIterable<string> {
    const msgs = options?.jsonMode
      ? appendJsonConstraint(messages)
      : messages;
    const systemParts = msgs
      .filter((m) => m.role === "system")
      .map((m) => m.content);
    const contents = msgs
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? ("model" as const) : ("user" as const),
        parts: [{ text: m.content }],
      }));

    const base = this.cfg.baseUrl || "https://generativelanguage.googleapis.com";
    const url = `${base}/v1beta/models/${encodeURIComponent(this.cfg.model)}:streamGenerateContent?alt=sse`;
    const res = await postJSON(
      url,
      {
        "x-goog-api-key": this.cfg.apiKey || "missing-key",
        ...this.cfg.headers,
      },
      {
        contents,
        systemInstruction:
          systemParts.length > 0
            ? { parts: systemParts.map((text) => ({ text })) }
            : undefined,
        generationConfig: {
          temperature: options?.temperature ?? 0.7,
          maxOutputTokens: options?.maxTokens,
        },
      }
    );

    for await (const payload of readSSE(res)) {
      try {
        const evt = JSON.parse(payload) as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
          }>;
        };
        const text =
          evt.candidates?.[0]?.content?.parts
            ?.map((p) => p.text ?? "")
            .join("") ?? "";
        if (text) yield text;
      } catch {
        /* 忽略非 JSON 行 */
      }
    }
  }
}

// ==================== Ollama 原生 API ====================

/**
 * Ollama 原生 API（POST /api/chat，NDJSON 流）
 * 无认证；body: { model, messages, stream, options }
 */
export class OllamaProvider implements AIProvider {
  readonly name = "ollama";
  private cfg: BaseConfig;

  constructor(config?: HttpProviderConfig) {
    this.cfg = buildBase(config);
  }

  async *chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncIterable<string> {
    const msgs = options?.jsonMode
      ? appendJsonConstraint(messages)
      : messages;
    const url = `${this.cfg.baseUrl || "http://localhost:11434"}/api/chat`;
    const res = await postJSON(
      url,
      this.cfg.headers,
      {
        model: this.cfg.model,
        messages: msgs.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
        options: {
          temperature: options?.temperature ?? 0.7,
          num_predict: options?.maxTokens,
        },
      }
    );

    for await (const line of readNDJSON(res)) {
      try {
        const evt = JSON.parse(line) as {
          message?: { content?: string };
          done?: boolean;
        };
        const text = evt.message?.content ?? "";
        if (text) yield text;
      } catch {
        /* 忽略非 JSON 行 */
      }
    }
  }
}

// ==================== 公共工具 ====================

/**
 * jsonMode 时在最后一条 user 消息上追加 JSON 约束指令
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
