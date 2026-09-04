/**
 * 画布保存队列（F3-T2，R1 根因修复）
 *
 * 职责：
 * - 执行防抖后的保存任务，画布保存天然"最后写入者胜"：
 *   enqueue 直接替换待处理任务（旧任务尚未发出的变更被新任务覆盖）
 * - 失败指数退避重试（1s/2s/4s/... 上限 maxDelayMs），最多 maxRetries 次
 * - 网络异常（fetch reject）按可重试失败处理
 * - 409 冲突不重试：任务结束并交 onConflict 回调（上层负责合并后重新入队）
 * - 重试耗尽进入 error 状态，保留失败任务供手动 retryNow()
 * - 退避等待可被 flush() 打断（pagehide 时立即落盘）
 *
 * 纯逻辑类（不依赖 React/DOM/fetch），通过构造函数注入 doSave，
 * 便于单测；时间相关用 setTimeout，测试可用 vi.useFakeTimers。
 */
import type { CanvasState } from "@/lib/hooks/use-local-storage";
import type { SaveResult, SaveStatus } from "./types";

/** 待保存任务：目标画布 + 基于的服务器 revision（乐观锁） */
export interface SaveTask {
  canvas: CanvasState;
  baseRevision: number | null;
}

export interface SaveQueueOptions {
  /** 失败重试上限（不含首次尝试），默认 5 */
  maxRetries?: number;
  /** 退避基数毫秒，默认 1000 */
  baseDelayMs?: number;
  /** 退避上限毫秒，默认 30000 */
  maxDelayMs?: number;
  /** 状态变化回调（供 hook 更新 UI 保存状态指示） */
  onStatus?: (status: SaveStatus) => void;
  /**
   * 冲突回调（409）：上层在此合并服务器与本地数据后重新 enqueue。
   * 注意：回调内调用 enqueue 是安全的，队列会在回调返回后自动继续。
   */
  onConflict?: (result: Extract<SaveResult, { outcome: "conflict" }>, task: SaveTask) => void | Promise<void>;
}

/** 可打断的退避等待句柄 */
interface RetryWait {
  timer: ReturnType<typeof setTimeout>;
  resolve: () => void;
}

export class SaveQueue {
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;

  /** 待处理任务（null = 无未保存变更） */
  private task: SaveTask | null = null;
  /** 重试耗尽后保留的失败任务（供手动重试） */
  private failedTask: SaveTask | null = null;
  /** 执行循环是否在运行 */
  private running = false;
  /** 当前任务连续失败次数 */
  private attempt = 0;
  /** 当前状态 */
  private status: SaveStatus = { phase: "idle" };
  /** 退避等待句柄（可被 flush 打断） */
  private retryWait: RetryWait | null = null;
  /** 是否已销毁（组件卸载后不再驱动） */
  private disposed = false;

  constructor(
    private readonly doSave: (task: SaveTask) => Promise<SaveResult>,
    private readonly options: SaveQueueOptions = {}
  ) {
    this.maxRetries = options.maxRetries ?? 5;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.maxDelayMs = options.maxDelayMs ?? 30000;
  }

  /** 入队：替换待处理任务并驱动执行（最后写入者胜） */
  enqueue(task: SaveTask): void {
    if (this.disposed) return;
    this.task = task;
    this.failedTask = null;
    this.attempt = 0; // 新任务重新计数
    this.setStatus({ phase: "pending" });
    if (!this.running) void this.run();
  }

  /** 手动重试：重放重试耗尽后保留的失败任务 */
  retryNow(): void {
    if (this.disposed || !this.failedTask) return;
    const task = this.failedTask;
    this.failedTask = null;
    this.enqueue(task);
  }

  /**
   * 立即处理待保存任务（pagehide/visibilitychange 时调用）：
   * 打断退避等待，让循环立刻进入下一轮尝试。
   */
  flush(): void {
    this.interruptRetry();
    if (this.task && !this.running) void this.run();
  }

