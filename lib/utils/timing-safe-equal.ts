/**
 * 常量时间字符串比较（防时序侧信道）
 *
 * 适用环境：Edge Runtime（middleware）与 Node.js（API 路由）通用。
 * 实现方式：对两侧分别做 SHA-256 摘要后逐字节比较——摘要长度固定，
 * 比较耗时与输入内容/长度无关，攻击者无法从耗时差异推断匹配进度。
 *
 * 背景：直接用 === 比较令牌时，短路求值使耗时随匹配前缀长度变化，
 * 理论上可被统计攻击逐字符还原密钥。
 */

const encoder = new TextEncoder();

/**
 * 常量时间比较两个字符串是否相等
 * @returns 相等返回 true
 */
export async function timingSafeEqualStr(
  a: string,
  b: string
): Promise<boolean> {
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const va = new Uint8Array(da);
  const vb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < va.length; i++) {
    diff |= va[i] ^ vb[i];
  }
  return diff === 0;
}
