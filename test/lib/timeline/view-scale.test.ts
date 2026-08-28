/**
 * 时间线视图计算纯函数测试
 * 覆盖：年份格式化 / 视图范围 / 刻度生成 / 事件布局 / 初始滚动定位
 */
import { describe, it, expect } from "vitest";
import {
  formatYear,
  eventAnchorYear,
  computeViewRange,
  computeTicks,
  layoutEvents,
  computeStackGroups,
  resolveStackFronts,
  computeInitialScrollLeft,
  assignEventVisuals,
  EVENT_PALETTE,
  MIN_PX_PER_YEAR,
  MAX_PX_PER_YEAR,
  VIEW_MARGIN_YEARS,
} from "@/lib/timeline/view-scale";
import type { TimelineEventDTO } from "@/lib/services/timelines/types";

/** 构造事件 DTO 的辅助工厂（测试用，字段均有默认值） */
function makeEvent(overrides: Partial<TimelineEventDTO> & { id: string }): TimelineEventDTO {
  return {
    timelineId: "tl-1",
    title: "测试事件",
    content: "",
    type: "point",
    startYear: 0,
    endYear: null,
    source: "manual",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("formatYear", () => {
  it("负数年份格式化为公元前", () => {
    expect(formatYear(-221)).toBe("公元前221");
  });

  it("0 年显示为公元前1（约定：无公元 0 年）", () => {
    expect(formatYear(0)).toBe("公元前1");
  });

  it("正数年份直接显示数字", () => {
    expect(formatYear(1840)).toBe("1840");
  });
});

describe("eventAnchorYear", () => {
  it("point 事件锚点为开始年份", () => {
    expect(
      eventAnchorYear({ type: "point", startYear: 1911, endYear: null })
    ).toBe(1911);
  });

  it("period 事件锚点为起止中点", () => {
    expect(
      eventAnchorYear({ type: "period", startYear: 1840, endYear: 1842 })
    ).toBe(1841);
  });
});

describe("computeViewRange", () => {
  it("无事件时返回默认空范围", () => {
    const range = computeViewRange([], 1200);
    expect(range.left).toBe(-100);
    expect(range.right).toBe(100);
  });

  it("单时间点事件：左右各外扩 100 年（点天然居中）", () => {
    const range = computeViewRange([{ type: "point", startYear: 1840, endYear: null }], 1200);
    expect(range.left).toBe(1840 - VIEW_MARGIN_YEARS);
    expect(range.right).toBe(1840 + VIEW_MARGIN_YEARS);
  });

  it("单时间段事件：左 = 开始-100，右 = 结束+100（段中心居中）", () => {
    const range = computeViewRange(
      [{ type: "period", startYear: 1840, endYear: 1842 }],
      1200
    );
    expect(range.left).toBe(1740);
    expect(range.right).toBe(1942);
  });

  it("多事件：范围覆盖最早开始到最晚结束（含外扩）", () => {
    const range = computeViewRange(
      [
        { type: "period", startYear: 1937, endYear: 1945 },
        { type: "point", startYear: 1840, endYear: null },
        { type: "point", startYear: 1911, endYear: null },
      ],
      1200
    );
    expect(range.left).toBe(1740); // 1840 - 100
    expect(range.right).toBe(2045); // 1945 + 100
  });

  it("比例钳制上限：极小跨度（如 200 年）不超过 MAX_PX_PER_YEAR", () => {
    const range = computeViewRange([{ type: "point", startYear: 100, endYear: null }], 1200);
    expect(range.pxPerYear).toBeLessThanOrEqual(MAX_PX_PER_YEAR);
  });

  it("比例钳制下限：极大跨度（如 10000 年）不低于 MIN_PX_PER_YEAR", () => {
    const range = computeViewRange(
      [
        { type: "point", startYear: -4000, endYear: null },
        { type: "point", startYear: 4000, endYear: null },
      ],
      1200
    );
    expect(range.pxPerYear).toBeGreaterThanOrEqual(MIN_PX_PER_YEAR);
    // 钳制后内容宽度超出视口（可滚动浏览）
    expect(range.contentWidth).toBeGreaterThan(1200);
  });

  it("中等跨度：比例按视口铺满计算", () => {
    const range = computeViewRange(
      [
        { type: "point", startYear: 0, endYear: null },
        { type: "point", startYear: 1000, endYear: null },
      ],
      1200
    );
    // 跨度 1200 年（0-100 到 1000+100），铺满 1200px 视口 → 1px/年
    expect(range.pxPerYear).toBeCloseTo(1);
  });
});

describe("computeTicks", () => {
  it("刻度年份对齐间隔整数倍且在范围内", () => {
    const range = computeViewRange(
      [
        { type: "point", startYear: 0, endYear: null },
        { type: "point", startYear: 1000, endYear: null },
      ],
      1200
    );
    const ticks = computeTicks(range);
    expect(ticks.length).toBeGreaterThan(1);
    for (const tick of ticks) {
      expect(tick.year).toBeGreaterThanOrEqual(range.left);
      expect(tick.year).toBeLessThanOrEqual(range.right);
      // 刻度 X 坐标与年份换算一致
      expect(tick.x).toBeCloseTo((tick.year - range.left) * range.pxPerYear);
    }
  });

  it("相邻刻度像素间距达标（标签不重叠）", () => {
    const range = computeViewRange(
      [
        { type: "point", startYear: -2000, endYear: null },
        { type: "point", startYear: 2000, endYear: null },
      ],
      1200
    );
    const ticks = computeTicks(range);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i].x - ticks[i - 1].x).toBeGreaterThanOrEqual(88);
    }
  });
});

