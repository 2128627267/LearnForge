/**
 * 时间线服务类型定义与校验
 *
 * 数据模型说明：
 * - Timeline：时间线本体（名称/描述/主题色），左侧选择器的小格子
 * - TimelineEvent：时间线上的事件，分为 point（时间点）与 period（时间段）
 * - 年份使用整数，负数表示公元前（如 -221 = 公元前221年）
 */
import { z } from "zod";

/** 事件类型枚举：point = 时间点事件，period = 时间段事件 */
export const TimelineEventTypeEnum = z.enum(["point", "period"]);
export type TimelineEventType = z.infer<typeof TimelineEventTypeEnum>;

/** 事件来源枚举 */
export const TimelineEventSourceEnum = z.enum(["manual", "ai"]);
export type TimelineEventSource = z.infer<typeof TimelineEventSourceEnum>;

/** 年份边界（约公元前 10000 年 ~ 公元 9999 年） */
export const YEAR_MIN = -10000;
export const YEAR_MAX = 9999;

/** 名称长度限制 */
export const NAME_MAX_LENGTH = 50;
export const CONTENT_MAX_LENGTH = 2000;

/** 年份校验（含边界） */
const yearSchema = z
  .number()
  .int()
  .min(YEAR_MIN, "年份超出范围（公元前 10000 ~ 公元 9999）")
  .max(YEAR_MAX, "年份超出范围（公元前 10000 ~ 公元 9999）");

/** hex 颜色校验（#RRGGBB） */
const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "颜色格式须为 #RRGGBB");

/** 创建时间线输入 */
export const CreateTimelineSchema = z.object({
  name: z.string().min(1, "名称不能为空").max(NAME_MAX_LENGTH),
  description: z.string().max(500).optional(),
  /** 主题色；缺省时由服务端按调色板轮询分配 */
  color: hexColorSchema.optional(),
  order: z.number().int().optional(),
});
export type CreateTimelineInput = z.infer<typeof CreateTimelineSchema>;

/** 更新时间线输入（全部可选） */
export const UpdateTimelineSchema = z.object({
  name: z.string().min(1).max(NAME_MAX_LENGTH).optional(),
  description: z.string().max(500).nullable().optional(),
  color: hexColorSchema.optional(),
  order: z.number().int().optional(),
});
export type UpdateTimelineInput = z.infer<typeof UpdateTimelineSchema>;

/** 创建事件输入 */
export const CreateTimelineEventSchema = z
  .object({
    title: z.string().min(1, "标题不能为空").max(NAME_MAX_LENGTH),
    content: z.string().max(CONTENT_MAX_LENGTH).default(""),
    type: TimelineEventTypeEnum,
    startYear: yearSchema,
    /** 结束年份：period 必填且 >= startYear；point 必须为空 */
    endYear: yearSchema.optional().nullable(),
    source: TimelineEventSourceEnum.default("manual"),
  })
  .refine(
    (data) => data.type !== "period" || (data.endYear !== null && data.endYear !== undefined),
    { message: "时间段事件必须填写结束年份", path: ["endYear"] }
  )
  .refine((data) => data.type !== "period" || (data.endYear ?? 0) >= data.startYear, {
    message: "结束年份不能早于开始年份",
    path: ["endYear"],
  })
  .refine((data) => data.type !== "point" || data.endYear === null || data.endYear === undefined, {
    message: "时间点事件不应填写结束年份",
    path: ["endYear"],
  });
export type CreateTimelineEventInput = z.infer<typeof CreateTimelineEventSchema>;

/** 批量创建事件输入（AI 解析结果批量落库） */
export const CreateTimelineEventsBatchSchema = z.object({
  events: z.array(CreateTimelineEventSchema).min(1).max(50),
});
export type CreateTimelineEventsBatchInput = z.infer<typeof CreateTimelineEventsBatchSchema>;

/** 更新事件输入（全部可选；type 变更时校验 endYear 一致性） */
export const UpdateTimelineEventSchema = z
  .object({
    title: z.string().min(1).max(NAME_MAX_LENGTH).optional(),
    content: z.string().max(CONTENT_MAX_LENGTH).optional(),
    type: TimelineEventTypeEnum.optional(),
    startYear: yearSchema.optional(),
    endYear: yearSchema.optional().nullable(),
  })
  .refine(
    (data) =>
      !data.type || data.type !== "period" || (data.endYear !== null && data.endYear !== undefined),
    { message: "时间段事件必须填写结束年份", path: ["endYear"] }
  )
  .refine(
    (data) =>
      data.endYear === null ||
      data.endYear === undefined ||
      data.startYear === undefined ||
      data.endYear >= data.startYear,
    { message: "结束年份不能早于开始年份", path: ["endYear"] }
  );
export type UpdateTimelineEventInput = z.infer<typeof UpdateTimelineEventSchema>;

/** AI 解析生成的事件（AI 返回结果，允许缺省字段，由服务端补全） */
export const AIParsedEventSchema = z.object({
  title: z.string().min(1).max(NAME_MAX_LENGTH),
  content: z.string().max(CONTENT_MAX_LENGTH).default(""),
  type: TimelineEventTypeEnum.default("point"),
  startYear: yearSchema,
  endYear: yearSchema.optional().nullable(),
});
export type AIParsedEvent = z.infer<typeof AIParsedEventSchema>;

/** API 返回的时间线 DTO（含事件数统计） */
export interface TimelineDTO {
  id: string;
  name: string;
  description: string | null;
  color: string;
  order: number;
  eventCount: number;
  createdAt: string;
  updatedAt: string;
}

/** API 返回的事件 DTO */
export interface TimelineEventDTO {
  id: string;
  timelineId: string;
  title: string;
  content: string;
  type: "point" | "period";
  startYear: number;
  endYear: number | null;
  source: "manual" | "ai";
  createdAt: string;
  updatedAt: string;
}
