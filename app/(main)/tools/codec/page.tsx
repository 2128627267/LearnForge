"use client";

/**
 * 文件编解码器工具页面
 *
 * 路径：/tools/codec
 * 作用：提供完整的 .lfdata 文件编解码功能
 *   - 编码：将 JSON / 文本内容编码为 .lfdata 二进制文件并下载
 *   - 解码：上传 .lfdata 文件（或任意文件）查看其文件头信息与正文内容
 *
 * 依赖：
 *   - UI 组件库：@/components/ui/{card, button, input, textarea, badge}
 *   - 通知：@/components/shared/toaster (sonner)
 *   - 图标：lucide-react
 *   - 类名工具：@/lib/utils/cn
 *
 * API 端点：
 *   - POST /api/settings/codec/encode  (JSON 请求体 → 二进制文件响应)
 *   - POST /api/settings/codec/decode  (FormData 请求体 → JSON 响应)
 */

import { useCallback, useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/shared/toaster";
import { cn } from "@/lib/utils/cn";
import {
  Copy,
  Database,
  Download,
  FileDown,
  FileUp,
  Loader2,
  Plus,
  Settings as SettingsIcon,
  Upload,
  Binary,
  FileSearch,
} from "lucide-react";

// ==================== 类型定义 ====================

/** 内容类型：决定 .lfdata 文件被读取后的处理行为 */
type ContentType = "apikey" | "settings" | "data" | "raw";

/** 编码方式：决定正文的序列化方式 */
type BodyEncoding = "json" | "text" | "binary";

/** 编码请求体（对应 POST /api/settings/codec/encode 的请求 JSON） */
interface EncodeRequest {
  content: string;
  contentType: ContentType;
  encoding?: BodyEncoding;
  description?: string;
  metadata?: Record<string, unknown>;
}

/** .lfdata 文件头结构（与 lib/codec/lfdata.ts 的 LFDataHeader 一致） */
interface LFDataHeader {
  formatVersion: string;
  contentType: ContentType;
  encoding: BodyEncoding;
  createdAt: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

/** 解码响应：.lfdata 文件分支 */
interface DecodeLFDataResponse {
  isLFData: true;
  header: LFDataHeader;
  body: string;
  bodyType: "string" | "base64";
  isJson: boolean;
  truncated: boolean;
}

/** 解码响应：非 .lfdata 文件分支 */
interface DecodeRawResponse {
  isLFData: false;
  filename: string;
  fileSize: number;
  rawContentPreview: string;
  message: string;
}

/** 解码响应联合类型 */
type DecodeResponse = DecodeLFDataResponse | DecodeRawResponse;

// ==================== 常量定义（提取配置项，避免硬编码） ====================

/** 内容类型选项（用于下拉选择） */
const CONTENT_TYPE_OPTIONS: {
  value: ContentType;
  label: string;
  desc: string;
}[] = [
  { value: "apikey", label: "API Key", desc: "存储 API 密钥与端点" },
  { value: "settings", label: "应用设置", desc: "覆盖应用配置项" },
  { value: "data", label: "数据", desc: "导入学习数据/卡片" },
  { value: "raw", label: "原始内容", desc: "任意文本/二进制" },
];

/** 编码方式选项（用于下拉选择） */
const ENCODING_OPTIONS: {
  value: BodyEncoding;
  label: string;
  desc: string;
}[] = [
  { value: "json", label: "JSON", desc: "正文为 JSON 字符串" },
  { value: "text", label: "文本", desc: "正文为纯文本" },
  { value: "binary", label: "二进制", desc: "正文为二进制数据" },
];

/** 快速模板按钮配置 */
const QUICK_TEMPLATES = [
  {
    label: "API Key 模板",
    content: JSON.stringify(
      { apiKey: "", apiUrl: "", provider: "", modelName: "" },
      null,
      2
    ),
  },
  {
    label: "设置模板",
    content: JSON.stringify({ temperature: 0.7, maxTokens: 2048 }, null, 2),
  },
] as const;

/**
 * 应用按钮配置：按 contentType 映射到不同的按钮文案与图标
 *
 * - apikey:   创建为模型配置（调用 POST /api/settings/models）
 * - settings: 应用到 AI 设置（调用 PUT /api/settings/ai）
 * - data:     导入数据（暂未实现，仅提示）
 * - raw:      不显示按钮（无对应配置）
 *
 * 使用方式：在渲染时通过 APPLY_BUTTON_CONFIG[contentType] 取配置，
 * 若返回 undefined 则不渲染按钮。
 */
const APPLY_BUTTON_CONFIG: Partial<
  Record<ContentType, { label: string; icon: typeof Plus }>
> = {
  apikey: { label: "创建为模型配置", icon: Plus },
  settings: { label: "应用到 AI 设置", icon: SettingsIcon },
  data: { label: "导入数据", icon: Database },
};

/** 文件上传接受的扩展名 */
const ACCEPTED_EXTENSIONS = ".lfdata,.json,.txt,.ts,.js,.md";

// ==================== 组件实现 ====================

/**
 * 文件编解码器页面
 *
 * 双栏布局：lg 以上左右排列（左编码 / 右解码），小屏垂直堆叠
 */
export default function CodecPage() {
  // -------- 编码区状态 --------
  const [encodeContent, setEncodeContent] = useState("");
  const [contentType, setContentType] = useState<ContentType>("apikey");
  const [encoding, setEncoding] = useState<BodyEncoding>("json");
  const [description, setDescription] = useState("");
  const [encodingLoading, setEncodingLoading] = useState(false);

  // -------- 解码区状态 --------
  const [decodeResult, setDecodeResult] = useState<DecodeResponse | null>(
    null
  );
  const [decodingLoading, setDecodingLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState("");

  /** 应用设置中状态（控制按钮 spinner 与禁用） */
  const [applying, setApplying] = useState(false);

  /** 隐藏的 file input 引用，通过按钮触发其 click */
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * 处理"编码并下载"
   *
   * 调用 /api/settings/codec/encode 接口获取二进制 .lfdata 文件，
   * 然后通过 Blob + URL.createObjectURL + <a> 标签触发浏览器下载
   */
  const handleEncode = useCallback(async () => {
    // 校验：内容不能为空
    if (!encodeContent.trim()) {
      toast.error("请输入要编码的内容");
      return;
    }

    setEncodingLoading(true);
    try {
      // 组装请求体（描述为空时不传，节省带宽）
      const payload: EncodeRequest = {
        content: encodeContent,
        contentType,
        encoding,
        ...(description.trim() ? { description: description.trim() } : {}),
      };

      // 发起编码请求
      const res = await fetch("/api/settings/codec/encode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        // 尝试从响应体提取错误信息
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      // 从 Content-Disposition 头提取文件名
      // 形如：attachment; filename="learnforge-apikey-2026-07-28.lfdata"
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
      const filename =
        filenameMatch?.[1] ?? `learnforge-${contentType}.lfdata`;

      // 将响应转为 Blob 并触发下载
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      // 挂到 DOM 后再点击，兼容 Firefox
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // 释放对象 URL，避免内存泄漏
      URL.revokeObjectURL(url);

      toast.success("编码完成，文件已下载", { description: filename });
    } catch (err) {
      toast.error("编码失败", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setEncodingLoading(false);
    }
  }, [encodeContent, contentType, encoding, description]);

  /**
   * 处理解码
   *
   * @param file 用户上传的文件
   */
  const handleDecode = useCallback(async (file: File) => {
    setDecodingLoading(true);
    setDecodeResult(null);
    setUploadedFileName(file.name);

    try {
      // 通过 FormData 上传文件（字段名 "file" 与 API 约定一致）
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/settings/codec/decode", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const result: DecodeResponse = await res.json();
      setDecodeResult(result);

      // 根据解码结果分别给出 toast 提示
      if (result.isLFData) {
        toast.success("解码成功", {
          description: `类型：${result.header.contentType} · 编码：${result.header.encoding}`,
        });
      } else {
        toast.info("该文件不是 .lfdata 格式", {
          description: "已显示原始内容预览",
        });
      }
    } catch (err) {
      toast.error("解码失败", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDecodingLoading(false);
    }
  }, []);

  /**
   * 触发文件选择对话框
   */
  const handlePickFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  /**
   * file input change 事件处理
   * 处理完后清空 value，允许用户重复选择同一文件
   */
  const handleFileInputChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (file) handleDecode(file);
    e.target.value = "";
  };

  /**
   * 拖拽进入：阻止默认行为并标记 dragOver 状态
   */
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  /**
   * 拖拽离开：取消 dragOver 标记
   */
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  /**
   * 拖拽释放：取第一个文件并触发解码
   */
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleDecode(file);
  };

  /**
   * 复制解码后的正文内容到剪贴板
   * 仅在解码结果为 .lfdata 时可用
   */
  const handleCopy = useCallback(async () => {
    if (!decodeResult || !decodeResult.isLFData) return;
    try {
      await navigator.clipboard.writeText(decodeResult.body);
      toast.success("已复制到剪贴板");
    } catch (err) {
      toast.error("复制失败", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [decodeResult]);

  /**
   * 安全地将解码正文解析为 JSON 对象
   *
   * @param body 解码后的正文字符串
   * @returns 解析成功返回对象，失败返回 null（并 toast 提示）
   */
  const parseBodyAsJSON = useCallback(
    (body: string): Record<string, unknown> | null => {
      try {
        const parsed = JSON.parse(body);
        // 仅接受对象/数组根节点，原始值（字符串/数字）拒绝
        if (parsed === null || typeof parsed !== "object") {
          toast.error("正文 JSON 不是对象结构，无法应用");
          return null;
        }
        return parsed as Record<string, unknown>;
      } catch (err) {
        toast.error("正文不是有效的 JSON", {
          description: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    },
    []
  );

  /**
   * 应用 apikey 类型：基于解码内容创建新的模型配置
   *
   * 期望字段（与 QUICK_TEMPLATES 中 API Key 模板一致）：
   *   - apiKey:     API Key（支持 ${ENV_VAR} 和 file:// 语法）
   *   - apiUrl:     Base URL
   *   - provider:   提供商（openai | anthropic | deepseek | local | custom）
   *   - modelName:  模型标识
   *   - name?:      配置名称（未提供则根据 provider/modelName 自动生成）
   *   - category?:  大类（未提供则默认 "language"）
   *
   * 调用：POST /api/settings/models
   */
  const applyApiKey = useCallback(
    async (body: string, description?: string) => {
      const data = parseBodyAsJSON(body);
      if (!data) return;

      // 校验必填字段
      const required = ["provider", "modelName"];
      for (const field of required) {
        if (typeof data[field] !== "string" || !(data[field] as string).trim()) {
          toast.error(`缺少必填字段：${field}`);
          return;
        }
      }

      // 自动生成配置名称（若未提供）
      const provider = data.provider as string;
      const modelName = data.modelName as string;
      const name =
        typeof data.name === "string" && data.name.trim()
          ? data.name.trim()
          : description?.trim() || `${provider}/${modelName}`;

      // 构造 POST 请求体
      const payload: Record<string, unknown> = {
        name,
        category:
          typeof data.category === "string" ? data.category : "language",
        provider,
        modelName,
        apiKey: typeof data.apiKey === "string" ? data.apiKey : "",
        apiUrl: typeof data.apiUrl === "string" ? data.apiUrl : "",
        isActive: true,
      };

      const res = await fetch("/api/settings/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const created = await res.json();
      toast.success("已创建模型配置", {
        description: `${created.name}（${created.category}）`,
      });
    },
    [parseBodyAsJSON]
  );

  /**
   * 应用 settings 类型：覆盖 AI 全局参数
   *
   * 期望字段（部分提供即可，仅更新提供的字段）：
   *   - temperature?:  采样温度（0-2）
   *   - maxTokens?:    最大 tokens 数
   *   - ragEnabled?:   是否启用 RAG
   *   - ragTopK?:      RAG Top-K
   *   - 其他 AISettings 字段（如 chatModel 等）也会透传
   *
   * 调用：PUT /api/settings/ai
   */
  const applySettings = useCallback(
    async (body: string) => {
      const data = parseBodyAsJSON(body);
      if (!data) return;

      const res = await fetch("/api/settings/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.detail || `HTTP ${res.status}`);
      }

      const updated = await res.json();
      toast.success("已应用 AI 全局设置", {
        description: `更新时间：${new Date(updated.updatedAt).toLocaleString("zh-CN")}`,
      });
    },
    [parseBodyAsJSON]
  );

  /**
   * 应用解码内容到系统
   *
   * 根据 contentType 分发到不同的应用逻辑：
   *   - apikey:   创建新的模型配置
   *   - settings: 覆盖 AI 全局参数
   *   - data:     数据导入（暂未实现）
   *   - raw:      不应用
   *
   * 应用前会弹出确认对话框，避免误操作（特别是 settings 会覆盖现有配置）
   */
  const handleApply = useCallback(async () => {
    if (!decodeResult || !decodeResult.isLFData) return;

    const { header, body } = decodeResult;
    const ct = header.contentType;

    // 二进制正文不支持应用（需为字符串 JSON）
    if (header.encoding === "binary") {
      toast.error("二进制正文暂不支持直接应用");
      return;
    }

    // 构造确认提示文案
    const confirmMap: Record<string, string> = {
      apikey: "确定要基于此内容创建新的模型配置吗？",
      settings:
        "确定要覆盖当前的 AI 全局设置吗？此操作不可撤销，原有参数将被替换。",
      data: "确定要导入此数据吗？",
    };
    const confirmMsg = confirmMap[ct];
    if (!confirmMsg) {
      // raw 或未知类型：不应用
      return;
    }

    if (!window.confirm(confirmMsg)) {
      return;
    }

    setApplying(true);
    try {
      switch (ct) {
        case "apikey":
          await applyApiKey(body, header.description);
          break;
        case "settings":
          await applySettings(body);
          break;
        case "data":
          // 数据导入涉及多表，暂提示开发中
          toast.info("数据导入功能开发中", {
            description: "后续将支持卡片/学习记录等数据的导入",
          });
          break;
      }
    } catch (err) {
      toast.error("应用失败", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setApplying(false);
    }
  }, [decodeResult, applyApiKey, applySettings]);

  // ==================== 渲染 ====================

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-bold">文件编解码器</h1>
        <p className="text-sm text-muted-foreground mt-1">
          将内容编码为 LearnForge 自定义的 .lfdata 二进制文件，或解码已有文件查看其内容
        </p>
      </div>

      {/* 双栏布局：lg 以上左右排列，小屏垂直堆叠 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ===================== 编码区 ===================== */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Binary className="w-5 h-5 text-primary" />
              编码
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 内容类型 + 编码方式（两列） */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  内容类型
                </label>
                <select
                  value={contentType}
                  onChange={(e) =>
                    setContentType(e.target.value as ContentType)
                  }
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {CONTENT_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} - {opt.desc}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  编码方式
                </label>
                <select
                  value={encoding}
                  onChange={(e) =>
                    setEncoding(e.target.value as BodyEncoding)
                  }
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {ENCODING_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} - {opt.desc}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* 描述（可选） */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                描述（可选）
              </label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="例如：OpenAI 生产环境密钥"
              />
            </div>

            {/* 内容文本框 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                内容
              </label>
              <Textarea
                value={encodeContent}
                onChange={(e) => setEncodeContent(e.target.value)}
                placeholder='输入要编码的内容，如 {"apiKey": "sk-xxx", "apiUrl": "https://..."}'
                className="font-mono text-xs"
                rows={10}
              />
            </div>

            {/* 快速模板按钮 */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">快速模板：</span>
              {QUICK_TEMPLATES.map((tpl) => (
                <Button
                  key={tpl.label}
                  variant="outline"
                  size="sm"
                  onClick={() => setEncodeContent(tpl.content)}
                >
                  <FileDown className="w-3.5 h-3.5 mr-1" />
                  {tpl.label}
                </Button>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEncodeContent("")}
              >
                清空
              </Button>
            </div>

            {/* 编码并下载按钮 */}
            <Button
              className="w-full"
              onClick={handleEncode}
              disabled={encodingLoading || !encodeContent.trim()}
            >
              <Download className="w-4 h-4 mr-2" />
              {encodingLoading ? "编码中..." : "编码并下载"}
            </Button>
          </CardContent>
        </Card>

        {/* ===================== 解码区 ===================== */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSearch className="w-5 h-5 text-primary" />
              解码
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 隐藏的文件输入框，由按钮 / 拖拽区触发 */}
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_EXTENSIONS}
              onChange={handleFileInputChange}
              className="hidden"
              aria-hidden="true"
            />

            {/* 拖拽 + 点击上传区 */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={handlePickFile}
              role="button"
              tabIndex={0}
              className={cn(
                "flex flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed p-8 text-center cursor-pointer transition-colors",
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-input hover:border-primary/50 hover:bg-accent/50"
              )}
            >
              <FileUp className="w-10 h-10 text-muted-foreground" />
              <div className="text-sm font-medium">
                {decodingLoading
                  ? "解码中..."
                  : dragOver
                    ? "释放以开始解码"
                    : "点击或拖拽文件到此处"}
              </div>
              <div className="text-xs text-muted-foreground">
                支持 .lfdata / .json / .txt 等格式
              </div>
              {/* 显式的"选择文件"按钮（阻止冒泡避免重复触发） */}
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePickFile();
                }}
                disabled={decodingLoading}
              >
                <Upload className="w-3.5 h-3.5 mr-1" />
                选择文件
              </Button>
            </div>

            {/* 已上传文件名 */}
            {uploadedFileName && (
              <div className="text-xs text-muted-foreground">
                当前文件：
                <span className="font-mono">{uploadedFileName}</span>
              </div>
            )}

            {/* 解码结果区 */}
            {decodeResult && (
              <div className="rounded-md border border-border p-3 space-y-3">
                {decodeResult.isLFData ? (
                  <>
                    {/* 文件头信息标签 */}
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="success">.lfdata 文件</Badge>
                      <Badge variant="secondary">
                        {decodeResult.header.contentType}
                      </Badge>
                      <Badge variant="outline">
                        {decodeResult.header.encoding}
                      </Badge>
                      {decodeResult.truncated && (
                        <Badge variant="warning">已截断</Badge>
                      )}
                    </div>

                    {/* 详细信息表格 */}
                    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                      <div className="text-muted-foreground">格式版本</div>
                      <div className="font-mono">
                        {decodeResult.header.formatVersion}
                      </div>
                      <div className="text-muted-foreground">创建时间</div>
                      <div className="font-mono">
                        {decodeResult.header.createdAt}
                      </div>
                      {decodeResult.header.description && (
                        <>
                          <div className="text-muted-foreground">描述</div>
                          <div className="break-all">
                            {decodeResult.header.description}
                          </div>
                        </>
                      )}
                      {decodeResult.header.metadata &&
                        Object.entries(decodeResult.header.metadata)
                          .length > 0 && (
                          <>
                            <div className="text-muted-foreground">元数据</div>
                            <div className="font-mono break-all">
                              {JSON.stringify(decodeResult.header.metadata)}
                            </div>
                          </>
                        )}
                    </div>

                    {/* 正文内容 */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">
                          正文内容
                        </span>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleCopy}
                          >
                            <Copy className="w-3.5 h-3.5 mr-1" />
                            复制内容
                          </Button>
                          {/* 根据 contentType 显示不同的应用按钮 */}
                          {APPLY_BUTTON_CONFIG[decodeResult.header.contentType] && (
                            <Button
                              size="sm"
                              onClick={handleApply}
                              disabled={applying}
                            >
                              {applying ? (
                                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                              ) : (
                                (() => {
                                  const Icon =
                                    APPLY_BUTTON_CONFIG[
                                      decodeResult.header.contentType
                                    ]!.icon;
                                  return <Icon className="w-3.5 h-3.5 mr-1" />;
                                })()
                              )}
                              {applying
                                ? "应用中..."
                                : APPLY_BUTTON_CONFIG[
                                    decodeResult.header.contentType
                                  ]!.label}
                            </Button>
                          )}
                        </div>
                      </div>
                      <pre className="bg-muted/30 rounded p-2 overflow-auto max-h-72 text-[11px] font-mono whitespace-pre-wrap break-all">
                        {decodeResult.body}
                      </pre>
                    </div>
                  </>
                ) : (
                  <>
                    {/* 非 .lfdata 文件 */}
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">非 .lfdata 文件</Badge>
                      <span className="text-xs text-muted-foreground">
                        {decodeResult.filename} · {decodeResult.fileSize} 字节
                      </span>
                    </div>
                    <pre className="bg-muted/30 rounded p-2 overflow-auto max-h-72 text-[11px] font-mono whitespace-pre-wrap break-all">
                      {decodeResult.rawContentPreview}
                    </pre>
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 页面底部说明 */}
      <Card>
        <CardContent className="pt-6">
          <div className="text-xs text-muted-foreground space-y-1">
            <p>
              <span className="font-medium text-foreground">.lfdata</span> 是
              LearnForge 自定义二进制文件格式，用于存储 API Key、应用设置、数据等。
            </p>
            <p>
              文件头包含
              <code className="mx-1 px-1 py-0.5 bg-muted rounded">
                contentType
              </code>
              /
              <code className="mx-1 px-1 py-0.5 bg-muted rounded">
                encoding
              </code>
              /
              <code className="mx-1 px-1 py-0.5 bg-muted rounded">
                createdAt
              </code>
              等元数据，正文根据
              <code className="mx-1 px-1 py-0.5 bg-muted rounded">
                encoding
              </code>
              字段决定如何反序列化。
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
