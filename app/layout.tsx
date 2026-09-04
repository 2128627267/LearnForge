import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/shared/toaster";
import { tokenBootstrapScript } from "@/lib/auth/token-bootstrap";

const inter = Inter({ subsets: ["latin"] });

/**
 * 应用元数据
 * 遵循 LearnForge 品牌定位
 */
export const metadata: Metadata = {
  title: {
    default: "LearnForge - AI 赋能的学习工具",
    template: "%s | LearnForge",
  },
  description: "便签卡片式知识点管理、可视化学习路线图、AI 智能学习辅助",
};

/**
 * 主题初始化内联脚本
 *
 * 在 React 渲染前同步执行，根据 localStorage 或系统偏好添加 .dark 类，
 * 避免页面加载时出现主题闪烁（FOUC）。
 *
 * 优先级：localStorage("learnforge-theme") > prefers-color-scheme > 默认亮色
 *
 * 注意：此脚本必须内联在 <head> 中，且不使用外部模块，
 * 以确保在任何 React 组件挂载前完成主题应用。
 */
const themeInitScript = `
(function() {
  try {
    var stored = localStorage.getItem('learnforge-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var shouldDark = stored === 'dark' || (!stored && prefersDark);
    if (shouldDark) {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
})();
`;

/**
 * 根布局
 * - 设置字体、主题变量
 * - 全局 Toaster 用于消息提示
 * - 内联主题脚本防止 FOUC
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 主题初始化脚本：在渲染前应用保存的主题，防止闪烁 */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {/* 访问令牌引导脚本：本机自动获取 / 局域网手动输入，自动携带 x-local-token（见 lib/auth/token-bootstrap.ts） */}
        <script dangerouslySetInnerHTML={{ __html: tokenBootstrapScript }} />
      </head>
      <body className={inter.className}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
