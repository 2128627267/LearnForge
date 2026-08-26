/**
 * AI 能力清单 API（面向模型/Agent 的工具发现端点）
 * GET /api/ai/capabilities
 *
 * 返回 LearnForge 画布可被外部模型调用的工具定义（OpenAI function-calling
 * 风格 JSON Schema）。任何支持 tool-use 的客户端（opencode / Claude /
 * 自定义 Agent）读取本清单即可像使用 skill/MCP/plugin 一样接入：
 *
 *   - create_cards_batch  批量添加卡片（含任意连线关系）
 *   - connect_cards       已有节点之间连线
 *   - get_canvas          读取画布最新状态（节点/连线/标签）
 *   - list_cards          查询知识库卡片
 *
 * 所有工具使用 baseUrl 下的 HTTP 端点，无需浏览器。
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** 工具定义（OpenAI function-calling 格式） */
const TOOLS = [
  {
    type: "function",
    function: {
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
            description:
              "可选，连线关系。source/target 为本批次索引（如 0、1）或画布已有节点 id",
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
    },
  },
  {
    type: "function",
    function: {
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
    },
  },
  {
    type: "function",
    function: {
      name: "get_canvas",
      description: "读取学习画布最新状态：所有节点（标题/内容/标签/位置）与连线关系。",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
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
    },
  },
];

/** 端点映射（供客户端按名称路由请求） */
const ENDPOINTS: Record<string, { method: string; url: string }> = {
  create_cards_batch: { method: "POST", url: "/api/cards/batch" },
  connect_cards: { method: "POST", url: "/api/cards/connect" },
  get_canvas: { method: "GET", url: "/api/canvas-layout" },
  list_cards: { method: "GET", url: "/api/cards" },
};

export async function GET() {
  return NextResponse.json({
    name: "learnforge-canvas",
    description:
      "LearnForge 学习画布能力接入（类 skill/MCP/plugin）。调用方式：将工具定义注入模型，按 ENDPOINTS 路由 HTTP 请求。",
    version: "1.0",
    protocol: "openai-function-tools",
    baseUrl: "/api",
    tools: TOOLS,
    endpoints: ENDPOINTS,
  });
}
