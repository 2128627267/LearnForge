/**
 * 环境变量解析库
 *
 * 支持以下配置值语法，按优先级解析：
 *   1. 直接值：sk-abc123 → 直接使用
 *   2. 环境变量引用：${OPENAI_API_KEY} → 从 process.env 读取
 *   3. 本地文件链接：file://C:/keys/openai.txt → 读取文件内容
 *
 * 注意：
 *   - file:// 协议仅在服务端可用（需要文件系统访问）
 *   - ${ENV_VAR} 在服务端和客户端均可解析（客户端从 process.env 读取）
 *   - 解析失败时返回空字符串，不抛出异常（避免阻断流程）
 */

import { getLogger } from "@/lib/utils/logger";
import path from "path";

const logger = getLogger("EnvResolver");

// ==================== 常量定义 ====================

/** 环境变量引用语法正则：${VAR_NAME} */
const ENV_VAR_PATTERN = /^\$\{([A-Z_][A-Z0-9_]*)\}$/;

/** file:// 协议前缀 */
const FILE_PROTOCOL = "file://";

// ==================== 核心解析函数 ====================

/**
 * 解析单个配置值
 *
 * 解析顺序：
 *   1. 检测 file:// 协议 → 读取本地文件
 *   2. 检测 ${ENV_VAR} 语法 → 从环境变量读取
 *   3. 直接返回原值
 *
 * @param value    原始配置值
 * @param options  解析选项
 * @returns 解析后的值（失败时返回空字符串或原值）
 *
 * @example
 * resolveValue("sk-abc123")           // → "sk-abc123"
 * resolveValue("${OPENAI_API_KEY}")   // → process.env.OPENAI_API_KEY
 * resolveValue("file://C:/keys.txt")  // → 文件内容
 */
export function resolveValue(
  value: string,
  options: {
    /** 是否允许 file:// 协议（服务端默认 true，客户端必须 false） */
    allowFileProtocol?: boolean;
    /** 文件读取失败时是否返回原值（默认 false，返回空字符串） */
    fallbackToRaw?: boolean;
  } = {}
): string {
  const { allowFileProtocol = true, fallbackToRaw = false } = options;

  if (!value || typeof value !== "string") {
    return "";
  }

  // 1. 检测 file:// 协议
  if (value.startsWith(FILE_PROTOCOL)) {
    if (!allowFileProtocol) {
      logger.warn("file:// 协议在当前环境不可用，已跳过", { value });
      return fallbackToRaw ? value : "";
    }
    return resolveFileLink(value.slice(FILE_PROTOCOL.length), fallbackToRaw);
  }

  // 2. 检测 ${ENV_VAR} 语法
  const envMatch = value.match(ENV_VAR_PATTERN);
  if (envMatch) {
    const varName = envMatch[1];
    const envValue = process.env[varName];
    if (envValue === undefined || envValue === "") {
      logger.warn(`环境变量 ${varName} 未设置或为空`);
      return fallbackToRaw ? value : "";
    }
    return envValue;
  }

  // 3. 直接返回原值
  return value;
}

/**
 * file:// 允许读取的根目录列表
 *
 * 安全约束（防止任意文件读取）：
 *   - 默认仅允许项目根目录下的 keys/ 目录（密钥文件约定存放处）
 *   - 可用环境变量 AI_KEY_FILES_DIR 追加允许的目录（绝对路径，多个用分号分隔）
 *   - 目录必须存在，否则拒绝读取
 */
const FILE_PROTOCOL_ALLOWED_DIRS: string[] = (() => {
  const dirs = [path.join(process.cwd(), "keys")];
  const extra = process.env.AI_KEY_FILES_DIR;
  if (extra) {
    dirs.push(...extra.split(";").map((d) => d.trim()).filter(Boolean));
  }
  return dirs;
})();

/**
 * 路径规范化：统一分隔符并解析 . / .. 段
 * Windows 盘符（C:\）也统一为 C:/ 形式，便于前缀比较
 */
function normalizePath(p: string): string {
  const sep = /[\\/]/;
  const parts = p.split(sep).filter((s) => s && s !== ".");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  let out = stack.join("/");
  // Windows 盘符
  if (/^[a-zA-Z]:/.test(out)) out = out.charAt(0).toUpperCase() + out.slice(1);
  return out;
}

/**
 * 校验 file:// 路径是否在白名单目录内
 * @returns 通过校验则返回解析后的目录列表；不通过返回 null
 */
