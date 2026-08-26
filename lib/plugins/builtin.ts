/**
 * 插件/技能系统 — 内置插件定义
 *
 * builtin-canvas：复用 /api/ai/capabilities 原硬编码的 4 个工具
 * （create_cards_batch / connect_cards / get_canvas / list_cards），
 * 迁移即搬运、不改语义，保证既有消费者（演示脚本/外部 Agent）无感。
 *
 * source=builtin：不可删除、不可改名；可启停（禁用后工具从 capabilities 消失）。
 */
import type { PluginManifest } from "./types";

/** 内置画布插件的唯一标识名 */
export const BUILTIN_PLUGIN_NAME = "builtin-canvas";

/** 内置插件 manifest（由 ensureBuiltinPlugins 幂等写入注册表） */
export const BUILTIN_CANVAS_MANIFEST: PluginManifest = {
  name: BUILTIN_PLUGIN_NAME,
  displayName: "画布核心工具",
  description: "LearnForge 画布读写核心工具集：批量建卡、连线、读取画布与卡片查询。",
  version: "1.0.0",
  author: "LearnForge",
  permissions: ["cards:read", "cards:write", "canvas:read", "canvas:write"],
  tools: [
    {
      name: "create_cards_batch",
      description:
        "批量添加知识点卡片到学习画布，并可选配置任意连线关系（节点间关联）。连线两端支持本批次索引（0、1...）或画布已有节点 id。",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            description: "要创建的卡片列表",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "可选，自定义节点 id（重复则跳过）" },
                title: { type: "string", description: "卡片标题（必填）" },
                content: { type: "string", description: "卡片内容，支持 Markdown" },
                tags: { type: "array", items: { type: "string" }, description: "标签数组" },
                color: { type: "string", description: "卡片主题色（hex）" },
                position: {
                  type: "object",
                  properties: { x: { type: "number" }, y: { type: "number" } },
                  description: "画布坐标（可选，缺省自动排布）",
                },
                learningMode: { type: "string", description: "学习模式：deep | review | both" },
                cardType: {
                  type: "string",
                  description: "卡片类型：concept | word | phrase | math | code | general",
                },
                favorite: { type: "boolean" },
              },
              required: ["title"],
            },
          },
          relations: {
            type: "array",
            description: "可选，连线关系。source/target 为本批次索引（如 0、1）或画布已有节点 id",
            items: {
              type: "object",
              properties: {
                source: { type: "string", description: "起点：批次索引或节点 id" },
                target: { type: "string", description: "终点：批次索引或节点 id" },
                label: { type: "string", description: "关系标签（如 延伸拓展、派生）" },
              },
              required: ["source", "target"],
            },
          },
        },
        required: ["items"],
      },
      endpoint: { method: "POST", url: "/api/cards/batch" },
      permissions: ["cards:write", "canvas:write"],
    },
    {
      name: "connect_cards",
      description:
        "在画布已有节点之间创建连线（关联关系）。重复连线自动跳过，自环拒绝。",
      parameters: {
        type: "object",
        properties: {
          relations: {
            type: "array",
            description: "连线列表，source/target 必须是画布中已存在的节点 id",
            items: {
              type: "object",
              properties: {
                source: { type: "string" },
                target: { type: "string" },
                label: { type: "string", description: "关系标签" },
              },
              required: ["source", "target"],
            },
          },
        },
        required: ["relations"],
      },
      endpoint: { method: "POST", url: "/api/cards/connect" },
      permissions: ["canvas:write"],
    },
    {
      name: "get_canvas",
      description: "读取学习画布最新状态：所有节点（标题/内容/标签/位置）与连线关系。",
      parameters: {
        type: "object",
        properties: {},
      },
      endpoint: { method: "GET", url: "/api/canvas-layout" },
      permissions: ["canvas:read"],
    },
    {
      name: "list_cards",
      description: "查询知识库卡片列表（支持搜索、类型、标签、收藏过滤）。",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "标题/内容关键词" },
          type: { type: "string", description: "卡片类型" },
          limit: { type: "number", description: "返回数量上限" },
        },
      },
      endpoint: { method: "GET", url: "/api/cards" },
      permissions: ["cards:read"],
    },
  ],
};
