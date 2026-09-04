"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { QuestionRenderer } from "@/components/learn/question-renderer";
import { SessionStatsBar } from "@/components/learn/session-stats";
import {
  type AnswerRequest,
  type AnswerResponse,
  type NextQuestionPayload,
} from "@/lib/learning/types";
import { cn } from "@/lib/utils/cn";
import {
  CheckCircle2,
  Loader2,
  LogOut,
  RotateCcw,
  XCircle,
} from "lucide-react";

/**
 * 学习会话组件（状态机驱动）
 *
 * 设计依据：.doc/WORD_LEARNING_DESIGN.md §4.2
 *
 * 状态机：
 *   Loading ──GET /api/learn/next──> Presenting ──提交──> Answering
 *     └──<── POST /api/learn/answer ──<──┘
 *                                         │
 *                                         ▼
 *                                       Feedback ──3s 自动 / 手动"下一题"──> Loading（循环）
 *                                         │
 *                                 "结束学习" │
 *                                         ▼
 *                                     SessionEnd ──POST /api/learn/session/end（容错）
 *
 * 数据流：
 *   - currentQuestion: NextQuestionPayload（当前题目）
 *   - lastAnswer: AnswerResponse（最近一次判定结果）
 *   - 本地累计 LocalStats（与后端滚动窗口区分，用于顶部条与结束页）
 *   - questionStartRef: 题目开始时间戳，提交时计算 responseMs
 */
type Phase =
  | "loading"
  | "presenting"
  | "answering"
  | "feedback"
  | "sessionEnd"
  | "error";

/** 本会话累计统计（独立于后端的最近 20 条滚动窗口） */
interface LocalStats {
  total: number;
  correct: number;
  currentStreak: number;
  maxStreak: number;
  responseMsSum: number;
  modeDistribution: Record<number, number>;
}

const INITIAL_STATS: LocalStats = {
  total: 0,
  correct: 0,
  currentStreak: 0,
  maxStreak: 0,
  responseMsSum: 0,
  modeDistribution: {},
};

/** 反馈阶段自动进入下一题的延时（毫秒） */
const AUTO_ADVANCE_MS = 3000;

