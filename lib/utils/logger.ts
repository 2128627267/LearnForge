/**
 * 简易结构化日志
 * 对标原 Python logger.py，提供分级日志与文件输出
 */
import fs from "node:fs";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** 获取项目根目录 */
function getProjectRoot(): string {
  // lib/utils/logger.ts → lib/utils → lib → root
  return path.resolve(__dirname, "..", "..");
}

/** 日志文件路径 */
function getLogFilePath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(getProjectRoot(), "logs", `learnforge_${date}.log`);
}

export class Logger {
  constructor(
    private readonly name: string = "LearnForge",
    private readonly minLevel: LogLevel = process.env.NODE_ENV === "production" ? "info" : "debug",
    private readonly writeFile: boolean = true
  ) {}

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) return;

    const timestamp = new Date().toISOString();
    const metaStr = meta ? " " + JSON.stringify(meta) : "";
    const line = `[${timestamp}] [${level.toUpperCase()}] [${this.name}] ${message}${metaStr}`;

    // 控制台输出
    const consoleFn =
      level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    consoleFn(line);

    // 文件输出
    if (this.writeFile) {
      try {
        const logPath = getLogFilePath();
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.appendFileSync(logPath, line + "\n", "utf-8");
      } catch {
        // 日志写入失败不影响主流程
      }
    }
  }

  debug(message: string, meta?: Record<string, unknown>) {
    this.log("debug", message, meta);
  }
  info(message: string, meta?: Record<string, unknown>) {
    this.log("info", message, meta);
  }
  warn(message: string, meta?: Record<string, unknown>) {
    this.log("warn", message, meta);
  }
  error(message: string, meta?: Record<string, unknown>) {
    this.log("error", message, meta);
  }
}

/** 默认全局 Logger 实例 */
let _defaultLogger: Logger | null = null;

export function getLogger(name?: string): Logger {
  if (!_defaultLogger || name) {
    _defaultLogger = new Logger(name || "LearnForge");
  }
  return _defaultLogger;
}
