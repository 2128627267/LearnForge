/**
 * 卡片颜色分类系统
 *
 * 职责：
 * - 定义命名颜色分类（与画布调色板一致，8 种）
 * - 计算卡片的有效分类色（data.color > cardType 色 > 首标签 hash 色 > 默认）
 * - 阈值化显示逻辑（卡片数超过阈值才显示分类标签）
 * - 颜色统计与按颜色筛选
 *
 * 说明：与 free-card-node 的色板/hash 逻辑保持一致，避免视觉不一致。
 */

/** 颜色分类（含中文名，用于分类标签展示） */
export interface ColorCategory {
  id: string;
  name: string;
  hex: string;
}

/** 卡片分类颜色（与画布标签/卡片调色板一致） */
export const COLOR_CATEGORIES: ColorCategory[] = [
  { id: "blue", name: "蓝", hex: "#3b82f6" },
  { id: "green", name: "绿", hex: "#22c55e" },
  { id: "purple", name: "紫", hex: "#a855f7" },
  { id: "orange", name: "橙", hex: "#f97316" },
  { id: "pink", name: "粉", hex: "#ec4899" },
  { id: "teal", name: "青", hex: "#14b8a6" },
  { id: "red", name: "红", hex: "#ef4444" },
  { id: "gray", name: "灰", hex: "#6b7280" },
];

/**
 * 颜色分类标签显示阈值：
 * 卡片数量超过该阈值时显示颜色分类标签（含数量），否则隐藏以保持界面简洁。
 */
export const CARD_COLOR_THRESHOLD = 50;

/** 默认卡片颜色 */
export const DEFAULT_CARD_COLOR = "#3b82f6";

/** 卡片类型 → 默认分类色（与 free-card-node CARD_TYPE_CONFIG 一致） */
export const CARD_TYPE_DEFAULT_COLORS: Record<string, string> = {
  word: "#3b82f6",
  phrase: "#22c55e",
  math: "#a855f7",
  code: "#f97316",
  concept: "#14b8a6",
  general: "#6b7280",
};

/** 根据标签名稳定取色（hash 映射到分类色板，与 free-card-node 回退逻辑一致） */
export function hashTagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 31 + tag.charCodeAt(i)) | 0;
  }
  return COLOR_CATEGORIES[Math.abs(hash) % COLOR_CATEGORIES.length].hex;
}

/** 卡片数据中参与颜色计算的字段（与 FreeCardData 子集一致） */
export interface CardColorSource {
  color?: string;
  cardType?: string;
  tags?: string[];
}

/**
 * 获取卡片的有效分类色：
 * 优先级 data.color → cardType 默认色 → 首标签 hash 色 → 默认蓝
 */
export function getEffectiveCardColor(data: CardColorSource): string {
  if (data.color) return data.color;
  if (data.cardType && CARD_TYPE_DEFAULT_COLORS[data.cardType]) {
    return CARD_TYPE_DEFAULT_COLORS[data.cardType];
  }
  if (data.tags && data.tags.length > 0) return hashTagColor(data.tags[0]);
  return DEFAULT_CARD_COLOR;
}

/** 是否应显示颜色分类标签（卡片数超过阈值） */
export function shouldShowColorLabels(cardCount: number): boolean {
  return cardCount > CARD_COLOR_THRESHOLD;
}

/**
 * 统计各颜色分类的卡片数
 * @returns Map<颜色 hex(小写), 数量>；仅包含实际出现的颜色
 */
export function getColorCounts(
  nodes: Array<{ data: CardColorSource }>
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    const hex = getEffectiveCardColor(n.data).toLowerCase();
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  return counts;
}

/**
 * 按颜色筛选卡片节点
 * @param nodes 卡片节点列表
 * @param colorHex 目标颜色（大小写不敏感）；为空返回全部
 */
export function filterNodesByColor<T extends { data: CardColorSource }>(
  nodes: T[],
  colorHex: string | null | undefined
): T[] {
  if (!colorHex) return nodes;
  const target = colorHex.toLowerCase();
  return nodes.filter(
    (n) => getEffectiveCardColor(n.data).toLowerCase() === target
  );
}