describe("layoutEvents", () => {
  it("年份相近的事件交错上下放置（防重叠）", () => {
    const events = [
      makeEvent({ id: "e1", startYear: 1840 }),
      makeEvent({ id: "e2", startYear: 1841 }),
      makeEvent({ id: "e3", startYear: 1842 }),
    ];
    const range = computeViewRange(events, 1200);
    const laid = layoutEvents(events, range);
    // 相邻三事件中至少出现上下交错
    const sides = laid.map((l) => l.side);
    expect(new Set(sides).size).toBe(2);
  });

  it("年份相距很远的事件同侧放置", () => {
    const events = [
      makeEvent({ id: "e1", startYear: 0 }),
      makeEvent({ id: "e2", startYear: 2000 }),
    ];
    const range = computeViewRange(events, 1200);
    const laid = layoutEvents(events, range);
    expect(laid[0].side).toBe("top");
    expect(laid[1].side).toBe("top");
  });

  it("period 事件输出横条起止坐标", () => {
    const events = [
      makeEvent({ id: "e1", type: "period", startYear: 1937, endYear: 1945 }),
    ];
    const range = computeViewRange(events, 1200);
    const laid = layoutEvents(events, range);
    expect(laid[0].barStartX).not.toBeNull();
    expect(laid[0].barEndX).not.toBeNull();
    expect(laid[0].barEndX!).toBeGreaterThan(laid[0].barStartX!);
  });

  it("point 事件无横条坐标", () => {
    const events = [makeEvent({ id: "e1", startYear: 1840 })];
    const range = computeViewRange(events, 1200);
    const laid = layoutEvents(events, range);
    expect(laid[0].barStartX).toBeNull();
    expect(laid[0].barEndX).toBeNull();
  });
});