export function LearnSession() {
  // ===== 状态 =====
  const [phase, setPhase] = useState<Phase>("loading");
  const [current, setCurrent] = useState<NextQuestionPayload | null>(null);
  const [lastAnswer, setLastAnswer] = useState<AnswerResponse | null>(null);
  const [userInput, setUserInput] = useState("");
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [stats, setStats] = useState<LocalStats>(INITIAL_STATS);

  // ===== 引用 =====
  /** 题目开始时间戳（用于计算 responseMs） */
  const questionStartRef = useRef<number>(0);
  /** 会话 ID（用于答题上报与结束统计） */
  const sessionIdRef = useRef<string | null>(null);
  if (sessionIdRef.current === null) {
    sessionIdRef.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  /** 自动下一题定时器 */
  const autoAdvanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 组件挂载标志（避免异步回调中 setState） */
  const mountedRef = useRef(true);

  /** 清理自动下一题定时器 */
  const clearAutoAdvance = useCallback(() => {
    if (autoAdvanceRef.current) {
      clearTimeout(autoAdvanceRef.current);
      autoAdvanceRef.current = null;
    }
  }, []);

  /** 拉取下一题 */
  const fetchNext = useCallback(async () => {
    setPhase("loading");
    setUserInput("");
    setSelectedOption(null);
    setLastAnswer(null);
    setErrorMsg("");
    try {
      const res = await fetch("/api/learn/next", { cache: "no-store" });
      // 404：暂无可学习单词
      if (res.status === 404) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "暂无可学习的单词");
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "获取题目失败");
      }
      const payload = (await res.json()) as NextQuestionPayload;
      if (!mountedRef.current) return;
      setCurrent(payload);
      questionStartRef.current = Date.now();
      setPhase("presenting");
    } catch (e) {
      if (!mountedRef.current) return;
      setErrorMsg(e instanceof Error ? e.message : "未知错误");
      setPhase("error");
    }
  }, []);

  // 首次挂载：拉取第一题；卸载时清理
  useEffect(() => {
    mountedRef.current = true;
    fetchNext();
    return () => {
      mountedRef.current = false;
      clearAutoAdvance();
    };
  }, [fetchNext, clearAutoAdvance]);

  /** 提交答案 */
  const submitAnswer = useCallback(async () => {
    if (!current) return;
    // modeId=4 取选项，其余取键入文本
    const answer =
      current.modeId === 4 ? selectedOption ?? "" : userInput.trim();
    if (!answer) return;

    setPhase("answering");
    const responseMs = Date.now() - questionStartRef.current;

    const body: AnswerRequest = {
      cardId: current.cardId,
      modeId: current.modeId,
      answer,
      responseMs,
      sessionId: sessionIdRef.current ?? undefined,
    };

    try {
      const res = await fetch("/api/learn/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "提交失败");
      }
      const result = (await res.json()) as AnswerResponse;
      if (!mountedRef.current) return;

      setLastAnswer(result);

      // 累计本地会话统计
      setStats((prev) => {
        const total = prev.total + 1;
        const correct = prev.correct + (result.correct ? 1 : 0);
        const currentStreak = result.correct ? prev.currentStreak + 1 : 0;
        const maxStreak = Math.max(prev.maxStreak, currentStreak);
        const responseMsSum = prev.responseMsSum + responseMs;
        const modeDistribution = { ...prev.modeDistribution };
        modeDistribution[current.modeId] =
          (modeDistribution[current.modeId] ?? 0) + 1;
        return {
          total,
          correct,
          currentStreak,
          maxStreak,
          responseMsSum,
          modeDistribution,
        };
      });

      setPhase("feedback");

      // 启动 3s 自动下一题定时器
      clearAutoAdvance();
      autoAdvanceRef.current = setTimeout(() => {
        fetchNext();
      }, AUTO_ADVANCE_MS);
    } catch (e) {
      if (!mountedRef.current) return;
      setErrorMsg(e instanceof Error ? e.message : "提交失败");
      setPhase("error");
    }
  }, [current, selectedOption, userInput, fetchNext, clearAutoAdvance]);

  /** 手动进入下一题（打断自动定时器） */
  const goNext = useCallback(() => {
    clearAutoAdvance();
    fetchNext();
  }, [clearAutoAdvance, fetchNext]);

  /** 结束会话 */
  const endSession = useCallback(() => {
    clearAutoAdvance();
    // 通知后端会话结束（端点可能未实现，静默失败，不影响前端流程）
    void fetch("/api/learn/session/end", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionIdRef.current,
        total: stats.total,
        correct: stats.correct,
        avgResponseMs:
          stats.total > 0 ? Math.round(stats.responseMsSum / stats.total) : 0,
        modeDistribution: stats.modeDistribution,
      }),
    }).catch(() => {
      /* 静默：端点未实现时不影响前端流程 */
    });
    setPhase("sessionEnd");
  }, [clearAutoAdvance, stats]);

  /** 再学一轮：重置统计并重新开始 */
  const restart = useCallback(() => {
    setStats(INITIAL_STATS);
    fetchNext();
  }, [fetchNext]);

  const avgResponseMs =
    stats.total > 0 ? Math.round(stats.responseMsSum / stats.total) : 0;

  // ===== 会话结束界面 =====
  if (phase === "sessionEnd") {
    return (
      <div className="max-w-[480px] mx-auto space-y-4">
        <Card>
          <CardContent className="p-6 space-y-5 text-center">
            <div className="space-y-1">
              <h2 className="text-xl font-bold">本次学习结束</h2>
              <p className="text-sm text-muted-foreground">
                共练习 {stats.total} 题，最长连击 {stats.maxStreak}
              </p>
            </div>
            <SessionStatsBar
              total={stats.total}
              correct={stats.correct}
              currentStreak={stats.currentStreak}
              avgResponseMs={avgResponseMs}
              modeDistribution={stats.modeDistribution}
            />
            <Button onClick={restart} size="lg" className="w-full">
              <RotateCcw className="h-4 w-4 mr-1" />
              再学一轮
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ===== 主学习界面 =====
  return (
    <div className="max-w-[480px] mx-auto space-y-4">
      {/* 顶部统计条 */}
      <SessionStatsBar
        total={stats.total}
        correct={stats.correct}
        currentStreak={stats.currentStreak}
        avgResponseMs={avgResponseMs}
        modeDistribution={stats.modeDistribution}
      />

      {/* 加载骨架屏 */}
      {phase === "loading" && <LoadingSkeleton />}

      {/* 错误重试 */}
      {phase === "error" && (
        <Card>
          <CardContent className="p-6 space-y-3 text-center">
            <p className="text-sm text-destructive">{errorMsg}</p>
            <Button onClick={fetchNext} variant="outline">
              <RotateCcw className="h-4 w-4 mr-1" />
              重试
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 题目卡片（展示/提交/反馈共用，保持视觉连续） */}
      {current &&
        (phase === "presenting" ||
          phase === "answering" ||
          phase === "feedback") && (
          <Card>
            <CardContent className="p-6 space-y-4">
              <QuestionRenderer
                question={current.question}
                modeId={current.modeId}
                userInput={userInput}
                selectedOption={selectedOption}
                onUserInput={setUserInput}
                onSelectOption={setSelectedOption}
                onSubmit={submitAnswer}
                // 仅在展示阶段可编辑；提交中/反馈中禁用
                disabled={phase !== "presenting"}
                feedback={phase === "feedback" ? lastAnswer : null}
              />
              {phase === "answering" && (
                <div className="flex items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  判定中…
                </div>
              )}
            </CardContent>
          </Card>
        )}

      {/* 反馈面板 */}
      {phase === "feedback" && lastAnswer && (
        <FeedbackPanel
          answer={lastAnswer}
          onNext={goNext}
          durationMs={AUTO_ADVANCE_MS}
        />
      )}

      {/* 底部操作 */}
      <div className="flex justify-between items-center pt-1">
        <Button variant="ghost" size="sm" onClick={endSession}>
          <LogOut className="h-4 w-4 mr-1" />
          结束学习
        </Button>
      </div>
    </div>
  );
}

// ==================== 子组件 ====================

/** 加载骨架屏 */
function LoadingSkeleton() {
  return (
    <Card>
      <CardContent
        className="p-6 space-y-4"
        aria-busy="true"
        aria-live="polite"
      >
        <div className="h-5 w-24 bg-muted rounded animate-pulse" />
        <div className="h-8 w-full bg-muted rounded animate-pulse" />
        <div className="h-12 w-full bg-muted rounded animate-pulse" />
        <div className="h-10 w-full bg-muted rounded animate-pulse" />
      </CardContent>
    </Card>
  );
}

/**
 * 反馈面板
 * - 正确：绿色高亮 + 鼓励语
 * - 错误：红色 + 正确答案 + 解释
 * - 自动下一题进度条（CSS 收缩动画）+ "下一题"按钮
 */
interface FeedbackPanelProps {
  answer: AnswerResponse;
  onNext: () => void;
  /** 自动下一题延时（毫秒），用于进度条动画时长 */
  durationMs: number;
}

function FeedbackPanel({ answer, onNext, durationMs }: FeedbackPanelProps) {
  const correct = answer.correct;

  // 进度条收缩动画：挂载时 100% → 下一帧 0%，transition 控制时长
  const [progress, setProgress] = useState(100);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setProgress(0));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <Card
      className={cn(correct ? "border-green-500" : "border-red-500")}
      aria-live="polite"
    >
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          {correct ? (
            <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
          ) : (
            <XCircle className="h-5 w-5 text-red-600 shrink-0" />
          )}
          <span
            className={cn(
              "font-semibold",
              correct ? "text-green-700" : "text-red-700"
            )}
          >
            {correct ? "答对了！干得漂亮" : "答错了，继续加油"}
          </span>
        </div>

        {/* 错误时显示正确答案（键入模式已在输入框侧展示，这里再强调） */}
        {!correct && (
          <div className="text-sm">
            正确答案：
            <b className="tracking-wide ml-1">{answer.correctAnswer}</b>
          </div>
        )}

        {/* 简要解释（词根/释义/例句，由后端生成） */}
        {answer.explanation && (
          <div className="text-sm text-muted-foreground whitespace-pre-line bg-muted/50 rounded-md p-2">
            {answer.explanation}
          </div>
        )}

        {/* 自动下一题进度条 + 手动按钮 */}
        <div className="space-y-1.5">
          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary"
              style={{
                width: `${progress}%`,
                transition: `width ${durationMs}ms linear`,
              }}
            />
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">
              即将自动进入下一题
            </span>
            <Button onClick={onNext} size="sm">
              下一题
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
