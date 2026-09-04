/**
 * 环境变量解析库测试
 *
 * 覆盖：
 * - 直接值解析
 * - ${ENV_VAR} 环境变量引用（含未设置回退）
 * - file:// 协议（禁用时跳过）
 * - 客户端解析（不允许 file://）
 * - 探测与判定辅助函数
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveValue,
  resolveValueClient,
  resolveModelConfig,
  listAvailableEnvVars,
  isEnvVarReference,
  isFileLink,
  needsResolution,
} from "@/lib/config/env-resolver";

describe("resolveValue（配置值解析）", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // 重置环境变量，避免测试间污染
    process.env = { ...originalEnv };
    delete process.env.TEST_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("直接值原样返回", () => {
    expect(resolveValue("sk-abc123")).toBe("sk-abc123");
  });

  it("空值返回空字符串", () => {
    expect(resolveValue("")).toBe("");
    expect(resolveValue(undefined as unknown as string)).toBe("");
  });

  it("${ENV_VAR} 语法读取环境变量", () => {
    process.env.TEST_API_KEY = "real-key-here";
    expect(resolveValue("${TEST_API_KEY}")).toBe("real-key-here");
  });

  it("环境变量未设置时返回空字符串", () => {
    expect(resolveValue("${TEST_API_KEY}")).toBe("");
  });

  it("环境变量未设置且 fallbackToRaw 时返回原值", () => {
    expect(resolveValue("${TEST_API_KEY}", { fallbackToRaw: true })).toBe(
      "${TEST_API_KEY}"
    );
  });

  it("file:// 协议在禁用时跳过", () => {
    expect(
      resolveValue("file://C:/keys/secret.txt", { allowFileProtocol: false })
    ).toBe("");
  });

  it("非法环境变量引用语法不被解析（如带后缀）", () => {
    // 非完整 ${VAR} 形式的占位符不匹配 ENV_VAR_PATTERN，原样返回
    expect(resolveValue("prefix-${TEST_API_KEY}")).toBe(
      "prefix-${TEST_API_KEY}"
    );
  });
});

describe("resolveValueClient（客户端解析）", () => {
  it("不支持 file:// 协议，保留原值", () => {
    expect(resolveValueClient("file://C:/keys/a.txt")).toBe(
      "file://C:/keys/a.txt"
    );
  });

  it("支持 ${ENV_VAR} 语法", () => {
    process.env.NEXT_PUBLIC_TEST_VAR = "pub-value";
    expect(resolveValueClient("${NEXT_PUBLIC_TEST_VAR}")).toBe("pub-value");
  });
});

describe("resolveModelConfig（模型配置解析）", () => {
  it("解析 apiKey 与 apiUrl", () => {
    process.env.MODEL_KEY = "k-123";
    const cfg = { id: "x", apiKey: "${MODEL_KEY}", apiUrl: "https://api.test/v1" };
    const resolved = resolveModelConfig(cfg);
    expect(resolved.apiKey).toBe("k-123");
    expect(resolved.apiUrl).toBe("https://api.test/v1");
    // 不修改原对象
    expect(cfg.apiKey).toBe("${MODEL_KEY}");
  });
});

describe("listAvailableEnvVars（环境变量探测）", () => {
  it("过滤 npm_/NODE_/下划线前缀并按前缀过滤", () => {
    process.env = {
      NODE_ENV: "test",
      npm_config_registry: "x",
      _hidden: "y",
      OPENAI_KEY: "a",
      OTHER_KEY: "b",
    } as NodeJS.ProcessEnv;
    const keys = listAvailableEnvVars("OPENAI_");
    expect(keys).toEqual(["OPENAI_KEY"]);
  });
});

describe("判定辅助函数", () => {
  it("isEnvVarReference 识别 ${VAR}", () => {
    expect(isEnvVarReference("${A_KEY}")).toBe(true);
    expect(isEnvVarReference("plain")).toBe(false);
    expect(isEnvVarReference("")).toBe(false);
  });

  it("isFileLink 识别 file://", () => {
    expect(isFileLink("file://C:/a.txt")).toBe(true);
    expect(isFileLink("https://x")).toBe(false);
  });

  it("needsResolution 组合判定", () => {
    expect(needsResolution("${A}")).toBe(true);
    expect(needsResolution("file://a")).toBe(true);
    expect(needsResolution("plain")).toBe(false);
  });
});
