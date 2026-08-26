/**
 * 常量时间字符串比较工具测试
 *
 * 覆盖相等/不相等/长度不同场景，验证防时序侧信道比较逻辑。
 */
import { describe, it, expect } from "vitest";
import { timingSafeEqualStr } from "@/lib/utils/timing-safe-equal";

describe("timingSafeEqualStr（常量时间比较）", () => {
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
