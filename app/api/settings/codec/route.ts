/**
 * 文件编解码 API
 * POST /api/settings/codec/encode  - 编码：JSON → .lfdata 二进制
 * POST /api/settings/codec/decode  - 解码：.lfdata 文件 → JSON
 *
 * 编码请求体（JSON）：
 *   {
 *     "content": "字符串内容",
 *     "contentType": "apikey" | "settings" | "data" | "raw",
 *     "encoding": "json" | "text" | "binary",  // 可选
 *     "description": "描述",                     // 可选
 *     "metadata": {}                             // 可选
 *   }
 *
 * 编码响应：
 *   - Content-Type: application/octet-stream
 *   - Content-Disposition: attachment; filename="xxx.lfdata"
 *   - Body: 二进制 .lfdata 数据
 *
 * 解码请求体（FormData）：
 *   - file: .lfdata 文件（或任意文件）
 *
 * 解码响应（JSON）：
 *   {
 *     "isLFData": true,
 *     "header": { ... },
 *     "body": "...",
 *     "isJson": true
 *   }
 *   或
 *   {
 *     "isLFData": false,
 *     "rawContentPreview": "前 500 字符..."
 *   }
 */
import { NextRequest, NextResponse } from "next/server";
import { getLogger } from "@/lib/utils/logger";
import {
  encode,
  decode,
  detectAndRead,
  fromBuffer,
  type ContentType,
  type BodyEncoding,
} from "@/lib/codec/lfdata";

const logger = getLogger("CodecAPI");

export const dynamic = "force-dynamic";

/** 允许的内容类型 */
const ALLOWED_CONTENT_TYPES: ContentType[] = [
  "apikey",
  "settings",
  "data",
  "raw",
];

/** 允许的编码方式 */
const ALLOWED_ENCODINGS: BodyEncoding[] = ["json", "text", "binary"];

/**
 * POST /api/settings/codec/encode
 *
 * 编码 JSON 内容为 .lfdata 二进制文件
 */
export async function POST(request: NextRequest) {
  try {
    // 检查是否是 multipart/form-data（解码模式）
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      return handleDecode(request);
    }

    // 编码模式：JSON 请求体
    return handleEncode(request);
  } catch (err) {
    logger.error("编解码失败", { error: String(err) });
    return NextResponse.json(
      { error: "编解码失败", detail: String(err) },
      { status: 500 }
    );
  }
}

/**
 * 处理编码请求
 */
async function handleEncode(request: NextRequest): Promise<NextResponse> {
  const body = await request.json();

  // 校验必填字段
  if (body.content === undefined || body.content === null) {
    return NextResponse.json(
      { error: "content 字段必填" },
      { status: 400 }
    );
  }

  if (!body.contentType || !ALLOWED_CONTENT_TYPES.includes(body.contentType)) {
    return NextResponse.json(
      {
        error: `contentType 取值非法，允许值：${ALLOWED_CONTENT_TYPES.join(", ")}`,
      },
      { status: 400 }
    );
  }

  // 推断编码方式
  const encoding: BodyEncoding =
    body.encoding && ALLOWED_ENCODINGS.includes(body.encoding)
      ? body.encoding
      : typeof body.content === "string"
        ? "text"
        : "binary";

  // 准备正文
  let bodyData: string | Uint8Array;
  if (typeof body.content === "string") {
    bodyData = body.content;
  } else if (body.content instanceof Uint8Array) {
    bodyData = body.content;
  } else {
    // 对象/数组：序列化为 JSON 字符串
    bodyData = JSON.stringify(body.content, null, 2);
  }

  // 编码
  const encoded = encode(bodyData, {
    contentType: body.contentType,
    encoding,
    description: body.description,
    metadata: body.metadata,
  });

  // 生成文件名
  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `learnforge-${body.contentType}-${timestamp}.lfdata`;

  logger.info("编码 .lfdata 文件", {
    contentType: body.contentType,
    encoding,
    size: encoded.length,
  });

  // 返回二进制文件
  return new NextResponse(encoded as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": encoded.length.toString(),
    },
  });
}

/**
 * 处理解码请求
 *
 * 从 FormData 中读取文件，检测是否为 .lfdata 格式
 */
async function handleDecode(request: NextRequest): Promise<NextResponse> {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "请上传文件（FormData 字段名：file）" },
      { status: 400 }
    );
  }

  // 读取文件内容为 ArrayBuffer → Uint8Array
  const arrayBuffer = await file.arrayBuffer();
  const data = fromBuffer(Buffer.from(arrayBuffer));

  // 检测并读取
  const result = detectAndRead(data);

  if (result.isLFData) {
    // .lfdata 文件：返回完整解码结果
    const { header, body, isJson } = result.result;

    // 正文如果是 Uint8Array，转为 base64 预览
    let bodyPreview: string;
    let bodyType: "string" | "base64";
    if (typeof body === "string") {
      bodyPreview = body.length > 10000 ? body.slice(0, 10000) : body;
      bodyType = "string";
    } else {
      // 二进制：转 base64
      const base64 = Buffer.from(body).toString("base64");
      bodyPreview = base64.length > 10000 ? base64.slice(0, 10000) : base64;
      bodyType = "base64";
    }

    logger.info("解码 .lfdata 文件", {
      filename: file.name,
      contentType: header.contentType,
      encoding: header.encoding,
      size: data.length,
    });

    return NextResponse.json({
      isLFData: true,
      header,
      body: bodyPreview,
      bodyType,
      isJson,
      truncated: (typeof body === "string" ? body.length : body.byteLength) > 10000,
    });
  }

  // 非 .lfdata 文件：返回原始内容预览
  const textContent = new TextDecoder().decode(result.rawContent).slice(0, 500);

  logger.info("检测到非 .lfdata 文件", {
    filename: file.name,
    size: data.length,
  });

  return NextResponse.json({
    isLFData: false,
    filename: file.name,
    fileSize: data.length,
    rawContentPreview: textContent,
    message: "该文件不是 .lfdata 格式，已显示原始内容预览",
  });
}
