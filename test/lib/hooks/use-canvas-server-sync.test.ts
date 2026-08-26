/**
 * useCanvasServerSync 同步 Hook 测试（F3 代码审查 S2 修复回归）
 *
 * 核心场景：PUT → 409 网络往返期间的用户编辑不得丢失——
 * onConflict 的合并基底必须是"最新画布引用"（canvasRef.current），
 * 而非防抖入队时刻的任务快照（task.canvas）。
 *
 * 实现方式：mock 全局 fetch（GET/PUT 按调用序返回受控响应），
 * renderHook 驱动真实 hook；不 mock SaveQueue/merge/reconcile 等纯逻辑，
 * 保证覆盖完整数据流。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCanvasServerSync } from "@/lib/hooks/use-canvas-server-sync";
import type { CanvasState } from "@/lib/hooks/use-local-storage";

// toast 依赖组件上下文，测试中静默 mock
vi.mock("@/components/shared/toaster", () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

/** 最小 Response 形状（不依赖 undici Response，规避 VM 沙箱全局缺失） */
interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

function fakeJson(body: unknown, status = 200): FakeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** 构造测试用画布 */
function makeCanvas(nodeIds: string[]): CanvasState {
  return {
    nodes: nodeIds.map((id) => ({
      id,
      type: "freeCard",
      position: { x: 0, y: 0 },
      data: { title: id },
    })),
    edges: [],
    tags: [],
  };
}

/** 读取第 n 次 fetch 调用的请求体（PUT 保存内容） */
function putBodyOf(fetchMock: ReturnType<typeof vi.fn>, callIndex: number) {
  const call = fetchMock.mock.calls[callIndex];
  return JSON.parse(String(call[1].body)) as {
    canvas: CanvasState;
    baseRevision: number | null;
  };
}

describe("useCanvasServerSync（S2：409 合并基底用最新画布）", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("409 往返期间的用户编辑应保留在合并结果中（S2 回归）", async () => {
    // ---- 服务器初始状态：revision 5，节点 [s1] ----
    const serverCanvas = makeCanvas(["s1"]);
    // 409 返回的服务器新状态：AI 批量写入追加了 s3
    const serverNew = makeCanvas(["s1", "s3"]);
    // 用户编辑 B（PUT 发出时的画布）：s1 + 本地新增 L1
    const canvasB = makeCanvas(["s1", "L1"]);
    // 409 往返期间用户继续编辑：B + 新增 L2（仅存在于 canvasRef，不在任务快照中）
    const canvasC = makeCanvas(["s1", "L1", "L2"]);

    // 受控的第一次 PUT：挂起，模拟网络往返
    let resolveFirstPut!: (r: FakeResponse) => void;
    const firstPutPending = new Promise<FakeResponse>((res) => {
      resolveFirstPut = res;
    });

    fetchMock
      // 1) 挂载加载 GET
      .mockImplementationOnce(async () =>
        fakeJson({
          data: serverCanvas,
          revision: 5,
          updatedAt: "2026-08-26T10:00:00Z",
        })
      )
      // 2) 第一次 PUT（携带 canvasB）→ 挂起后返回 409
      .mockImplementationOnce(() => firstPutPending)
      // 3) 冲突合并后的重试 PUT → 成功
      .mockImplementationOnce(async () => fakeJson({ ok: true, revision: 7 }));

    const setCanvas = vi.fn();
    const initial = makeCanvas(["a1"]);
    const { rerender } = renderHook(
      ({ canvas }: { canvas: CanvasState }) =>
        useCanvasServerSync(canvas, setCanvas),
      { initialProps: { canvas: initial } }
    );

    // ---- 挂载加载完成 → use-server 应用服务器画布 ----
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(setCanvas).toHaveBeenCalledWith(serverCanvas);

    // ---- 模拟状态更新 + 用户编辑 B：进入防抖 ----
    rerender({ canvas: serverCanvas });
    rerender({ canvas: canvasB });
    // 防抖 1.5s 到期 → enqueue(canvasB, baseRevision=5) → PUT 挂起
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(putBodyOf(fetchMock, 1).baseRevision).toBe(5);

    // ---- 409 往返期间：用户继续编辑为 C（防抖重新计时，闭包捕获 C）----
    rerender({ canvas: canvasC });

    // ---- 409 返回：onConflict 必须以 C（最新引用）为合并基底 ----
    await act(async () => {
      resolveFirstPut(
        fakeJson(
          { error: "revision_conflict", revision: 6, data: serverNew },
          409
        )
      );
      await vi.advanceTimersByTimeAsync(0);
    });

    // 合并结果 = 服务器基底 [s1,s3] + 本地新增 [L1,L2]：
    // L2 在场即证明合并基底是 canvasRef.current（C）而非任务快照 B
    expect(setCanvas).toHaveBeenCalledTimes(2);
    const merged = setCanvas.mock.calls[1][0] as CanvasState;
    expect(merged.nodes.map((n) => n.id).sort()).toEqual([
      "L1",
      "L2",
      "s1",
      "s3",
    ]);

    // 重试 PUT 携带合并结果与服务器新 revision 基线
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const retry = putBodyOf(fetchMock, 2);
    expect(retry.baseRevision).toBe(6);
    expect(retry.canvas.nodes.map((n) => n.id).sort()).toEqual([
      "L1",
      "L2",
      "s1",
      "s3",
    ]);

    // ---- 合并结果应用后：防抖计时器已被清除，不再有额外 PUT ----
    rerender({ canvas: merged });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
