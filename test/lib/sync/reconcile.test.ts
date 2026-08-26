/**
 * reconcileOnLoad 加载协调决策测试（F3，R4/X1 修复）
 *
 * 覆盖决策优先级：
 * 会话内已编辑 > 本地未同步修改（dirty meta）> 服务器优先
 */
import { describe, it, expect } from "vitest";
import {
  reconcileOnLoad,
  DEFAULT_RECONCILE_TOLERANCE_MS,
} from "@/lib/sync/reconcile";

/** 一小时前的 ISO 时间 */
function oneHourAgo(): string {
  return new Date(Date.now() - 3600_000).toISOString();
}

describe("reconcileOnLoad", () => {
  it("本地无数据时应采用服务器（正常首次使用）", () => {
    const d = reconcileOnLoad({
      hasLocalCanvas: false,
      dirtySavedAt: null,
      serverUpdatedAt: oneHourAgo(),
      sessionEdited: false,
    });
    expect(d).toEqual({ action: "use-server" });
  });

  it("本地无数据且服务器也无数据时应采用服务器（保持空状态）", () => {
    const d = reconcileOnLoad({
      hasLocalCanvas: false,
      dirtySavedAt: null,
      serverUpdatedAt: null,
      sessionEdited: false,
    });
    expect(d).toEqual({ action: "use-server" });
  });

  it("无未同步修改时应采用服务器（正常路径：服务器是最新保存）", () => {
    const d = reconcileOnLoad({
      hasLocalCanvas: true,
      dirtySavedAt: null,
      serverUpdatedAt: oneHourAgo(),
      sessionEdited: false,
    });
    expect(d).toEqual({ action: "use-server" });
  });

  it("会话内已编辑时应保留本地（X1 加载竞态，最高优先级）", () => {
    const d = reconcileOnLoad({
      hasLocalCanvas: true,
      dirtySavedAt: null,
      serverUpdatedAt: oneHourAgo(),
      sessionEdited: true,
    });
    expect(d).toEqual({ action: "keep-local-edited" });
  });

  it("会话内已编辑优先级高于 dirty meta 判定", () => {
    // dirty 早于服务器更新（本应 use-server），但会话内已编辑 → 本地胜
    const d = reconcileOnLoad({
      hasLocalCanvas: true,
      dirtySavedAt: Date.now() - 7200_000,
      serverUpdatedAt: oneHourAgo(),
      sessionEdited: true,
    });
    expect(d).toEqual({ action: "keep-local-edited" });
  });

  it("本地未同步修改晚于服务器更新时应保留本地（R4：上次 PUT 失败滞留）", () => {
    const d = reconcileOnLoad({
      hasLocalCanvas: true,
      dirtySavedAt: Date.now(),
      serverUpdatedAt: oneHourAgo(),
      sessionEdited: false,
    });
    expect(d).toEqual({ action: "keep-local" });
  });

  it("本地未同步修改早于服务器更新时应采用服务器（服务器有更新的保存）", () => {
    // 两小时前的 dirty vs 一小时前的服务器更新
    const d = reconcileOnLoad({
      hasLocalCanvas: true,
      dirtySavedAt: Date.now() - 7200_000,
      serverUpdatedAt: oneHourAgo(),
      sessionEdited: false,
    });
    expect(d).toEqual({ action: "use-server" });
  });

  it("本地未同步修改与服务器更新时间接近（宽限期内）时应采用服务器", () => {
    // 时钟偏差宽限：dirty 仅比服务器更新晚 1 秒（< 5s 宽限）
    const d = reconcileOnLoad({
      hasLocalCanvas: true,
      dirtySavedAt: Date.now(),
      serverUpdatedAt: new Date(Date.now() - 1000).toISOString(),
      sessionEdited: false,
    });
    expect(d).toEqual({ action: "use-server" });
  });

  it("宽限期可通过 toleranceMs 自定义", () => {
    const d = reconcileOnLoad({
      hasLocalCanvas: true,
      dirtySavedAt: Date.now(),
      serverUpdatedAt: new Date(Date.now() - 1000).toISOString(),
      sessionEdited: false,
      toleranceMs: 500, // 收紧到 0.5s：1s 差值已超宽限 → 本地胜
    });
    expect(d).toEqual({ action: "keep-local" });
  });

  it("服务器无数据但本地有未同步修改时应保留本地", () => {
    const d = reconcileOnLoad({
      hasLocalCanvas: true,
      dirtySavedAt: Date.now(),
      serverUpdatedAt: null,
      sessionEdited: false,
    });
    expect(d).toEqual({ action: "keep-local" });
  });

  it("dirty meta 存在但服务器时间解析失败时应采用服务器（保守回退）", () => {
    const d = reconcileOnLoad({
      hasLocalCanvas: true,
      dirtySavedAt: Date.now(),
      serverUpdatedAt: "not-a-date",
      sessionEdited: false,
    });
    expect(d).toEqual({ action: "use-server" });
  });

  it("默认宽限时间常量应为 5 秒", () => {
    expect(DEFAULT_RECONCILE_TOLERANCE_MS).toBe(5000);
  });
});
