"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect } from "react";
import {
  Bold,
  Italic,
  Strikethrough,
  List,
  ListOrdered,
  Code,
  Quote,
  Link as LinkIcon,
  Undo2,
  Redo2,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { HighlightMark } from "@/lib/editor/highlight-mark";
import { HighlightPalette } from "./highlight-palette";

/**
 * 富文本编辑器组件（基于 Tiptap）
 *
 * 功能：
 *   1. 支持粗体/斜体/删除线/代码 内联格式
 *   2. 支持无序列表/有序列表
 *   3. 支持代码块/引用块
 *   4. 支持超链接
 *   5. 工具栏按钮 + 快捷键
 *   6. 内容以 HTML 字符串形式存储（content 字段）
 *
 * 注意：
 *   - LaTeX 标记 $...$ 在编辑器中作为纯文本保留
 *   - 显示时由 RichCardContent 组件渲染（HTML + LaTeX 混合）
 *   - 编辑器内容变化通过 onUpdate 回调通知父组件
 */

interface RichTextEditorProps {
  /** 当前 HTML 内容 */
  content: string;
  /** 内容变化回调（返回 HTML 字符串） */
  onChange: (html: string) => void;
  /** 占位符文本 */
  placeholder?: string;
  /** 最小高度（px） */
  minHeight?: number;
  /** 自动聚焦 */
  autoFocus?: boolean;
}

/** 工具栏按钮配置 */
interface ToolbarButton {
  icon: typeof Bold;
  title: string;
  action: (editor: ReturnType<typeof useEditor>) => void;
  isActive: (editor: ReturnType<typeof useEditor>) => boolean;
  /** 是否启用 */
  canRun?: (editor: ReturnType<typeof useEditor>) => boolean;
}

/** 工具栏按钮列表（分组） */
const TOOLBAR_GROUPS: ToolbarButton[][] = [
  // 文字格式组
  [
    {
      icon: Bold,
      title: "粗体 (Ctrl+B)",
      action: (ed) => ed?.chain().focus().toggleBold().run(),
      isActive: (ed) => !!ed?.isActive("bold"),
    },
    {
      icon: Italic,
      title: "斜体 (Ctrl+I)",
      action: (ed) => ed?.chain().focus().toggleItalic().run(),
      isActive: (ed) => !!ed?.isActive("italic"),
    },
    {
      icon: Strikethrough,
      title: "删除线",
      action: (ed) => ed?.chain().focus().toggleStrike().run(),
      isActive: (ed) => !!ed?.isActive("strike"),
    },
    {
      icon: Code,
      title: "行内代码",
      action: (ed) => ed?.chain().focus().toggleCode().run(),
      isActive: (ed) => !!ed?.isActive("code"),
    },
  ],
  // 列表组
  [
    {
      icon: List,
      title: "无序列表",
      action: (ed) => ed?.chain().focus().toggleBulletList().run(),
      isActive: (ed) => !!ed?.isActive("bulletList"),
    },
    {
      icon: ListOrdered,
      title: "有序列表",
      action: (ed) => ed?.chain().focus().toggleOrderedList().run(),
      isActive: (ed) => !!ed?.isActive("orderedList"),
    },
    {
      icon: Quote,
      title: "引用块",
      action: (ed) => ed?.chain().focus().toggleBlockquote().run(),
      isActive: (ed) => !!ed?.isActive("blockquote"),
    },
  ],
  // 链接组
  [
    {
      icon: LinkIcon,
      title: "插入链接",
      action: (ed) => {
        if (!ed) return;
        const previousUrl = ed.getAttributes("link").href;
        const url = window.prompt("链接 URL", previousUrl);
        if (url === null) return;
        if (url === "") {
          ed.chain().focus().extendMarkRange("link").unsetLink().run();
          return;
        }
        ed
          .chain()
          .focus()
          .extendMarkRange("link")
          .setLink({ href: url, target: "_blank" })
          .run();
      },
      isActive: (ed) => !!ed?.isActive("link"),
    },
  ],
  // 撤销/重做组
  [
    {
      icon: Undo2,
      title: "撤销 (Ctrl+Z)",
      action: (ed) => ed?.chain().focus().undo().run(),
      isActive: () => false,
      canRun: (ed) => !!ed?.can().undo(),
    },
    {
      icon: Redo2,
      title: "重做 (Ctrl+Y)",
      action: (ed) => ed?.chain().focus().redo().run(),
      isActive: () => false,
      canRun: (ed) => !!ed?.can().redo(),
    },
  ],
];

export function RichTextEditor({
  content,
  onChange,
  placeholder = "输入卡片内容... 支持 LaTeX：$x^2$ 行内，$$\\int$$ 块级",
  minHeight = 120,
  autoFocus = true,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // 启用代码块、引用块、列表等
        heading: false, // 卡片内容较小，不启用标题
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-primary underline underline-offset-2",
        },
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass:
          "is-editor-empty:before:text-muted-foreground/50 before:content-[attr(data-placeholder)] before:absolute before:italic",
      }),
      // 文字高亮（自研 Mark，支持多色 + 调色板）
      HighlightMark,
    ],
    content,
    autofocus: autoFocus,
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML());
    },
    editorProps: {
      attributes: {
        class: cn(
          "tiptap-editor prose prose-sm max-w-none",
          "focus:outline-none",
          "px-2 py-1.5",
          "text-xs leading-relaxed"
        ),
        style: `min-height: ${minHeight}px`,
      },
    },
  });

  // 同步外部 content 变化（仅在编辑器内容与外部不一致时更新）
  // 避免循环更新：仅在 content 真正变化且与编辑器不同步时
  useEffect(() => {
    if (!editor) return;
    const currentHtml = editor.getHTML();
    if (content !== currentHtml) {
      editor.commands.setContent(content, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  // 组件卸载时销毁编辑器
  useEffect(() => {
    return () => {
      editor?.destroy();
    };
  }, [editor]);

  if (!editor) {
    return (
      <div
        className="w-full text-xs bg-muted/30 rounded p-2"
        style={{ minHeight }}
      />
    );
  }

  return (
    <div className="w-full rounded bg-muted/30 border border-input/40 focus-within:ring-1 focus-within:ring-primary">
      {/* 工具栏 */}
      <div className="flex items-center gap-0.5 px-1 py-1 border-b border-border/40 flex-wrap">
        {TOOLBAR_GROUPS.map((group, gi) => (
          <div key={gi} className="flex items-center gap-0.5">
            {gi > 0 && <div className="w-px h-3.5 bg-border mx-0.5" />}
            {group.map((btn, bi) => {
              const Icon = btn.icon;
              const active = btn.isActive(editor);
              const disabled = btn.canRun ? !btn.canRun(editor) : false;
              return (
                <button
                  key={bi}
                  type="button"
                  onClick={() => btn.action(editor)}
                  disabled={disabled}
                  title={btn.title}
                  className={cn(
                    "p-1 rounded transition-colors",
                    active
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    disabled && "opacity-30 cursor-not-allowed"
                  )}
                >
                  <Icon className="w-3 h-3" />
                </button>
              );
            })}
          </div>
        ))}

        {/* 高亮调色板组（插入链接组之后） */}
        <div className="flex items-center gap-0.5">
          <div className="w-px h-3.5 bg-border mx-0.5" />
          <HighlightPalette
            activeColor={editor.getAttributes("highlight").color}
            onApply={(color) => editor.chain().focus().setHighlight(color).run()}
            onClear={() => editor.chain().focus().unsetHighlight().run()}
          />
        </div>
      </div>

      {/* 编辑区 */}
      <EditorContent editor={editor} />
    </div>
  );
}