describe("assignEventVisuals（重合事件染色）", () => {
  it("不重合的事件：统一基础色", () => {
    const visuals = assignEventVisuals([
      { id: "a", startYear: 1800, endYear: 1810 },
      { id: "b", startYear: 1850, endYear: 1860 },
      { id: "c", startYear: 1900, endYear: null },
    ]);
    for (const id of ["a", "b", "c"]) {
      expect(visuals.get(id)).toEqual({ color: EVENT_PALETTE[0] });
    }
  });

  it("时间重合的事件：颜色互异", () => {
    const visuals = assignEventVisuals([
      { id: "a", startYear: 1840, endYear: 1842 },
      { id: "b", startYear: 1841, endYear: 1845 },
      { id: "c", startYear: 1842, endYear: null },
    ]);
    const a = visuals.get("a")!;
    const b = visuals.get("b")!;
    const c = visuals.get("c")!;
    // 三者颜色互异
    expect(new Set([a.color, b.color, c.color]).size).toBe(3);
  });

  it("时间点落在时间段内：颜色区分", () => {
    const visuals = assignEventVisuals([
      { id: "period", startYear: 1937, endYear: 1945 },
      { id: "point", startYear: 1941, endYear: null },
    ]);
    expect(visuals.get("point")!.color).not.toBe(visuals.get("period")!.color);
  });

  it("端点相接视为重合（叠加时完全重合）", () => {
    const visuals = assignEventVisuals([
      { id: "a", startYear: 1800, endYear: 1810 },
      { id: "b", startYear: 1810, endYear: 1820 },
    ]);
    expect(visuals.get("b")!.color).not.toBe(visuals.get("a")!.color);
  });

  it("重合链结束后，后续事件回到基础色", () => {
    const visuals = assignEventVisuals([
      { id: "a", startYear: 1800, endYear: 1810 },
      { id: "b", startYear: 1805, endYear: 1815 },
      { id: "c", startYear: 1820, endYear: 1830 }, // a、b 均已结束 → 回到基础色
    ]);
    expect(visuals.get("c")!.color).toBe(EVENT_PALETTE[0]);
  });

  it("色板循环兜底：超过 8 个事件同时重合不崩溃", () => {
    const events = Array.from({ length: 12 }, (_, i) => ({
      id: `e${i}`,
      startYear: 1900 + i, // 依次重叠（i 与 i+1 间隔 1 年，10 年跨度内全重叠）
      endYear: 1911,
    }));
    const visuals = assignEventVisuals(events);
    // 全部有合法结果且颜色均属于色板
    const colors = events.map((e) => visuals.get(e.id)!.color);
    for (const color of colors) {
      expect(EVENT_PALETTE).toContain(color);
    }
    // 前 8 个（色板容量内）颜色互异
    expect(new Set(colors.slice(0, 8)).size).toBe(8);
  });
});

describe("layoutEvents（含染色输出）", () => {
  it("输出包含事件颜色（重合事件颜色互异）", () => {
    const events = [
      makeEvent({ id: "a", type: "period", startYear: 1840, endYear: 1842 }),
      makeEvent({ id: "b", startYear: 1841 }),
    ];
    const range = computeViewRange(events, 1200);
    const laid = layoutEvents(events, range);
    const a = laid.find((l) => l.event.id === "a")!;
    const b = laid.find((l) => l.event.id === "b")!;
    expect(a.color).not.toBe(b.color);
  });
});

describe("computeStackGroups（堆叠分组）", () => {
  it("同侧且卡片横向重叠的事件归入同组", () => {
    const events = [
      makeEvent({ id: "e1", startYear: 1840 }),
      makeEvent({ id: "e2", startYear: 1841 }),
      makeEvent({ id: "e3", startYear: 1842 }),
    ];
    const range = computeViewRange(events, 1200);
    const groups = computeStackGroups(layoutEvents(events, range));
    // 布局交错后 e1/e3 同在上方且卡片重叠 → 同组；e2 独占下方
    expect(groups).toHaveLength(2);
    const top = groups.find((g) => g.side === "top")!;
    expect(top.members).toEqual(["e1", "e3"]);
  });

  it("年份相距很远的事件各自成组", () => {
    const events = [
      makeEvent({ id: "e1", startYear: 0 }),
      makeEvent({ id: "e2", startYear: 2000 }),
    ];
    const range = computeViewRange(events, 1200);
    const groups = computeStackGroups(layoutEvents(events, range));
    expect(groups).toHaveLength(2);
    for (const group of groups) {
      expect(group.members).toHaveLength(1);
    }
  });

  it("上下两侧的卡片不归入同组（互不遮挡）", () => {
    const events = [
      makeEvent({ id: "e1", startYear: 1840 }),
      makeEvent({ id: "e2", startYear: 1841 }),
      makeEvent({ id: "e3", startYear: 1842 }),
    ];
    const range = computeViewRange(events, 1200);
    const laid = layoutEvents(events, range);
    const groups = computeStackGroups(laid);
    // 三事件交错上下后，任一组不超过 2 个成员（不会上下混叠）
    for (const group of groups) {
      expect(group.members.length).toBeLessThanOrEqual(2);
    }
    expect(groups.reduce((n, g) => n + g.members.length, 0)).toBe(3);
  });

  it("时间段事件按锚点参与分组", () => {
    const events = [
      makeEvent({ id: "p1", type: "period", startYear: 1840, endYear: 1860 }),
      makeEvent({ id: "e1", startYear: 1850 }),
      makeEvent({ id: "e2", startYear: 1851 }),
    ];
    const range = computeViewRange(events, 1200);
    const groups = computeStackGroups(layoutEvents(events, range));
    // 段锚点 1850 与点 1850/1851 卡片重叠；交错后 p1 与 e2 同在上方 → 同组
    const top = groups.find((g) => g.side === "top")!;
    expect(top.members).toEqual(["p1", "e2"]);
  });
});

