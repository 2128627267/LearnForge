/**
 * Tiptap 高亮 Mark 扩展测试（配置级）
 *
 * 说明：直接验证扩展的序列化契约（renderHTML/parseHTML/命令暴露），
 * 不创建完整 Editor（避免 jsdom 下 ProseMirror 兼容性问题）。
 */
import { describe, it, expect } from "vitest";
import {
  HighlightMark,
  DEFAULT_HIGHLIGHT_COLORS,
} from "@/lib/editor/highlight-mark";

/** 宽松访问扩展配置（Mark.config 为 Tiptap 公开属性） */
const config = HighlightMark.config as unknown as {
  addAttributes: () => Record<
    string,
    {
      default: unknown;
      parseHTML: (el: {
        getAttribute: (n: string) => string | null;
        style: { backgroundColor?: string };
      }) => unknown;
      renderHTML: (attrs: Record<string, unknown>) => Record<string, unknown>;
    }
  >;
  addOptions: () => { defaultColor: string; colors: readonly string[] };
  parseHTML: () => { tag: string }[];
  renderHTML: (props: { HTMLAttributes: Record<string, unknown> }) => [string, Record<string, unknown>, number];
  addCommands: () => Record<string, unknown>;
};

describe("HighlightMark（Tiptap 高亮扩展）", () => {
  it("renderHTML 输出 data-color 与内联背景色", () => {
    const attrs = config.addAttributes();
    expect(attrs.color.renderHTML({ color: "#fef08a" })).toEqual({
      "data-color": "#fef08a",
      style: "background-color: #fef08a",
    });
  });

  it("renderHTML 无颜色时不输出任何属性", () => {
    const attrs = config.addAttributes();
    expect(attrs.color.renderHTML({ color: null })).toEqual({});
  });

  it("parseHTML 优先读取 data-color", () => {
    const attrs = config.addAttributes();
    const el = {
      getAttribute: (n: string) => (n === "data-color" ? "#bbf7d0" : null),
      style: { backgroundColor: "rgb(153, 153, 153)" },
    };
    expect(attrs.color.parseHTML(el)).toBe("#bbf7d0");
  });

  it("parseHTML 无 data-color 时回退内联样式背景色", () => {
    const attrs = config.addAttributes();
    const el = {
      getAttribute: () => null,
      style: { backgroundColor: "rgb(187, 247, 208)" },
    };
    expect(attrs.color.parseHTML(el)).toBe("rgb(187, 247, 208)");
  });

  it("parseHTML 匹配 mark 标签", () => {
    expect(config.parseHTML()).toEqual([{ tag: "mark" }]);
  });

  it("renderHTML 生成 mark 元素", () => {
    const [tag, attrs] = config.renderHTML({ HTMLAttributes: { "data-color": "#fef08a" } });
    expect(tag).toBe("mark");
    expect(attrs).toEqual({ "data-color": "#fef08a" });
  });

  it("默认调色板包含 8 种预设色且无重复", () => {
    expect(DEFAULT_HIGHLIGHT_COLORS).toHaveLength(8);
    expect(new Set(DEFAULT_HIGHLIGHT_COLORS).size).toBe(8);
  });

  it("默认选项使用调色板首个颜色", () => {
    const opts = config.addOptions();
    expect(opts.defaultColor).toBe(DEFAULT_HIGHLIGHT_COLORS[0]);
    expect(opts.colors).toEqual(DEFAULT_HIGHLIGHT_COLORS);
  });

  it("addCommands 暴露 set/unset/toggle 三个命令", () => {
    const commands = config.addCommands();
    expect(typeof commands.setHighlight).toBe("function");
    expect(typeof commands.unsetHighlight).toBe("function");
    expect(typeof commands.toggleHighlight).toBe("function");
  });
});
