/**
 * 插件/技能系统 — manifest 校验（zod）
 *
 * 安装/更新插件时对提交的 JSON 清单做结构校验与语义校验：
 *   - 结构：字段类型/长度/格式（schema 定义）
 *   - 语义：工具名插件内唯一、工具权限 ⊆ 插件权限总集、端点必须站内路径
 *     且已在权限登记表（ENDPOINT_SCOPES）登记（审查 S-1：
 *     未登记端点无插件级权限校验，暴露即形成绕过路径）
 *
 * 跨插件工具名冲突需查库，在 service 层安装时校验（此处无 DB 访问）。
 */
import { z } from "zod";
import { ENDPOINT_SCOPES, PLUGIN_SCOPES } from "./scopes";
import type { PluginManifest } from "./types";

// ==================== 基础字段 schema ====================

/** 权限作用域枚举 */
const ScopeSchema = z.enum(PLUGIN_SCOPES);

/** kebab-case 插件名：小写字母开头，段间单连字符（禁尾部/连续连字符） */
const PluginNameSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
    "插件名必须为 kebab-case（如 my-plugin）"
  );

/** snake_case 工具名：小写字母开头，允许小写字母/数字/下划线 */
const ToolNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "工具名必须为 snake_case（如 create_cards）");

/** semver 版本：X.Y.Z */
const SemverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, "版本号必须为 semver 格式（如 1.0.0）");

// ==================== 参数 schema 防护常量（审查 G-4） ====================

/** parameters JSON Schema 序列化后的大小上限（64KB） */
const MAX_PARAMETERS_JSON_LENGTH = 64 * 1024;

/** parameters JSON Schema 的嵌套深度上限（防 stringify 栈溢出） */
const MAX_PARAMETERS_DEPTH = 16;

/**
 * 计算 JSON 值的嵌套深度（对象/数组各计一层，标量为 0）
 * 带深度剪枝：超过上限即提前返回，避免恶意深嵌套导致自身栈溢出
 */
function jsonDepth(value: unknown, depth = 0): number {
  if (depth > MAX_PARAMETERS_DEPTH) return depth;
  if (Array.isArray(value)) {
    return 1 + Math.max(0, ...value.map((v) => jsonDepth(v, depth + 1)));
  }
  if (value && typeof value === "object") {
    return (
      1 +
      Math.max(0, ...Object.values(value as object).map((v) => jsonDepth(v, depth + 1)))
    );
  }
  return 0;
}

// ==================== manifest schema ====================

export const PluginManifestSchema = z
  .object({
    name: PluginNameSchema.min(1).max(64),
    displayName: z.string().min(1).max(100),
    description: z.string().max(500).optional().default(""),
    version: SemverSchema,
    author: z.string().max(100).optional().default(""),
    permissions: z.array(ScopeSchema).min(1, "至少声明一个权限作用域"),
    tools: z
      .array(
        z.object({
          name: ToolNameSchema.min(1).max(64),
          description: z.string().min(1).max(1000),
          // 注意：用 transform 工厂而非 .default({})——zod v3 的 default
          // 每次返回同一实例，多个解析结果会共享可变引用（审查 B-2）
          parameters: z
            .record(z.unknown())
            .optional()
            .transform((v) => v ?? {}),
          endpoint: z.object({
            method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
            // 必须站内 /api/ 路径，禁止外部 URL（防 SSRF 式滥用）
            url: z
              .string()
              .regex(/^\/api\//, "端点必须是 /api/ 开头的站内路径"),
          }),
          permissions: z.array(ScopeSchema).min(1, "工具必须声明所需权限"),
        })
      )
      .min(1, "至少定义一个工具")
      .max(32, "工具数量上限 32"),
  })
  .superRefine((manifest, ctx) => {
    // —— 语义校验 1：工具名插件内唯一（收集全部重复，不提前终止：审查 B-1）——
    const seen = new Set<string>();
    const duplicated = new Set<string>();
    for (const tool of manifest.tools) {
      if (seen.has(tool.name)) duplicated.add(tool.name);
      seen.add(tool.name);
    }
    if (duplicated.size > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tools"],
        message: `工具名重复：${[...duplicated].join(", ")}`,
      });
    }

    // —— 语义校验 2：工具权限 ⊆ 插件权限总集 ——
    const granted = new Set(manifest.permissions);
    for (const tool of manifest.tools) {
      const missing = tool.permissions.filter((p) => !granted.has(p));
      if (missing.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tools"],
          message: `工具 ${tool.name} 所需权限 [${missing.join(", ")}] 未在插件 permissions 中声明`,
        });
      }
    }

    // —— 语义校验 3：端点必须已在权限登记表登记（审查 S-1）——
    // 未登记端点没有插件级权限校验（无 x-plugin-id 语义），暴露即形成
    // 绕过路径（如指向 POST /api/plugins 的注入链）；登记表见 scopes.ts
    const registered = new Set(Object.keys(ENDPOINT_SCOPES));
    for (const tool of manifest.tools) {
      const key = `${tool.endpoint.method} ${tool.endpoint.url}`;
      if (!registered.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tools"],
          message: `工具 ${tool.name} 的端点 ${key} 未在权限登记表中，禁止暴露`,
        });
      }
    }

    // —— 语义校验 4：parameters 大小与深度限制（审查 G-4）——
    for (const tool of manifest.tools) {
      const serialized = JSON.stringify(tool.parameters);
      if (serialized.length > MAX_PARAMETERS_JSON_LENGTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tools"],
          message: `工具 ${tool.name} 的 parameters 过大（${serialized.length} 字节，上限 ${MAX_PARAMETERS_JSON_LENGTH}）`,
        });
        continue; // 超大时跳过深度检查（stringify 已成功，无需重复）
      }
      if (jsonDepth(tool.parameters) > MAX_PARAMETERS_DEPTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tools"],
          message: `工具 ${tool.name} 的 parameters 嵌套深度超过 ${MAX_PARAMETERS_DEPTH} 层`,
        });
      }
    }
  });

// ==================== 解析入口 ====================

/**
 * 解析并校验 manifest JSON
 *
 * @param raw 安装/更新请求提交的原始 JSON 对象
 * @returns 校验通过的规范化 manifest（可选字段已填充默认值）
 * @throws z.ZodError 校验失败（含可读的中文错误信息，路由层转 400 响应）
 */
export function parseManifest(raw: unknown): PluginManifest {
  return PluginManifestSchema.parse(raw) as PluginManifest;
}
