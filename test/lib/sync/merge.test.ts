/**
 * mergeCanvas 合并算法测试（F3，X2 修复）
 *
 * 覆盖：新增节点/边合并、悬空边过滤、标签合并、视口取值、入参不可变性
 */
import { describe, it, expect } from "vitest";
import { mergeCanvas } from "@/lib/sync/merge";
import type { CanvasState } from "@/lib/hooks/use-local-storage";

/** 构造测试用画布 */
function makeCanvas(overrides: Partial<CanvasState> = {}): CanvasState {
  return {
    nodes: [],
    edges: [],
    tags: [],
    ...overrides,
  };
}

function makeNode(id: string) {
  return {
    id,
    type: "freeCard",
    position: { x: 0, y: 0 },
    data: { title: id },
  };
}

function makeEdge(id: string, source: string, target: string) {
  return { id, source, target };
}

describe("mergeCanvas", () => {
  it("本地独有的节点应追加到服务器数据之后", () => {
    const server = makeCanvas({ nodes: [makeNode("a"), makeNode("b")] });
    const local = makeCanvas({
      nodes: [makeNode("a"), makeNode("b"), makeNode("c")],
    });
    const merged = mergeCanvas(server, local);
    expect(merged.nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("本地对已有节点的编辑冲突应以服务器为准", () => {
    const serverNode = { ...makeNode("a"), data: { title: "服务器版" } };
    const localNode = { ...makeNode("a"), data: { title: "本地编辑版" } };
    const merged = mergeCanvas(makeCanvas({ nodes: [serverNode] }), makeCanvas({ nodes: [localNode] }));
    expect(merged.nodes[0].data.title).toBe("服务器版");
  });

  it("本地独有的边应追加（两端节点存在于合并结果时）", () => {
    const server = makeCanvas({ nodes: [makeNode("a")] });
    const local = makeCanvas({
      nodes: [makeNode("a"), makeNode("b")],
      edges: [makeEdge("e1", "a", "b")],
    });
    const merged = mergeCanvas(server, local);
    expect(merged.edges.map((e) => e.id)).toEqual(["e1"]);
  });

  it("两端节点不存在的悬空边应被过滤", () => {
    const server = makeCanvas({ nodes: [makeNode("a")] });
    const local = makeCanvas({
      nodes: [makeNode("a"), makeNode("b")],
      edges: [
        makeEdge("e1", "a", "b"),
        makeEdge("e2", "a", "不存在的节点"), // target 缺失
        makeEdge("e3", "不存在的节点", "b"), // source 缺失
      ],
    });
    const merged = mergeCanvas(server, local);
    // 只有 e1 两端都在合并结果中
    expect(merged.edges.map((e) => e.id)).toEqual(["e1"]);
  });

  it("本地独有的标签应追加（按 name 去重）", () => {
    const server = makeCanvas({
      tags: [{ name: "数学", color: "#3b82f6" }],
    });
    const local = makeCanvas({
      tags: [
        { name: "数学", color: "#ef4444" },
        { name: "英语" },
      ],
    });
    const merged = mergeCanvas(server, local);
    expect(merged.tags.map((t) => t.name)).toEqual(["数学", "英语"]);
    // 已有标签保留服务器版本
    expect(merged.tags[0].color).toBe("#3b82f6");
  });

  it("视口应采用本地值（用户当前视口）", () => {
    const server = makeCanvas({ viewport: { x: 1, y: 1, zoom: 1 } });
    const local = makeCanvas({ viewport: { x: 2, y: 2, zoom: 2 } });
    const merged = mergeCanvas(server, local);
    expect(merged.viewport).toEqual({ x: 2, y: 2, zoom: 2 });
  });

  it("本地无视口时应回退服务器视口", () => {
    const server = makeCanvas({ viewport: { x: 1, y: 1, zoom: 1 } });
    const merged = mergeCanvas(server, makeCanvas());
    expect(merged.viewport).toEqual({ x: 1, y: 1, zoom: 1 });
  });

  it("不应修改入参（纯函数）", () => {
    const server = makeCanvas({ nodes: [makeNode("a")], tags: [{ name: "t" }] });
    const local = makeCanvas({
      nodes: [makeNode("a"), makeNode("b")],
      edges: [makeEdge("e1", "a", "b")],
      tags: [{ name: "t" }, { name: "t2" }],
    });
    const serverCopy = JSON.parse(JSON.stringify(server));
    const localCopy = JSON.parse(JSON.stringify(local));
    mergeCanvas(server, local);
    expect(server).toEqual(serverCopy);
    expect(local).toEqual(localCopy);
  });

  it("完全相同的数据合并后应等价于原数据", () => {
    const canvas = makeCanvas({
      nodes: [makeNode("a"), makeNode("b")],
      edges: [makeEdge("e1", "a", "b")],
      tags: [{ name: "t" }],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(mergeCanvas(canvas, canvas)).toEqual(canvas);
  });

  it("已知局限（审查 G1）：本地删除的节点会从服务器基底复活", () => {
    // 场景：用户删除了节点 b，与此同时 AI 批量写入触发 409 合并——
    // 服务器基底仍含 b，合并结果中 b "复活"。MVP 无删除墓碑的既定取舍，
    // 本用例固化该行为防止无意识变更（若未来实现墓碑语义请更新此用例）
    const server = makeCanvas({ nodes: [makeNode("a"), makeNode("b")] });
    const local = makeCanvas({ nodes: [makeNode("a")] }); // b 已被本地删除
    const merged = mergeCanvas(server, local);
    expect(merged.nodes.map((n) => n.id)).toEqual(["a", "b"]);
  });
});
