/**
 * API 错误响应工具
 *
 * 统一错误处理约定：
 * - 对外只返回用户可读的 `{ error }`，绝不透传 Prisma/SQL/LLM provider
 *   等内部错误细节（防敏感信息泄露）
 * - 内部细节仅记录到日志（logger.error）
 * - 500 用于服务端异常；参数类错误（400）由调用方按校验结果自行返回
 */
import { NextResponse } from "next/server";

/** 日志器接口（与 lib/utils/logger 的 getLogger 返回值兼容） */
interface ErrorLogger {
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * 构造统一的 500 错误响应并记录内部细节。
 *
 * @param logger 日志器实例
 * @param fallbackMessage 返回给客户端的用户可读错误信息
 * @param err 捕获到的异常对象
 * @returns NextResponse（status 500，仅含 { error }）
 */
export function errorResponse(
  logger: ErrorLogger,
  fallbackMessage: string,
  err: unknown
): NextResponse {
  logger.error(fallbackMessage, {
    error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}
