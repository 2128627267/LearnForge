import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * Vitest 测试配置（LearnForge）
 *
 * - 环境：jsdom（DOM / React 组件测试）
 * - 插件：@vitejs/plugin-react（JSX/TSX 编译支持）
 * - 别名：与 tsconfig paths 保持一致（@/ → 项目根目录）
 * - 测试文件：显式 import（globals: false），保证类型安全
 * - 覆盖率：v8 provider，范围锁定 lib/ 核心逻辑（目标 ≥80%）
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // 覆盖率统计范围：lib/ 核心逻辑（算法/学习引擎/服务/工具/编解码/配置/画布/同步）
      include: ["lib/**/*.{ts,tsx}"],
      // 排除：数据库薄包装层、类型声明文件
      exclude: ["lib/db/**", "lib/**/*.test.{ts,tsx}", "lib/**/*.d.ts"],
      // 覆盖率目标：语句/行/函数 ≥80%，分支 ≥70%
      thresholds: {
        statements: 80,
        lines: 80,
        functions: 80,
        branches: 70,
      },
    },
  },
});
