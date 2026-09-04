/**
 * 插件/技能系统 — 类型定义
 *
 * 与 manifest JSON 结构一一对应。运行时校验见 manifest.ts（zod schema）。
 */
import type { PluginScope } from "./scopes";

/** HTTP 端点（manifest 中声明，仅用于 capabilities 展示） */
export interface ToolEndpoint {
  /** GET | POST | PUT | PATCH | DELETE */
  method: string;
  /** 站内路径，/api/ 开头 */
  url: string;
}

/** manifest 中的单个工具定义 */
export interface PluginToolManifest {
  /** 工具名（全局唯一，snake_case） */
  name: string;
  /** 工具描述（注入模型的说明文本） */
  description: string;
  /** OpenAI function-calling 参数 JSON Schema */
  parameters: Record<string, unknown>;
  /** HTTP 端点映射 */
  endpoint: ToolEndpoint;
  /** 工具所需权限作用域（必须 ⊆ 插件 permissions） */
  permissions: PluginScope[];
}

/** 完整插件 manifest */
export interface PluginManifest {
  /** 唯一标识（kebab-case） */
  name: string;
  /** 展示名 */
  displayName: string;
  /** 描述 */
  description: string;
  /** semver 版本 */
  version: string;
  /** 作者 */
  author: string;
  /** 插件声明的权限总集 */
  permissions: PluginScope[];
  /** 工具清单（1-32 个） */
  tools: PluginToolManifest[];
}

/** capabilities 聚合结果中的工具条目（OpenAI function-calling 格式） */
export interface AggregatedTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** capabilities 聚合结果中的工具归属说明 */
export interface AggregatedPluginInfo {
  name: string;
  version: string;
  tools: string[];
}

/** 插件调用上下文（authorize 通过后返回） */
export interface PluginCallContext {
  /** 插件注册表 id */
  pluginId: string;
  /** 插件唯一标识名 */
  pluginName: string;
  /** 审计日志来源标识：plugin:<name> */
  auditSource: string;
}