function isAllowedFileDir(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return FILE_PROTOCOL_ALLOWED_DIRS.some((dir) => {
    const normalizedDir = normalizePath(dir);
    return (
      normalized === normalizedDir ||
      normalized.startsWith(normalizedDir + "/")
    );
  });
}

/**
 * 解析 file:// 链接，读取本地文件内容
 *
 * @param filePath    文件路径
 * @param fallbackToRaw 失败时是否返回原值
 * @returns 文件内容或空字符串
 */
function resolveFileLink(
  filePath: string,
  fallbackToRaw: boolean
): string {
  try {
    // 安全校验：仅允许读取白名单目录内的密钥文件
    if (!isAllowedFileDir(filePath)) {
      logger.error("file:// 路径不在允许的密钥目录内，已拒绝", {
        filePath,
        allowedDirs: FILE_PROTOCOL_ALLOWED_DIRS,
      });
      return fallbackToRaw ? `${FILE_PROTOCOL}${filePath}` : "";
    }
    // 动态导入 fs，避免客户端 bundle 包含 Node.js 模块
    const fs = require("fs") as typeof import("fs");
    const content = fs.readFileSync(filePath, "utf-8").trim();
    return content;
  } catch (err) {
    logger.error("读取本地文件失败", {
      filePath,
      error: err instanceof Error ? err.message : String(err),
    });
    return fallbackToRaw ? `${FILE_PROTOCOL}${filePath}` : "";
  }
}

// ==================== 批量解析函数 ====================

/**
 * 解析模型配置中的 apiKey 和 apiUrl
 *
 * @param config 原始模型配置
 * @returns 解析后的模型配置（apiKey 和 apiUrl 已替换为实际值）
 *
 * @example
 * const resolved = resolveModelConfig({
 *   id: "xxx",
 *   apiKey: "${OPENAI_API_KEY}",
 *   apiUrl: "https://api.openai.com/v1",
 *   ...
 * });
 * // resolved.apiKey = process.env.OPENAI_API_KEY 的值
 */
export function resolveModelConfig<T extends { apiKey: string; apiUrl: string }>(
  config: T,
  options: {
    allowFileProtocol?: boolean;
    fallbackToRaw?: boolean;
  } = {}
): T {
  return {
    ...config,
    apiKey: resolveValue(config.apiKey, options),
    apiUrl: resolveValue(config.apiUrl, options),
  };
}

// ==================== 客户端解析函数 ====================

/**
 * 客户端环境变量解析（不支持 file:// 协议）
 *
 * 用于客户端组件中解析配置值
 * 仅支持 ${ENV_VAR} 语法，且 process.env 仅包含 NEXT_PUBLIC_ 前缀的变量
 *
 * @param value 原始配置值
 * @returns 解析后的值
 */
export function resolveValueClient(value: string): string {
  return resolveValue(value, {
    allowFileProtocol: false,
    fallbackToRaw: true,
  });
}

// ==================== 环境变量探测 ====================

/**
 * 获取可用的环境变量列表（用于设置页展示）
 *
 * 返回 process.env 中所有键，过滤掉 Node.js 内部变量
 *
 * @param prefix 前缀过滤（如 "OPENAI_" 只返回以此开头的变量）
 * @returns 环境变量名列表
 */
export function listAvailableEnvVars(prefix?: string): string[] {
  try {
    const keys = Object.keys(process.env).filter(
      (key) =>
        !key.startsWith("npm_") &&
        !key.startsWith("NODE_") &&
        !key.startsWith("_") &&
        (prefix ? key.startsWith(prefix) : true)
    );
    return keys.sort();
  } catch {
    return [];
  }
}

/**
 * 检测配置值是否使用了环境变量引用
 *
 * @param value 配置值
 * @returns 是否为 ${ENV_VAR} 语法
 */
export function isEnvVarReference(value: string): boolean {
  return !!value && ENV_VAR_PATTERN.test(value);
}

/**
 * 检测配置值是否使用了 file:// 协议
 *
 * @param value 配置值
 * @returns 是否为 file:// 链接
 */
export function isFileLink(value: string): boolean {
  return !!value && value.startsWith(FILE_PROTOCOL);
}

/**
 * 检测配置值是否需要解析（环境变量引用或 file:// 链接）
 *
 * @param value 配置值
 * @returns 是否需要解析
 */
export function needsResolution(value: string): boolean {
  return isEnvVarReference(value) || isFileLink(value);
}
