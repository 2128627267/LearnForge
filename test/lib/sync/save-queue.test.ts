/**
 * SaveQueue 保存队列测试（F3-T2，R1 修复）
 *
 * 覆盖：成功路径、可重试失败指数退避、重试耗尽（error + 手动重试）、
 * 不可重试失败、冲突回调、任务替换（最后写入者胜）、flush 打断退避、dispose
 *
 * 使用 vi.useFakeTimers 推进退避时间。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SaveQueue, type SaveTask } from "@/lib/sync/save-queue";
import type { SaveResult, SaveStatus } from "@/lib/sync/types";
import type { CanvasState } from "@/lib/hooks/use-local-storage";

/** 构造测试任务 */
function makeTask(id: string, baseRevision: number | null = 1): SaveTask {
  return {
    canvas: { nodes: [], edges: [], tags: [] } as CanvasState,
    baseRevision,
  };
}

/** 记录状态序列的辅助器 */
class StatusRecorder {
  statuses: SaveStatus[] = [];
  record = (s: SaveStatus) => {
    this.statuses.push(s);
  };
  phases() {
    return this.statuses.map((s) => s.phase);
  }
}

describe("SaveQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("保存成功：状态应经历 pending → saving → saved", async () => {
    const rec = new StatusRecorder();
    const queue = new SaveQueue(
      async () => ({ outcome: "saved", revision: 2 } as SaveResult),
      { onStatus: rec.record }
    );

    queue.enqueue(makeTask("a"));
    await vi.advanceTimersByTimeAsync(0);

    expect(rec.phases()).toEqual(["pending", "saving", "saved"]);
    expect(queue.hasPending).toBe(false);
    const final = rec.statuses.at(-1);
    expect(final).toMatchObject({ phase: "saved", revision: 2 });
  });

  it("可重试失败：应指数退避重试直至成功", async () => {
    let calls = 0;
    const rec = new StatusRecorder();
    const queue = new SaveQueue(
      async () => {
        calls += 1;
        // 前两次 5xx 失败，第三次成功
        if (calls < 3) {
          return { outcome: "failed", retryable: true, status: 500 } as SaveResult;
        }
        return { outcome: "saved", revision: 3 } as SaveResult;
      },
      { onStatus: rec.record, baseDelayMs: 1000 }
    );

    queue.enqueue(makeTask("a"));
    await vi.advanceTimersByTimeAsync(0); // 第一次尝试失败
    expect(calls).toBe(1);

    await vi.advanceTimersByTimeAsync(1000); // 第一次退避 1s 后第二次尝试失败
    expect(calls).toBe(2);

    await vi.advanceTimersByTimeAsync(2000); // 第二次退避 2s 后第三次成功
    expect(calls).toBe(3);
    expect(rec.phases().at(-1)).toBe("saved");
    expect(queue.hasPending).toBe(false);
  });

  it("重试耗尽：进入 error 状态且保留任务供手动重试", async () => {
    let calls = 0;
    const rec = new StatusRecorder();
    const queue = new SaveQueue(
      async () => {
        calls += 1;
        return { outcome: "failed", retryable: true } as SaveResult;
      },
      { onStatus: rec.record, maxRetries: 2, baseDelayMs: 100 }
    );

    queue.enqueue(makeTask("a"));
    // 首次尝试 + 2 次重试：推进足够时间（100 + 200）
    await vi.advanceTimersByTimeAsync(1000);

    expect(calls).toBe(3); // 1 + maxRetries(2)
    const final = rec.statuses.at(-1);
    expect(final).toMatchObject({
      phase: "error",
      attempt: 2,
      canRetry: true,
    });

    // 手动重试：retryNow 内部即重新 enqueue，任务重新享有完整重试预算；
    // 此处 doSave 恒失败 → 再次走 1 + maxRetries(2) 次尝试后耗尽
    queue.retryNow();
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(6); // 3 + (1 + maxRetries(2))
    expect(queue.getStatus()).toMatchObject({ phase: "error", canRetry: true });
  });

  it("不可重试失败（4xx）：直接 error 且 canRetry=false", async () => {
    const rec = new StatusRecorder();
    const queue = new SaveQueue(
      async () =>
        ({ outcome: "failed", retryable: false, status: 400 } as SaveResult),
      { onStatus: rec.record }
    );

    queue.enqueue(makeTask("a"));
    await vi.advanceTimersByTimeAsync(0);

    expect(rec.phases()).toEqual(["pending", "saving", "error"]);
    expect(rec.statuses.at(-1)).toMatchObject({ canRetry: false });
  });

  it("doSave 抛异常应按可重试失败处理", async () => {
    let calls = 0;
    const queue = new SaveQueue(
      async () => {
        calls += 1;
        if (calls < 2) throw new Error("断网");
        return { outcome: "saved", revision: 5 } as SaveResult;
      },
      { baseDelayMs: 100 }
    );

    queue.enqueue(makeTask("a"));
    await vi.advanceTimersByTimeAsync(200);
    expect(calls).toBe(2);
    expect(queue.getStatus().phase).toBe("saved");
  });

  it("冲突：任务结束并触发 onConflict 回调（不重试）", async () => {
    const rec = new StatusRecorder();
    const onConflict = vi.fn();
    const queue = new SaveQueue(
      async () =>
        ({
          outcome: "conflict",
          serverCanvas: { nodes: [], edges: [], tags: [] },
          serverRevision: 9,
        } as SaveResult),
      { onStatus: rec.record, onConflict }
    );

    const task = makeTask("a", 1);
    queue.enqueue(task);
    await vi.advanceTimersByTimeAsync(0);

    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(onConflict).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "conflict", serverRevision: 9 }),
      task
    );
    // 冲突后队列空闲，等待上层合并后重新 enqueue
    expect(queue.hasPending).toBe(false);
    expect(rec.phases().at(-1)).not.toBe("error");
  });

  it("enqueue 替换待处理任务（最后写入者胜）", async () => {
    const savedCanvases: string[] = [];
    let releaseSave: (() => void) | null = null;

    const queue = new SaveQueue(
      async (task) => {
        // 手动控制完成时机，模拟保存进行中入队新任务
        await new Promise<void>((resolve) => {
          releaseSave = resolve;
        });
        savedCanvases.push(JSON.stringify(task.canvas));
        return { outcome: "saved", revision: 2 } as SaveResult;
      }
    );

    const taskA = makeTask("a");
    const taskB = makeTask("b");
    queue.enqueue(taskA);
    await vi.advanceTimersByTimeAsync(0);
    // 第一次保存进行中：入队新任务
    queue.enqueue(taskB);
    releaseSave!(); // 完成 taskA
    await vi.advanceTimersByTimeAsync(0);

    // taskA 已发出；taskB 应在循环继续后发出
    releaseSave!();
    await vi.advanceTimersByTimeAsync(0);

    expect(savedCanvases).toHaveLength(2);
  });

  it("flush 应打断退避等待立即重试", async () => {
    let calls = 0;
    const queue = new SaveQueue(
      async () => {
        calls += 1;
        if (calls < 2) return { outcome: "failed", retryable: true } as SaveResult;
        return { outcome: "saved", revision: 2 } as SaveResult;
      },
      { baseDelayMs: 60000 } // 退避 1 分钟
    );

    queue.enqueue(makeTask("a"));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1); // 第一次失败，进入长退避

    queue.flush(); // pagehide 打断退避
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2); // 立即重试并成功
    expect(queue.getStatus().phase).toBe("saved");
  });

  it("dispose 后不再执行任务", async () => {
    let calls = 0;
    const queue = new SaveQueue(
      async () => {
        calls += 1;
        return { outcome: "saved", revision: 2 } as SaveResult;
      }
    );

    queue.dispose();
    queue.enqueue(makeTask("a"));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(0);
    // dispose 后入队被防御性丢弃（队列已销毁，挂任务无意义且会泄漏回调）
    expect(queue.hasPending).toBe(false);
  });

  it("退避延迟应封顶 maxDelayMs", async () => {
    // 通过自定义 maxDelayMs 验证退避不超过上限
    let calls = 0;
    const queue = new SaveQueue(
      async () => {
        calls += 1;
        return { outcome: "failed", retryable: true } as SaveResult;
      },
      { baseDelayMs: 1000, maxDelayMs: 3000, maxRetries: 10 }
    );

    queue.enqueue(makeTask("a"));
    // 推进 1000 + 2000 + 3000 = 第 4 次尝试在 3000ms 退避后（总 6s）
    await vi.advanceTimersByTimeAsync(6000);
    expect(calls).toBe(4);
    // 再推进 3000（第 4→5 次退避也封顶 3000）：若未封顶应为 16000
    await vi.advanceTimersByTimeAsync(3000);
    expect(calls).toBe(5);
    // 额外推进到重试耗尽（共 11 次尝试）
    await vi.advanceTimersByTimeAsync(30000);
    expect(calls).toBe(11);
    expect(queue.getStatus()).toMatchObject({ phase: "error", canRetry: true });
  });
});
