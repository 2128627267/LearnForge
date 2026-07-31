"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/shared/toaster";
import { Loader2, Upload, FolderOpen, Sparkles, AlertCircle } from "lucide-react";

/**
 * 数据导入页面
 *
 * 功能：
 *   - 导入原 LearnForge 数据包格式（pack.json + data/*.json）
 *   - 导入后自动检查缺失字段（音标/释义/例句等）
 *   - 若有缺失，提示用户使用 AI 智能补全
 */

/** 缺失字段中文映射 */
const FIELD_LABELS: Record<string, string> = {
  phonetic: "音标",
  partOfSpeech: "词性",
  meanings: "释义",
  sentences: "例句",
  relatedWords: "相关单词",
  synonyms: "同义词",
  wordRoot: "词根",
};

/** 缺失检查结果 */
interface MissingCheckResult {
  total: number;
  missingCount: number;
  missing: Array<{
    id: string;
    title: string;
    missingFields: string[];
  }>;
}

/** AI 补全结果 */
interface AICompleteResult {
  total: number;
  completed: number;
  results: Array<{ id: string; title: string; completed: boolean; fields: string[] }>;
}

export default function ImportPage() {
  const [packDir, setPackDir] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);

  // 缺失检查状态
  const [missingCheck, setMissingCheck] = useState<MissingCheckResult | null>(null);
  const [checkingMissing, setCheckingMissing] = useState(false);

  // AI 补全状态
  const [completing, setCompleting] = useState(false);
  const [completeResult, setCompleteResult] = useState<AICompleteResult | null>(null);

  /**
   * 导入数据包
   * 成功后自动检查缺失字段
   */
  const handleImport = async () => {
    if (!packDir.trim()) {
      toast.error("请输入数据包目录路径");
      return;
    }
    setLoading(true);
    setResult(null);
    setMissingCheck(null);
    setCompleteResult(null);

    try {
      const res = await fetch("/api/import/datapack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packDir }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "导入失败");
      }

      const data = await res.json();
      setResult({ imported: data.imported, skipped: data.skipped });
      toast.success(`导入完成：${data.imported} 张成功`);

      // 导入成功后自动检查缺失字段
      if (data.imported > 0) {
        await checkMissingFields();
      }
    } catch (err) {
      toast.error("导入失败", { description: String(err) });
    } finally {
      setLoading(false);
    }
  };

  /**
   * 检查导入卡片的缺失字段
   */
  const checkMissingFields = async () => {
    setCheckingMissing(true);
    try {
      const res = await fetch("/api/learn/check-missing?limit=50");
      if (!res.ok) throw new Error("检查失败");
      const data: MissingCheckResult = await res.json();
      setMissingCheck(data);

      if (data.missingCount > 0) {
        toast.info(`发现 ${data.missingCount} 张卡片有缺失字段，可使用 AI 补全`);
      } else {
        toast.success("所有卡片数据完整，无需补全");
      }
    } catch (err) {
      toast.error("缺失字段检查失败", { description: String(err) });
    } finally {
      setCheckingMissing(false);
    }
  };

  /**
   * 使用 AI 补全缺失字段
   */
  const handleAIComplete = async () => {
    if (!missingCheck || missingCheck.missing.length === 0) return;

    setCompleting(true);
    setCompleteResult(null);

    try {
      const cardIds = missingCheck.missing.map((m) => m.id);
      const res = await fetch("/api/learn/ai-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardIds }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "AI 补全失败");
      }

      const data: AICompleteResult = await res.json();
      setCompleteResult(data);

      const successCount = data.completed;
      const failCount = data.total - data.completed;
      toast.success(
        `AI 补全完成：成功 ${successCount} 张${failCount > 0 ? `，失败 ${failCount} 张` : ""}`
      );

      // 补全后重新检查
      await checkMissingFields();
    } catch (err) {
      toast.error("AI 补全失败", { description: String(err) });
    } finally {
      setCompleting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">数据导入</h1>
        <p className="text-sm text-muted-foreground mt-1">
          导入原 LearnForge 数据包格式（pack.json + data/*.json）
        </p>
      </div>

      {/* 导入区 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FolderOpen className="h-4 w-4" />
            数据包目录
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={packDir}
            onChange={(e) => setPackDir(e.target.value)}
            placeholder="例如：./datapacks/SZFL-Hz-1 或绝对路径"
          />
          <p className="text-xs text-muted-foreground">
            目录应包含 pack.json 配置文件和 data/ 子目录（含 JSON 数据文件）
          </p>
          <div className="flex justify-end">
            <Button onClick={handleImport} disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Upload className="h-4 w-4 mr-1" />
              )}
              {loading ? "导入中..." : "开始导入"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 导入结果 */}
      {result && (
        <Card>
          <CardContent className="pt-6">
            <h3 className="font-medium mb-2">导入结果</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-4 rounded border">
                <div className="text-3xl font-bold text-green-600">
                  {result.imported}
                </div>
                <div className="text-sm text-muted-foreground">成功导入</div>
              </div>
              <div className="text-center p-4 rounded border">
                <div className="text-3xl font-bold text-red-600">
                  {result.skipped}
                </div>
                <div className="text-sm text-muted-foreground">跳过/失败</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 缺失字段检查 */}
      {checkingMissing && (
        <Card>
          <CardContent className="pt-6 flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm">正在检查缺失字段...</span>
          </CardContent>
        </Card>
      )}

      {missingCheck && missingCheck.missingCount > 0 && (
        <Card className="border-amber-300 bg-amber-50/50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-medium text-amber-900">
                  发现 {missingCheck.missingCount} 张卡片有缺失字段
                </h3>
                <p className="text-sm text-amber-700 mt-1">
                  以下单词/短语缺少音标、释义、例句等信息。可使用 AI 智能补全。
                </p>

                {/* 缺失字段列表（最多显示 10 条） */}
                <div className="mt-3 space-y-1 max-h-40 overflow-y-auto">
                  {missingCheck.missing.slice(0, 10).map((m) => (
                    <div key={m.id} className="text-xs flex items-center gap-2">
                      <span className="font-medium">{m.title}</span>
                      <span className="text-muted-foreground">
                        缺少：{m.missingFields.map((f) => FIELD_LABELS[f] || f).join("、")}
                      </span>
                    </div>
                  ))}
                  {missingCheck.missing.length > 10 && (
                    <div className="text-xs text-muted-foreground">
                      ...还有 {missingCheck.missing.length - 10} 张
                    </div>
                  )}
                </div>

                {/* AI 补全按钮 */}
                <div className="mt-4 flex justify-end">
                  <Button
                    onClick={handleAIComplete}
                    disabled={completing}
                    size="sm"
                  >
                    {completing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5 mr-1" />
                    )}
                    {completing ? "AI 补全中..." : "AI 智能补全"}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI 补全结果 */}
      {completeResult && (
        <Card>
          <CardContent className="pt-6">
            <h3 className="font-medium mb-2 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              AI 补全结果
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-4 rounded border">
                <div className="text-3xl font-bold text-green-600">
                  {completeResult.completed}
                </div>
                <div className="text-sm text-muted-foreground">补全成功</div>
              </div>
              <div className="text-center p-4 rounded border">
                <div className="text-3xl font-bold text-red-600">
                  {completeResult.total - completeResult.completed}
                </div>
                <div className="text-sm text-muted-foreground">补全失败</div>
              </div>
            </div>
            {/* 补全详情 */}
            <div className="mt-3 space-y-1 max-h-32 overflow-y-auto">
              {completeResult.results
                .filter((r) => r.completed && r.fields.length > 0)
                .slice(0, 10)
                .map((r) => (
                  <div key={r.id} className="text-xs flex items-center gap-2">
                    <span className="font-medium">{r.title}</span>
                    <span className="text-muted-foreground">
                      已补全：{r.fields.map((f) => FIELD_LABELS[f] || f).join("、")}
                    </span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 支持格式说明 */}
      <Card>
        <CardContent className="pt-6">
          <h3 className="font-medium mb-2">支持的格式</h3>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>• 原 LearnForge 数据包（pack.json + data/*.json）</li>
            <li>• JSON 数据文件格式：包含 type/uuid/data 字段</li>
            <li>• 支持单词（word）和短语（phrase）类型</li>
            <li>• 导入后自动转换为统一卡片格式</li>
            <li>• 导入后检查缺失字段，支持 AI 智能补全</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
