"use client";

import { LearnSession } from "@/components/learn/learn-session";

/**
 * 单词学习页面入口
 *
 * 设计依据：.doc/WORD_LEARNING_DESIGN.md §4.1
 *
 * 纯客户端交互页面：所有数据由 /api/learn/* API 驱动，
 * 无需 Server Component 数据预取。
 *
 * 简洁聚焦布局：顶部标题 → 学习会话（全屏单题展示 + 顶部统计 + 底部提交）。
 */
export default function LearnPage() {
  return (
    <div className="space-y-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold">单词学习</h1>
        <p className="text-sm text-muted-foreground mt-1">
          智能推荐 · 即时反馈 · 间隔重复
        </p>
      </div>
      <LearnSession />
    </div>
  );
}
