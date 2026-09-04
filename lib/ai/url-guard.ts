/**
 * AI API URL SSRF 防护（15 号报告 LF-H1）
 *
 * apiUrl 由用户在设置页配置、由服务端直接 fetch——不校验即可指向云元数据
 * （169.254.169.254）、内网服务或本机其他端口。本守卫默认拒绝一切
 * 私网/回环/链路本地/保留地址；本机 AI 服务（Ollama 等）经
 * `LEARNFORGE_ALLOW_LOCAL_AI=1` 显式放行，且仅放行回环（localhost/127.0.0.1/::1），
 * 链路本地（云元数据段）与其他私网段在任何情况下都拒绝。
 *
 * 采用「DNS 解析后校验」：存在理论上的 DNS 重绑定窗口（TOCTOU），
 * 连接层 IP 固定（同主站 spider.ts 方案）留待后续增强。
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type UrlGuardResult = { ok: true } | { ok: false; reason: string };

/** IPv4 私网/保留段 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // 解析失败按不信任处理
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true; // 本网络/私网/回环
  if (a === 169 && b === 254) return true; // 链路本地（含云元数据 169.254.169.254）
  if (a === 172 && b >= 16 && b <= 31) return true; // 私网
  if (a === 192 && b === 168) return true; // 私网
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // 组播/保留
  return false;
}

/** IPv6 私网/保留段（含 IPv4-mapped 解包复检） */
function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) {
    return true; // fe80::/10 链路本地
  }
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 unique local
  if (lower.startsWith("::ffff:")) {
    const v4 = lower.slice("::ffff:".length);
    return isIP(v4) === 4 ? isPrivateIPv4(v4) : true;
  }
  return false;
}

function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "::1";
}

/**
 * 校验 AI API URL 是否可安全发起服务端请求。
 * 异步执行 DNS 解析；任何一段解析到非公网地址即拒绝。
 */
export async function checkApiUrlSafety(rawUrl: string): Promise<UrlGuardResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "URL 无法解析" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `协议不允许：${url.protocol}（仅 http/https）` };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "不允许携带凭据的 URL" };
  }

  const allowLocal = process.env.LEARNFORGE_ALLOW_LOCAL_AI === "1";
  const { hostname } = url;

  // 本机 AI 服务白名单：显式开启且目标为字面回环地址时放行
  if (allowLocal && isLoopbackHostname(hostname)) {
    return { ok: true };
  }

  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
  if (addresses.length === 0) {
    return { ok: false, reason: `主机无法解析：${hostname}` };
  }
  const bad = addresses.find((a) => isPrivateIp(a.address));
  if (bad) {
    return {
      ok: false,
      reason: `目标解析到非公网地址 ${bad.address}，已拒绝（本机 AI 服务请设置 LEARNFORGE_ALLOW_LOCAL_AI=1）`,
    };
  }
  return { ok: true };
}

/** 校验失败即抛错（供 Provider 调用前置守卫） */
export async function assertSafeApiUrl(rawUrl: string): Promise<void> {
  const result = await checkApiUrlSafety(rawUrl);
  if (!result.ok) {
    throw new Error(`[AI SSRF 防护] ${result.reason}`);
  }
}
