/**
 * 配置文件（.env.local）查看与编辑 API
 * GET    /api/settings/env-config  - 读取配置文件，AI 相关键脱敏返回
 * PUT    /api/settings/env-config  - 按 key 更新/追加/删除配置行（保留注释与无关行）
 *
 * 安全：
 * - 敏感键（*KEY* / *SECRET* / *TOKEN* 等）返回时脱敏（前4后4）
 * - 更新时若值含 "****" 占位则跳过（避免覆盖真实值）
 * - 仅允许 AI_ 前缀与白名单键（NEXTAUTH_*）的更新，其他键拒绝
 */
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getLogger } from "@/lib/utils/logger";
import { errorResponse } from "@/lib/utils/http-error";
import { isEnvVarReference, isFileLink } from "@/lib/config/env-resolver";

const logger = getLogger("EnvConfigAPI");

export const dynamic = "force-dynamic";

/** 优先读取 .env.local，缺失时回退 .env */
function resolveEnvPath(): string {
  return path.join(process.cwd(), ".env.local");
}

/** 敏感键判定：键名含 KEY / SECRET / TOKEN / PASSWORD */
const SENSITIVE_PATTERN = /(KEY|SECRET|TOKEN|PASSWORD)/i;

/** 允许更新的键：AI_ 前缀（全量） + 少量白名单 */
const ALLOWED_KEY_PREFIXES = ["AI_"];
const ALLOWED_KEYS = ["NEXTAUTH_SECRET", "NEXTAUTH_URL", "CRON_SECRET"];

/**
 * 禁止通过 API 写入的键（安全黑名单）：
 * - AI_KEY_FILES_DIR：扩展 lib/config/env-resolver 的 file:// 白名单目录，
 *   若可被 API 改写为任意盘符，配合模型配置 file:// 语法即可读取全盘文件
 */
const FORBIDDEN_KEYS = new Set(["AI_KEY_FILES_DIR"]);

/** 行解析：KEY=value */
const LINE_REGEX = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/** 脱敏：前 4 + **** + 后 4（长度 ≤ 8 时全 ****） */
function maskValue(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

/** 是否为脱敏占位 */
function isMaskedPlaceholder(value: string): boolean {
  if (!value) return false;
  if (isEnvVarReference(value) || isFileLink(value)) return false;
  return value.includes("****");
}

/** 键是否允许写入 */
function isAllowedKey(key: string): boolean {
  if (FORBIDDEN_KEYS.has(key)) return false;
  if (ALLOWED_KEY_PREFIXES.some((p) => key.startsWith(p))) return true;
  return ALLOWED_KEYS.includes(key);
}

/** 解析环境文件内容为键值行数组 */
function parseLines(content: string): Array<{ key: string; value: string }> {
  const result: Array<{ key: string; value: string }> = [];
  for (const line of content.split(/\r?\n/)) {
    const m = LINE_REGEX.exec(line);
    if (m) result.push({ key: m[1], value: m[2].trim() });
  }
  return result;
}

/**
 * 按 key 更新环境文件内容（保留注释、空行、无关行）
 * - removals：删除对应行
 * - updates：替换已有行或追加新行（追加时按 key 排序插入到 AI 区段）
 */
function applyUpdates(
  content: string,
  updates: Record<string, string>,
  removals: string[]
): string {
  let lines = content.split(/\r?\n/);
  const keyIndex = new Map<string, number>();
  lines.forEach((line, i) => {
    const m = LINE_REGEX.exec(line);
    if (m) keyIndex.set(m[1], i);
  });

  for (const key of removals) {
    const idx = keyIndex.get(key);
    if (idx !== undefined) {
      lines[idx] = "";
      keyIndex.delete(key);
    }
  }

  for (const [key, value] of Object.entries(updates)) {
    const idx = keyIndex.get(key);
    if (idx !== undefined && lines[idx] !== "") {
      lines[idx] = `${key}=${value}`;
    } else {
      lines.push(`${key}=${value}`);
    }
  }

  return lines.filter((l) => l !== "").join("\n") + "\n";
}

/**
 * GET：读取配置文件，敏感键脱敏
 * 响应：{ path, exists, keys: [{ key, value, masked }] }
 */
export async function GET() {
  try {
    const envPath = resolveEnvPath();
    let content = "";
    let exists = true;
    try {
      content = await fs.readFile(envPath, "utf-8");
    } catch {
      exists = false;
    }

    const keys = parseLines(content).map(({ key, value }) => {
      const masked = SENSITIVE_PATTERN.test(key);
      return {
        key,
        value: masked ? maskValue(value) : value,
        masked,
      };
    });

    return NextResponse.json({
      path: envPath,
      exists,
      keys,
      aiKeys: keys.filter((k) => k.key.startsWith("AI_")),
    });
  } catch (err) {
    return errorResponse(logger, "读取配置文件失败", err);
  }
}

/**
 * PUT：按 key 更新配置文件
 * 请求体：{ updates: { KEY: value, ... }, removals?: string[] }
 * 约束：仅允许 AI_ 前缀与白名单键；占位值（****）跳过
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const envPath = resolveEnvPath();

    let content = "";
    try {
      content = await fs.readFile(envPath, "utf-8");
    } catch {
      content = "";
    }

    const updates: Record<string, string> = {};
    const skipped: string[] = [];

    if (body.updates && typeof body.updates === "object") {
      for (const [key, rawValue] of Object.entries(body.updates)) {
        if (!isAllowedKey(key)) {
          logger.warn("拒绝写入未授权键", { key });
          continue;
        }
        const value = String(rawValue ?? "")
          .replace(/[\r\n]+/g, " ")
          .trim();
        // 安全：剥离换行符，防止 "KEY=value\nEVIL=..." 形式注入任意环境变量行
        if (isMaskedPlaceholder(value)) {
          skipped.push(key);
          continue;
        }
        updates[key] = value;
      }
    }

    const removals: string[] = Array.isArray(body.removals)
      ? body.removals.filter((k: unknown) => typeof k === "string" && isAllowedKey(k))
      : [];

    const next = applyUpdates(content, updates, removals);
    await fs.writeFile(envPath, next, "utf-8");

    logger.info("配置文件已更新", {
      path: envPath,
      updatedKeys: Object.keys(updates),
      removedKeys: removals,
      skippedPlaceholders: skipped,
    });

    const keys = parseLines(next).map(({ key, value }) => {
      const masked = SENSITIVE_PATTERN.test(key);
      return {
        key,
        value: masked ? maskValue(value) : value,
        masked,
      };
    });

    return NextResponse.json({
      ok: true,
      path: envPath,
      skipped,
      keys,
      aiKeys: keys.filter((k) => k.key.startsWith("AI_")),
    });
  } catch (err) {
    return errorResponse(logger, "更新配置文件失败", err);
  }
}