  /** 是否存在待保存变更 */
  get hasPending(): boolean {
    return this.task != null;
  }

  /** 当前状态（快照） */
  getStatus(): SaveStatus {
    return this.status;
  }

  /** 销毁：停止一切定时器与循环（组件卸载时调用） */
  dispose(): void {
    this.disposed = true;
    this.interruptRetry();
  }

  /** 主执行循环：处理 task 直到保存成功 / 冲突 / 不可重试 / 重试耗尽 */
  private async run(): Promise<void> {
    this.running = true;
    try {
      while (this.task && !this.disposed) {
        const task = this.task;
        this.setStatus({ phase: "saving" });

        let result: SaveResult;
        try {
          result = await this.doSave(task);
        } catch {
          // 网络层异常（断网/DNS 失败等 fetch reject）：按可重试失败处理
          result = { outcome: "failed", retryable: true };
        }

        if (result.outcome === "saved") {
          // 成功：仅清除已保存的任务——保存进行期间可能有新任务入队（最后写入者胜），
          // 那个新任务必须保留，由循环继续处理，否则会被静默丢弃（数据丢失）
          if (this.task === task) {
            this.task = null;
          }
          this.attempt = 0;
          this.setStatus({
            phase: "saved",
            at: Date.now(),
            revision: result.revision,
          });
          // 无新任务则收工；有新任务则继续循环处理
          if (!this.task) return;
          continue;
        }

        if (result.outcome === "conflict") {
          // 冲突不重试：交给上层合并（合并后重新 enqueue 会再次进入循环）
          if (this.task === task) {
            this.task = null;
          }
          this.attempt = 0;
          this.setStatus({ phase: "idle" });
          await this.options.onConflict?.(result, task);
          return;
        }

        // ---- failed ----
        if (!result.retryable) {
          // 4xx 类不可重试：任务作废（如请求体校验失败，重发无意义）
          if (this.task === task) {
            this.task = null;
          }
          this.attempt = 0;
          this.setStatus({
            phase: "error",
            at: Date.now(),
            attempt: this.attempt,
            canRetry: false,
          });
          return;
        }

        // 可重试：指数退避后重试
        this.attempt += 1;
        if (this.attempt > this.maxRetries) {
          // 重试耗尽：保留失败任务供手动 retryNow
          this.failedTask = task;
          if (this.task === task) {
            this.task = null;
          }
          this.setStatus({
            phase: "error",
            at: Date.now(),
            attempt: this.maxRetries,
            canRetry: true,
          });
          return;
        }
        const delay = this.backoffDelayMs(this.attempt);
        await this.waitRetry(delay);
        // 等待期间 task 可能已被新 enqueue 替换 → 循环下一轮用最新任务，符合最后写入者胜
      }
    } finally {
      this.running = false;
      // 兜底：循环退出后若仍有待处理任务（如 onConflict 回调期间入队），继续驱动
      if (this.task && !this.disposed) {
        Promise.resolve().then(() => {
          if (!this.running && this.task && !this.disposed) void this.run();
        });
      }
    }
  }

  /** 指数退避延迟：base * 2^(attempt-1)，封顶 maxDelayMs */
  private backoffDelayMs(attempt: number): number {
    const exponential = this.baseDelayMs * Math.pow(2, attempt - 1);
    return Math.min(exponential, this.maxDelayMs);
  }

  /** 可打断的退避等待（flush 时立即 resolve） */
  private waitRetry(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.retryWait = null;
        resolve();
      }, ms);
      this.retryWait = { timer, resolve };
    });
  }

  /** 打断退避等待（flush 用） */
  private interruptRetry(): void {
    if (this.retryWait) {
      clearTimeout(this.retryWait.timer);
      this.retryWait.resolve();
      this.retryWait = null;
    }
  }

  /** 更新状态并通知 */
  private setStatus(status: SaveStatus): void {
    this.status = status;
    this.options.onStatus?.(status);
  }
}
