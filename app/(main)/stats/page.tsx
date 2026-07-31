import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { WordVolumeSwitcher } from "@/components/stats/word-volume-switcher";

// ============================================================================
// 标签与颜色映射配置（集中管理，避免硬编码）
// ============================================================================

/** 卡片类型 → 中文标签 */
const TYPE_LABELS: Record<string, string> = {
  concept: "概念",
  word: "单词",
  phrase: "短语",
  grammar: "语法",
  problem: "题目",
  theorem: "定理",
  formula: "公式",
};

/** 学习状态 → 中文标签 */
const STATUS_LABELS: Record<string, string> = {
  new: "未学",
  learning: "学习中",
  reviewing: "复习中",
  mastered: "已掌握",
};

/** 学习状态 → Badge 变体（用于状态徽章着色） */
const STATUS_BADGE_VARIANT: Record<
  string,
  "default" | "secondary" | "success" | "warning"
> = {
  new: "secondary",
  learning: "default",
  reviewing: "warning",
  mastered: "success",
};

/** 考查方式编号 → 中文标签 */
const MODE_LABELS: Record<number, string> = {
  1: "缺失单词句子",
  2: "缺失字母拼写",
  3: "看释义拼写",
  4: "ABCD选择",
};

/** 考查方式编号 → 颜色（用于进度条着色） */
const MODE_COLORS: Record<number, string> = {
  1: "bg-blue-500",
  2: "bg-purple-500",
  3: "bg-amber-500",
  4: "bg-emerald-500",
};

/** 卡片类型 → 颜色（用于进度条着色） */
const TYPE_COLORS: Record<string, string> = {
  concept: "bg-blue-500",
  word: "bg-emerald-500",
  phrase: "bg-purple-500",
  grammar: "bg-amber-500",
  problem: "bg-rose-500",
  theorem: "bg-cyan-500",
  formula: "bg-indigo-500",
};

/** 卡片来源 → 中文标签 */
const SOURCE_LABELS: Record<string, string> = {
  manual: "手动创建",
  ai: "AI 生成",
  imported: "导入",
};

/** 卡片来源 → 十六进制颜色（用于 conic-gradient 饼图） */
const SOURCE_COLORS: Record<string, string> = {
  manual: "#3b82f6", // blue-500
  ai: "#8b5cf6", // purple-500
  imported: "#10b981", // emerald-500
};

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 将日期转换为 `YYYY-MM-DD` 形式的字符串键，用于按天聚合去重
 * 注意：直接使用本地时区（与 SQLite 存储的 UTC 时间需在查询前对齐）
 */
function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * 将日期格式化为简短的中文展示形式 `MM-DD HH:mm`
 */
