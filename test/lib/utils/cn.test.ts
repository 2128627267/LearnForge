/**
 * cn 工具测试
 *
 * 验证类名合并与 Tailwind 冲突解决行为。
 */
import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils/cn";

describe("cn（类名合并工具）", () => {
  it("合并多个字符串类名", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("支持条件类名（falsy 值被过滤）", () => {
    expect(cn("a", false, undefined, null, "b")).toBe("a b");
  });

  it("解决 Tailwind 类名冲突（后者覆盖前者）", () => {
    // tailwind-merge 应保留后者，去除冲突的前者
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("不破坏非冲突类名", () => {
    expect(cn("flex", "p-2", "bg-red-500")).toBe("flex p-2 bg-red-500");
  });
});