describe("resolveStackFronts（滚轮置顶解析）", () => {
  // 三事件交错后 e1/e3 同在上方构成堆叠组
  const events = [
    makeEvent({ id: "e1", startYear: 1840 }),
    makeEvent({ id: "e2", startYear: 1841 }),
    makeEvent({ id: "e3", startYear: 1842 }),
  ];
  const groups = computeStackGroups(
    layoutEvents(events, computeViewRange(events, 1200))
  );
  const top = groups.find((g) => g.side === "top")!;
  const key = top.key;

  it("游标缺省：首个成员置顶", () => {
    const fronts = resolveStackFronts(groups, {});
    expect(fronts.get("e1")!.isFront).toBe(true);
    expect(fronts.get("e3")!.isFront).toBe(false);
    // 单成员组始终置顶
    expect(fronts.get("e2")!.isFront).toBe(true);
  });

  it("游标为 1：第二个成员置顶", () => {
    const fronts = resolveStackFronts(groups, { [key]: 1 });
    expect(fronts.get("e1")!.isFront).toBe(false);
    expect(fronts.get("e3")!.isFront).toBe(true);
  });

  it("游标为负数或越界：取模归一", () => {
    expect(resolveStackFronts(groups, { [key]: -1 }).get("e3")!.isFront).toBe(true);
    expect(resolveStackFronts(groups, { [key]: 2 }).get("e1")!.isFront).toBe(true);
  });
});

describe("computeInitialScrollLeft", () => {
  it("无事件：从头开始", () => {
    const range = computeViewRange([], 1200);
    expect(computeInitialScrollLeft([], range, 1200)).toBe(0);
  });

  it("单事件：居中显示（需求核心场景）", () => {
    const events = [makeEvent({ id: "e1", startYear: 1840 })];
    const range = computeViewRange(events, 1200);
    const scrollLeft = computeInitialScrollLeft(events, range, 1200);
    // 事件 X 坐标 - scrollLeft 应为视口中心
    const eventX = (1840 - range.left) * range.pxPerYear;
    expect(scrollLeft).toBeCloseTo(eventX - 600);
  });

  it("单时间段事件：段中心居中", () => {
    const events = [
      makeEvent({ id: "e1", type: "period", startYear: 1840, endYear: 1842 }),
    ];
    const range = computeViewRange(events, 1200);
    const scrollLeft = computeInitialScrollLeft(events, range, 1200);
    const centerX = (1841 - range.left) * range.pxPerYear;
    expect(scrollLeft).toBeCloseTo(centerX - 600);
  });

  it("多事件：最早事件位于视口 1/4 处", () => {
    const events = [
      makeEvent({ id: "e1", startYear: 1840 }),
      makeEvent({ id: "e2", startYear: 1911 }),
    ];
    const range = computeViewRange(events, 1200);
    const scrollLeft = computeInitialScrollLeft(events, range, 1200);
    const earliestX = (1840 - range.left) * range.pxPerYear;
    expect(scrollLeft).toBeCloseTo(earliestX - 300);
  });
});
