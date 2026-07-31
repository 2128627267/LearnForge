import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/shared/toaster";

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
 * 本地访问令牌自动携带脚本
 *
 * 安全增强（与 middleware.ts 的 LOCAL_ACCESS_TOKEN 校验配合）：
 *   - 页面加载时从 /api/local-token（仅 localhost 可访问）获取访问令牌
 *   - 获取成功后拦截 window.fetch：对同源 /api/* 请求自动附加
 *     x-local-token header，保证配置认证后页面功能不受影响
 *   - 未配置令牌（接口 404）或获取失败时静默跳过，保持默认开放行为
 *
 * 注意：此脚本必须内联在 <head> 中，并在任何数据请求发起前执行。
 */
const localTokenScript = `
(function() {
  try {
    fetch('/api/local-token').then(function(r) {
      if (!r.ok) return null;
      return r.json();
    }).then(function(d) {
      if (!d || !d.token) return;
      var token = d.token;
      var orig = window.fetch;
      window.fetch = function(input, init) {
        init = init || {};
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.indexOf('/api/') !== -1) {
          var headers = new Headers(init.headers || {});
          if (!headers.has('x-local-token')) {
            headers.set('x-local-token', token);
            init.headers = headers;
          }
        }
        return orig.call(this, input, init);
      };
    }).catch(function() {});
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
        {/* 本地访问令牌脚本：配置认证后自动携带 x-local-token（见 middleware.ts） */}
        <script dangerouslySetInnerHTML={{ __html: localTokenScript }} />
      </head>
      <body className={inter.className}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
