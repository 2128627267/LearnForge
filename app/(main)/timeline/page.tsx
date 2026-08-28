"use client";

/**
 * 时间线页面：历史大事件的可视化整理与总览
 *
 * 功能概览：
 * - 左侧时间线选择器（彩色小格子动态生成、点击切换）
 * - 水平时间线（从左到右），支持滚轮/拖拽浏览
 * - 时间点 / 时间段 / AI 输入框三种事件创建方式
 * - 单事件自动居中；左右边界各外扩 100 年
 *
 * 布局说明：与画布页一致采用全屏布局（见 app/(main)/layout.tsx 的 isFullBleed）
 */
import { TimelinePageClient } from "@/components/timeline/timeline-page-client";

export default function TimelinePage() {
  return <TimelinePageClient />;
}
