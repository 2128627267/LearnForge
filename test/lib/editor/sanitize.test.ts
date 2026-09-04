/**
 * 富文本净化模块测试（DOMPurify 净化契约）
 *
 * 覆盖：
 * - 高亮 mark 的 data-color / background-color 被保留
 * - script / 事件属性 / javascript: 协议被移除
 * - 非 mark 标签的 style 被剔除（CSS 注入面收窄）
 */
import { describe, it, expect } from "vitest";
import { sanitizeCardContent } from "@/lib/editor/sanitize";

describe("sanitizeCardContent（富文本净化契约）", () => {
  it("保留高亮 mark 的 data-color 与 background-color 样式", () => {
    const out = sanitizeCardContent(
      '<p><mark data-color="#fef08a" style="background-color: #fef08a;">hi</mark></p>'
    );
    expect(out).toContain("<mark");
    expect(out).toContain('data-color="#fef08a"');
    expect(out).toContain("background-color");
  });

  it("移除 script 标签", () => {
    const out = sanitizeCardContent("<p>ok</p><script>alert(1)</script>");
    expect(out).not.toContain("<script");
    expect(out).toContain("ok");
  });

  it("移除事件属性（onclick/onerror）", () => {
    const out = sanitizeCardContent(
      '<p onclick="evil()" onerror="x">hi</p>'
    );
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("onerror");
    expect(out).toContain("hi");
  });

  it("阻断 javascript: 协议链接", () => {
    const out = sanitizeCardContent(
      '<a href="javascript:alert(1)">x</a>'
    );
    expect(out).not.toContain("javascript:");
  });

  it("非 mark 标签的 style 被剔除（CSS 注入面收窄）", () => {
    const out = sanitizeCardContent(
      '<div style="position:fixed;background-image:url(https://evil/track)">x</div>'
    );
    expect(out).not.toContain("position");
    expect(out).not.toContain("background-image");
  });

  it("mark 上含危险 CSS 的 style 被整体剔除", () => {
    const out = sanitizeCardContent(
      '<mark style="position:fixed;background-color:#fef08a">x</mark>'
    );
    expect(out).not.toContain("position");
  });
});
