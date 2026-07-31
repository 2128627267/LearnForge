/**
 * 浮动连接点（Floating Edges）工具
 *
 * 功能：
 *   1. 自动计算两节点之间的最佳连接点（支持 8 方向：上下左右 + 4 斜角）
 *   2. 连接点基于节点边界与两节点中心连线的交点计算
 *   3. 根据交点位置推断 sourcePosition / targetPosition
 *
 * 路径生成使用 React Flow 内置的 getSmoothStepPath（正交折线 + 圆角），
 * 标签沿路径弯曲使用 SVG <textPath> 元素。
 *
 * 参考实现：React Flow 官方 floating edges 示例
 * https://reactflow.dev/examples/nodes/floating-edges
 */
import { Position, type Node, type XYPosition } from "reactflow";

/**
 * 计算节点中心点（画布坐标）
 */
function getNodeCenter(node: Node): XYPosition {
  const width = node.width ?? 200;
  const height = node.height ?? 100;
  const position = node.positionAbsolute ?? node.position;
  return {
    x: position.x + width / 2,
    y: position.y + height / 2,
  };
}

/**
 * 计算从矩形中心出发到外部点的射线与矩形边界的交点
 *
 * 数学原理：
 *   射线方向 (dx, dy)，矩形半宽 hw=w/2，半高 hh=h/2
 *   缩放因子 t = min(hw/|dx|, hh/|dy|)，取先到达边界的方向
 *   交点 = (cx + t*dx, cy + t*dy)
 *
 * @param cx 矩形中心 X
 * @param cy 矩形中心 Y
 * @param w  矩形宽
 * @param h  矩形高
 * @param x  目标点 X
 * @param y  目标点 Y
 * @returns 交点坐标
 */
function getIntersection(
  cx: number,
  cy: number,
  w: number,
  h: number,
  x: number,
  y: number
): XYPosition {
  const dx = x - cx;
  const dy = y - cy;

  // 目标点在中心，返回中心
  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  const hw = w / 2;
  const hh = h / 2;

  // 计算到达左右边界和上下边界的缩放因子
  // 避免除零：如果 dx/dy 为 0，对应方向不会到达边界，设为 Infinity
  const tX = dx !== 0 ? Math.abs(hw / dx) : Infinity;
  const tY = dy !== 0 ? Math.abs(hh / dy) : Infinity;

  // 取较小的 t（先到达的边界）
  const t = Math.min(tX, tY);

  return {
    x: cx + dx * t,
    y: cy + dy * t,
  };
}

/**
 * 根据交点在节点边界上的位置推断连接方向
 *
 * 通过交点相对于中心的方向，判断属于哪个方向：
 *   - 水平方向占优 → Left/Right
 *   - 垂直方向占优 → Top/Bottom
 *
 * 注意：React Flow 的 Position 只有 4 种（Top/Right/Bottom/Left），
 * 斜角方向会归一化到最接近的正交方向，但浮动连接点本身支持斜角拖出。
 *
 * @param node 节点
 * @param intersection 交点坐标
 * @returns 最接近的 Position
 */
function getEdgePosition(
  node: Node,
  intersection: XYPosition
): Position {
  const center = getNodeCenter(node);
  const w = node.width ?? 200;
  const h = node.height ?? 100;

  const dx = intersection.x - center.x;
  const dy = intersection.y - center.y;

  // 用宽高比校正（矩形不是正方形）
  const normalizedDx = dx / (w / 2);
  const normalizedDy = dy / (h / 2);

  if (Math.abs(normalizedDx) > Math.abs(normalizedDy)) {
    return dx > 0 ? Position.Right : Position.Left;
  } else {
    return dy > 0 ? Position.Bottom : Position.Top;
  }
}

/**
 * 计算两节点之间的最佳连接参数（浮动连接）
 *
 * @param source 源节点
 * @param target 目标节点
 * @returns 起止坐标 + 方向
 */
export function getEdgeParams(
  source: Node,
  target: Node
): {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  sourcePosition: Position;
  targetPosition: Position;
} {
  const sourceCenter = getNodeCenter(source);
  const targetCenter = getNodeCenter(target);

  const sourceW = source.width ?? 200;
  const sourceH = source.height ?? 100;
  const targetW = target.width ?? 200;
  const targetH = target.height ?? 100;

  // 源节点边界与中心连线的交点
  const sourceIntersection = getIntersection(
    sourceCenter.x,
    sourceCenter.y,
    sourceW,
    sourceH,
    targetCenter.x,
    targetCenter.y
  );

  // 目标节点边界与中心连线的交点
  const targetIntersection = getIntersection(
    targetCenter.x,
    targetCenter.y,
    targetW,
    targetH,
    sourceCenter.x,
    sourceCenter.y
  );

  const sourcePosition = getEdgePosition(source, sourceIntersection);
  const targetPosition = getEdgePosition(target, targetIntersection);

  return {
    sx: sourceIntersection.x,
    sy: sourceIntersection.y,
    tx: targetIntersection.x,
    ty: targetIntersection.y,
    sourcePosition,
    targetPosition,
  };
}
