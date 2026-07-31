/**
 * 模型配置单条操作 API
 * PUT    /api/settings/models/:id  - 更新模型配置
 * DELETE /api/settings/models/:id  - 删除模型配置
 *
 * 删除约束：
 *   - 如果该配置项被 AITaskBinding 引用（主模型或备用模型），则拒绝删除
 *   - 需先解除任务绑定再删除
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getLogger } from "@/lib/utils/logger";
import { isEnvVarReference, isFileLink } from "@/lib/config/env-resolver";

const logger = getLogger("ModelsAPI");

export const dynamic = "force-dynamic";

/** 模型配置大类 */
type ModelCategory = "language" | "embedding" | "voice" | "image" | "other";

/** 允许的模型大类 */
const ALLOWED_CATEGORIES: ModelCategory[] = [
  "language",
  "embedding",
  "voice",
  "image",
  "other",
];

/** 允许的提供商 */
const ALLOWED_PROVIDERS = [
  "openai",
  "anthropic",
  "deepseek",
  "local",
  "custom",
];

/**
 * 更新模型配置
 *
 * 请求体（所有字段可选，仅更新提供的字段）：
 *   - name, category, provider, modelName, apiKey, apiUrl, isActive, order, metadata
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const body = await request.json();

    // 检查记录是否存在
    const existing = await prisma.aIModelConfig.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "模型配置不存在" },
        { status: 404 }
      );
    }

    // 构建更新数据（仅更新提供的字段）
    const data: Record<string, unknown> = {};

    if (typeof body.name === "string") data.name = body.name;

    if (typeof body.category === "string") {
      if (!ALLOWED_CATEGORIES.includes(body.category as ModelCategory)) {
        return NextResponse.json(
          { error: `category 取值非法` },
          { status: 400 }
        );
      }
      data.category = body.category;
    }

    if (typeof body.provider === "string") {
      if (!ALLOWED_PROVIDERS.includes(body.provider)) {
        return NextResponse.json(
          { error: `provider 取值非法` },
          { status: 400 }
        );
      }
      data.provider = body.provider;
    }

    if (typeof body.modelName === "string") data.modelName = body.modelName;
    if (typeof body.apiKey === "string") data.apiKey = body.apiKey;
    if (typeof body.apiUrl === "string") data.apiUrl = body.apiUrl;
    if (typeof body.isActive === "boolean") data.isActive = body.isActive;
    if (typeof body.order === "number") data.order = body.order;
    if (body.metadata !== undefined) {
      data.metadata = JSON.stringify(body.metadata ?? {});
    }

    const updated = await prisma.aIModelConfig.update({
      where: { id },
      data: data as Record<string, never>,
    });

    logger.info("更新模型配置", { id, name: updated.name });

    // 返回时脱敏 apiKey
    const apiKey = updated.apiKey;
    const maskedKey =
      !apiKey
        ? ""
        : isEnvVarReference(apiKey) || isFileLink(apiKey)
          ? apiKey
          : apiKey.length <= 8
            ? "****"
            : `${apiKey.slice(0, 4)}****${apiKey.slice(-4)}`;

    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      category: updated.category,
      provider: updated.provider,
      modelName: updated.modelName,
      apiKey: maskedKey,
      apiUrl: updated.apiUrl,
      isActive: updated.isActive,
      order: updated.order,
      metadata: JSON.parse(updated.metadata || "{}"),
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (err) {
    logger.error("更新模型配置失败", { error: String(err) });
    return NextResponse.json(
      { error: "更新模型配置失败", detail: String(err) },
      { status: 500 }
    );
  }
}

/**
 * 删除模型配置
 *
 * 删除前检查是否被任务绑定引用：
 *   - 如果被引用（主模型或备用模型），返回 409 Conflict
 *   - 否则删除
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    // 检查是否被任务绑定引用
    const bindingsAsPrimary = await prisma.aITaskBinding.count({
      where: { primaryModelId: id },
    });
    const bindingsAsFallback = await prisma.aITaskBinding.count({
      where: { fallbackModelId: id },
    });

    if (bindingsAsPrimary > 0 || bindingsAsFallback > 0) {
      return NextResponse.json(
        {
          error: "该模型配置正在被任务绑定引用，无法删除",
          detail: `主模型引用 ${bindingsAsPrimary} 条，备用模型引用 ${bindingsAsFallback} 条。请先解除绑定再删除。`,
        },
        { status: 409 }
      );
    }

    await prisma.aIModelConfig.delete({ where: { id } });

    logger.info("删除模型配置", { id });

    return NextResponse.json({ success: true, id });
  } catch (err) {
    logger.error("删除模型配置失败", { error: String(err) });
    return NextResponse.json(
      { error: "删除模型配置失败", detail: String(err) },
      { status: 500 }
    );
  }
}
