/**
 * 服务端同步操作测试（F3 审查 B9 补齐）
 *
 * 覆盖 snapshotCurrentLayout / appendChangeLog 的核心分支：
 * - 无当前布局 → 跳过快照
 * - 画布数据损坏 → 跳过快照（不备份垃圾数据）
 * - 正常快照：写入统计正确 + B6 count 预检（未超限不清理 / 超限清理最老）
 * - 变更日志：写入字段正确 + 滚动清理同上
 *
 * 说明：server-ops 依赖 Prisma 单例作为默认 tx，测试统一显式传入
 * mock tx（与 cards/batch、快照恢复路由传入事务客户端的用法一致），
 * 并 mock prisma 模块避免真实客户端初始化。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// mock Prisma 单例：默认 tx 不会被用到（测试均显式传 tx），仅切断真实连接
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

// mock 日志器：避免测试向控制台/logs 目录输出噪音
vi.mock("@/lib/utils/logger", () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  snapshotCurrentLayout,
  appendChangeLog,
} from "@/lib/sync/server-ops";
import {
  MAX_CANVAS_SNAPSHOTS,
  MAX_CHANGE_LOG_ENTRIES,
} from "@/lib/sync/snapshot-policy";

/** server-ops 的 tx 参数类型（Prisma 事务客户端的宽松子集） */
type TxParam = NonNullable<Parameters<typeof snapshotCurrentLayout>[1]>;

/** mock 事务客户端的运行时形态：仅实现被测函数实际触达的模型方法 */
interface TxMock {
  canvasLayout: { findUnique: ReturnType<typeof vi.fn> };
  canvasSnapshot: {
    create: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  dataChangeLog: {
    create: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
}

/** 构造 mock 事务客户端（断言为 TxMock 保持 vi.fn 可调 mockResolvedValue） */
function makeTx(): TxMock {
  return {
    canvasLayout: {
      findUnique: vi.fn(),
    },
    canvasSnapshot: {
      create: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    dataChangeLog: {
      create: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
}

/** 传给被测函数时的类型桥接（TxMock 结构兼容 DbClient 的实际使用面） */
function asTx(tx: TxMock): TxParam {
  return tx as unknown as TxParam;
}

/** 构造 N 个递增时间戳的条目（id = s0..sN，s0 最老），供 findMany 返回 */
function makeEntries(n: number) {
  const base = new Date("2026-08-26T00:00:00Z").getTime();
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    createdAt: new Date(base + i * 1000),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("snapshotCurrentLayout", () => {
  it("服务器无画布布局时应跳过快照并返回 false", async () => {
    const tx = makeTx();
    tx.canvasLayout.findUnique.mockResolvedValue(null);

    const created = await snapshotCurrentLayout("auto", asTx(tx));

    expect(created).toBe(false);
    expect(tx.canvasSnapshot.create).not.toHaveBeenCalled();
  });

  it("画布数据损坏时应跳过快照（不备份垃圾数据）", async () => {
    const tx = makeTx();
    tx.canvasLayout.findUnique.mockResolvedValue({
      id: "default",
      version: 3,
      data: "not-a-json{{{",
    });

    const created = await snapshotCurrentLayout("auto", asTx(tx));

    expect(created).toBe(false);
    expect(tx.canvasSnapshot.create).not.toHaveBeenCalled();
  });

  it("正常快照应写入节点/边统计与 reason（B6：未超限不触发清理查询）", async () => {
    const tx = makeTx();
    tx.canvasLayout.findUnique.mockResolvedValue({
      id: "default",
      version: 7,
      data: JSON.stringify({
        nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
        edges: [{ id: "e1" }],
      }),
    });
    // 稳定态：总数未超上限（B6 count 预检生效）
    tx.canvasSnapshot.count.mockResolvedValue(5);

    const created = await snapshotCurrentLayout("manual", asTx(tx));

    expect(created).toBe(true);
    // Prisma create 参数为 { data: { data, nodeCount, edgeCount, reason } }
    expect(tx.canvasSnapshot.create).toHaveBeenCalledWith({
      data: {
        data: JSON.stringify({
          nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
          edges: [{ id: "e1" }],
        }),
        nodeCount: 3,
        edgeCount: 1,
        reason: "manual",
      },
    });
    // B6 验证：count 预检通过后不应触发 findMany / deleteMany
    expect(tx.canvasSnapshot.count).toHaveBeenCalledTimes(1);
    expect(tx.canvasSnapshot.findMany).not.toHaveBeenCalled();
    expect(tx.canvasSnapshot.deleteMany).not.toHaveBeenCalled();
  });

  it("超出保留上限时应清理最老的快照（B6：超限才走 findMany）", async () => {
    const tx = makeTx();
    tx.canvasLayout.findUnique.mockResolvedValue({
      id: "default",
      version: 7,
      data: JSON.stringify({ nodes: [], edges: [] }),
    });
    // 超限 1 条：21 > 20（count 含刚 create 的新快照）
    tx.canvasSnapshot.count.mockResolvedValue(MAX_CANVAS_SNAPSHOTS + 1);
    tx.canvasSnapshot.findMany.mockResolvedValue(makeEntries(21));

    const created = await snapshotCurrentLayout("auto", asTx(tx));

    expect(created).toBe(true);
    expect(tx.canvasSnapshot.findMany).toHaveBeenCalledTimes(1);
    // 21 条保留最新 20 条，最老的 s0 被清理
    expect(tx.canvasSnapshot.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["s0"] } },
    });
  });
});

describe("appendChangeLog", () => {
  it("应写入完整日志字段（detail 序列化为 JSON 字符串）", async () => {
    const tx = makeTx();
    tx.dataChangeLog.count.mockResolvedValue(10);

    await appendChangeLog(
      {
        action: "save",
        revision: 12,
        nodeCount: 5,
        edgeCount: 2,
        source: "web",
        detail: { baseRevision: 11 },
      },
      asTx(tx)
    );

    expect(tx.dataChangeLog.create).toHaveBeenCalledWith({
      data: {
        action: "save",
        revision: 12,
        nodeCount: 5,
        edgeCount: 2,
        source: "web",
        detail: JSON.stringify({ baseRevision: 11 }),
      },
    });
    // 未超限：不触发清理
    expect(tx.dataChangeLog.findMany).not.toHaveBeenCalled();
    expect(tx.dataChangeLog.deleteMany).not.toHaveBeenCalled();
  });

  it("无 detail 时写入空对象字符串", async () => {
    const tx = makeTx();
    tx.dataChangeLog.count.mockResolvedValue(0);

    await appendChangeLog(
      {
        action: "restore",
        revision: 1,
        nodeCount: 0,
        edgeCount: 0,
        source: "restore:abc",
      },
      asTx(tx)
    );

    expect(tx.dataChangeLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ detail: "{}" }),
    });
  });

  it("超出日志上限时应清理最老条目（B6：超限才走 findMany）", async () => {
    const tx = makeTx();
    tx.dataChangeLog.count.mockResolvedValue(MAX_CHANGE_LOG_ENTRIES + 1);
    tx.dataChangeLog.findMany.mockResolvedValue(makeEntries(201));

    await appendChangeLog(
      { action: "save", revision: 1, nodeCount: 0, edgeCount: 0, source: "web" },
      asTx(tx)
    );

    expect(tx.dataChangeLog.findMany).toHaveBeenCalledTimes(1);
    // 201 条保留最新 200 条，最老的 s0 被清理
    expect(tx.dataChangeLog.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["s0"] } },
    });
  });
});
