/**
 * 409 冲突合并算法（F3，X2 根因修复）
 *
 * 场景：前端 PUT 携带的 baseRevision 与服务器不一致（服务器已被
 * /api/cards/batch 等其他通道修改），服务器返回 409 + 最新数据。
 *
 * 合并策略（MVP：最后写入者胜 + 新增保底）：
 * 1. 以服务器最新数据为基底（尊重其他通道的写入，如 AI 生成的卡片）
 * 2. 本地独有的 nodes（按 id diff）追加到基底之后（保留用户新建卡片）
 * 3. 本地独有的 edges：两端节点存在于合并结果才追加（防止悬空边）
 * 4. tags：服务器为基底，本地独有标签（按 name diff）追加
 * 5. viewport：采用本地（用户当前视口，无数据丢失风险）
 * 6. 本地对已有节点的编辑冲突以服务器为准（如有误覆盖可从快照恢复）
 *
 * 已知局限（审查 G1，MVP 取舍）：
 * - 本地"删除"操作无墓碑（tombstone）记录——服务器基底中仍存在的节点
 *   会在合并后"复活"（用户删除卡片与 AI 批量写入并发时）。误删找回可走
 *   快照恢复；后续如需精确删除语义，可引入删除墓碑（已删节点 id 差集）
 * - 调用方注意（审查 S2）：local 参数应传"最新画布引用"而非防抖入队时
 *   的快照，否则 PUT→409 往返期间的用户编辑会被合并结果覆盖
 */
import type { CanvasState } from "@/lib/hooks/use-local-storage";

/** 构造节点 id 集合 */
function nodeIdSet(nodes: CanvasState["nodes"]): Set<string> {
  return new Set(nodes.map((n) => n.id));
}

/** 构造边 id 集合 */
function edgeIdSet(edges: CanvasState["edges"]): Set<string> {
  return new Set(edges.map((e) => e.id));
}

/** 构造标签名集合 */
function tagNameSet(tags: CanvasState["tags"]): Set<string> {
  return new Set(tags.map((t) => t.name));
}

/**
 * 冲突合并：以 server 为基底，合并 local 的新增内容
 * 纯函数，不修改入参。
 */
export function mergeCanvas(
  server: CanvasState,
  local: CanvasState
): CanvasState {
  // 1. 节点：服务器基底 + 本地新增（按 id diff）
  const serverNodeIds = nodeIdSet(server.nodes);
  const addedNodes = local.nodes.filter((n) => !serverNodeIds.has(n.id));
  const mergedNodes = [...server.nodes, ...addedNodes];

  // 2. 边：服务器基底 + 本地新增，且两端节点必须存在于合并结果（防悬空边）
  const mergedNodeIds = nodeIdSet(mergedNodes);
  const serverEdgeIds = edgeIdSet(server.edges);
  const addedEdges = local.edges.filter(
    (e) =>
      !serverEdgeIds.has(e.id) &&
      mergedNodeIds.has(e.source) &&
      mergedNodeIds.has(e.target)
  );

  // 3. 标签：服务器基底 + 本地独有标签（按 name diff）
  const serverTagNames = tagNameSet(server.tags);
  const addedTags = local.tags.filter((t) => !serverTagNames.has(t.name));

  return {
    nodes: mergedNodes,
    edges: [...server.edges, ...addedEdges],
    tags: [...server.tags, ...addedTags],
    // 视口采用本地值：用户当前视口位置，无数据语义，取最新即可
    viewport: local.viewport ?? server.viewport,
  };
}
