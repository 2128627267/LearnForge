/**
 * 画布同步服务端操作（F3-T4/T5）
 *
 * 供 API 路由调用的 Prisma 辅助函数：
 * - snapshotCurrentLayout：覆盖写入前备份当前画布（auto/manual/pre-restore）
 * - appendChangeLog：写入变更日志并滚动清理
 *
 * 设计意图：把"快照备份 + 日志 + 滚动清理"的横切逻辑集中在此，
 * canvas-layout / canvas-snapshots / cards/batch 多个写入入口保持一致行为。
 */
import { prisma } from "@/lib/db/prisma";
import { getLogger } from "@/lib/utils/logger";
import {
  MAX_CANVAS_SNAPSHOTS,
  MAX_CHANGE_LOG_ENTRIES,
  selectSnapshotsToPrune,
  selectChangeLogToPrune,
} from "./snapshot-policy";

const logger = getLogger("CanvasSyncServerOps");

const CANVAS_LAYOUT_ID = "default";

export type SnapshotReason = "auto" | "manual" | "pre-restore";

/**
 * 将当前 CanvasLayout 备份为快照
 * @returns 是否实际创建了快照（服务器无数据/数据损坏时返回 false）
 */
export async function snapshotCurrentLayout(
  reason: SnapshotReason
): Promise<boolean> {
  const current = await prisma.canvasLayout.findUnique({
    where: { id: CANVAS_LAYOUT_ID },
  });
  if (!current) return false;

  // 解析统计节点/边数量（损坏数据跳过快照，避免备份垃圾）
  let nodeCount = 0;
  let edgeCount = 0;
  try {
    const parsed = JSON.parse(current.data) as {
      nodes?: unknown[];
      edges?: unknown[];
    };
    nodeCount = Array.isArray(parsed.nodes) ? parsed.nodes.length : 0;
    edgeCount = Array.isArray(parsed.edges) ? parsed.edges.length : 0;
  } catch {
    logger.warn("快照失败：当前画布数据损坏", { revision: current.version });
    return false;
  }

  await prisma.canvasSnapshot.create({
    data: { data: current.data, nodeCount, edgeCount, reason },
  });

  // 滚动清理：超出保留上限的最老快照
  const all = await prisma.canvasSnapshot.findMany({
    select: { id: true, createdAt: true },
  });
  const prunable = selectSnapshotsToPrune(all, MAX_CANVAS_SNAPSHOTS);
  if (prunable.length > 0) {
    await prisma.canvasSnapshot.deleteMany({
      where: { id: { in: prunable } },
    });
  }
  return true;
}

export interface ChangeLogInput {
  /** save | batch-create | restore */
  action: string;
  /** 写入后的服务器 revision */
  revision: number;
  nodeCount: number;
  edgeCount: number;
  /** web | ai-batch | restore:<snapshotId> 等 */
  source: string;
  /** 附加信息（对象，内部序列化为 JSON 字符串） */
  detail?: Record<string, unknown>;
}

/**
 * 追加变更日志并滚动清理（超出保留上限的最老条目）
 */
export async function appendChangeLog(entry: ChangeLogInput): Promise<void> {
  await prisma.dataChangeLog.create({
    data: {
      action: entry.action,
      revision: entry.revision,
      nodeCount: entry.nodeCount,
      edgeCount: entry.edgeCount,
      source: entry.source,
      detail: JSON.stringify(entry.detail ?? {}),
    },
  });

  const all = await prisma.dataChangeLog.findMany({
    select: { id: true, createdAt: true },
  });
  const prunable = selectChangeLogToPrune(all, MAX_CHANGE_LOG_ENTRIES);
  if (prunable.length > 0) {
    await prisma.dataChangeLog.deleteMany({
      where: { id: { in: prunable } },
    });
  }
}
