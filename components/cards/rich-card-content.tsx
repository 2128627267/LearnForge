"use client";

import { useMemo } from "react";
import { MathContent } from "@/components/math/katex-renderer";
import katex from "katex";
import DOMPurify from "dompurify";

/**
 * 富文本卡片内容渲染组件
 *
 * 设计目的：
 *   兼容三种内容格式：
 *     1. 纯文本（含 LaTeX 标记 $...$ / $$...$$） → 用 MathContent 渲染
 *     2. HTML 字符串（来自 Tiptap 编辑器） → DOMPurify 净化后解析 LaTeX 再用 dangerouslySetInnerHTML
 *     3. 空字符串 → 显示占位提示
 *
 * HTML 中 LaTeX 的处理：
 *   - 用正则匹配 $$...$$（块级）和 $...$（行内）
 *   - 调用 katex.renderToString 转换为 HTML
 *   - 注入到原 HTML 字符串中
 *   - 整体用 dangerouslySetInnerHTML 渲染
 *
 * 安全性（S5 修复，防 XSS）：
 *   - 渲染前先用 DOMPurify.sanitize 净化 HTML，移除 <script>、事件属性
 *     （onerror/onclick 等）、javascript: 协议等危险内容
 *   - LaTeX 部分由 katex.renderToString 生成（内置转义，无 trust）
 *   - 净化后 HTML 来自 Tiptap（用户输入）与 AI 生成内容、导入的数据包，
 *     净化可阻断恶意脚本执行
 *   - 纯文本路径（无 HTML 标签）由 MathContent 转义处理，天然安全
 */

/** 净化器：统一配置，只净化一次（DOMPurify 是客户端库） */
let sanitizer: ((html: string) => string) | null = null;
function getSanitizer(): (html: string) => string {
  if (!sanitizer) {
    sanitizer = (html: string) =>
      DOMPurify.sanitize(html, {
        ALLOWED_TAGS: [...SANITIZE_ALLOW_LIST],
        // 链接仅允许 http/https/mailto（阻断 javascript: 等危险协议）
        ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
      }) as string;
  }
  return sanitizer;
}

/** 允许保留的标签白名单（Tiptap 输出所需；脚本/事件属性/危险协议均被移除） */
const SANITIZE_ALLOW_LIST = [
  "p", "br", "strong", "b", "em", "i", "s", "strike", "u",
  "ul", "ol", "li", "blockquote", "code", "pre", "a", "span", "div", "h1", "h2", "h3",
] as const;

interface RichCardContentProps {
  /** 卡片内容（纯文本或 HTML 字符串） */
  content: string;
  /** 最大行数（用于截断显示，默认 8） */
  maxLines?: number;
  /** 占位提示文本 */
  placeholder?: string;
  /** 是否显示空内容提示 */
  showPlaceholder?: boolean;
  /** 自定义类名 */
  className?: string;
}

/**
 * 检测字符串是否包含 HTML 标签
 * 简单匹配 <tag>...</tag> 或自闭合标签
 */
function hasHtmlTag(s: string): boolean {
  return /<[a-z][\s\S]*?>/i.test(s);
}

/**
 * 将 HTML 字符串中的 LaTeX 标记替换为 KaTeX 渲染的 HTML
 *
 * 处理顺序：
 *   1. 先处理 $$...$$（块级，避免被 $...$ 误匹配）
 *   2. 再处理 $...$（行内）
 *
 * 注意：仅在 HTML 标签外的文本中替换
 *       但为简化实现，全文替换（katex 渲染结果为 span，不会破坏 HTML 结构）
 */
function renderMathInHtml(html: string): string {
  // 块级 $$...$$
  let result = html.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr: string) => {
    try {
      return katex.renderToString(expr.trim(), {
        displayMode: true,
        throwOnError: false,
      });
    } catch {
      return `<code>$${expr}$</code>`;
    }
  });
  // 行内 $...$
  result = result.replace(/\$([^\$\n]+?)\$/g, (_, expr: string) => {
    try {
      return katex.renderToString(expr.trim(), {
        displayMode: false,
        throwOnError: false,
      });
    } catch {
      return `<code>${expr}</code>`;
    }
  });
  return result;
}

export function RichCardContent({
  content,
  maxLines = 8,
  placeholder = "点击编辑添加内容",
  showPlaceholder = true,
  className,
}: RichCardContentProps) {
  /**
   * 渲染逻辑：
   *   - 空内容 → 占位提示
   *   - 纯文本（无 HTML 标签） → MathContent（保留 LaTeX 支持）
   *   - HTML 字符串 → 解析 LaTeX 后用 dangerouslySetInnerHTML
   */
  const rendered = useMemo(() => {
    if (!content || !content.trim()) return null;
    if (!hasHtmlTag(content)) {
      // 纯文本：用 MathContent 渲染（支持 LaTeX）
      return <MathContent text={content} />;
    }
    // HTML：先净化（防 XSS），再渲染 LaTeX，最后注入
    const sanitized = getSanitizer()(content);
    const html = renderMathInHtml(sanitized);
    return (
      <div
        className="rich-content prose prose-sm max-w-none"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }, [content]);

  if (!rendered) {
    if (!showPlaceholder) return null;
    return (
      <span className={className ?? "text-muted-foreground italic"}>
        {placeholder}
      </span>
    );
  }

  // 限制最大高度（line-clamp）
  if (maxLines > 0) {
    return (
      <div
        className={className ?? "text-xs overflow-hidden text-foreground/90"}
        style={{
          maxHeight: `${maxLines * 1.5}rem`,
          overflow: "hidden",
        }}
      >
        {rendered}
      </div>
    );
  }
  return <div className={className}>{rendered}</div>;
}

/**
 * 静态渲染函数（供 SSR 或导出时使用）
 * 不依赖 React 渲染上下文
 */
export function renderCardContentToHtml(content: string): string {
  if (!content) return "";
  if (!hasHtmlTag(content)) {
    // 纯文本：转义 HTML 字符，再渲染 LaTeX
    const escaped = content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return renderMathInHtml(escaped).replace(/\n/g, "<br/>");
  }
  return renderMathInHtml(content);
}
