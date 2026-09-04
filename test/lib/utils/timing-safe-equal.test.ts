/**
 * 常量时间字符串比较工具测试
 *
 * 覆盖相等/不相等/长度不同场景，验证防时序侧信道比较逻辑。
 *
 * 注意：vmThreads pool 的 VM 上下文不注入 Node 原生全局（含 crypto.subtle），
 * 需从 node:crypto 显式取 WebCrypto 实现并 stub 到全局后再运行被测代码。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { timingSafeEqualStr } from "@/lib/utils/timing-safe-equal";

describe("timingSafeEqualStr（常量时间比较）", () => {
  beforeAll(() => {
    // VM 沙箱中 crypto.subtle 缺失：以 Node 官方 WebCrypto 实现补齐
    vi.stubGlobal("crypto", webcrypto);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("相同字符串返回 true", async () => {
    await expect(timingSafeEqualStr("secret-token", "secret-token")).resolves.toBe(true);
  });

  it("不同字符串返回 false", async () => {
    await expect(timingSafeEqualStr("secret-token", "secret-tokEn")).resolves.toBe(false);
  });

  it("长度不同的字符串返回 false", async () => {
    await expect(timingSafeEqualStr("abc", "abcdef")).resolves.toBe(false);
  });

  it("空字符串与空字符串相等", async () => {
    await expect(timingSafeEqualStr("", "")).resolves.toBe(true);
  });
});
