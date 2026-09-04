/**
 * 富文本内容安全净化模块（可独立测试）
 *
 * 从 rich-card-content 中抽离的 DOMPurify 净化逻辑，便于单元测试与复用。
 * 安全约束：
 * - 仅放行富文本所需的标签白名单（script/事件属性/危险协议一律移除）
 * - 内联 style 仅允许 mark 元素上的纯 background-color（高亮颜色）
 *   —— 避免全局放行 style 导致的 CSS 注入面（远程背景图追踪、UI 覆盖钓鱼等）
 *
 * 注意：rich-card-content 通过动态 import 本模块以保持惰性加载（DOMPurify
 * 不会进入主包）。
 */
import DOMPurify from "dompurify";

/** 允许保留的标签白名单（Tiptap 输出所需；脚本/事件属性/危险协议均被移除） */
export const SANITIZE_ALLOW_LIST = [
  "p", "br", "strong", "b", "em", "i", "s", "strike", "u",
  "ul", "ol", "li", "blockquote", "code", "pre", "a", "span", "div", "h1", "h2", "h3",
  "mark", // 文字高亮（颜色存于 data-color 与内联 style）
] as const;

/** 注册防重标志：确保钩子只注册一次（模块单例） */
let hookRegistered = false;

/**
 * 注册净化钩子：将内联 style 收窄为「仅 mark 元素上的纯 background-color」。
 * 其余标签的 style 一律剔除，阻断 CSS 注入面。
 */
function ensureSanitizeHook(): void {
  if (hookRegistered) return;
  hookRegistered = true;
  DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
    // 只处理 style 属性
    if (data.attrName !== "style") return;
    // 仅 mark 元素允许内联样式（tagName 为全大写，需忽略大小写比较）
    if ((node.tagName ?? "").toLowerCase() !== "mark") {
      data.keepAttr = false;
      return;
    }
    // 仅允许纯 background-color 声明（拒绝 position/url() 等其他 CSS）
    const value = data.attrValue || "";
    if (!/^\s*background-color\s*:\s*[^;{}]+;?\s*$/i.test(value)) {
      data.keepAttr = false;
    }
  });
}

/**
 * 净化富文本 HTML（防 XSS）
 *
 * - 移除 script、事件属性（onerror/onclick 等）、javascript: 协议
 * - 保留 <mark data-color style="background-color"> 高亮标记
 * - 其余标签的 style 一律剔除
 */
export function sanitizeCardContent(html: string): string {
  ensureSanitizeHook();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...SANITIZE_ALLOW_LIST],
    // 放行内联样式（配合上面的钩子收窄到 mark 的 background-color）
    ADD_ATTR: ["style"],
    // 链接仅允许 http/https/mailto（阻断 javascript: 等危险协议）
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
  }) as string;
}
