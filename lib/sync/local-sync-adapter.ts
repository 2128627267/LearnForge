/**
 * 本地同步适配器（F3-T6）
 *
 * CanvasSyncAdapter 的本地实现：通过 Next.js REST API 读写
 * SQLite（CanvasLayout / CanvasSnapshot / DataChangeLog）。
 *
 * 设计要点：
 * - 网络层异常（fetch reject）在 save 内捕获并转为可重试的 failed，
 *   让 SaveQueue 的重试逻辑统一处理（调用方无需 try/catch）
 * - load 抛出异常（供上层区分"加载失败"与"无数据"）
 * - keepalive 选项用于页面卸载场景（受浏览器 64KB body 限制，
 *   仅作为兜底；主路径是 visibilitychange 提前 flush）
 */
import type { CanvasState } from "@/lib/hooks/use-local-storage";
import type {
  CanvasSyncAdapter,
  ChangeLogEntry,
  LoadedCanvas,
  SaveResult,
  SnapshotSummary,
} from "./types";

const LAYOUT_URL = "/api/canvas-layout";
const SNAPSHOTS_URL = "/api/canvas-snapshots";
const CHANGELOG_URL = "/api/canvas-changelog";

export class LocalSyncAdapter implements CanvasSyncAdapter {
  /** 加载服务器画布（网络/服务器错误时抛异常） */
  async load(): Promise<LoadedCanvas> {
    const r = await fetch(LAYOUT_URL, { cache: "no-store" });
    if (!r.ok) throw new Error(`加载画布失败: HTTP ${r.status}`);
    const json = (await r.json()) as {
      data: CanvasState | null;
      revision?: number | null;
      updatedAt?: string | null;
    };
    return {
      canvas: json.data ?? null,
      revision: json.revision ?? null,
      updatedAt: json.updatedAt ?? null,
    };
  }

  async save(
    canvas: CanvasState,
    baseRevision: number | null,
    opts?: { keepalive?: boolean }
  ): Promise<SaveResult> {
    let r: Response;
    try {
      r = await fetch(LAYOUT_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canvas, baseRevision }),
        keepalive: opts?.keepalive ?? false,
      });
    } catch {
      // 网络层异常：可重试
      return { outcome: "failed", retryable: true };
    }

    // 409 冲突：携带服务器最新数据返回，供上层合并
    if (r.status === 409) {
      // B3 修复（审查）：409 响应体可能不是 JSON（反向代理/网关错误页）——
      // 解析失败若向外抛异常，SaveQueue 会把 409 当"可重试失败"死循环重试
      // 至耗尽；此处解析失败降级为不可重试失败，由用户手动重试
      let json: { data?: CanvasState; revision?: number } | null = null;
      try {
        json = (await r.json()) as { data?: CanvasState; revision?: number };
      } catch {
        json = null;
      }
      if (
        !json ||
        typeof json.revision !== "number" ||
        !json.data
      ) {
        return { outcome: "failed", retryable: false, status: 409 };
      }
      return {
        outcome: "conflict",
        serverCanvas: json.data,
        serverRevision: json.revision,
      };
    }

    if (!r.ok) {
      // 5xx（服务器/SQLite 写失败）可重试；其他 4xx 不可重试
      return { outcome: "failed", retryable: r.status >= 500, status: r.status };
    }

    const json = (await r.json()) as { revision: number };
    return { outcome: "saved", revision: json.revision };
  }

  async listSnapshots(limit = 20): Promise<SnapshotSummary[]> {
    const r = await fetch(`${SNAPSHOTS_URL}?limit=${limit}`, {
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`加载快照列表失败: HTTP ${r.status}`);
    const json = (await r.json()) as { data: SnapshotSummary[] };
    return json.data ?? [];
  }

  async createSnapshot(reason: "manual"): Promise<SnapshotSummary> {
    const r = await fetch(SNAPSHOTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (!r.ok) throw new Error(`创建快照失败: HTTP ${r.status}`);
    return (await r.json()) as SnapshotSummary;
  }

  async restoreSnapshot(
    id: string
  ): Promise<{ canvas: CanvasState; revision: number }> {
    const r = await fetch(`${SNAPSHOTS_URL}/${id}/restore`, {
      method: "POST",
    });
    if (!r.ok) throw new Error(`恢复快照失败: HTTP ${r.status}`);
    return (await r.json()) as { canvas: CanvasState; revision: number };
  }

  async listChangeLog(limit = 50): Promise<ChangeLogEntry[]> {
    const r = await fetch(`${CHANGELOG_URL}?limit=${limit}`, {
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`加载变更日志失败: HTTP ${r.status}`);
    const json = (await r.json()) as { data: ChangeLogEntry[] };
    return json.data ?? [];
  }
}
