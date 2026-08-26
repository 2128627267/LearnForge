"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  MODE_META,
  type AnswerResponse,
  type LearnModeId,
  type QuestionData,
} from "@/lib/learning/types";

/**
 * 题目渲染器
 *
 * 设计依据：.doc/WORD_LEARNING_DESIGN.md §4.3 / §4.4
 *
 * 职责：根据 QuestionData.modeId 分派到对应视图，渲染
 *   - 主展示文本（prompt）
 *   - 对照锚点（anchor，"必有对照"约束）
 *   - 答案输入/选项
 *   - 反馈高亮（feedback 非 null 时）
 *
 * modeId 说明：
 *   1 缺失单词句子：挖空句 + 整句中文翻译 + 键入
 *   2 缺失字母拼写：maskedWord + 音标/英文释义 + 键入
 *   3 看释义拼写：中文释义 + 词性 + 键入
 *   4 ABCD 选择：挖空句 + 句意参考 + 选项点击
 *   5 听写（预留）：兜底键入视图
 */
export interface QuestionRendererProps {
  /** 题目数据 */
  question: QuestionData;
  /** 考查方式 */
  modeId: LearnModeId;
  /** 键入模式：用户已输入文本 */
  userInput: string;
  /** 选择模式：用户已选选项 */
  selectedOption: string | null;
  /** 键入文本变更 */
  onUserInput: (v: string) => void;
  /** 选择选项变更 */
  onSelectOption: (v: string) => void;
  /** 提交答案 */
  onSubmit: () => void;
  /** true 时禁用输入（提交中/反馈中） */
  disabled: boolean;
  /** 反馈结果，非 null 时高亮正误并隐藏提交按钮 */
  feedback: AnswerResponse | null;
}

/** 题目渲染器入口：按 modeId 分派 */
export function QuestionRenderer(props: QuestionRendererProps) {
  const { question, modeId } = props;
  const modeName = MODE_META[modeId]?.name ?? `模式 ${modeId}`;

  return (
    <div className="space-y-4">
      {/* 顶部：考查方式标签 + 单词长度提示 */}
      <div className="flex items-center justify-between">
        <Badge variant="secondary">{modeName}</Badge>
        {question.wordLength ? (
          <span className="text-xs text-muted-foreground">
            单词长度 {question.wordLength}
          </span>
        ) : null}
      </div>

      {modeId === 1 && <SentenceGapView {...props} />}
      {modeId === 2 && <LetterGapView {...props} />}
      {modeId === 3 && <MeaningSpellView {...props} />}
      {modeId === 4 && <MultiChoiceView {...props} />}
      {(modeId as number) === 5 && <GenericSpellView {...props} />}
    </div>
  );
}

// ==================== 通用子组件 ====================

/** 主展示文本块 */
function PromptBlock({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("text-lg font-medium leading-relaxed", className)}>
      {children}
    </div>
  );
}

/** 对照锚点块（"必有对照"约束的视觉呈现） */
function AnchorBlock({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="text-sm text-muted-foreground bg-muted/40 rounded-md p-2">
      <span className="text-xs font-medium mr-1">{label}：</span>
      {children}
    </div>
  );
}

/**
 * 将文本中的连续下划线 ___ 高亮为块状占位符。
 * 用于 modeId=1/4 的挖空句子展示。
 */
