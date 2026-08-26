/**
 * 快照与变更日志的滚动保留策略（F3，R2 根因修复）
 *
 * 语义：快照/日志只增不减会无限膨胀（快照含全量画布 JSON），
 * 采用"保留最近 N 份（条），超出部分从最老的开始清理"的滚动策略。
 * 纯函数，便于单测；实际删除由 server-ops / API 路由执行。
 */

/** 自动快照保留上限（覆盖保存前的自动备份） */
export const MAX_CANVAS_SNAPSHOTS = 20;

/** 变更日志保留上限（审计条目较小，可保留更多） */
export const MAX_CHANGE_LOG_ENTRIES = 200;

/**
 * 计算应清理（prune）的快照 id 列表
 * @param snapshots 现有快照（任意顺序）
 * @param max 保留上限，默认 MAX_CANVAS_SNAPSHOTS
 * @returns 超出上限的最老快照 id（若未超限返回空数组）
 */
export function selectSnapshotsToPrune(
  snapshots: Array<{ id: string; createdAt: Date | string }>,
  max: number = MAX_CANVAS_SNAPSHOTS
): string[] {
  if (snapshots.length <= max) return [];
  // 按 createdAt 倒序（最新在前），保留前 max 个
  const sorted = [...snapshots].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  return sorted.slice(max).map((s) => s.id);
}

/**
 * 计算应清理的变更日志 id 列表（逻辑同快照，上限独立）
 */
export function selectChangeLogToPrune(
  entries: Array<{ id: string; createdAt: Date | string }>,
  max: number = MAX_CHANGE_LOG_ENTRIES
): string[] {
  return selectSnapshotsToPrune(entries, max);
}
