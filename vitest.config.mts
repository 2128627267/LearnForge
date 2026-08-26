import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Vitest 测试配置（LearnForge）
 *
 * - 环境：jsdom（DOM / React 组件测试）
 * - 插件：@vitejs/plugin-react（JSX/TSX 编译支持）
 * - 别名：与 tsconfig paths 保持一致（@/ → 项目根目录）
 * - 测试文件：显式 import（globals: false），保证类型安全
 * - 覆盖率：v8 provider，范围锁定 lib/ 核心逻辑（目标 ≥80%）
 *
 * 注意：文件必须使用 .mts 扩展名（明确 ESM）——
 * Vite 8 的 native configLoader 会将无 type:module 包内的 .ts 配置
 * 按 CommonJS 解析，导致配置对象与测试 worker 断连，
 * 表现为所有用例在收集阶段报 "Cannot read properties of undefined (reading 'config')"。
 */
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * Node 25+ 原生 globalThis.localStorage（无 --localstorage-file 时求值为 undefined
 * 并发出 ExperimentalWarning）会占住 key，导致 Vitest 4 jsdom 环境跳过复制
 * jsdom 的 Storage 实现，window.localStorage 变为 undefined（vitest#10867）。
 * 传 --no-webstorage 关闭 Node 侧全局即可恢复；低版本 Node 不支持该参数需守卫。
 */
const nodeMajor = Number(process.versions.node.split(".")[0]);
const execArgv = nodeMajor >= 25 ? ["--no-webstorage"] : [];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": projectRoot,
    },
  },
  test: {
    environment: "jsdom",
    execArgv,
    /**
     * pool 固化为 vmThreads（worker 线程 + VM 上下文复用）：
     * 受限环境（如沙箱终端）下 forks pool 的多进程并发会触发死锁——
     * 文件数超过 4 时进程静默退出（exit 0 且无结果输出），vmThreads 可稳定跑完全量。
     * 注意：VM 上下文不注入 Node 原生全局，依赖 crypto 等全局的用例需在测试内自行 stub。
     */
    pool: "vmThreads",
    globals: false,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    coverage: {
      // istanbul 纯插桩不依赖 V8 inspector——受限环境下 v8 provider 会使运行静默挂起
      provider: "istanbul",
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
