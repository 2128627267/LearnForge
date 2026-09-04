/**
 * 数据包导入路径安全守卫
 *
 * 背景：导入 API 接受客户端提供的目录路径。若不加限制，
 * 攻击者可提交任意目录（如 C:/Users/...）将磁盘上的 JSON 文件
 * 导入数据库并经卡片接口读出（数据外带通道）。
 *
 * 策略：所有导入路径必须位于项目 datapacks/ 目录（白名单根）内。
 */

import path from "path";

/** 数据包根目录（安全白名单根） */
export const DATAPACKS_ROOT = path.resolve(process.cwd(), "datapacks");

/**
 * 校验并解析导入路径（防路径遍历 / 任意目录读取）
 * - 相对路径按 process.cwd() 解析；绝对路径原样 resolve
 * - 必须等于白名单根或位于其子目录内
 * @returns 校验通过返回规范化绝对路径；不通过返回 null
 */
export function resolveWithinDatapacks(dir: string): string | null {
  if (!dir || typeof dir !== "string") return null;
  const resolved = path.resolve(dir);
  // Windows 文件系统大小写不敏感，比较前统一小写（POSIX 下无副作用）
  const norm = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);
  const a = norm(resolved);
  const b = norm(DATAPACKS_ROOT);
  if (a === b || a.startsWith(b + path.sep)) {
    return resolved;
  }
  return null;
}
