/**
 * 知识库 API 路由
 * GET    /api/settings/knowledge          - 列出所有知识库文档（按 createdAt 降序）
 * POST   /api/settings/knowledge          - 创建新知识库文档（状态设为 pending）
 * DELETE /api/settings/knowledge?id=xxx   - 删除指定文档（级联删除 VectorChunk）
 *
 * 说明：
 * - 知识库导入暂不实现实际的向量嵌入，仅创建文档记录并标记为 pending
 * - 后续由独立的处理任务（队列/定时器）读取 pending 文档进行分块与嵌入
 * - 删除时利用 Prisma schema 中 VectorChunk.doc 的 onDelete: Cascade 自动级联
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getLogger } from "@/lib/utils/logger";

const logger = getLogger("SettingsAPI");

// 该路由需读取查询参数并查询数据库，强制动态渲染
export const dynamic = "force-dynamic";

/**
 * 允许的文档来源类型
 */
const ALLOWED_SOURCES = ["file_upload", "manual", "ai_generated"] as const;
type AllowedSource = (typeof ALLOWED_SOURCES)[number];

/**
 * 允许的文件类型
 */
const ALLOWED_FILE_TYPES = ["text", "markdown", "pdf", "json"] as const;
type AllowedFileType = (typeof ALLOWED_FILE_TYPES)[number];

/**
 * 知识库文档对外暴露的 DTO
 * - 不返回完整 content（列表场景），由前端按需请求
 * - metadata 解析为对象
 */
export interface KnowledgeDocDTO {
  id: string;
  title: string;
  source: string;
  fileType: string;
  status: string;
  chunkCount: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * 将数据库记录转换为 DTO
 * metadata JSON 解析失败时回退为空对象
 */
function toDTO(record: {
  id: string;
  title: string;
  source: string;
  fileType: string;
  content: string;
  status: string;
  chunkCount: number;
  metadata: string;
  createdAt: Date;
  updatedAt: Date;
}): KnowledgeDocDTO {
  let metadata: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(record.metadata || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      metadata = parsed as Record<string, unknown>;
    }
  } catch {
    // 脏数据：metadata 解析失败，回退为空对象
  }
  return {
    id: record.id,
    title: record.title,
    source: record.source,
    fileType: record.fileType,
    status: record.status,
    chunkCount: record.chunkCount,
    metadata,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/**
 * 列出所有知识库文档
 * 按 createdAt 降序排列（最新在前）
 */
export async function GET() {
  try {
    const docs = await prisma.knowledgeDoc.findMany({
      orderBy: { createdAt: "desc" },
      // 列表场景不返回完整 content，避免响应体过大
      // 此处仍查询全部字段后由 toDTO 裁剪，保持类型简单
    });

    return NextResponse.json({
      items: docs.map(toDTO),
      total: docs.length,
    });
  } catch (err) {
    logger.error("查询知识库列表失败", { error: String(err) });
    return NextResponse.json(
      { error: "查询知识库列表失败", detail: String(err) },
      { status: 500 }
    );
  }
}

/**
 * 创建新知识库文档
 * 请求体：{ title, content, fileType?, source?, metadata? }
 *
 * 行为：
 * - status 固定设为 "pending"（等待后续向量处理）
 * - chunkCount 初始为 0（向量处理完成后更新）
 * - source 默认为 "manual"（手动粘贴），文件上传时由前端传 "file_upload"
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // 标题校验
    if (typeof body.title !== "string" || !body.title.trim()) {
      return NextResponse.json(
        { error: "title 不能为空" },
        { status: 400 }
      );
    }

    // 内容校验
    if (typeof body.content !== "string" || !body.content.trim()) {
      return NextResponse.json(
        { error: "content 不能为空" },
        { status: 400 }
      );
    }

    // fileType 校验（默认 text）
    const fileType: AllowedFileType = (
      ALLOWED_FILE_TYPES.includes(body.fileType)
        ? body.fileType
        : "text"
    ) as AllowedFileType;

    // source 校验（默认 manual）
    const source: AllowedSource = (
      ALLOWED_SOURCES.includes(body.source) ? body.source : "manual"
    ) as AllowedSource;

    // metadata 校验（对象则序列化，否则用空对象）
    let metadataStr = "{}";
    if (body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)) {
      try {
        metadataStr = JSON.stringify(body.metadata);
      } catch {
        // 序列化失败则用空对象
        metadataStr = "{}";
      }
    }

    // 创建文档记录，状态为 pending
    const doc = await prisma.knowledgeDoc.create({
      data: {
        title: body.title.trim(),
        content: body.content,
        source,
        fileType,
        status: "pending",
        chunkCount: 0,
        metadata: metadataStr,
      },
    });

    logger.info("知识库文档已创建", {
      docId: doc.id,
      title: doc.title,
      source: doc.source,
    });

    return NextResponse.json(toDTO(doc), { status: 201 });
  } catch (err) {
    logger.error("创建知识库文档失败", { error: String(err) });
    return NextResponse.json(
      { error: "创建知识库文档失败", detail: String(err) },
      { status: 500 }
    );
  }
}

/**
 * 删除指定知识库文档
 * 通过 query 参数 id 指定文档 ID
 * VectorChunk 通过 schema 中的 onDelete: Cascade 自动级联删除
 */
export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { error: "缺少 id 查询参数" },
        { status: 400 }
      );
    }

    // 先查询文档是否存在，便于给出准确的 404 反馈
    const existing = await prisma.knowledgeDoc.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "文档不存在" },
        { status: 404 }
      );
    }

    // 删除文档（VectorChunk 自动级联删除）
    await prisma.knowledgeDoc.delete({ where: { id } });

    logger.info("知识库文档已删除", { docId: id, title: existing.title });

    return NextResponse.json({ id, deleted: true });
  } catch (err) {
    logger.error("删除知识库文档失败", { error: String(err) });
    return NextResponse.json(
      { error: "删除知识库文档失败", detail: String(err) },
      { status: 500 }
    );
  }
}
