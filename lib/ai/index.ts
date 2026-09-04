/**
 * AI 服务层入口
 * 统一对外暴露 AI 能力，封装常见场景调用
 */
export type { AIProvider, ChatMessage, ChatOptions, AIConfig } from "./types";
export { loadAIConfig } from "./types";
export { getAIProvider, resetAIProvider, OpenAICompatProvider } from "./provider-openai";
export { resolveChatProvider } from "./provider-resolver";
export type { ResolvedChatProvider } from "./provider-resolver";
export * as Prompts from "./prompts";
