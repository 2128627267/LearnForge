"use client";

import { usePathname } from "next/navigation";
import { MainNav } from "@/components/shared/main-nav";

/**
 * 主应用布局（带导航栏）
 *
 * 根据页面类型自适应：
 * - 画布页（/canvas）：全屏布局，不限制宽度与内边距
 * - 其他页面：保留 container py-6 内边距
 */
export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // 画布与时间线页面需要全屏，不受 container 限制
  // 精确匹配 /canvas 或 /canvas/ 开头（W9 修复：避免匹配 /canvas-xxx）
  // 时间线页同为水平滚动全屏交互（左选择器 + 时间轴 + AI 输入栏）
  const isFullBleed =
    pathname === "/canvas" ||
    pathname?.startsWith("/canvas/") ||
    pathname === "/timeline" ||
    pathname?.startsWith("/timeline/");

  // 画布页面需要固定视口高度（h-screen），让 flex-1 的 main 有确定高度，
  // 子元素 h-full 才能正确引用（React Flow 需要父容器有明确宽高）
  // 其他页面用 min-h-screen，允许内容超出视口时滚动
  const rootClassName = isFullBleed
    ? "h-screen bg-background flex flex-col overflow-hidden"
    : "min-h-screen bg-background flex flex-col";

  return (
    <div className={rootClassName}>
      <MainNav />
      <main
        className={
          isFullBleed
            ? "flex-1 overflow-hidden min-h-0"
            : "container py-6 flex-1"
        }
      >
        {children}
      </main>
    </div>
  );
}
