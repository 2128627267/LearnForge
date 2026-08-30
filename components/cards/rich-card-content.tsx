"use client";

import { useEffect, useMemo, useState } from "react";
import { MathContent } from "@/components/math/katex-renderer";
import { getKatexSync, loadKatex } from "@/components/math/katex-renderer";

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
 *
 * 性能（P1 优化）：
 *   - KaTeX / DOMPurify 均为惰性加载：仅当内容为 HTML 或含 $ 公式标记时
 *     才按需下载对应库；纯文本卡片完全不需要重型依赖
 *   - 重型依赖就绪前以转义文本渲染（安全降级，加载完成自动刷新）
 */

type SanitizeModule = typeof import("@/lib/editor/sanitize");

let sanitizerPromise: Promise<SanitizeModule> | null = null;
let sanitizerMod: SanitizeModule | null = null;

/** 惰性加载净化模块（单例，并发调用共享同一 Promise；DOMPurify 不进主包） */
function loadSanitizer(): Promise<SanitizeModule> {
  if (sanitizerMod) return Promise.resolve(sanitizerMod);
  if (!sanitizerPromise) {
    sanitizerPromise = import("@/lib/editor/sanitize").then((m) => {
      sanitizerMod = m;
      return m;
    });
  }
  return sanitizerPromise;
}

/** 净化 HTML（净化模块未就绪时返回转义文本作为安全降级） */
function sanitizeHtml(html: string): string {
  if (!sanitizerMod) return escapeHtml(html);
  return sanitizerMod.sanitizeCardContent(html);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

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
  const katex = getKatexSync();
  // 块级 $$...$$
  let result = html.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr: string) => {
    try {
      if (!katex) return `<code>$$${expr}$$</code>`;
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
      if (!katex) return `<code>${expr}</code>`;
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
   *
   * 重型依赖（DOMPurify / KaTeX）按需加载：
   *   - 内容为 HTML 或含 $ 公式标记时才触发加载
   *   - 就绪前以转义文本渲染（安全，不阻塞首屏）
   */
  const isHtml = useMemo(() => {
    if (!content || !content.trim()) return false;
    return hasHtmlTag(content);
  }, [content]);

  const needsHeavy = useMemo(
    () => (isHtml || content.includes("$")) && !!content && !!content.trim(),
    [content, isHtml]
  );

  const [heavyReady, setHeavyReady] = useState(false);

  useEffect(() => {
    if (!needsHeavy) return;
    let cancelled = false;
    Promise.all([loadSanitizer(), loadKatex()])
      .then(() => {
        if (!cancelled) setHeavyReady(true);
      })
      .catch(() => {
        // 加载失败：保持转义文本降级，不阻塞渲染
      });
    return () => {
      cancelled = true;
    };
  }, [needsHeavy]);

  const rendered = useMemo(() => {
    if (!content || !content.trim()) return null;
    if (!isHtml) {
      // 纯文本：用 MathContent 渲染（支持 LaTeX，内部自行惰性加载）
      return <MathContent text={content} />;
    }
    if (!heavyReady) {
      // 安全降级：DOMPurify/KaTeX 未就绪，仅显示转义文本
      return (
        <div className="rich-content prose prose-sm max-w-none">
          {escapeHtml(content).replace(/\n/g, "<br/>")}
        </div>
      );
    }
    // HTML：先净化（防 XSS），再渲染 LaTeX，最后注入
    const sanitized = sanitizeHtml(content);
    const html = renderMathInHtml(sanitized);
    return (
      <div
        className="rich-content prose prose-sm max-w-none"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }, [content, isHtml, heavyReady]);

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

