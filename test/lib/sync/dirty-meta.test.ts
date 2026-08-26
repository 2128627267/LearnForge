/**
 * dirty meta 读写测试（F3，R4 修复）
 * jsdom 环境下验证 localStorage 标记的读写清除与容错
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  DIRTY_META_KEY,
  readDirtyMeta,
  writeDirtyMeta,
  clearDirtyMeta,
} from "@/lib/sync/dirty-meta";

describe("dirty-meta", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("无标记时读取应返回 null", () => {
    expect(readDirtyMeta()).toBeNull();
  });

  it("写入后应能读回相同时间戳", () => {
    const at = Date.now();
    writeDirtyMeta(at);
    expect(readDirtyMeta()).toBe(at);
  });

  it("标记应存储在约定的 key 下", () => {
    writeDirtyMeta(12345);
    expect(window.localStorage.getItem(DIRTY_META_KEY)).toBe(
      JSON.stringify({ savedAt: 12345 })
    );
  });

  it("清除后读取应返回 null", () => {
    writeDirtyMeta(Date.now());
    clearDirtyMeta();
    expect(readDirtyMeta()).toBeNull();
    expect(window.localStorage.getItem(DIRTY_META_KEY)).toBeNull();
  });

  it("损坏数据时应返回 null 而不抛异常", () => {
    window.localStorage.setItem(DIRTY_META_KEY, "{broken json");
    expect(readDirtyMeta()).toBeNull();
  });

  it("savedAt 非数字时应返回 null", () => {
    window.localStorage.setItem(
      DIRTY_META_KEY,
      JSON.stringify({ savedAt: "not-number" })
    );
    expect(readDirtyMeta()).toBeNull();
  });

  it("重复写入应覆盖旧值（保留最新编辑时间）", () => {
    writeDirtyMeta(1000);
    writeDirtyMeta(2000);
    expect(readDirtyMeta()).toBe(2000);
  });
});
