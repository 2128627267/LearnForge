/**
 * Tiptap 文字高亮 Mark 扩展（自研）
 *
 * 设计要点：
 * - 存储方式：`<mark data-color="#..." style="background-color: ...">`，
 *   data-color 用于语义化持久化与解析回退，内联样式用于即时渲染
 * - 命令：setHighlight / unsetHighlight / toggleHighlight（支持指定颜色）
 * - 调色板：预设 8 种淡色系 + 自定义取色（颜色由外部调色板组件提供）
 * - 安全：颜色值由 `<input type="color">` 或预设白名单产生，
 *   渲染侧 DOMPurify 白名单需放行 <mark> 与 style 属性（见 rich-card-content）
 */
import { Mark, mergeAttributes } from "@tiptap/core";

/** 预设高亮颜色（淡色系，与整体清新风格一致） */
export const DEFAULT_HIGHLIGHT_COLORS = [
  "#fef08a", // 淡黄
  "#bbf7d0", // 淡绿
  "#bfdbfe", // 淡蓝
  "#e9d5ff", // 淡紫
  "#fed7aa", // 淡橙
  "#fbcfe8", // 淡粉
  "#a5f3fc", // 淡青
  "#fecaca", // 淡红
] as const;

export interface HighlightOptions {
  /** 默认高亮色（未指定颜色时使用） */
  defaultColor: string;
  /** 预设颜色列表（供调色板展示） */
  colors: readonly string[];
}

/** 命令类型声明（Tiptap v2 module augmentation） */
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    highlight: {
      /** 设置高亮（指定颜色） */
      setHighlight: (color?: string) => ReturnType;
      /** 清除高亮 */
      unsetHighlight: () => ReturnType;
      /** 切换高亮（已高亮则清除，否则应用指定颜色） */
      toggleHighlight: (color?: string) => ReturnType;
    };
  }
}

export const HighlightMark = Mark.create<HighlightOptions>({
  name: "highlight",

  addOptions() {
    return {
      defaultColor: DEFAULT_HIGHLIGHT_COLORS[0],
      colors: DEFAULT_HIGHLIGHT_COLORS,
    };
  },

  addAttributes() {
    return {
      color: {
        // 无颜色时不渲染属性（空 mark 标记）
        default: null,
        // 解析：优先 data-color，回退内联样式背景色（兼容手工 HTML）
        parseHTML: (element) =>
          element.getAttribute("data-color") ||
          element.style.backgroundColor ||
          null,
        // 渲染：同时输出语义属性与内联样式，保证持久化与即时显示
        renderHTML: (attributes) => {
          if (!attributes.color) return {};
          return {
            "data-color": attributes.color,
            style: `background-color: ${attributes.color}`,
          };
        },
      },
    };
  },

  // 匹配 <mark> 标签（含已有高亮的存量内容）
  parseHTML() {
    return [{ tag: "mark" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["mark", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setHighlight:
        (color) =>
        ({ commands }) =>
          commands.setMark(this.name, {
            color: color ?? this.options.defaultColor,
          }),
      unsetHighlight:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
      toggleHighlight:
        (color) =>
        ({ commands }) =>
          commands.toggleMark(this.name, {
            color: color ?? this.options.defaultColor,
          }),
    };
  },
});
