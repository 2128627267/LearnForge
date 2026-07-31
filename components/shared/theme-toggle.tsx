"use client";

import { useState, useEffect, useCallback } from "react";
import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * 主题切换按钮
 *
 * 功能：
 * - 在亮色/暗色主题之间切换
 * - 通过 localStorage 持久化用户偏好（key: "learnforge-theme"）
 * - 在 <html> 元素上切换 .dark 类
 * - 遵循系统偏好（prefers-color-scheme: dark）作为默认值
 *
 * 防 hydration 不匹配：
 * - 初始渲染使用占位（避免服务端/客户端不一致）
 * - 挂载后从 localStorage 或系统偏好读取实际主题
 * - 通过 mounted 状态确保只在客户端执行 DOM 操作
 */
export function ThemeToggle() {
  // 当前是否为暗色主题（null 表示尚未挂载，用于避免 hydration 不匹配）
  const [isDark, setIsDark] = useState<boolean | null>(null);
  // 组件是否已挂载（避免服务端渲染时读取 localStorage）
  const [mounted, setMounted] = useState(false);

  /**
   * 应用主题到 <html> 元素
   * - dark: 添加 .dark 类
   * - light: 移除 .dark 类
   */
  const applyTheme = useCallback((dark: boolean) => {
    const root = document.documentElement;
    if (dark) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, []);

  /**
   * 读取初始主题（挂载时执行）
   * 优先级：localStorage > 系统偏好 > 默认亮色
   */
  useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem("learnforge-theme");
      if (stored === "dark") {
        setIsDark(true);
        applyTheme(true);
      } else if (stored === "light") {
        setIsDark(false);
        applyTheme(false);
      } else {
        // 未存储过，跟随系统偏好
        const prefersDark = window.matchMedia(
          "(prefers-color-scheme: dark)"
        ).matches;
        setIsDark(prefersDark);
        applyTheme(prefersDark);
      }
    } catch {
      // localStorage 不可用时回退到亮色
      setIsDark(false);
      applyTheme(false);
    }
  }, [applyTheme]);

  /**
   * 切换主题
   * - 切换 isDark 状态
   * - 应用到 DOM
   * - 持久化到 localStorage
   */
  const toggleTheme = useCallback(() => {
    if (isDark === null) return;
    const next = !isDark;
    setIsDark(next);
    applyTheme(next);
    try {
      localStorage.setItem("learnforge-theme", next ? "dark" : "light");
    } catch {
      // localStorage 不可用时静默失败
    }
  }, [isDark, applyTheme]);

  // 未挂载时渲染占位按钮（避免 hydration 不匹配）
  if (!mounted || isDark === null) {
    return (
      <button
        className="p-1.5 rounded-md w-9 h-9"
        aria-label="切换主题"
        disabled
      />
    );
  }

  return (
    <button
      onClick={toggleTheme}
      className={cn(
        "p-1.5 rounded-md w-9 h-9",
        "flex items-center justify-center",
        "text-muted-foreground hover:text-foreground hover:bg-accent",
        "transition-colors"
      )}
      title={isDark ? "切换到亮色模式" : "切换到暗色模式"}
      aria-label={isDark ? "切换到亮色模式" : "切换到暗色模式"}
    >
      {/* 暗色模式显示太阳图标（点击切换到亮色），亮色模式显示月亮图标（点击切换到暗色） */}
      {isDark ? (
        <Sun className="w-4 h-4" />
      ) : (
        <Moon className="w-4 h-4" />
      )}
    </button>
  );
}
