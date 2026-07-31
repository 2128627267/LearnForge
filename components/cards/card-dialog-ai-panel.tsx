"use client";

import { useEffect, useState } from "react";
import { Tabs } from "@/components/ui/tabs";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RichCardContent } from "./rich-card-content";
import { toast } from "@/components/shared/toaster";
import {
  Send,
  Loader2,
  Sparkles,
  Wand2,
  GitBranch,
  Calculator,
  Trash2,
  Link as LinkIcon,
} from "lucide-react";
import type { CardDraft, LearningMode } from "@/lib/hooks/use-card-dialog-draft";
import type {
  CardDialogPayload,
  CreateNodeItem,
} from "./card-dialog-types";

/** 语言模型配置项（来自 /api/settings/models?category=language） */
interface LanguageModelOption {
  id: string;
  name: string;
  modelName: string;
  provider: string;
}

/** AI 生成的卡片预览项 */
interface GeneratePreviewItem {
  title: string;
  type?: string;
  content: string;
  difficulty?: number;
  tags?: string[];
}

/** 扩展探索结果 */
interface ExtendPreview {
  advanced: Array<{ title: string; difficulty: number; reason: string }>;
  applications: string[];
  crossSubject: string[];
  suggestedOrder: string[];
}

export function CardDialogAiPanel({
  ai,
  updateAi,
  form,
  updateForm,
  onCreateNodes,
  sourceId,
}: {
  ai: CardDraft["ai"];
  updateAi: (patch: Partial<CardDraft["ai"]>) => void;
  form: CardDialogPayload;
  updateForm: (patch: Partial<CardDialogPayload>) => void;
  onCreateNodes: (items: CreateNodeItem[]) => void;
  /** 当前卡片节点 id（扩展 Tab 创建关系线用） */
  sourceId?: string;
}) {
  const [tab, setTab] = useState("chat");
  const [models, setModels] = useState<LanguageModelOption[]>([]);
  const [modelId, setModelId] = useState("");

  // 各 Tab 加载状态
  const [chatLoading, setChatLoading] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [extLoading, setExtLoading] = useState(false);
  const [mathLoading, setMathLoading] = useState(false);

  // 生成/扩展结果预览
  const [genPreview, setGenPreview] = useState<GeneratePreviewItem[] | null>(null);
  const [genRaw, setGenRaw] = useState("");
  const [extPreview, setExtPreview] = useState<ExtendPreview | null>(null);

  // 加载语言模型列表（对话框打开时）
  useEffect(() => {
    fetch("/api/settings/models?category=language&includeInactive=false")
      .then((r) => r.json())
      .then((d: { items?: LanguageModelOption[] }) => {
        const items = d.items ?? [];
        setModels(items);
        if (items.length > 0) {
          setModelId((prev) => prev || items[0].id);
        }
      })
      .catch(() => {
        toast.error("读取模型配置失败", {
          description: "AI 功能暂不可用，可前往设置页检查",
        });
      });
  }, []);

  /** 通用流式读取工具：读取 response body，逐块回调 */
  const readStream = async (
    res: Response,
    onChunk: (text: string) => void
  ): Promise<string> => {
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let acc = "";
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      acc += decoder.decode(value, { stream: true });
      onChunk(acc);
    }
    return acc;
  };

  /** 尝试从流式文本解析 JSON（数组或对象，兼容代码块包裹） */
  const parseJson = <T,>(text: string): T | null => {
    const candidates = [text, text.replace(/```json|```/g, "")];
    for (const c of candidates) {
      // 提取最外层 {...} 或 [...] 子串
      const match = c.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (!match) continue;
      try {
        return JSON.parse(match[1]) as T;
      } catch {
        /* 尝试下一个候选 */
      }
    }
    return null;
  };

  // ==================== 提问 Tab ====================
  const sendChat = async (text: string) => {
    if (!text.trim() || chatLoading) return;
    const userMsg = text.trim();
    updateAi({ chatInput: "", chatMessages: [...ai.chatMessages, { role: "user", content: userMsg }] });
    setChatLoading(true);
    try {
      const res = await fetch("/api/ai/qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg,
          modelId: modelId || undefined,
          cardTitle: form.title,
          cardContent: form.content,
          history: ai.chatMessages.slice(-20),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `请求失败 (${res.status})`);
      }
      const full = await readStream(res, (acc) => {
        updateAi({
          chatMessages: [...ai.chatMessages, { role: "user", content: userMsg }, { role: "assistant", content: acc }],
        });
      });
      if (!full) {
        updateAi({
          chatMessages: [
            ...ai.chatMessages,
            { role: "user", content: userMsg },
            { role: "assistant", content: "（AI 未返回内容，请检查模型配置）" },
          ],
        });
      }
    } catch (err) {
      updateAi({
        chatMessages: [
          ...ai.chatMessages,
          { role: "user", content: userMsg },
          { role: "assistant", content: `❌ 错误：${String(err)}` },
        ],
      });
      toast.error("AI 请求失败");
    } finally {
      setChatLoading(false);
    }
  };

  // ==================== 生成 Tab ====================
  const runGenerate = async () => {
    const text = (ai.generateInput || form.content || "").trim();
    if (!text || genLoading) return;
    setGenLoading(true);
    setGenPreview(null);
    setGenRaw("");
    try {
      const res = await fetch("/api/ai/generate-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          hint: `当前卡片：${form.title}`,
          modelId: modelId || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `请求失败 (${res.status})`);
      }
      const full = await readStream(res, () => {
        /* 生成 Tab 不逐块预览 */
      });
      setGenRaw(full);
      const parsed = parseJson<GeneratePreviewItem[]>(full);
      if (!parsed || !Array.isArray(parsed)) {
        toast.error("AI 返回格式无法解析，已显示原始文本");
      } else {
        setGenPreview(parsed);
      }
    } catch (err) {
      toast.error("AI 生成失败", { description: String(err) });
    } finally {
      setGenLoading(false);
    }
  };

  /** 生成项填入表单 */
  const fillGenerateItem = (item: GeneratePreviewItem) => {
    updateForm({
      title: item.title,
      content: item.content,
      tags: item.tags?.length ? item.tags : form.tags,
    });
    toast.success("已填入表单");
  };

  /** 生成项创建为新画布卡片 */
  const createGenerateItem = (item: GeneratePreviewItem) => {
    onCreateNodes([
      {
        data: {
          title: item.title,
          content: item.content,
          tags: item.tags ?? [],
          learningMode: form.learningMode,
          cardType: item.type as "concept" | "word" | "phrase" | "math" | "code" | "general" | undefined,
        },
        sourceId,
        relationLabel: "相关知识",
      },
    ]);
    toast.success(`已创建卡片：${item.title}`);
  };

  // ==================== 扩展 Tab ====================
  const runExtend = async () => {
    const topic = (ai.extendInput || form.title || "").trim();
    if (!topic || extLoading) return;
    setExtLoading(true);
    setExtPreview(null);
    try {
      const res = await fetch("/api/ai/extend-explore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          context: form.content || undefined,
          modelId: modelId || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `请求失败 (${res.status})`);
      }
      const full = await readStream(res, () => {});
      const parsed = parseJson<ExtendPreview>(full);
      if (!parsed) {
        toast.error("AI 返回格式无法解析");
        return;
      }
      setExtPreview(parsed);
    } catch (err) {
      toast.error("AI 扩展失败", { description: String(err) });
    } finally {
      setExtLoading(false);
    }
  };

  /** 扩展进阶项批量创建为关联卡片 */
  const createExtendCards = () => {
    if (!extPreview) return;
    onCreateNodes(
      extPreview.advanced.map((a) => ({
        data: {
          title: a.title,
          content: `**推荐理由：** ${a.reason}`,
          tags: ["扩展"],
          learningMode: form.learningMode,
          cardType: "concept",
        },
        sourceId,
        relationLabel: "延伸拓展",
      }))
    );
    toast.success(`已创建 ${extPreview.advanced.length} 张关联卡片`);
  };

  /** 扩展结果整体填入表单内容 */
  const fillExtendContent = () => {
    if (!extPreview) return;
    const sections = [
      `## 进阶内容`,
      ...extPreview.advanced.map((a) => `- ${a.title}（难度 ${a.difficulty}）：${a.reason}`),
      `## 应用场景`,
      ...extPreview.applications.map((a) => `- ${a}`),
      `## 跨学科联系`,
      ...extPreview.crossSubject.map((c) => `- ${c}`),
      `## 推荐学习顺序`,
      ...extPreview.suggestedOrder.map((s) => `1. ${s}`),
    ].join("\n");
    updateForm({ content: form.content ? `${form.content}\n\n${sections}` : sections });
    toast.success("已追加到内容");
  };

  // ==================== 数学 Tab ====================
  const runMath = async () => {
    const problem = (ai.mathInput || "").trim();
    if (!problem || mathLoading) return;
    setMathLoading(true);
    updateAi({ mathResult: "" });
    try {
      const res = await fetch("/api/ai/math-solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problem, modelId: modelId || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `请求失败 (${res.status})`);
      }
      await readStream(res, (acc) => updateAi({ mathResult: acc }));
    } catch (err) {
      updateAi({ mathResult: `❌ 错误：${String(err)}` });
      toast.error("AI 解题失败");
    } finally {
      setMathLoading(false);
    }
  };

  const handleChatKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendChat(ai.chatInput);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* 面板头部：模型选择 */}
      <div className="px-4 py-2.5 border-b flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary shrink-0" />
        <span className="text-sm font-medium whitespace-nowrap">AI 助手</span>
        <div className="flex-1" />
        {models.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            未配置模型，请前往设置页配置
          </span>
        ) : (
          <Select
            value={modelId}
            onChange={setModelId}
            options={models.map((m) => ({
              value: m.id,
              label: `${m.name} (${m.modelName})`,
            }))}
            className="max-w-[220px] text-xs"
          />
        )}
      </div>

      {/* Tab 切换 */}
      <Tabs
        items={[
          { value: "chat", label: "提问", icon: <Send className="w-3 h-3" /> },
          { value: "gen", label: "生成", icon: <Wand2 className="w-3 h-3" /> },
          { value: "ext", label: "扩展", icon: <GitBranch className="w-3 h-3" /> },
          { value: "math", label: "数学", icon: <Calculator className="w-3 h-3" /> },
        ]}
        value={tab}
        onChange={setTab}
      />

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* ---------- 提问 ---------- */}
        {tab === "chat" && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                针对当前卡片提问（多轮对话自动保存）
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => updateAi({ chatMessages: [], chatInput: "" })}
                disabled={chatLoading}
              >
                <Trash2 className="w-3 h-3 mr-1" />
                清空对话
              </Button>
            </div>
            <div className="space-y-3 min-h-[240px]">
              {ai.chatMessages.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">
                  输入问题，AI 将结合当前卡片内容回答
                </p>
              ) : (
                ai.chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${
                      msg.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      }`}
                    >
                      {msg.content ? (
                        msg.role === "user" ? (
                          <span className="whitespace-pre-wrap">{msg.content}</span>
                        ) : (
                          <RichCardContent content={msg.content} />
                        )
                      ) : (
                        <Loader2 className="h-3.5 w-3.5 animate-spin inline" />
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="space-y-2">
              <Textarea
                value={ai.chatInput}
                onChange={(e) => updateAi({ chatInput: e.target.value })}
                onKeyDown={handleChatKeyDown}
                placeholder="输入问题... Ctrl/⌘ + Enter 发送"
                rows={2}
                disabled={chatLoading}
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Ctrl/⌘ + Enter 发送
                </span>
                <Button
                  size="sm"
                  onClick={() => sendChat(ai.chatInput)}
                  disabled={chatLoading || !ai.chatInput.trim()}
                >
                  {chatLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : (
                    <Send className="h-3.5 w-3.5 mr-1" />
                  )}
                  发送
                </Button>
              </div>
            </div>
          </>
        )}

        {/* ---------- 生成 ---------- */}
        {tab === "gen" && (
          <>
            <div className="space-y-2">
              <Textarea
                value={ai.generateInput}
                onChange={(e) => updateAi({ generateInput: e.target.value })}
                placeholder={"输入学习资料文本，AI 将提取知识点生成多张卡片\n（留空则使用当前卡片内容）"}
                rows={4}
                disabled={genLoading}
              />
              <Button
                size="sm"
                onClick={runGenerate}
                disabled={genLoading || (!ai.generateInput.trim() && !form.content.trim())}
              >
                {genLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5 mr-1" />
                )}
                生成卡片
              </Button>
            </div>

            {genPreview && genPreview.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">
                    生成 {genPreview.length} 张卡片预览
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      genPreview.forEach(createGenerateItem);
                      toast.success(`已批量创建 ${genPreview.length} 张卡片`);
                    }}
                  >
                    <LinkIcon className="w-3 h-3 mr-1" />
                    全部创建为卡片
                  </Button>
                </div>
                {genPreview.map((item, i) => (
                  <div
                    key={i}
                    className="p-2.5 rounded-lg border border-border/60 bg-muted/20 space-y-1.5"
                  >
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground line-clamp-3">
                      <RichCardContent content={item.content} />
                    </p>
                    <div className="flex gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fillGenerateItem(item)}
                      >
                        填入表单
                      </Button>
                      <Button size="sm" onClick={() => createGenerateItem(item)}>
                        创建为卡片
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {genRaw && !genPreview && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">原始输出：</p>
                <pre className="text-xs whitespace-pre-wrap p-2 rounded bg-muted/30 max-h-60 overflow-y-auto">
                  {genRaw}
                </pre>
              </div>
            )}
          </>
        )}

        {/* ---------- 扩展 ---------- */}
        {tab === "ext" && (
          <>
            <div className="space-y-2">
              <Textarea
                value={ai.extendInput}
                onChange={(e) => updateAi({ extendInput: e.target.value })}
                placeholder={"输入知识点主题（留空则使用当前卡片标题）"}
                rows={2}
                disabled={extLoading}
              />
              <Button
                size="sm"
                onClick={runExtend}
                disabled={extLoading || (!ai.extendInput.trim() && !form.title.trim())}
              >
                {extLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                ) : (
                  <GitBranch className="h-3.5 w-3.5 mr-1" />
                )}
                探索扩展
              </Button>
            </div>

            {extPreview && (
              <div className="space-y-2">
                <div className="flex gap-1.5">
                  <Button size="sm" onClick={createExtendCards}>
                    <LinkIcon className="w-3 h-3 mr-1" />
                    创建进阶卡片（连关系线）
                  </Button>
                  <Button variant="outline" size="sm" onClick={fillExtendContent}>
                    追加到内容
                  </Button>
                </div>

                <div className="p-2.5 rounded-lg border border-border/60 bg-muted/20 space-y-2">
                  <p className="text-xs font-medium">进阶知识点</p>
                  {extPreview.advanced.map((a, i) => (
                    <div key={i} className="text-xs space-y-0.5">
                      <p className="font-medium">
                        {a.title}{" "}
                        <span className="text-muted-foreground">
                          （难度 {a.difficulty}）
                        </span>
                      </p>
                      <p className="text-muted-foreground">{a.reason}</p>
                    </div>
                  ))}
                  {extPreview.applications.length > 0 && (
                    <>
                      <p className="text-xs font-medium pt-1">应用场景</p>
                      {extPreview.applications.map((a, i) => (
                        <p key={i} className="text-xs text-muted-foreground">
                          - {a}
                        </p>
                      ))}
                    </>
                  )}
                  {extPreview.crossSubject.length > 0 && (
                    <>
                      <p className="text-xs font-medium pt-1">跨学科联系</p>
                      {extPreview.crossSubject.map((c, i) => (
                        <p key={i} className="text-xs text-muted-foreground">
                          - {c}
                        </p>
                      ))}
                    </>
                  )}
                  {extPreview.suggestedOrder.length > 0 && (
                    <>
                      <p className="text-xs font-medium pt-1">推荐学习顺序</p>
                      {extPreview.suggestedOrder.map((s, i) => (
                        <p key={i} className="text-xs text-muted-foreground">
                          {i + 1}. {s}
                        </p>
                      ))}
                    </>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* ---------- 数学 ---------- */}
        {tab === "math" && (
          <>
            <div className="space-y-2">
              <Textarea
                value={ai.mathInput}
                onChange={(e) => updateAi({ mathInput: e.target.value })}
                placeholder="输入数学题目，AI 分步解题（公式使用 LaTeX）"
                rows={3}
                disabled={mathLoading}
              />
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  onClick={runMath}
                  disabled={mathLoading || !ai.mathInput.trim()}
                >
                  {mathLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : (
                    <Calculator className="h-3.5 w-3.5 mr-1" />
                  )}
                  开始解题
                </Button>
                {ai.mathResult && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      updateForm({
                        content: form.content
                          ? `${form.content}\n\n${ai.mathResult}`
                          : ai.mathResult,
                      });
                      toast.success("已填入表单");
                    }}
                  >
                    填入表单
                  </Button>
                )}
              </div>
            </div>
            {ai.mathResult && (
              <div className="p-2.5 rounded-lg border border-border/60 bg-muted/20">
                <RichCardContent content={ai.mathResult} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
