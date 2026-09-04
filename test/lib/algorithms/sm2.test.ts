/**
 * SM-2 间隔重复算法测试
 *
 * 覆盖：
 * - 低质量（<3）重置逻辑
 * - 高质量间隔递增（1 → 6 → 指数增长）
 * - 难度系数下限与更新
 * - 标签映射
 */
import { describe, it, expect } from "vitest";
import {
  calculateSM2,
  INITIAL_SM2_STATE,
  qualityLabel,
  type SM2State,
} from "@/lib/algorithms/sm2";

/** 一天的毫秒数 */
const DAY_MS = 24 * 60 * 60 * 1000;

describe("calculateSM2（SM-2 算法）", () => {
  it("质量 < 3 时重置 repetitions 并安排次日复习", () => {
    const prev: SM2State = {
      repetitions: 5,
      interval: 30,
      easeFactor: 2.5,
      lastReviewAt: 0,
    };
    const next = calculateSM2(prev, 2);

    expect(next.repetitions).toBe(0);
    expect(next.interval).toBe(1);
    expect(next.nextReviewAt - next.lastReviewAt!).toBe(DAY_MS);
  });

  it("低质量会降低难度系数（下限 1.3）", () => {
    const next = calculateSM2({ ...INITIAL_SM2_STATE, easeFactor: 1.3 }, 1);
    expect(next.easeFactor).toBe(1.3); // 不低于下限
  });

  it("首次高质量回忆：间隔为 1 天", () => {
    const next = calculateSM2(INITIAL_SM2_STATE, 5);
    expect(next.repetitions).toBe(1);
    expect(next.interval).toBe(1);
    expect(next.nextReviewAt - next.lastReviewAt!).toBe(DAY_MS);
  });

  it("第二次高质量回忆：间隔为 6 天", () => {
    const prev: SM2State = { repetitions: 1, interval: 1, easeFactor: 2.5, lastReviewAt: 0 };
    const next = calculateSM2(prev, 5);
    expect(next.repetitions).toBe(2);
    expect(next.interval).toBe(6);
    expect(next.nextReviewAt - next.lastReviewAt!).toBe(6 * DAY_MS);
  });

  it("后续间隔按 easeFactor 指数增长", () => {
    const prev: SM2State = { repetitions: 2, interval: 6, easeFactor: 2.5, lastReviewAt: 0 };
    const next = calculateSM2(prev, 5);
    expect(next.repetitions).toBe(3);
    // quality=5 → easeFactor 2.5 → 2.6；间隔 = round(6 * 2.6) = 16（使用更新后的 EF，标准 SM-2 行为）
    expect(next.easeFactor).toBeCloseTo(2.6, 5);
    expect(next.interval).toBe(16);
    expect(next.nextReviewAt - next.lastReviewAt!).toBe(16 * DAY_MS);
  });

  it("质量 4 时 easeFactor 微调", () => {
    const next = calculateSM2(INITIAL_SM2_STATE, 4);
    // 0.1 - (5-4)*(0.08 + 0.02) = 0.1 - 0.1 = 0 → easeFactor 不变
    expect(next.easeFactor).toBeCloseTo(2.5, 5);
  });
});

describe("qualityLabel（质量标签映射）", () => {
  it("映射 0-5 为中文标签", () => {
    expect(qualityLabel(0)).toBe("完全忘记");
    expect(qualityLabel(3)).toBe("费力正确");
    expect(qualityLabel(5)).toBe("完美回忆");
  });
});
