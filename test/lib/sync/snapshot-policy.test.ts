/**
 * 快照/日志滚动保留策略测试（F3，R2 修复）
 */
import { describe, it, expect } from "vitest";
import {
  MAX_CANVAS_SNAPSHOTS,
  MAX_CHANGE_LOG_ENTRIES,
  selectSnapshotsToPrune,
  selectChangeLogToPrune,
} from "@/lib/sync/snapshot-policy";

/** 构造 N 个递增时间戳的条目（id = s0..sN，时间 s0 最老） */
function makeEntries(n: number) {
  const base = new Date("2026-08-26T00:00:00Z").getTime();
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    createdAt: new Date(base + i * 1000),
  }));
}

describe("snapshot-policy", () => {
  it("默认快照保留上限应为 20", () => {
    expect(MAX_CANVAS_SNAPSHOTS).toBe(20);
  });

  it("默认日志保留上限应为 200", () => {
    expect(MAX_CHANGE_LOG_ENTRIES).toBe(200);
  });

  it("未超限时应返回空数组（无需清理）", () => {
    expect(selectSnapshotsToPrune(makeEntries(20))).toEqual([]);
    expect(selectSnapshotsToPrune(makeEntries(5))).toEqual([]);
  });

  it("超限时应返回最老的超出部分", () => {
    const entries = makeEntries(23); // s0..s22
    const prune = selectSnapshotsToPrune(entries);
    // 应清理最老的 3 个：s0、s1、s2
    expect(prune.sort()).toEqual(["s0", "s1", "s2"]);
  });

  it("清理结果与输入顺序无关", () => {
    const entries = makeEntries(23);
    const shuffled = [...entries].reverse();
    expect(selectSnapshotsToPrune(shuffled).sort()).toEqual(["s0", "s1", "s2"]);
  });

  it("支持自定义上限", () => {
    const entries = makeEntries(5);
    const prune = selectSnapshotsToPrune(entries, 3);
    expect(prune.sort()).toEqual(["s0", "s1"]);
  });

  it("时间为字符串（API 序列化后）时应同样正确判定", () => {
    const entries = makeEntries(22).map((e) => ({
      id: e.id,
      createdAt: e.createdAt.toISOString(),
    }));
    const prune = selectSnapshotsToPrune(entries);
    expect(prune.sort()).toEqual(["s0", "s1"]);
  });

  it("B4（审查）：同毫秒并列时应以 id 作次级排序键，结果确定", () => {
    // 同一时刻密集创建的快照（保存频繁时常见）：createdAt 全部相同，
    // 期望稳定保留 id 最大（cuid 近似最新）的条目、清理 id 较小的两个
    const same = new Date("2026-08-26T00:00:00Z");
    const entries = [
      { id: "ckaaa", createdAt: same },
      { id: "ckaab", createdAt: same },
      { id: "ckaac", createdAt: same },
    ];
    const prune = selectSnapshotsToPrune(entries, 1);
    expect(prune).toEqual(["ckaab", "ckaaa"]); // 倒序（新→老）后保留 ckaac
  });

  it("变更日志清理逻辑与快照一致（上限独立）", () => {
    const entries = makeEntries(202);
    const prune = selectChangeLogToPrune(entries);
    expect(prune).toHaveLength(2);
    expect(prune.sort()).toEqual(["s0", "s1"]);
  });
});
