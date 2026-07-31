/**
 * .lfdata 文件格式编解码核心库
 *
 * 文件格式（二进制）：
 *   偏移      长度      字段              说明
 *   0x00      4         magic             魔术字节 0x4C464441（"LFDA"）
 *   0x04      2         version           版本号 0x0100（v1.0，大端序）
 *   0x06      4         headerLength      JSON 头的字节长度（大端序）
 *   0x0A      N         headerJson        UTF-8 编码的 JSON 头
 *   0x0A+N    M         body              正文（格式由 header.encoding 决定）
 *
 * contentType 行为：
 *   - apikey:   直接读取 API Key
 *   - settings: 覆盖应用设置
 *   - data:     导入数据
 *   - raw:      原始内容
 *
 * 使用方式：
 *   - 编码：const buf = encode({ contentType: "apikey", body: jsonStr })
 *   - 解码：const { header, body } = decode(buffer)
 *   - 检测：const isLFData = isLFDataFile(buffer)
 */

// ==================== 常量定义 ====================

/** 魔术字节 "LFDA"（LearnForge Data） */
export const MAGIC_BYTES = new Uint8Array([0x4c, 0x46, 0x44, 0x41]);

/** 当前格式版本（1.0 = 0x0100） */
export const CURRENT_VERSION = 0x0100;

/** 文件头固定长度（magic 4 + version 2 + headerLength 4 = 10 字节） */
const FIXED_HEADER_SIZE = 10;

// ==================== 类型定义 ====================

/** 内容类型：决定程序读取后的行为 */
export type ContentType = "apikey" | "settings" | "data" | "raw";

/** 正文编码方式 */
export type BodyEncoding = "json" | "text" | "binary";

/** .lfdata 文件头 */
export interface LFDataHeader {
  /** 格式版本 */
  formatVersion: string;
  /** 内容类型 */
  contentType: ContentType;
  /** 正文编码方式 */
  encoding: BodyEncoding;
  /** 创建时间 ISO 字符串 */
  createdAt: string;
  /** 内容描述 */
  description?: string;
  /** 任意元数据 */
  metadata?: Record<string, unknown>;
}

/** 编码参数 */
export interface EncodeOptions {
  /** 内容类型 */
  contentType: ContentType;
  /** 正文编码方式（默认根据 body 类型自动推断） */
  encoding?: BodyEncoding;
  /** 内容描述 */
  description?: string;
  /** 元数据 */
  metadata?: Record<string, unknown>;
  /** 创建时间（默认当前时间） */
  createdAt?: string;
}

/** 解码结果 */
export interface DecodeResult {
  /** 文件头 */
  header: LFDataHeader;
  /** 正文（根据 encoding 返回不同类型） */
  body: string | Uint8Array;
  /** 正文是否为 JSON（便于调用方判断是否需要 JSON.parse） */
  isJson: boolean;
}

// ==================== 编码函数 ====================

/**
 * 将数据编码为 .lfdata 二进制格式
 *
 * @param body    正文内容（字符串或 Uint8Array）
 * @param options 编码选项
 * @returns Uint8Array 二进制数据
 *
 * @example
 * // 编码 API Key 配置
 * const buf = encode(
 *   JSON.stringify({ apiKey: "sk-xxx", apiUrl: "https://api.openai.com/v1" }),
 *   { contentType: "apikey", encoding: "json" }
 * );
 */
export function encode(
  body: string | Uint8Array,
  options: EncodeOptions
): Uint8Array {
  // 推断编码方式
  const encoding: BodyEncoding =
    options.encoding ??
    (typeof body === "string" ? "text" : "binary");

  // 构建文件头
  const header: LFDataHeader = {
    formatVersion: "1.0",
    contentType: options.contentType,
    encoding,
    createdAt: options.createdAt ?? new Date().toISOString(),
    description: options.description,
    metadata: options.metadata,
  };

  // 序列化文件头为 UTF-8 JSON
  const headerJson = JSON.stringify(header);
  const headerBytes = new TextEncoder().encode(headerJson);

  // 序列化正文
  let bodyBytes: Uint8Array;
  if (typeof body === "string") {
    bodyBytes = new TextEncoder().encode(body);
  } else {
    bodyBytes = body;
  }

  // 组装二进制数据
  const totalSize = FIXED_HEADER_SIZE + headerBytes.length + bodyBytes.length;
  const result = new Uint8Array(totalSize);
  let offset = 0;

  // 写入魔术字节（4 字节）
  result.set(MAGIC_BYTES, offset);
  offset += 4;

  // 写入版本号（2 字节，大端序）
  result[offset] = (CURRENT_VERSION >> 8) & 0xff;
  result[offset + 1] = CURRENT_VERSION & 0xff;
  offset += 2;

  // 写入头长度（4 字节，大端序）
  const headerLen = headerBytes.length;
  // 使用 DataView 写入 32 位无符号整数（避免位运算溢出）
  const dv = new DataView(result.buffer, offset, 4);
  dv.setUint32(0, headerLen, false); // false = 大端序
  offset += 4;

  // 写入文件头 JSON
  result.set(headerBytes, offset);
  offset += headerBytes.length;

  // 写入正文
  result.set(bodyBytes, offset);

  return result;
}

