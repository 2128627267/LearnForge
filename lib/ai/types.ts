/**
 * AI 服务层 - 类型定义
 * 抽象 AI Provider 接口，支持多模型切换（OpenAI 协议兼容、Anthropic、本地 Ollama 等）
 */

/** 对话消息角色 */
export type MessageRole = "system" | "user" | "assistant";

/** 对话消息 */
export interface ChatMessage {
  role: MessageRole;
  content: string;
}

/** 聊天选项 */
export interface ChatOptions {
  /** 温度（0-2，越高越随机） */
  temperature?: number;
  /** 最大输出 token 数 */
  maxTokens?: number;
  /** 强制 JSON 输出（用于结构化提取） */
  jsonMode?: boolean;
  /** 停止序列 */
  stop?: string[];
}

/** AI Provider 抽象接口 */
export interface AIProvider {
  /** Provider 名称 */
  readonly name: string;

  /**
   * 流式对话
   * @param messages 消息列表
   * @param options 选项
   * @returns 异步迭代器，逐块返回文本
   */
  chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncIterable<string>;

  /**
   * 文本嵌入（用于语义搜索/相似度）
   * @param text 输入文本
   * @returns 向量
   */
  embed?(text: string): Promise<number[]>;
}

/** AI 服务配置（从环境变量读取） */
export interface AIConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * 从环境变量读取 AI 配置
 */
export function loadAIConfig(): AIConfig {
  const config: AIConfig = {
    provider: process.env.AI_PROVIDER || "openai",
    apiKey: process.env.AI_API_KEY || "",
    baseUrl: process.env.AI_BASE_URL || "https://api.openai.com/v1",
    model: process.env.AI_MODEL || "gpt-4o-mini",
  };

  if (!config.apiKey) {
    console.warn(
      "[AI] 未配置 AI_API_KEY，AI 功能将不可用。请在 .env.local 中配置。"
    );
  }

  return config;
}
