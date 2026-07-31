"use client";

import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

/**
 * KaTeX 数学公式渲染组件
 * 支持行内公式（$...$）和块级公式（$$...$$）
 *
 * 用法：
 * <MathContent text="求 $x^2 + 2x + 1 = 0$ 的根" />
 * <MathContent text="$$\\int_0^1 x^2 dx = \\frac{1}{3}$$" block />
 */

interface MathContentProps {
  /** 含 LaTeX 的文本（支持 $...$ 行内和 $$...$$ 块级混合） */
  text: string;
  /** 是否强制块级渲染（整段作为公式） */
  block?: boolean;
  /** className */
  className?: string;
}

/**
 * 渲染单个 LaTeX 公式为 HTML
 *
 * 安全策略（S4 修复）：
 * - 不使用 trust: true，禁用 \href、\url 等可能引入 XSS 的命令
 * - strict: false 仅放宽语法检查，不影响安全策略
 * - throwOnError: false 错误降级为红色文本，不抛出异常
 */
function renderFormula(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      errorColor: "#dc2626",
      strict: false,
    });
  } catch {
    return `<span style="color:#dc2626">${escapeHtml(tex)}</span>`;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * 将含 LaTeX 的文本解析为 HTML
 * 支持：$$...$$ 块级、$...$ 行内
 */
function parseAndRender(text: string): string {
  // 先处理块级 $$...$$
  const blockParts = text.split(/\$\$([\s\S]+?)\$\$/g);
  let html = "";
  blockParts.forEach((part, i) => {
    if (i % 2 === 1) {
      // 奇数索引 = 公式内容
      html += renderFormula(part, true);
    } else {
      // 偶数索引 = 普通文本，处理行内 $...$
      const inlineParts = part.split(/\$([^$\n]+?)\$/g);
      inlineParts.forEach((inlinePart, j) => {
        if (j % 2 === 1) {
          html += renderFormula(inlinePart, false);
        } else {
          html += escapeHtml(inlinePart).replace(/\n/g, "<br/>");
        }
      });
    }
  });
  return html;
}

export function MathContent({ text, block, className }: MathContentProps) {
  const html = useMemo(() => {
    if (block) {
      // 强制块级渲染整段
      return renderFormula(text, true);
    }
    return parseAndRender(text);
  }, [text, block]);

  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * 数学公式实时预览组件
 * 左侧编辑、右侧预览（或上下布局）
 */
export function MathPreview({
  value,
  onChange,
  placeholder = "输入公式，支持 $...$ 行内和 $$...$$ 块级...",
  rows = 4,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <div className="space-y-2">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {value.trim() && (
        <div className="rounded-md border bg-muted/30 p-3 min-h-[2rem] overflow-x-auto">
          <MathContent text={value} />
        </div>
      )}
    </div>
  );
}