// ==================== 解码函数 ====================

/**
 * 从 Uint8Array 读取大端序的 32 位无符号整数
 */
function readUint32BE(buf: Uint8Array, offset: number): number {
  const dv = new DataView(
    buf.buffer,
    buf.byteOffset + offset,
    Math.min(4, buf.byteLength - offset)
  );
  return dv.getUint32(0, false);
}

/**
 * 从 Uint8Array 读取大端序的 16 位无符号整数
 */
function readUint16BE(buf: Uint8Array, offset: number): number {
  const dv = new DataView(
    buf.buffer,
    buf.byteOffset + offset,
    Math.min(2, buf.byteLength - offset)
  );
  return dv.getUint16(0, false);
}

/**
 * 解码 .lfdata 二进制数据
 *
 * @param data 二进制数据
 * @returns 解码结果 { header, body, isJson }
 * @throws 如果数据不是有效的 .lfdata 格式
 *
 * @example
 * const { header, body } = decode(buffer);
 * if (header.contentType === "apikey") {
 *   const config = JSON.parse(body as string);
 *   console.log(config.apiKey);
 * }
 */
export function decode(data: Uint8Array): DecodeResult {
  // 校验最小长度
  if (data.length < FIXED_HEADER_SIZE) {
    throw new Error(
      `Invalid .lfdata file: too short (${data.length} bytes, minimum ${FIXED_HEADER_SIZE})`
    );
  }

  // 校验魔术字节
  for (let i = 0; i < 4; i++) {
    if (data[i] !== MAGIC_BYTES[i]) {
      throw new Error(
        `Invalid .lfdata file: magic bytes mismatch (expected "LFDA")`
      );
    }
  }

  // 读取版本号
  const version = readUint16BE(data, 4);
  if (version !== CURRENT_VERSION) {
    throw new Error(
      `Unsupported .lfdata version: 0x${version.toString(16)} (expected 0x${CURRENT_VERSION.toString(16)})`
    );
  }

  // 读取头长度
  const headerLength = readUint32BE(data, 6);
  if (headerLength === 0 || headerLength > 1024 * 1024) {
    // 头长度限制 1MB，防止恶意文件
    throw new Error(
      `Invalid .lfdata file: header length ${headerLength} out of range`
    );
  }

  // 校验总长度
  const headerStart = FIXED_HEADER_SIZE;
  const headerEnd = headerStart + headerLength;
  if (headerEnd > data.length) {
    throw new Error(
      `Invalid .lfdata file: header truncated (expected ${headerLength} bytes, only ${data.length - headerStart} available)`
    );
  }

  // 解析文件头 JSON
  const headerBytes = data.slice(headerStart, headerEnd);
  let header: LFDataHeader;
  try {
    const headerJson = new TextDecoder().decode(headerBytes);
    header = JSON.parse(headerJson);
  } catch (err) {
    throw new Error(
      `Invalid .lfdata file: header JSON parse failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // 提取正文
  const bodyBytes = data.slice(headerEnd);
  let body: string | Uint8Array;
  const isJson = header.encoding === "json";

  switch (header.encoding) {
    case "json":
    case "text":
      body = new TextDecoder().decode(bodyBytes);
      break;
    case "binary":
      body = bodyBytes;
      break;
    default:
      // 未知编码方式，回退为文本
      body = new TextDecoder().decode(bodyBytes);
  }

  return { header, body, isJson };
}

// ==================== 工具函数 ====================

/**
 * 检测数据是否为 .lfdata 格式
 *
 * 通过检查魔术字节判断，不解析完整内容
 *
 * @param data 二进制数据
 * @returns 是否为 .lfdata 格式
 */
export function isLFDataFile(data: Uint8Array): boolean {
  if (data.length < 4) return false;
  for (let i = 0; i < 4; i++) {
    if (data[i] !== MAGIC_BYTES[i]) return false;
  }
  return true;
}

/**
 * 检测并读取文件
 *
 * 如果是 .lfdata 格式，解码并返回 { isLFData: true, header, body }
 * 如果不是，作为普通文件返回 { isLFData: false, rawContent }
 *
 * @param data 文件二进制数据
 * @returns 检测结果
 */
export function detectAndRead(
  data: Uint8Array
):
  | { isLFData: true; result: DecodeResult }
  | { isLFData: false; rawContent: Uint8Array } {
  if (isLFDataFile(data)) {
    return { isLFData: true, result: decode(data) };
  }
  return { isLFData: false, rawContent: data };
}

/**
 * 将 Uint8Array 转换为 Node.js Buffer
 *
 * 在浏览器环境中为 no-op（直接返回 Uint8Array 的视图）
 * 在 Node.js 环境中返回真正的 Buffer
 */
export function toBuffer(data: Uint8Array): Buffer {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(data);
  }
  // 浏览器环境：返回 Uint8Array 的视图（类型断言）
  return data as unknown as Buffer;
}

/**
 * 将 Buffer 转换为 Uint8Array
 *
 * 确保 cross-platform 兼容（浏览器无 Buffer）
 */
export function fromBuffer(buf: Buffer): Uint8Array {
  return new Uint8Array(buf);
}