function highlightGap(text: string): ReactNode {
  if (!text) return null;
  // 按下划线分组拆分，保留分隔符
  const parts = text.split(/(_+)/);
  return parts.map((p, i) =>
    /_+/.test(p) ? (
      <span
        key={i}
        className="inline-block mx-1 px-2 py-0.5 rounded bg-primary/15 text-primary font-mono align-baseline"
      >
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

/**
 * 键入型答案输入框（modeId 1/2/3 共用）
 *
 * 特性：
 *   - 自动聚焦（进入可编辑状态时）
 *   - Enter 提交
 *   - 实时显示已输入字母数 / wordLength
 *   - 反馈阶段：正误高亮（绿/红边框与底色），错误时显示正确答案
 */
interface AnswerInputProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  wordLength?: number;
  feedback: AnswerResponse | null;
}

function AnswerInput({
  value,
  onChange,
  onSubmit,
  disabled,
  wordLength,
  feedback,
}: AnswerInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // 进入可编辑状态时自动聚焦（disabled 由 true→false 时触发）
  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  // 反馈状态：correct / wrong / idle
  const state = feedback ? (feedback.correct ? "correct" : "wrong") : "idle";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !disabled) onSubmit();
          }}
          disabled={disabled}
          placeholder={wordLength ? `请输入 ${wordLength} 个字母` : "请输入答案"}
          aria-label="答案输入框"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className={cn(
            state === "correct" &&
              "border-green-500 bg-green-50 text-green-800 dark:bg-green-950/50 dark:text-green-300",
            state === "wrong" &&
              "border-red-500 bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-300"
          )}
        />
        {wordLength ? (
          <span
            className="text-xs text-muted-foreground tabular-nums whitespace-nowrap"
            aria-hidden
          >
            {value.length}/{wordLength}
          </span>
        ) : null}
      </div>

      {/* 反馈前：提交按钮；反馈后：正误提示 */}
      {!feedback ? (
        <Button
          onClick={onSubmit}
          disabled={disabled || !value.trim()}
          className="w-full"
          size="lg"
        >
          {disabled ? "提交中…" : "提交答案 (Enter)"}
        </Button>
      ) : !feedback.correct ? (
        <div className="text-sm text-red-700">
          正确答案：
          <b className="tracking-wide ml-1">{feedback.correctAnswer}</b>
        </div>
      ) : null}
    </div>
  );
}

// ==================== 各 modeId 视图 ====================

/**
 * modeId=1：缺失单词句子
 * - prompt：挖空句子（___ 高亮）
 * - anchor.translation：整句中文翻译（对照）
 * - anchor.meaningInContext：此单词在此句中的具体释义（多义词支持）
 * - 键入缺失单词
 *
 * 修复说明：
 *   - 新增 meaningInContext 展示，解决单词多义时与句子释义对不上的问题
 *   - 仅当 meaningInContext 存在且与 translation 不同时才显示，避免重复
 */
function SentenceGapView(props: QuestionRendererProps) {
  const { question, userInput, onUserInput, onSubmit, disabled, feedback } = props;
  const { translation, meaningInContext } = question.anchor;
  // 仅当 meaningInContext 与 translation 不同时才单独展示（避免重复）
  const showMeaningInContext =
    meaningInContext && meaningInContext !== translation;

  return (
    <>
      <PromptBlock>{highlightGap(question.prompt)}</PromptBlock>
      {translation ? (
        <AnchorBlock label="整句翻译">
          {translation}
        </AnchorBlock>
      ) : null}
      {showMeaningInContext ? (
        <AnchorBlock label="此句中释义">
          <span className="text-primary font-medium">{meaningInContext}</span>
        </AnchorBlock>
      ) : null}
      <AnswerInput
        value={userInput}
        onChange={onUserInput}
        onSubmit={onSubmit}
        disabled={disabled}
        wordLength={question.wordLength}
        feedback={feedback}
      />
    </>
  );
}

/**
 * modeId=2：缺失字母拼写
 * - prompt / maskedWord：挖字母后的单词（等宽大字展示）
 * - anchor.phonetic / anchor.meaning：音标或英文释义（对照）
 * - 分段渲染：可见字母 + 缺失位输入框合并为一行，仅填缺失部分
 *
 * 优化说明（S1）：
 *   - 旧实现要求用户输入完整单词，体验不佳
 *   - 新实现基于 maskedSegments 分段渲染，缺失位显示输入框
 *   - 用户只填缺失字母，前端重构完整单词后传给父组件
 *   - 服务端仍与 card.title 比对，无需修改后端
 *   - 支持：自动聚焦首位、输入后自动跳到下一格、Backspace 回退、Enter 提交
 *   - 反馈阶段：正确显示绿色、错误显示红色并展示正确答案
 */
