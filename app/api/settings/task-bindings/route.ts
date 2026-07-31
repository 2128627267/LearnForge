/**
 * 任务绑定 CRUD API
 * GET  /api/settings/task-bindings        - 列出所有任务绑定
 * PUT  /api/settings/task-bindings        - 批量更新任务绑定（upsert by taskType）
 *
 * 设计要点：
 *   - 每个 taskType 仅一条绑定（@unique 约束）
 *   - PUT 采用 upsert 语义：存在则更新，不存在则创建
 *   - 支持批量更新：请求体为数组时批量 upsert
 *
 * 任务类型（taskType）：
 *   - chat: AI 对话/问答
 *   - embedding: 向量嵌入
 *   - tts: 语音合成
 *   - stt: 语音识别
 *   - image_gen: 图片生成
 *   - image_recognize: 图片识别
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getLogger } from "@/lib/utils/logger";

const logger = getLogger("TaskBindingsAPI");

export const dynamic = "force-dynamic";

// ==================== 类型定义 ====================

/** 允许的任务类型 */
const ALLOWED_TASK_TYPES = [
  "chat",
  "embedding",
  "tts",
  "stt",
  "image_gen",
  "image_recognize",
] as const;

/** 任务类型 */
type TaskType = (typeof ALLOWED_TASK_TYPES)[number];

/** 任务绑定 DTO */
export interface AITaskBindingDTO {
  id: string;
  taskType: string;
  primaryModelId: string;
  /** 主模型摘要（便于前端展示） */
  primaryModel?: {
    id: string;
    name: string;
    category: string;
    provider: string;
    modelName: string;
  };
  fallbackModelId: string | null;
  /** 备用模型摘要 */
  fallbackModel?: {
    id: string;
    name: string;
    category: string;
    provider: string;
    modelName: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

/** 更新请求体 */
interface UpdateBindingInput {
  taskType: string;
  primaryModelId: string;
  fallbackModelId?: string | null;
}

// ==================== 工具函数 ====================

/**
 * 将数据库记录（含关联模型）转换为 DTO
 */
function toDTO(record: {
  id: string;
  taskType: string;
  primaryModelId: string;
  fallbackModelId: string | null;
  createdAt: Date;
  updatedAt: Date;
  primaryModel: {
    id: string;
    name: string;
    category: string;
    provider: string;
    modelName: string;
  };
  fallbackModel: {
    id: string;
    name: string;
    category: string;
    provider: string;
    modelName: string;
  } | null;
}): AITaskBindingDTO {
  return {
    id: record.id,
    taskType: record.taskType,
    primaryModelId: record.primaryModelId,
    primaryModel: record.primaryModel
      ? {
          id: record.primaryModel.id,
          name: record.primaryModel.name,
          category: record.primaryModel.category,
          provider: record.primaryModel.provider,
          modelName: record.primaryModel.modelName,
        }
      : undefined,
    fallbackModelId: record.fallbackModelId,
    fallbackModel: record.fallbackModel
      ? {
          id: record.fallbackModel.id,
          name: record.fallbackModel.name,
          category: record.fallbackModel.category,
          provider: record.fallbackModel.provider,
          modelName: record.fallbackModel.modelName,
        }
      : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

// ==================== 路由处理 ====================

/**
 * GET /api/settings/task-bindings
 *
 * 返回所有任务绑定，包含关联的模型信息
 */
export async function GET() {
  try {
    const records = await prisma.aITaskBinding.findMany({
      include: {
        primaryModel: {
          select: {
            id: true,
            name: true,
            category: true,
            provider: true,
            modelName: true,
          },
        },
        fallbackModel: {
          select: {
            id: true,
            name: true,
            category: true,
            provider: true,
            modelName: true,
          },
        },
      },
      orderBy: { taskType: "asc" },
    });

    return NextResponse.json({
      items: records.map(toDTO),
      total: records.length,
    });
  } catch (err) {
    logger.error("读取任务绑定列表失败", { error: String(err) });
    return NextResponse.json(
      { error: "读取任务绑定列表失败", detail: String(err) },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/settings/task-bindings
 *
 * 批量更新任务绑定（upsert by taskType）
 *
 * 请求体：
 *   - 单个对象：更新一条绑定
 *   - 数组：批量更新多条绑定
 *
 * 每个对象字段：
 *   - taskType:         任务类型（必填）
 *   - primaryModelId:   主模型 ID（必填）
 *   - fallbackModelId:  备用模型 ID（可选，传 null 清除）
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    // 支持单个对象或数组
    const inputs: UpdateBindingInput[] = Array.isArray(body) ? body : [body];

    // 校验所有输入
    for (const input of inputs) {
      if (!input.taskType || typeof input.taskType !== "string") {
        return NextResponse.json(
          { error: "taskType 必填且必须为字符串" },
          { status: 400 }
        );
      }
      if (!ALLOWED_TASK_TYPES.includes(input.taskType as TaskType)) {
        return NextResponse.json(
          {
            error: `taskType 取值非法，允许值：${ALLOWED_TASK_TYPES.join(", ")}`,
          },
          { status: 400 }
        );
      }
      if (!input.primaryModelId || typeof input.primaryModelId !== "string") {
        return NextResponse.json(
          { error: "primaryModelId 必填且必须为字符串" },
          { status: 400 }
        );
      }
    }

    // 验证所有引用的模型配置存在
    const allModelIds = new Set<string>();
    for (const input of inputs) {
      allModelIds.add(input.primaryModelId);
      if (input.fallbackModelId) {
        allModelIds.add(input.fallbackModelId);
      }
    }
    const existingModels = await prisma.aIModelConfig.findMany({
      where: { id: { in: Array.from(allModelIds) } },
      select: { id: true },
    });
    const existingModelIds = new Set(existingModels.map((m) => m.id));
    for (const input of inputs) {
      if (!existingModelIds.has(input.primaryModelId)) {
        return NextResponse.json(
          { error: `主模型 ID ${input.primaryModelId} 不存在` },
          { status: 400 }
        );
      }
      if (input.fallbackModelId && !existingModelIds.has(input.fallbackModelId)) {
        return NextResponse.json(
          { error: `备用模型 ID ${input.fallbackModelId} 不存在` },
          { status: 400 }
        );
      }
    }

    // 批量 upsert
    const results = await Promise.all(
      inputs.map((input) =>
        prisma.aITaskBinding.upsert({
          where: { taskType: input.taskType },
          update: {
            primaryModelId: input.primaryModelId,
            fallbackModelId: input.fallbackModelId ?? null,
          },
          create: {
            taskType: input.taskType,
            primaryModelId: input.primaryModelId,
            fallbackModelId: input.fallbackModelId ?? null,
          },
          include: {
            primaryModel: {
              select: {
                id: true,
                name: true,
                category: true,
                provider: true,
                modelName: true,
              },
            },
            fallbackModel: {
              select: {
                id: true,
                name: true,
                category: true,
                provider: true,
                modelName: true,
              },
            },
          },
        })
      )
    );

    logger.info("更新任务绑定", { count: results.length });

    return NextResponse.json({
      items: results.map(toDTO),
      total: results.length,
    });
  } catch (err) {
    logger.error("更新任务绑定失败", { error: String(err) });
    return NextResponse.json(
      { error: "更新任务绑定失败", detail: String(err) },
      { status: 500 }
    );
  }
}
