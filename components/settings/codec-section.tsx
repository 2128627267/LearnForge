"use client";

/**
 * 编解码器快速入口组件
 *
 * 在设置页中提供快速的文件编码/解码功能
 * 完整功能请访问 /tools/codec
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/shared/toaster";
import {
  Download,
  Upload,
  ExternalLink,
  FileText,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

/** 内容类型选项 */
const CONTENT_TYPE_OPTIONS = [
  { value: "apikey", label: "API Key" },
  { value: "settings", label: "应用设置" },
  { value: "data", label: "数据" },
  { value: "raw", label: "原始内容" },
] as const;

export function CodecSection() {
  // 编码状态
  const [encodeContent, setEncodeContent] = useState("");
  const [encodeType, setEncodeType] =
    useState<(typeof CONTENT_TYPE_OPTIONS)[number]["value"]>("apikey");
  const [encoding, setEncoding] = useState(false);

  // 解码状态
  const [decodeResult, setDecodeResult] = useState<{
    isLFData: boolean;
    header?: Record<string, unknown>;
    body?: string;
    rawContentPreview?: string;
  } | null>(null);
  const [decoding, setDecoding] = useState(false);

  /**
   * 执行编码并下载
   */
  const handleEncode = async () => {
    if (!encodeContent.trim()) {
      toast.error("请输入要编码的内容");
      return;
    }
    setEncoding(true);
    try {
      const res = await fetch("/api/settings/codec/encode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: encodeContent,
          contentType: encodeType,
          encoding: "json",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      // 从响应头获取文件名
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
      const filename = filenameMatch?.[1] ?? `learnforge-${encodeType}.lfdata`;

      // 下载文件
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      toast.success("编码完成，文件已下载", { description: filename });
    } catch (err) {
      toast.error("编码失败", { description: String(err) });
    } finally {
      setEncoding(false);
    }
  };

  /**
   * 执行解码
   */
  const handleDecode = async (file: File) => {
    setDecoding(true);
    setDecodeResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/settings/codec/decode", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const result = await res.json();
      setDecodeResult(result);
      if (result.isLFData) {
        toast.success("解码成功", {
          description: `类型：${result.header?.contentType ?? "未知"}`,
        });
      } else {
        toast.info("该文件不是 .lfdata 格式", {
          description: "已显示原始内容预览",
        });
      }
    } catch (err) {
      toast.error("解码失败", { description: String(err) });
    } finally {
      setDecoding(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            文件编解码器
          </CardTitle>
          <Link href="/tools/codec">
            <Button variant="outline" size="sm">
              <ExternalLink className="w-3.5 h-3.5 mr-1" />
              完整工具
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 编码区 */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-sm font-medium">快速编码</span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={encodeType}
              onChange={(e) =>
                setEncodeType(e.target.value as typeof encodeType)
              }
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              {CONTENT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              onClick={handleEncode}
              disabled={encoding || !encodeContent.trim()}
            >
              <Download className="w-3.5 h-3.5 mr-1" />
              {encoding ? "编码中..." : "编码下载"}
            </Button>
          </div>
          <Textarea
            value={encodeContent}
            onChange={(e) => setEncodeContent(e.target.value)}
            placeholder='输入要编码的内容，如 {"apiKey": "sk-xxx", "apiUrl": "https://..."}'
            className="text-xs font-mono"
            rows={4}
          />
        </div>

        {/* 解码区 */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Upload className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-sm font-medium">快速解码</span>
          </div>
          <input
            type="file"
            accept=".lfdata,.json,.txt,.ts,.js"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleDecode(file);
            }}
            className="hidden"
            id="codec-file-input"
          />
          <label htmlFor="codec-file-input">
            <Button
              variant="outline"
              size="sm"
              asChild
              disabled={decoding}
            >
              <span>
                <Upload className="w-3.5 h-3.5 mr-1" />
                {decoding ? "解码中..." : "选择文件解码"}
              </span>
            </Button>
          </label>

          {/* 解码结果 */}
          {decodeResult && (
            <div className="rounded-md border border-border p-3 text-xs space-y-2">
              {decodeResult.isLFData ? (
                <>
                  <div className="flex items-center gap-2">
                    <Badge variant="success">.lfdata 文件</Badge>
                    <span className="text-muted-foreground">
                      类型：{String(decodeResult.header?.contentType ?? "未知")}
                    </span>
                  </div>
                  <div className="text-muted-foreground">
                    编码：{String(decodeResult.header?.encoding ?? "未知")} ·
                    创建：{String(decodeResult.header?.createdAt ?? "未知")}
                  </div>
                  {decodeResult.body && (
                    <pre className="bg-muted/30 rounded p-2 overflow-auto max-h-40 text-[10px]">
                      {decodeResult.body.slice(0, 500)}
                      {decodeResult.body.length > 500 && "..."}
                    </pre>
                  )}
                </>
              ) : (
                <>
                  <Badge variant="secondary">非 .lfdata 文件</Badge>
                  {decodeResult.rawContentPreview && (
                    <pre className="bg-muted/30 rounded p-2 overflow-auto max-h-40 text-[10px]">
                      {decodeResult.rawContentPreview}
                    </pre>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* 说明 */}
        <div className="text-[10px] text-muted-foreground/70 border-t border-border/30 pt-2">
          .lfdata 是 LearnForge 自定义文件格式，支持存储 API Key、设置、数据等。
          文件头指导程序执行不同行为（直接读取/覆盖设置等）。
        </div>
      </CardContent>
    </Card>
  );
}
