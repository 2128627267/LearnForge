/**
 * AI 时间线事件解析 API
 * POST /api/ai/timeline-parse
 *
 * 接收自然语言描述（时间、内容、地点、人物等），调用 AI 解析为结构化事件数组。
 * 非流式：内部收集完整输出后解析 JSON 一次性返回（事件解析需要完整 JSON，流式无意义）。
 *
 * 返回：{ events: AIParsedEvent[] }
 * 注意：本路由只做解析，不落库；前端确认后调用批量创建接口。
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveChatProvider, Prompts } from "@/lib/ai";
import { AIParsedEventSchema } from "@/lib/services/timelines/types";
import { getLogger } from "@/lib/utils/logger";
import { errorResponse } from "@/lib/utils/http-error";
import { z } from "zod";

const logger = getLogger("AI-TimelineParse");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 请求体 Schema */
const RequestSchema = z.object({
  /** 用户输入的自然语言描述（如"1840年鸦片战争爆发，地点广东沿海"） */
  text: z.string().min(1, "请输入事件描述"),
  /** 可选：指定使用的模型 ID */
  modelId: z.string().optional(),
});

/**
 * 从 AI 输出中提取 JSON 文本并解析
 * 兼容模型输出前后夹杂 ```json 代码块围栏或多余文字的情况
 */
function extractJSON(raw: string): unknown {
  // 优先尝试直接解析
  try {
    return JSON.parse(raw);
  } catch {
    /* 继续尝试提取代码块 */
  }
  // 提取 ```json ... ``` 或首个 {...} 块
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = codeBlockMatch ? codeBlockMatch[1] : raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  if (candidate) {
    return JSON.parse(candidate.trim());
  }
  throw new Error("AI 输出中未找到有效 JSON");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, modelId } = RequestSchema.parse(body);

    logger.info("AI 时间线事件解析请求", { textLength: text.length });

    const { provider } = await resolveChatProvider(modelId);
    const stream = provider.chat(
      [
        { role: "system", content: Prompts.TIMELINE_PARSE_SYSTEM },
        { role: "user", content: text },
      ],
      { temperature: 0.1, jsonMode: true }
    );

    // 收集完整输出（非流式场景：需要完整 JSON 才能解析）
    let raw = "";
    for await (const chunk of stream) {
      raw += chunk;
    }

    // 解析并校验 AI 输出结构
    const parsed = extractJSON(raw);
    const eventsRaw = Array.isArray((parsed as { events?: unknown[] }).events)
      ? (parsed as { events: unknown[] }).events
      : Array.isArray(parsed)
        ? parsed // 容错：个别模型直接返回数组
        : [];

    // 逐条校验；无效条目跳过而非整体失败（宽松策略，提升容错）
    const validEvents = [];
    for (const ev of eventsRaw) {
      const result = AIParsedEventSchema.safeParse(ev);
      if (result.success) {
        validEvents.push(result.data);
      } else {
        logger.warn("跳过无效的 AI 解析事件", {
          issue: result.error.issues[0]?.message,
        });
      }
    }

    if (validEvents.length === 0) {
      return NextResponse.json(
        { error: "未能从输入中解析出有效事件，请检查描述中的时间信息" },
        { status: 422 }
      );
    }

    return NextResponse.json({ events: validEvents });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "请求体格式错误", detail: err.issues[0]?.message },
        { status: 400 }
      );
    }
    return errorResponse(logger, "AI 解析时间线事件失败", err);
  }
}
