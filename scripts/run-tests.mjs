/**
 * LearnForge 测试运行器（Node 包装脚本）
 *
 * 用途：
 *   在受限制的沙箱/终端环境下可靠地运行 Vitest，并将结果写入 test-result.json。
 *
 * 背景：
 *   Vitest（Vite 7 原生配置加载器）默认使用系统临时目录（如 H:\TEMP）创建
 *   临时文件；在受限环境（沙箱禁写系统 TEMP）会抛出 EPERM。本脚本将
 *   TEMP/TMP/TMPDIR 统一重定向到项目内 `.tmp/` 目录，保证可写。
 *
 * 用法：
 *   node scripts/run-tests.mjs
 *
 * 输出：
 *   - 测试结果写入 <项目根>/test-result.json（Vitest JSON 报告器）
 *   - 退出码：0 = 全部通过，非 0 = 存在失败
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 项目根目录（脚本位于 scripts/ 下）
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 项目内临时目录（避免使用系统 TEMP）
const tmpDir = path.join(root, ".tmp");
mkdirSync(tmpDir, { recursive: true });

// 覆盖系统临时目录环境变量（子进程继承）
const env = {
  ...process.env,
  TEMP: tmpDir,
  TMP: tmpDir,
  TMPDIR: tmpDir,
};

// 生成测试结果文件路径
const resultFile = path.join(root, "test-result.json");

// 执行 Vitest（CLI：JSON 报告器输出到文件，兼顾 stdout 可能丢失的情况）
// 捕获 stdout/stderr 以便在结果文件缺失时排查原因
const res = spawnSync(
  process.execPath,
  [
    path.join(root, "node_modules/vitest/vitest.mjs"),
    "run",
    "--reporter=json",
    `--outputFile=${resultFile}`,
  ],
  {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  }
);

// 将子进程输出写入日志文件（便于诊断；同步写入避免 process.exit 截断）
writeFileSync(path.join(root, "test-run.stdout.log"), res.stdout?.toString() ?? "");
writeFileSync(path.join(root, "test-run.stderr.log"), res.stderr?.toString() ?? "");

// 以子进程退出码作为脚本退出码
process.exit(res.status ?? 1);