function formatDateTimeCN(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${m}-${d} ${h}:${min}`;
}

/**
 * 将 `YYYY-MM-DD` 形式的字符串解析为本地时区 0 点的 Date 对象
 *
 * 注意：直接 `new Date("2026-01-15")` 在多数浏览器中会被解析为 UTC，
 *      与本地时区偏移会导致日期错位，因此显式按本地时分秒构造。
 */
function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * 计算从今天起（或昨天起，若今日尚未学习）的连续学习天数
 *
 * 增强点（相对初版）：
 *   1. 突破 30 天上限：基于全量答题日集合，支持任意长度的连续天数
 *   2. 仅统计有效答题日：调用方需传入 ModeHistory 衍生的日期集合
 *   3. 跨年/跨月：由 formatDateKey (YYYY-MM-DD) 字符串比较自然支持
 *   4. 安全上限：3650 天（约 10 年）防止极端情况下死循环
 *
 * @param studyDates 已学习的日期集合（`YYYY-MM-DD` 形式）
 * @param todayStart 今天 0 点的 Date 对象
 * @returns 当前连续学习天数
 */
function calcStreakDays(studyDates: Set<string>, todayStart: Date): number {
  // 若今日尚未学习，则从昨天开始倒推（更宽容的展示）
  const todayKey = formatDateKey(todayStart);
  const startCursor = studyDates.has(todayKey)
    ? new Date(todayStart)
    : new Date(new Date(todayStart).setDate(todayStart.getDate() - 1));

  let streak = 0;
  const cursor = new Date(startCursor);
  // 突破 30 天上限：基于全量答题日集合，无回溯限制
  // 安全上限 10 年（3650 天）防止极端情况死循环
  while (streak < 3650 && studyDates.has(formatDateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/**
 * 计算历史最长连续学习天数
 *
 * 遍历所有答题日，按日期升序排序后线性扫描最长连续段。
 * 跨年/跨月由 formatDateKey (YYYY-MM-DD) 字符串排序自然支持。
 *
 * @param studyDates 已学习的日期集合（`YYYY-MM-DD` 形式）
 * @returns 历史最长连续学习天数（集合为空时返回 0）
 */
function calcMaxStreakDays(studyDates: Set<string>): number {
  if (studyDates.size === 0) return 0;

  // YYYY-MM-DD 字符串字典序等价于日期升序
  const sortedDates = Array.from(studyDates).sort();

  let maxStreak = 1;
  let currentStreak = 1;

  for (let i = 1; i < sortedDates.length; i++) {
    const prev = parseDateKey(sortedDates[i - 1]);
    const curr = parseDateKey(sortedDates[i]);

    // 计算两天之间的天数差（按本地时区 0 点对齐）
    const diffMs = curr.getTime() - prev.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      // 相邻 1 天，连续
      currentStreak++;
      if (currentStreak > maxStreak) {
        maxStreak = currentStreak;
      }
    } else {
      // 断裂，重新计数
      currentStreak = 1;
    }
  }

  return maxStreak;
}

// ============================================================================
// 主页面组件（Server Component）
// ============================================================================

/**
 * 数据统计页面
 * 作为应用默认首页，提供丰富的学习数据概览
 *
 * 包含模块：
 *   1. 学习概览卡片（6 项核心指标）
 *   2. 卡片类型分布（水平进度条）
 *   3. 学习状态分布（卡片网格）
 *   4. 考查方式分布（基于 ModeHistory 统计）
 *   5. 近 7 天学习趋势（柱状图 + 正确率）
 *   6. 易错单词 Top 10（WordProfile.errorProneness 降序）
 *   7. 待复习单词列表（WordProfile.nextReviewAt <= now）
 *   8. 数据来源分布（conic-gradient 饼图）
 */
export default async function StatsPage() {
  // ------------------------------------------------------------------
  // 时间锚点计算
  // ------------------------------------------------------------------
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  // 7 天前 0 点（含今天共 7 天）
  const sevenDaysAgo = new Date(todayStart);
  sevenDaysAgo.setDate(todayStart.getDate() - 6);

  // 本周一 0 点（中国习惯：周一为一周起始）
  // getDay(): 0=周日, 1=周一, ..., 6=周六
  const dayOfWeek = todayStart.getDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(todayStart);
  weekStart.setDate(todayStart.getDate() - daysSinceMonday);

  // 本月 1 号 0 点
  const monthStart = new Date(
    todayStart.getFullYear(),
    todayStart.getMonth(),
    1
  );

  // 本年 1 月 1 日 0 点
  const yearStart = new Date(todayStart.getFullYear(), 0, 1);

  // ------------------------------------------------------------------
  // 并行查询所有统计数据
  // 说明：使用 Promise.all 一次性发起所有 Prisma 查询，最大化 IO 并发
  // ------------------------------------------------------------------
  const [
    totalCards,
    masteredCount,
    totalLogs,
    totalFavorites,
    todayLogs,
    weekLogs,
    monthLogs,
    yearLogs,
    cardsByType,
    cardsByStatus,
    cardsBySource,
    modesByModeId,
    recent7DaysLogs,
    allAnswerDates,
    topErrorProne,
    dueReview,
  ] = await Promise.all([
    // 1. 总卡片数
    prisma.card.count(),
    // 2. 已掌握卡片数
    prisma.card.count({ where: { status: "mastered" } }),
    // 3. 学习行为总数
    prisma.studyLog.count(),
    // 4. 收藏总数
    prisma.cardFavorite.count(),
    // 5. 今日学习行为数（综合学习量·天维度）
    prisma.studyLog.count({ where: { createdAt: { gte: todayStart } } }),
    // 6. 本周学习行为数（综合学习量·周维度，本周一 0 点起）
    prisma.studyLog.count({ where: { createdAt: { gte: weekStart } } }),
    // 7. 本月学习行为数（综合学习量·月维度，本月 1 号 0 点起）
    prisma.studyLog.count({ where: { createdAt: { gte: monthStart } } }),
    // 8. 本年学习行为数（综合学习量·年维度，本年 1 月 1 日 0 点起）
    prisma.studyLog.count({ where: { createdAt: { gte: yearStart } } }),
    // 9. 卡片类型分布
    prisma.card.groupBy({ by: ["type"], _count: true }),
    // 10. 学习状态分布
    prisma.card.groupBy({ by: ["status"], _count: true }),
    // 11. 数据来源分布
    prisma.card.groupBy({ by: ["source"], _count: true }),
    // 12. 考查方式分布（按 modeId 聚合 ModeHistory）
    prisma.modeHistory.groupBy({ by: ["modeId"], _count: true }),
    // 13. 近 7 天学习记录（用于趋势图）
    prisma.studyLog.findMany({
      where: { createdAt: { gte: sevenDaysAgo } },
      select: { createdAt: true, correct: true },
      orderBy: { createdAt: "asc" },
    }),
    // 14. 全量答题记录的日期（用于计算当前/最长连续学习天数）
    // 仅取 createdAt 字段，按升序返回；突破原 30 天上限，支持任意长度连续
    prisma.modeHistory.findMany({
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    // 15. 易错单词 Top 10（按 errorProneness 降序）
    prisma.wordProfile.findMany({
      orderBy: { errorProneness: "desc" },
      take: 10,
      include: { card: { select: { title: true } } },
    }),
    // 16. 待复习单词列表（nextReviewAt <= now 的前 10 个）
    prisma.wordProfile.findMany({
      where: { nextReviewAt: { not: null, lte: now } },
      orderBy: { nextReviewAt: "asc" },
      take: 10,
      include: { card: { select: { title: true } } },
    }),
  ]);

  // ------------------------------------------------------------------
  // 数据后处理：连续学习天数（基于 ModeHistory 有效答题日）
  // ------------------------------------------------------------------
  const studyDates = new Set<string>();
  for (const record of allAnswerDates) {
    studyDates.add(formatDateKey(record.createdAt));
  }
  const streakDays = calcStreakDays(studyDates, todayStart);
  const maxStreakDays = calcMaxStreakDays(studyDates);

  // ------------------------------------------------------------------
  // 数据后处理：近 7 天学习趋势
  // ------------------------------------------------------------------
  // 构造从 7 天前到今天的每日聚合数据
  const trendData: Array<{
    date: Date;
    count: number;
    correctRate: number;
  }> = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(todayStart);
    dayStart.setDate(todayStart.getDate() - i);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayStart.getDate() + 1);

    // 筛选当天的学习记录
    const dayLogs = recent7DaysLogs.filter(
      (log) => log.createdAt >= dayStart && log.createdAt < dayEnd
    );
    const dayCount = dayLogs.length;
    // 仅统计有正确性判定（correct 非 null）的记录作为分母
    const answeredLogs = dayLogs.filter((log) => log.correct !== null);
    const correctCount = answeredLogs.filter((log) => log.correct === true).length;
    const correctRate =
      answeredLogs.length > 0 ? (correctCount / answeredLogs.length) * 100 : 0;

    trendData.push({ date: dayStart, count: dayCount, correctRate });
  }
  // 用于柱状图高度比例计算，至少为 1 避免除零
  const maxDayCount = Math.max(...trendData.map((d) => d.count), 1);

  // ------------------------------------------------------------------
  // 数据后处理：数据来源饼图（conic-gradient）
  // ------------------------------------------------------------------
  const sourceTotal = cardsBySource.reduce((sum, item) => sum + item._count, 0);
  let accumulatedDeg = 0;
  const sourceGradientParts: string[] = [];
  const sourceList: Array<{ source: string; count: number; pct: number }> = [];
  for (const item of cardsBySource) {
    const pct = sourceTotal > 0 ? (item._count / sourceTotal) * 100 : 0;
    const startDeg = accumulatedDeg;
    const endDeg = accumulatedDeg + pct * 3.6; // 百分比转角度
    const color = SOURCE_COLORS[item.source] || "#64748b"; // 默认 slate-500
    sourceGradientParts.push(`${color} ${startDeg}deg ${endDeg}deg`);
    sourceList.push({ source: item.source, count: item._count, pct });
    accumulatedDeg = endDeg;
  }
  // 构造 conic-gradient CSS 字符串（空数据时使用灰色兜底）
  const conicGradient =
    sourceGradientParts.length > 0
      ? `conic-gradient(${sourceGradientParts.join(", ")})`
      : "conic-gradient(#94a3b8 0deg 360deg)";

  // ------------------------------------------------------------------
  // 数据后处理：类型分布、状态分布、考查方式分布按数量降序排序
  // ------------------------------------------------------------------
  const sortedByType = [...cardsByType].sort((a, b) => b._count - a._count);
  const sortedByMode = [...modesByModeId].sort((a, b) => b._count - a._count);

  // ------------------------------------------------------------------
  // 渲染
  // ------------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-bold">学习统计</h1>
        <p className="text-sm text-muted-foreground mt-1">
          学习数据概览与进度分析
        </p>
      </div>

      {/* ============================================================ */}
      {/* 模块 1：学习概览卡片（6 项核心指标）                            */}
      {/* ============================================================ */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-3xl font-bold">{totalCards}</div>
            <div className="text-sm text-muted-foreground">总卡片数</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-3xl font-bold text-emerald-600">{masteredCount}</div>
            <div className="text-sm text-muted-foreground">已掌握</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-3xl font-bold">{totalLogs}</div>
            <div className="text-sm text-muted-foreground">学习行为</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-3xl font-bold text-amber-600">{totalFavorites}</div>
            <div className="text-sm text-muted-foreground">收藏数</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <WordVolumeSwitcher
              day={todayLogs}
              week={weekLogs}
              month={monthLogs}
              year={yearLogs}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-orange-600 tabular-nums">
                {streakDays}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                / 最长 {maxStreakDays} 天
              </span>
            </div>
            <div className="text-sm text-muted-foreground">连续学习天数</div>
          </CardContent>
        </Card>
      </div>

      {/* ============================================================ */}
      {/* 模块 2 + 4：卡片类型分布 / 考查方式分布（左右两列）              */}
      {/* ============================================================ */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* 模块 2：卡片类型分布（水平进度条 + 百分比） */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">卡片类型分布</CardTitle>
          </CardHeader>
          <CardContent>
            {sortedByType.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无数据</p>
            ) : (
              <div className="space-y-3">
                {sortedByType.map((item) => {
                  const pct =
                    totalCards > 0 ? (item._count / totalCards) * 100 : 0;
                  const color = TYPE_COLORS[item.type] || "bg-slate-400";
                  return (
                    <div key={item.type} className="flex items-center gap-3">
                      <span className="text-sm w-12 shrink-0">
                        {TYPE_LABELS[item.type] || item.type}
                      </span>
                      <div className="flex-1 h-5 bg-muted rounded overflow-hidden">
                        <div
                          className={`h-full ${color} transition-all`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-sm text-muted-foreground w-24 text-right shrink-0">
                        {item._count} 张 ({pct.toFixed(1)}%)
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 模块 4：考查方式分布（基于 ModeHistory 统计） */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">考查方式分布</CardTitle>
          </CardHeader>
          <CardContent>
            {sortedByMode.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无答题记录</p>
            ) : (
              <div className="space-y-3">
                {(() => {
                  // 计算总答题次数（用于百分比计算）
                  const totalModeCount = sortedByMode.reduce(
                    (sum, item) => sum + item._count,
                    0
                  );
                  return sortedByMode.map((item) => {
                    const pct =
                      totalModeCount > 0
                        ? (item._count / totalModeCount) * 100
                        : 0;
                    const color = MODE_COLORS[item.modeId] || "bg-slate-400";
                    const label =
                      MODE_LABELS[item.modeId] || `方式 ${item.modeId}`;
                    return (
                      <div key={item.modeId} className="flex items-center gap-3">
                        <span className="text-sm w-24 shrink-0">{label}</span>
                        <div className="flex-1 h-5 bg-muted rounded overflow-hidden">
                          <div
                            className={`h-full ${color} transition-all`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-sm text-muted-foreground w-24 text-right shrink-0">
                          {item._count} 次 ({pct.toFixed(1)}%)
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ============================================================ */}
      {/* 模块 3 + 8：学习状态分布 / 数据来源分布（左右两列）              */}
      {/* ============================================================ */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* 模块 3：学习状态分布（卡片网格） */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">学习状态分布</CardTitle>
          </CardHeader>
          <CardContent>
            {totalCards === 0 ? (
              <p className="text-sm text-muted-foreground">暂无数据</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {(["new", "learning", "reviewing", "mastered"] as const).map(
                  (status) => {
                    const item = cardsByStatus.find((s) => s.status === status);
                    const count = item?._count || 0;
                    const pct =
                      totalCards > 0 ? (count / totalCards) * 100 : 0;
                    return (
                      <div
                        key={status}
                        className="text-center p-4 rounded border bg-muted/30"
                      >
                        <div className="flex justify-center mb-2">
                          <Badge variant={STATUS_BADGE_VARIANT[status]}>
                            {STATUS_LABELS[status]}
                          </Badge>
                        </div>
                        <div className="text-2xl font-bold">{count}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          占比 {pct.toFixed(1)}%
                        </div>
                      </div>
                    );
                  }
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 模块 8：数据来源分布（conic-gradient 饼图） */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">数据来源分布</CardTitle>
          </CardHeader>
          <CardContent>
            {sourceTotal === 0 ? (
              <p className="text-sm text-muted-foreground">暂无数据</p>
            ) : (
              <div className="flex flex-col sm:flex-row items-center gap-6">
                {/* 饼图本体：使用 conic-gradient 实现纯 CSS 饼图 */}
                <div
                  className="w-32 h-32 rounded-full shrink-0 border-4 border-background shadow-sm"
                  style={{ background: conicGradient }}
                  aria-label="数据来源饼图"
                  role="img"
                />
                {/* 图例列表 */}
                <div className="flex-1 w-full space-y-2">
                  {sourceList.map((item) => {
                    const color = SOURCE_COLORS[item.source] || "#64748b";
                    return (
                      <div
                        key={item.source}
                        className="flex items-center gap-3"
                      >
                        <span
                          className="w-3 h-3 rounded-sm shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span className="text-sm flex-1">
                          {SOURCE_LABELS[item.source] || item.source}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {item.count} 张 ({item.pct.toFixed(1)}%)
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ============================================================ */}
      {/* 模块 5：近 7 天学习趋势（柱状图 + 正确率折线模拟）              */}
      {/* ============================================================ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">近 7 天学习趋势</CardTitle>
        </CardHeader>
        <CardContent>
          {recent7DaysLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">近 7 天暂无学习记录</p>
          ) : (
            <div className="space-y-4">
              {/* 柱状图区域：使用 flex 布局，每天一列 */}
              <div className="flex items-end justify-between gap-2 h-40 border-b border-border pb-1">
                {trendData.map((day) => {
                  // 柱子高度按当日次数占最大值的比例计算（最低 4px 保证可见性）
                  const barHeight =
                    day.count > 0
                      ? Math.max((day.count / maxDayCount) * 100, 4)
                      : 0;
                  const isToday = formatDateKey(day.date) === formatDateKey(now);
                  return (
                    <div
                      key={day.date.toISOString()}
                      className="flex-1 flex flex-col items-center gap-1"
                    >
                      {/* 顶部显示当日次数 */}
                      <span className="text-xs font-medium text-foreground">
                        {day.count}
                      </span>
                      {/* 柱子本体 */}
                      <div className="w-full flex-1 flex items-end">
                        <div
                          className={`w-full rounded-t transition-all ${
                            isToday ? "bg-orange-500" : "bg-primary"
                          }`}
                          style={{ height: `${barHeight}%` }}
                          title={`${formatDateKey(day.date)}：${day.count} 次学习`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* X 轴日期标签 + 正确率展示 */}
              <div className="flex justify-between gap-2">
                {trendData.map((day) => {
                  const monthDay = `${String(day.date.getMonth() + 1).padStart(
                    2,
                    "0"
                  )}-${String(day.date.getDate()).padStart(2, "0")}`;
                  const isToday = formatDateKey(day.date) === formatDateKey(now);
                  return (
                    <div
                      key={`label-${day.date.toISOString()}`}
                      className="flex-1 text-center"
                    >
                      <div
                        className={`text-xs ${
                          isToday
                            ? "font-bold text-orange-600"
                            : "text-muted-foreground"
                        }`}
                      >
                        {monthDay}
                      </div>
                      <div className="text-xs text-emerald-600 mt-0.5">
                        {day.correctRate > 0
                          ? `${day.correctRate.toFixed(0)}%`
                          : "-"}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* 图例说明 */}
              <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t border-border">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-primary" />
                  <span>每日学习次数</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-orange-500" />
                  <span>今日</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-emerald-600 font-bold">%</span>
                  <span>正确率（仅统计有判定的答题）</span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ============================================================ */}
      {/* 模块 6 + 7：易错单词 Top 10 / 待复习单词列表（左右两列）         */}
      {/* ============================================================ */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* 模块 6：易错单词 Top 10 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">易错单词 Top 10</CardTitle>
          </CardHeader>
          <CardContent>
            {topErrorProne.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                暂无单词学习画像数据
              </p>
            ) : (
              <div className="space-y-2">
                {topErrorProne.map((profile, index) => {
                  const word = profile.card?.title || "(已删除)";
                  const errorPct = (profile.errorProneness * 100).toFixed(1);
                  return (
                    <div
                      key={profile.id}
                      className="flex items-center gap-3 py-1.5 border-b border-border last:border-0"
                    >
                      {/* 排名徽章 */}
                      <Badge
                        variant={index < 3 ? "destructive" : "secondary"}
                        className="w-6 justify-center"
                      >
                        {index + 1}
                      </Badge>
                      <span className="text-sm font-medium flex-1 truncate">
                        {word}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        学习 {profile.studyCount} 次
                      </span>
                      <span className="text-xs font-semibold text-rose-600 w-14 text-right shrink-0">
                        易错 {errorPct}%
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 模块 7：待复习单词列表 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">待复习单词列表</CardTitle>
          </CardHeader>
          <CardContent>
            {dueReview.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                暂无待复习单词，继续保持学习节奏
              </p>
            ) : (
              <div className="space-y-2">
                {dueReview.map((profile) => {
                  const word = profile.card?.title || "(已删除)";
                  const reviewTime = profile.nextReviewAt;
                  const isOverdue =
                    reviewTime && reviewTime.getTime() < now.getTime();
                  return (
                    <div
                      key={profile.id}
                      className="flex items-center gap-3 py-1.5 border-b border-border last:border-0"
                    >
                      <span className="text-sm font-medium flex-1 truncate">
                        {word}
                      </span>
                      <Badge variant={isOverdue ? "destructive" : "warning"}>
                        {isOverdue ? "已逾期" : "待复习"}
                      </Badge>
                      {reviewTime && (
                        <span className="text-xs text-muted-foreground w-24 text-right shrink-0">
                          {formatDateTimeCN(reviewTime)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ============================================================ */}
      {/* 底部跳转按钮：跳转至 /canvas（卡片库页面已迁移至画布）           */}
      {/* ============================================================ */}
      <div className="flex justify-end">
        <Button asChild variant="outline">
          <Link href="/canvas">查看所有卡片</Link>
        </Button>
      </div>
    </div>
  );
}