function LetterGapView(props: QuestionRendererProps) {
  const { question, onUserInput, onSubmit, disabled, feedback } = props;
  const { phonetic, meaning } = question.anchor;
  const segments = question.maskedSegments;
  const missingAnswer = question.missingAnswer ?? "";

  // 无分段数据时回退到旧的整词输入模式（兼容旧题目）
  if (!segments || segments.length === 0) {
    return <LetterGapFallback {...props} />;
  }

  return (
    <LetterGapSegmented
      segments={segments}
      missingAnswer={missingAnswer}
      phonetic={phonetic}
      meaning={meaning}
      onUserInput={onUserInput}
      onSubmit={onSubmit}
      disabled={disabled}
      feedback={feedback}
      questionKey={question.maskedWord ?? question.prompt}
    />
  );
}

/** 旧版整词输入回退视图（无 maskedSegments 时使用） */
function LetterGapFallback(props: QuestionRendererProps) {
  const { question, userInput, onUserInput, onSubmit, disabled, feedback } = props;
  const { phonetic, meaning } = question.anchor;
  return (
    <>
      <PromptBlock className="text-center font-mono text-3xl tracking-[0.3em]">
        {question.maskedWord ?? question.prompt}
      </PromptBlock>
      {phonetic ? (
        <AnchorBlock label="音标">{phonetic}</AnchorBlock>
      ) : null}
      {meaning ? (
        <AnchorBlock label="英文释义">{meaning}</AnchorBlock>
      ) : null}
      <AnswerInput
        value={userInput}
        onChange={onUserInput}
        onSubmit={onSubmit}
        disabled={disabled}
        wordLength={question.wordLength}
        feedback={feedback}
      />
    </>
  );
}

/** 分段缺失字母输入视图的 Props */
interface LetterGapSegmentedProps {
  segments: Array<{ char: string; masked: boolean }>;
  missingAnswer: string;
  phonetic?: string;
  meaning?: string;
  onUserInput: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  feedback: AnswerResponse | null;
  /** 题目标识，变化时重置输入 */
  questionKey: string;
}

/**
 * 分段缺失字母输入视图
 * - 渲染：可见字符 + 缺失位输入框，合并为一行
 * - 输入：每个缺失位一个单字符输入框，仅填缺失字母
 * - 同步：本地 gapInputs → 重构完整单词 → onUserInput 传给父组件
 * - 反馈：正确绿色 / 错误红色，并显示正确答案
 */
