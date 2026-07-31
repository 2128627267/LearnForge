"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { ThemeToggle } from "@/components/shared/theme-toggle";

/**
 * 主导航栏
 * 页面重组说明：
 *   - AI 问答合并至画布（卡片对话框内提问，支持模型选择）
 *   - 删除卡片库/复习/路线图/英语独立页（功能收敛到画布与学习）
 *   - 导入、编解码器为工具页，通过 /import、/tools/codec 直接访问
 */
const navItems = [
  { href: "/stats", label: "统计", icon: "📊" },
  { href: "/canvas", label: "画布", icon: "🎨" },
  { href: "/learn", label: "学习", icon: "📚" },
  { href: "/settings", label: "设置", icon: "⚙️" },
];

export function MainNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center">
        <Link href="/" className="mr-6 flex items-center space-x-2">
          <span className="font-bold text-lg">LearnForge</span>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            AI 学习工具
          </span>
        </Link>

        <nav className="flex items-center space-x-1 lg:space-x-2 overflow-x-auto">
          {navItems.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
              >
                <span className="mr-1">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center space-x-2">
          {/* 主题切换按钮：亮色/暗色模式切换 */}
          <ThemeToggle />
          <Link
            href="/canvas"
            className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
          >
            + 打开画布
          </Link>
        </div>
      </div>
    </header>
  );
}
