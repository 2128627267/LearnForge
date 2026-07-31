"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/shared/toaster";
import { Loader2, Sparkles, Check, X } from "lucide-react";

/** AI 提炼的复式学习条目 */
export interface ReviewItem {
  kind: "word" | "sentence";
  title: string;
  phonetic?: string;
  partOfSpeech?: string;
  meanings: string[];
  sentences: string[];
  translation?: string;
  keyPoints?: string[];
}

/** 尝试从流式文本解析 JSON 数组 */
function parseItems(text: string): ReviewItem[] | null {
  const candidates = [text, text.replace(/```json|```/g, "")];
  for (const c of candidates) {
    const match = c.match(/\[[\s\S]*\]/);
    if (!match) continue;
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) return parsed as ReviewItem[];
    } catch {
      /* 尝试下一个候选 */
    }
  }
  return null;
}

/** 将条目渲染为画布节点 content（兼容 parseContentToLearnData 解析格式） */
function buildNodeContent(item: ReviewItem): string {
  if (item.kind === "word") {
    return [
      `**音标：** ${item.phonetic ?? ""}`,
      `**词性：** ${item.partOfSpeech ?? ""}`,
      `**释义：** ${item.meanings.join("；")}`,
      `**例句：**`,
      ...item.sentences.map((s) => `- ${s}`),
    ]
      .filter((l) => l && !l.endsWith("：** "))
      .join("\n");
  }
  return [
    `**释义：** ${item.translation ?? ""}`,
    ...(item.keyPoints?.length ? [`**要点：**`, ...item.keyPoints.map((k) => `- ${k}`)] : []),
  ]
    .filter((l) => l && !l.endsWith("：** "))
    .join("\n");
}

export function AiReviewBridge({
  open,
  onClose,
  nodes,
}: {
  open: boolean;
  onClose: () => void;
  nodes: Array<{ id: string; title: string; content: string }>;
}) {
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [raw, setRaw] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<Record<number, boolean>>({});

  const run = async () => {
    if (loading || nodes.length === 0) return;
    setLoading(true);
    setItems(null);
    setRaw("");
    try {
      const res = await fetch("/api/ai/to-review-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cards: nodes.map((n) => ({ id: n.id, title: n.title, content: n.content })) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `请求失败 (${res.status})`);
      }
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
      }
      setRaw(acc);
      const parsed = parseItems(acc);
      if (!parsed) {
        toast.error("AI 返回格式无法解析");
        return;
      }
      setItems(parsed);
      setSelected(Object.fromEntries(parsed.map((_, i) => [i, true])));
    } catch (err) {
      toast.error("AI 转化失败", { description: String(err) });
    } finally {
      setLoading(false);
    }
  };

  const confirmImport = async () => {
    if (!items || importing) return;
    const chosen = items.filter((_, i) => selected[i]);
    if (chosen.length === 0) {
      toast.warning("请至少勾选一条");
      return;
    }
    setImporting(true);
    try {
      // 构造合成画布，复用 /api/learn/import-canvas 链路
      const baseId = Date.now();
      const canvas = {
        nodes: chosen.map((it, i) => ({
          id: `bridge-${baseId}-${i}`,
          type: "freeCard",
          position: { x: i * 40, y: 0 },
          data: {
            title: it.title,
            content: buildNodeContent(it),
            tags: it.kind === "word" ? ["单词", "AI转化"] : ["句子", "AI转化"],
            favorite: false,
          },
        })),
        edges: [],
        tags: [],
      };
      const res = await fetch("/api/learn/import-canvas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canvas }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const result = await res.json();
      toast.success(result.message || `已导入 ${result.imported} 个卡片`, {
        description: "可前往 /learn 开始复式学习（测验+推荐+复习）",
      });
      onClose();
      setItems(null);
      setRaw("");
    } catch (err) {
      toast.error("导入复式学习失败", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!importing) {
          onClose();
          setItems(null);
          setRaw("");
        }
      }}
      title="AI 转化复式学习"
      maxWidth="max-w-3xl"
      footer={
        items && items.length > 0 ? (
          <>
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button onClick={confirmImport} disabled={importing}>
              {importing ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Check className="h-4 w-4 mr-1" />
              )}
              导入复式学习（{items.filter((_, i) => selected[i]).length} 条）
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        )
      }
    >
      <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
        <p className="text-sm text-muted-foreground">
          将选中的 {nodes.length} 张画布卡片交给 AI，提炼为可复式学习（测验+推荐+复习）的单词/句子条目。可勾选、取消后导入。
        </p>

        {!items && (
          <Button onClick={run} disabled={loading} className="w-full">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Sparkles className="h-4 w-4 mr-1" />
            )}
            {loading ? "AI 提炼中..." : "开始 AI 提炼"}
          </Button>
        )}

        {items && items.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                共提炼 {items.length} 条
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => run()}
                disabled={loading}
              >
                重新生成
              </Button>
            </div>
            {items.map((item, i) => (
              <label
                key={i}
                className="flex items-start gap-3 p-2.5 rounded-lg border border-border/60 bg-muted/20 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={!!selected[i]}
                  onChange={() =>
                    setSelected((prev) => ({ ...prev, [i]: !prev[i] }))
                  }
                  className="mt-1"
                />
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{item.title}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                        item.kind === "word"
                          ? "bg-blue-500/10 text-blue-500"
                          : "bg-green-500/10 text-green-500"
                      }`}
                    >
                      {item.kind === "word" ? "单词" : "句子"}
                    </span>
                  </div>
                  {item.kind === "word" && (
                    <p className="text-xs text-muted-foreground">
                      {item.phonetic || ""} {item.partOfSpeech || ""}
                      {item.meanings.length > 0 && ` · ${item.meanings.join("；")}`}
                    </p>
                  )}
                  {item.kind === "sentence" && item.translation && (
                    <p className="text-xs text-muted-foreground">
                      {item.translation}
                    </p>
                  )}
                </div>
              </label>
            ))}
          </div>
        )}

        {raw && !items && (
          <pre className="text-xs whitespace-pre-wrap p-2 rounded bg-muted/30 max-h-60 overflow-y-auto">
            {raw}
          </pre>
        )}
      </div>
    </Dialog>
  );
}
