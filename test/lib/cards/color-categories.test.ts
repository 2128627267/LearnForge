/**
 * 卡片颜色分类系统测试
 *
 * 覆盖：有效分类色计算 / 阈值显示逻辑 / 颜色统计 / 按颜色筛选。
 */
import { describe, it, expect } from "vitest";
import {
  COLOR_CATEGORIES,
  CARD_COLOR_THRESHOLD,
  DEFAULT_CARD_COLOR,
  hashTagColor,
  getEffectiveCardColor,
  shouldShowColorLabels,
  getColorCounts,
  filterNodesByColor,
  type CardColorSource,
} from "@/lib/cards/color-categories";

describe("COLOR_CATEGORIES（颜色分类定义）", () => {
  it("包含 8 种命名颜色且无重复 hex", () => {
    expect(COLOR_CATEGORIES).toHaveLength(8);
    const hexes = COLOR_CATEGORIES.map((c) => c.hex);
    expect(new Set(hexes).size).toBe(8);
    // 与画布调色板一致
    expect(hexes).toContain("#3b82f6");
  });
});

describe("getEffectiveCardColor（有效分类色）", () => {
  it("优先使用 data.color", () => {
    expect(getEffectiveCardColor({ color: "#ef4444" })).toBe("#ef4444");
  });

  it("无 color 时回退 cardType 默认色", () => {
    expect(getEffectiveCardColor({ cardType: "math" })).toBe("#a855f7");
  });

  it("无 color/cardType 时回退首标签 hash 色", () => {
    const tagColor = getEffectiveCardColor({ tags: ["数学"] });
    expect(tagColor).toBe(hashTagColor("数学"));
  });

  it("全部缺失时回退默认色", () => {
    expect(getEffectiveCardColor({})).toBe(DEFAULT_CARD_COLOR);
  });

  it("hashTagColor 稳定且落在分类色板内", () => {
    const a = hashTagColor("数学");
    const b = hashTagColor("数学");
    expect(a).toBe(b);
    expect(COLOR_CATEGORIES.some((c) => c.hex === a)).toBe(true);
  });
});

describe("shouldShowColorLabels（阈值显示逻辑）", () => {
  it("卡片数超过阈值时显示分类标签", () => {
    expect(shouldShowColorLabels(CARD_COLOR_THRESHOLD + 1)).toBe(true);
  });

  it("卡片数不超过阈值时隐藏", () => {
    expect(shouldShowColorLabels(CARD_COLOR_THRESHOLD)).toBe(false);
    expect(shouldShowColorLabels(0)).toBe(false);
  });
});

describe("getColorCounts（颜色统计）", () => {
  const nodes = [
    { data: { color: "#3b82f6" } },
    { data: { color: "#3B82F6" } }, // 大小写不敏感
    { data: { cardType: "math" } }, // → #a855f7
    { data: {} }, // → 默认蓝
  ];

  it("统计各颜色卡片数（hex 小写归一）", () => {
    const counts = getColorCounts(nodes);
    expect(counts.get("#3b82f6")).toBe(3); // 2 显式蓝 + 1 默认蓝
    expect(counts.get("#a855f7")).toBe(1);
  });
});

describe("filterNodesByColor（按颜色筛选）", () => {
  const nodes: Array<{ data: CardColorSource; id: string }> = [
    { id: "a", data: { color: "#3b82f6" } },
    { id: "b", data: { color: "#ef4444" } },
    { id: "c", data: { cardType: "math" } }, // → #a855f7
  ];

  it("按颜色精确筛选", () => {
    const result = filterNodesByColor(nodes, "#3b82f6");
    expect(result.map((n) => n.id)).toEqual(["a"]);
  });

  it("筛选大小写不敏感", () => {
    const result = filterNodesByColor(nodes, "#3B82F6");
    expect(result).toHaveLength(1);
  });

  it("空颜色返回全部", () => {
    expect(filterNodesByColor(nodes, null)).toHaveLength(3);
    expect(filterNodesByColor(nodes, undefined)).toHaveLength(3);
    expect(filterNodesByColor(nodes, "")).toHaveLength(3);
  });
});