function LetterGapSegmented({
  segments,
  missingAnswer,
  phonetic,
  meaning,
  onUserInput,
  onSubmit,
  disabled,
  feedback,
  questionKey,
}: LetterGapSegmentedProps) {
  // 缺失位数量
  const gapCount = useMemo(
    () => segments.filter((s) => s.masked).length,
    [segments]
  );

  // 每个缺失位的输入值（单字符）
  const [gapInputs, setGapInputs] = useState<string[]>(() =>
    Array.from({ length: gapCount }, () => "")
  );

  // 输入框引用数组（用于自动聚焦与跳转）
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // 题目切换时重置输入
  useEffect(() => {
    setGapInputs(Array.from({ length: gapCount }, () => ""));
    // 聚焦第一个输入框
    requestAnimationFrame(() => {
      inputRefs.current[0]?.focus();
    });
  }, [questionKey, gapCount]);

  // 缺失位索引 → 段索引的映射
  const gapToSegIndex = useMemo(() => {
    const map: number[] = [];
    segments.forEach((s, i) => {
      if (s.masked) map.push(i);
    });
    return map;
  }, [segments]);

  // 重构完整单词并同步给父组件
  // 策略：可见位用 segments.char，缺失位用 gapInputs 填充
  useEffect(() => {
    const reconstructed = segments
      .map((seg, i) => {
        if (seg.masked) {
          const gapIdx = gapToSegIndex.indexOf(i);
          return gapInputs[gapIdx] ?? "";
        }
        return seg.char;
      })
      .join("");
    onUserInput(reconstructed);
    // 仅在 gapInputs 变化时同步（onUserInput 来自 useState setter，引用稳定）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gapInputs]);

  // 处理单个缺失位输入
  const handleGapChange = (gapIdx: number, raw: string) => {
    // 仅取最后一个字符（避免粘贴多字符）
    const char = raw.slice(-1);
    setGapInputs((prev) => {
      const next = [...prev];
      next[gapIdx] = char;
      return next;
    });
    // 输入后自动跳到下一格
    if (char && gapIdx < gapCount - 1) {
      requestAnimationFrame(() => {
        inputRefs.current[gapIdx + 1]?.focus();
      });
    }
  };

  // 键盘事件：Backspace 回退 + Enter 提交
  const handleKeyDown = (gapIdx: number, e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !gapInputs[gapIdx] && gapIdx > 0) {
      // 当前格为空时 Backspace → 聚焦上一格
      e.preventDefault();
      inputRefs.current[gapIdx - 1]?.focus();
    } else if (e.key === "Enter" && !disabled) {
      e.preventDefault();
      onSubmit();
    }
  };

  // 反馈阶段：每个缺失位的正误状态
  const feedbackState = feedback
    ? feedback.correct
      ? "correct"
      : "wrong"
    : "idle";

  // 渲染段：可见字符用 span，缺失位用 input
  let gapCounter = 0;

  return (
    <>
      {/* 合并一行：可见字符 + 缺失位输入框 */}
      <div
        className="flex items-center justify-center gap-0.5 font-mono text-3xl my-6 flex-wrap"
        role="group"
        aria-label="缺失字母拼写"
      >
        {segments.map((seg, i) => {
          if (seg.masked) {
            const myGapIdx = gapCounter++;
            const userChar = gapInputs[myGapIdx] ?? "";
            const correctChar = missingAnswer[myGapIdx] ?? "";

            // 反馈阶段：显示正确字母（绿色=对，红色=错）
            // 非反馈阶段：显示用户输入
            const displayValue = feedback ? correctChar : userChar;

            return (
              <input
                key={i}
                ref={(el) => {
                  inputRefs.current[myGapIdx] = el;
                }}
                value={displayValue}
                onChange={(e) => handleGapChange(myGapIdx, e.target.value)}
                onKeyDown={(e) => handleKeyDown(myGapIdx, e)}
                disabled={disabled || !!feedback}
                maxLength={1}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label={`第 ${myGapIdx + 1} 个缺失字母`}
                className={cn(
                  "w-10 h-12 text-center border-b-2 outline-none transition-colors bg-transparent",
                  feedback
                    ? feedbackState === "correct"
                      ? "border-green-500 text-green-700"
                      : "border-red-500 text-red-700"
                    : "border-primary/50 focus:border-primary focus:bg-primary/5"
                )}
              />
            );
          }
          // 可见字符
          return (
            <span key={i} className="px-0.5 leading-none">
              {seg.char}
            </span>
          );
        })}
      </div>

      {/* 对照锚点 */}
      {phonetic ? <AnchorBlock label="音标">{phonetic}</AnchorBlock> : null}
      {meaning ? <AnchorBlock label="英文释义">{meaning}</AnchorBlock> : null}

      {/* 提交按钮 / 反馈提示 */}
      {!feedback ? (
        <Button
          onClick={onSubmit}
          disabled={disabled || gapInputs.filter((v) => v).length < gapCount}
          className="w-full"
          size="lg"
        >
          {disabled ? "提交中…" : "提交答案 (Enter)"}
        </Button>
      ) : !feedback.correct ? (
        <div className="text-sm text-red-700">
          正确答案：
          <b className="tracking-wide ml-1">{feedback.correctAnswer}</b>
        </div>
      ) : null}
    </>
  );
}

/**
 * modeId=3：看释义拼写
 * - prompt：中文释义
 * - anchor.partOfSpeech：词性（Badge 展示，对照）
 * - 键入英文单词
 */
function MeaningSpellView(props: QuestionRendererProps) {
  const { question, userInput, onUserInput, onSubmit, disabled, feedback } = props;
  return (
    <>
      <PromptBlock className="text-center">{question.prompt}</PromptBlock>
      {question.anchor.partOfSpeech ? (
        <div className="text-center">
          <Badge variant="outline">{question.anchor.partOfSpeech}</Badge>
        </div>
      ) : null}
      <AnswerInput
        value={userInput}
        onChange={onUserInput}
        onSubmit={onSubmit}
        disabled={disabled}
        wordLength={question.wordLength}
        feedback={feedback}
      />
    </>
  );
}

/**
 * modeId=4：ABCD 选择
 * - prompt：挖空句子（___ 高亮），即句子语境
 * - anchor.translation：句意参考（中文，不泄露英文答案）
 *   注：不展示 anchor.sentence（API 中为含答案的完整句，会泄露）
 * - 4 个选项按钮，点击选择
 */
function MultiChoiceView(props: QuestionRendererProps) {
  const {
    question,
    selectedOption,
    onSelectOption,
    onSubmit,
    disabled,
    feedback,
  } = props;
  const options = question.options ?? [];
  const labels = ["A", "B", "C", "D", "E", "F"];

  return (
    <>
      <PromptBlock>{highlightGap(question.prompt)}</PromptBlock>
      {question.anchor.translation ? (
        <AnchorBlock label="句意参考">
          {question.anchor.translation}
        </AnchorBlock>
      ) : null}

      {/* 选项列表：移动端单列，桌面端两列；触摸目标 ≥44px */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" aria-label="选项列表">
        {options.map((opt, i) => {
          const isSelected = selectedOption === opt;
          const isCorrectOpt = feedback?.correctAnswer === opt;
          // 反馈阶段：正确选项绿色，用户选错的选项红色
          const showCorrect = feedback && isCorrectOpt;
          const showWrong = feedback && isSelected && !isCorrectOpt;
          return (
            <button
              key={opt}
              type="button"
              disabled={disabled}
              onClick={() => onSelectOption(opt)}
              aria-label={`选项 ${labels[i]}：${opt}`}
              aria-pressed={isSelected}
              className={cn(
                "flex items-center gap-2 min-h-[44px] px-3 py-2 rounded-md border text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                !feedback && isSelected && "border-primary bg-primary/10",
                !feedback && !isSelected && "border-input hover:bg-accent",
                showCorrect &&
                  "border-green-500 bg-green-50 text-green-800 dark:bg-green-950/50 dark:text-green-300",
                showWrong &&
                  "border-red-500 bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-300",
                disabled && !feedback && "opacity-60 cursor-not-allowed"
              )}
            >
              <span className="font-semibold text-muted-foreground w-5 shrink-0">
                {labels[i]}
              </span>
              <span className="font-medium">{opt}</span>
            </button>
          );
        })}
      </div>

      {!feedback ? (
        <Button
          onClick={onSubmit}
          disabled={disabled || !selectedOption}
          className="w-full"
          size="lg"
        >
          {disabled ? "提交中…" : "提交答案"}
        </Button>
      ) : null}
    </>
  );
}

/**
 * 兜底视图（modeId=5 听写预留或未知 modeId）
 * 仅展示 prompt + 键入框，最低限度可用。
 */
function GenericSpellView(props: QuestionRendererProps) {
  const { question, userInput, onUserInput, onSubmit, disabled, feedback } = props;
  return (
    <>
      <PromptBlock className="text-center">{question.prompt}</PromptBlock>
      <AnswerInput
        value={userInput}
        onChange={onUserInput}
        onSubmit={onSubmit}
        disabled={disabled}
        wordLength={question.wordLength}
        feedback={feedback}
      />
    </>
  );
}
