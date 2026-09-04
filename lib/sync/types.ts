/**
 * 画布同步模块类型定义（F3）
 *
 * 职责划分：
 * - types.ts        类型与 SyncAdapter 抽象接口（F3-T6）
 * - save-queue.ts   保存队列（防抖后任务执行 + 失败指数退避重试，R1 修复）
 * - merge.ts        409 冲突合并算法（X2 修复：AI 批量写入不被前端覆盖）
 * - reconcile.ts    加载时新旧数据协调决策（R4/X1 修复）
 * - snapshot-policy.ts 快照/日志滚动保留策略（R2 修复）
 * - local-sync-adapter.ts  本地实现（走 /api/*），预留云同步扩展点
 */
import type { CanvasState } from "@/lib/hooks/use-local-storage";

/**
 * 保存状态（供 UI 完整性监控展示，F3-T3）
 * - idle    无未保存变更
 * - pending 有未保存变更（防抖等待中）
 * - saving  保存请求进行中
 * - saved   保存成功（at=成功时间戳, revision=服务器 revision）
 * - error   保存失败（attempt=已重试次数, canRetry=是否可手动重试）
 */
export type SaveStatus =
  | { phase: "idle" }
  | { phase: "pending" }
  | { phase: "saving" }
  | { phase: "saved"; at: number; revision: number }
  | { phase: "error"; at: number; attempt: number; canRetry: boolean };

/**
 * 单次保存结果
 * - saved     成功，revision 为写入后的服务器 revision
 * - conflict  乐观锁冲突（服务器已被其他端修改），携带服务器最新数据供合并
 * - failed    失败；retryable=网络/5xx 类可重试，4xx 类不可重试
 */
export type SaveResult =
  | { outcome: "saved"; revision: number }
  | { outcome: "conflict"; serverCanvas: CanvasState; serverRevision: number }
  | { outcome: "failed"; retryable: boolean; status?: number };

/** 加载结果（GET /api/canvas-layout） */
export interface LoadedCanvas {
  canvas: CanvasState | null;
  revision: number | null;
  /** ISO 时间字符串；服务器无数据时为 null */
  updatedAt: string | null;
}

/** 快照摘要（列表展示用，不含全量 data） */
export interface SnapshotSummary {
  id: string;
  nodeCount: number;
  edgeCount: number;
  /** auto | manual | pre-restore */
  reason: string;
  createdAt: string;
}

/** 变更日志条目 */
export interface ChangeLogEntry {
  id: string;
  /** save | batch-create | restore 等 */
  action: string;
  revision: number;
  nodeCount: number;
  edgeCount: number;
  /** web | ai-batch | restore:<snapshotId> 等 */
  source: string;
  /** 附加信息 JSON 字符串 */
  detail: string;
  createdAt: string;
}

/**
 * 画布同步适配器抽象接口（F3-T6）
 *
 * 设计意图：hook 只依赖此接口，不感知存储介质。
 * 当前提供 LocalSyncAdapter（本地 SQLite via REST API），
 * 未来接入云同步时实现 CloudSyncAdapter 即可，hook 无需改动。
 */
export interface CanvasSyncAdapter {
  /** 加载服务器画布 */
  load(): Promise<LoadedCanvas>;
  /**
   * 保存画布
   * @param baseRevision 基于的服务器 revision（乐观锁）；null 表示无条件写入
   * @param opts.keepalive 页面卸载时用 keepalive fetch（受 64KB body 限制）
   */
  save(
    canvas: CanvasState,
    baseRevision: number | null,
    opts?: { keepalive?: boolean }
  ): Promise<SaveResult>;
  /** 快照列表（倒序，最新在前） */
  listSnapshots(limit?: number): Promise<SnapshotSummary[]>;
  /** 手动创建当前画布快照 */
  createSnapshot(reason: "manual"): Promise<SnapshotSummary>;
  /** 恢复指定快照（恢复前服务器会自动备份当前数据） */
  restoreSnapshot(id: string): Promise<{ canvas: CanvasState; revision: number }>;
  /** 变更日志列表（倒序） */
  listChangeLog(limit?: number): Promise<ChangeLogEntry[]>;
}
