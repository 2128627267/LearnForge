# 卡片对话框 AI 整合与双学习模式实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AI 提问/生成/扩展/数学能力并入画布卡片的统一编辑对话框，打通运行时模型选择，实现深度学习（canvas）与复式学习（/learn）的 AI 桥接，并整合简化页面。

**Architecture:** 在 `/canvas` 画布上以 `CardDialog`（左侧编辑表单 + 右侧 AI 侧栏）取代内联编辑作为卡片创建/编辑唯一入口；运行时通过 `lib/ai/provider-resolver.ts` 按 `modelId` 解析 `AIModelConfig` 动态创建 provider；新增 AI 桥接 route 将画布卡片转化为 /learn 单词/句子条目；主导航精简为 4 项并删除死链页面。

**Tech Stack:** Next.js 14 App Router、React 18、React Flow 11、Tiptap（富文本）、KaTeX、Vercel AI SDK v3 + @ai-sdk/openai、Prisma + SQLite、Tailwind、lucide-react、sonner。

## Global Constraints

- TypeScript 严格模式；所有新组件以 `"use client"` 开头；组件样式使用 `cn()`（clsx + tailwind-merge）。
- 画布卡片数据（`FreeCardData`）存 localStorage，key `learnforge-canvas`；所有节点 data 经 `injectOnUpdate` 注入 `onUpdate` 回调。
- 模型配置存 `AIModelConfig` 表（Prisma），apiKey/apiUrl 支持 `${ENV_VAR}` 与 `file://` 语法，由 `lib/config/env-resolver.ts` 的 `resolveValue` 解析。
- API 路由错误模式：`NextResponse.json({ error, detail }, { status: 4xx/5xx })`；流式响应用 `text/plain` + `Cache-Control: no-cache` + `X-Accel-Buffering: no`。
- 无测试框架；每个任务的验证周期 = `npm run typecheck`（全部通过）+ 按步骤说明手动验证；里程碑任务跑 `npm run build`。
- 中文 JSDoc 注释，遵循现有代码风格。
- 运行环境：Windows Git Bash。命令用 `cd /j/Programs/Learning && ...`。

---

### Task 1: UI 基础组件（Dialog / Tabs / Select）

**Files:**
- Create: `components/ui/dialog.tsx`
- Create: `components/ui/tabs.tsx`
- Create: `components/ui/select.tsx`

**Interfaces:**
- Produces: `Dialog({ open, onClose, title, children, footer, className?, maxWidth? })` — 模态对话框（遮罩点击/Esc 关闭）
- Produces: `Tabs({ items: {value,label,icon?}[], value, onChange, className? })`
- Produces: `Select({ value, onChange, options: {value,label}[], className?, placeholder? })` — 原生 select 封装

- [ ] **Step 1: 创建 `components/ui/dialog.tsx`**

```tsx
"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * 通用模态对话框
 * 覆盖在画布之上，支持 Esc / 点击遮罩关闭
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  className,
  maxWidth = "max-w-5xl",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  maxWidth?: string;
}) {
  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          "bg-card border rounded-xl shadow-2xl w-full mx-auto flex flex-col max-h-[92vh]",
          maxWidth,
          className
        )}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b shrink-0">
          <h2 className="font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground"
            title="关闭 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {/* 内容区 */}
        <div className="flex-1 overflow-hidden min-h-0">{children}</div>
        {/* 底部操作区 */}
        {footer && (
          <div className="px-5 py-3 border-t shrink-0 flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建 `components/ui/tabs.tsx`**

```tsx
"use client";

import { cn } from "@/lib/utils/cn";

/** Tab 项 */
export interface TabItem {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

/** 轻量 Tab 切换条 */
export function Tabs({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-0.5 border-b border-border", className)}>
      {items.map((it) => (
        <button
          key={it.value}
          onClick={() => onChange(it.value)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px",
            value === it.value
              ? "text-primary border-primary bg-primary/5"
              : "text-muted-foreground hover:text-foreground border-transparent"
          )}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: 创建 `components/ui/select.tsx`**

```tsx
"use client";

import { cn } from "@/lib/utils/cn";

/** 原生 select 封装（统一视觉） */
export function Select({
  value,
  onChange,
  options,
  className,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  className?: string;
  placeholder?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-9 rounded-md border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary",
        className
      )}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 4: 验证**

Run: `cd /j/Programs/Learning && npm run typecheck`
Expected: `tsc --noEmit` 无错误。

- [ ] **Step 5: 提交**

```bash
cd /j/Programs/Learning && git add components/ui/dialog.tsx components/ui/tabs.tsx components/ui/select.tsx && git commit -m "feat(ui): 新增 Dialog/Tabs/Select 基础组件"
```

---

### Task 2: Provider 解析（运行时模型选择）

**Files:**
- Modify: `lib/ai/provider-openai.ts` — `OpenAICompatProvider` 构造函数接受显式配置
- Create: `lib/ai/provider-resolver.ts` — `resolveChatProvider(modelId?)`
- Modify: `lib/ai/index.ts` — 导出 `resolveChatProvider`

**Interfaces:**
- Produces: `OpenAICompatProvider(config?: Partial<{ apiKey: string; baseUrl: string; model: string }>)` — 不传时回退环境变量
- Produces: `resolveChatProvider(modelId?: string): Promise<{ provider: AIProvider; modelLabel: string }>` — 解析顺序：显式 modelId → AITaskBinding(chat).primaryModel → 环境变量
- Consumes: `prisma`（`@/lib/db/prisma`）、`resolveValue`（`@/lib/config/env-resolver`）、`getAIProvider`/`loadAIConfig`

- [ ] **Step 1: 重构 `lib/ai/provider-openai.ts` 构造函数**

将现有构造函数改为可接受显式配置（保持 `getAIProvider()` 无参默认行为不变）：

```ts
export class OpenAICompatProvider implements AIProvider {
  readonly name = "openai-compat";
  private model: ReturnType<ReturnType<typeof createOpenAI>["chat"]>;
  private modelName: string;

  constructor(
    config?: Partial<{ apiKey: string; baseUrl: string; model: string }>
  ) {
    const base = loadAIConfig();
    const apiKey = config?.apiKey || base.apiKey;
    const baseUrl = config?.baseUrl || base.baseUrl;
    const openai = createOpenAI({
      apiKey: apiKey || "missing-key",
      baseURL: baseUrl,
    });
    this.modelName = config?.model || base.model;
    this.model = openai.chat(this.modelName);
  }
  // chat() 方法保持不变
}
```

- [ ] **Step 2: 创建 `lib/ai/provider-resolver.ts`**

```ts
/**
 * AI Provider 运行时解析器
 *
 * 让"自由选择配置的模型"真正生效：按优先级解析实际使用的模型
 *   1. 请求显式传入的 modelId（来自对话框模型选择器）
 *   2. AITaskBinding(chat) 绑定的主模型
 *   3. 环境变量 AI_MODEL/AI_API_KEY/AI_BASE_URL（原默认行为）
 *
 * 凭据解析：apiKey/apiUrl 支持 ${ENV_VAR} 与 file:// 语法，由 env-resolver 解析
 */
import { prisma } from "@/lib/db/prisma";
import { resolveValue } from "@/lib/config/env-resolver";
import { getAIProvider, OpenAICompatProvider } from "./provider-openai";
import type { AIProvider } from "./types";
import { loadAIConfig } from "./types";

/** 解析结果 */
export interface ResolvedChatProvider {
  provider: AIProvider;
  /** 实际使用模型的显示名（日志/提示用） */
  modelLabel: string;
}

/**
 * 解析 chat 任务实际使用的 Provider
 *
 * @param modelId 请求显式指定的 AIModelConfig.id（可选）
 * @returns 可用的 provider 与模型显示名
 */
export async function resolveChatProvider(
  modelId?: string
): Promise<ResolvedChatProvider> {
  // 1. 显式指定 modelId
  if (modelId) {
    const cfg = await prisma.aIModelConfig.findUnique({ where: { id: modelId } });
    if (cfg && cfg.isActive) {
      return {
        provider: new OpenAICompatProvider({
          apiKey: resolveValue(cfg.apiKey),
          baseUrl: cfg.apiUrl || undefined,
          model: cfg.modelName,
        }),
        modelLabel: `${cfg.name} (${cfg.modelName})`,
      };
    }
  }

  // 2. 任务绑定 chat 主模型
  const binding = await prisma.aITaskBinding.findUnique({
    where: { taskType: "chat" },
    include: { primaryModel: true },
  });
  if (binding?.primaryModel) {
    const m = binding.primaryModel;
    return {
      provider: new OpenAICompatProvider({
        apiKey: resolveValue(m.apiKey),
        baseUrl: m.apiUrl || undefined,
        model: m.modelName,
      }),
      modelLabel: `${m.name} (${m.modelName})`,
    };
  }

  // 3. 环境变量回退
  return { provider: getAIProvider(), modelLabel: loadAIConfig().model };
}
```

- [ ] **Step 3: 更新 `lib/ai/index.ts` 导出**

在 `provider-openai` 导出行后追加：

```ts
export { resolveChatProvider } from "./provider-resolver";
export type { ResolvedChatProvider } from "./provider-resolver";
```

- [ ] **Step 4: 验证**

Run: `cd /j/Programs/Learning && npm run typecheck`
Expected: 无错误（`lib/ai/provider-resolver.ts` 的 `prisma` 为服务端依赖，仅服务端使用）。

- [ ] **Step 5: 提交**

```bash
cd /j/Programs/Learning && git add lib/ai/provider-openai.ts lib/ai/provider-resolver.ts lib/ai/index.ts && git commit -m "feat(ai): 新增运行时模型解析器，支持按 AIModelConfig 选择模型"
```

---

### Task 3: AI routes 支持 modelId / 卡片上下文 / 多轮历史

**Files:**
- Modify: `app/api/ai/qa/route.ts`
- Modify: `app/api/ai/generate-cards/route.ts`
- Modify: `app/api/ai/extend-explore/route.ts`
- Modify: `app/api/ai/math-solve/route.ts`

**Interfaces:**
- Consumes: `resolveChatProvider(modelId?)` from `@/lib/ai`
- Produces: 四个 route 请求体均新增可选字段 `modelId`；`/api/ai/qa` 新增可选 `cardTitle`、`cardContent`、`history`

- [ ] **Step 1: 修改 `app/api/ai/qa/route.ts`**

将 `import { getAIProvider } from "@/lib/ai";` 改为：

```ts
import { resolveChatProvider } from "@/lib/ai";
```

请求体解构改为（第 40 行附近）：

```ts
const { message, conversationId, modelId, cardTitle, cardContent, history } =
  await request.json();
```

在 `buildQASystemPrompt(...)` 之后、创建会话之前，注入卡片上下文：

```ts
// ===== 1.5 注入当前卡片上下文（对话框内针对卡片提问）=====
const cardContextText =
  cardTitle || cardContent
    ? `\n\n---\n\n## 当前学习的卡片\n\n标题：${cardTitle || ""}\n内容：\n${cardContent || ""}\n\n请优先围绕这张卡片回答，帮助我理解、记忆或扩展其中的知识。\n\n---\n`
    : "";

const systemPrompt = buildQASystemPrompt(...) + cardContextText;
```

将 `const provider = getAIProvider();`（第 105 行）改为：

```ts
// ===== 5. 构建 AI 消息列表 =====
const { provider } = await resolveChatProvider(modelId);
const historyMessages = Array.isArray(history)
  ? history
      .slice(-20)
      .map((m: { role: string; content: string }) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      }))
  : [];

const messages = [
  { role: "system" as const, content: systemPrompt },
  ...historyMessages,
  { role: "user" as const, content: message },
];
```

（删除原 `history` 查询到 messages 构造之间依赖 `getAIProvider` 的代码；DB 会话创建/保存逻辑保持不变。注意原代码第 98-112 行从 DB 取 `history` 并拼接——现在改为使用请求传入的 `history`，删除该 DB 查询段及其 messages 拼接，保留会话创建与消息保存。）

- [ ] **Step 2: 修改 `app/api/ai/generate-cards/route.ts`**

`import { getAIProvider } from "@/lib/ai";` → `import { resolveChatProvider } from "@/lib/ai";`

请求体解构改为：

```ts
const { text, hint, modelId } = await request.json();
```

`const provider = getAIProvider();` → `const { provider } = await resolveChatProvider(modelId);`

- [ ] **Step 3: 修改 `app/api/ai/extend-explore/route.ts`**

`import { getAIProvider } from "@/lib/ai";` → `import { resolveChatProvider } from "@/lib/ai";`

请求体解构改为：

```ts
const { topic, context, modelId } = await request.json();
```

`const provider = getAIProvider();` → `const { provider } = await resolveChatProvider(modelId);`

- [ ] **Step 4: 修改 `app/api/ai/math-solve/route.ts`**

`import { getAIProvider } from "@/lib/ai";` → `import { resolveChatProvider } from "@/lib/ai";`

请求体解构改为：

```ts
const { problem, conversationId, cardId, modelId } = await request.json();
```

`const provider = getAIProvider();` → `const { provider } = await resolveChatProvider(modelId);`

（其余 DB 会话逻辑保持不变。）

- [ ] **Step 5: 验证**

Run: `cd /j/Programs/Learning && npm run typecheck`
Expected: 无错误。

手动验证（可选，需配置模型）：POST `/api/ai/qa` 带 `{ message: "你好", modelId: "<某个 language 模型 id>" }` 应流式返回。

- [ ] **Step 6: 提交**

```bash
cd /j/Programs/Learning && git add app/api/ai/qa/route.ts app/api/ai/generate-cards/route.ts app/api/ai/extend-explore/route.ts app/api/ai/math-solve/route.ts && git commit -m "feat(ai): AI routes 支持 modelId 选择模型与卡片上下文"
```

---

### Task 4: 草稿缓存 Hook

**Files:**
- Create: `lib/hooks/use-card-dialog-draft.ts`

**Interfaces:**
- Produces:
  - `type LearningMode = "deep" | "review" | "both"`
  - `interface CardDraft { title; content; tags; color; learningMode; width; ai: { chatInput; chatMessages: {role,content}[]; generateInput; extendInput; mathInput; mathResult } }`
  - `DEFAULT_DRAFT: CardDraft`
  - `cardDraftKey(cardId: string | null): string` — `card-dialog:draft:{cardId|new}`
  - `useCardDialogDraft(cardId: string | null): { draft, setDraft, clearDraft }`
  - `readCardDraft(key: string): CardDraft | null`（供 CardDialog 初始化使用）

- [ ] **Step 1: 创建 `lib/hooks/use-card-dialog-draft.ts`**

```ts
"use client";

import { useCallback, useState } from "react";

/** 学习模式：深度学习（canvas+AI+关系线）/ 复式学习（quiz+review）/ 两者 */
export type LearningMode = "deep" | "review" | "both";

/** AI 侧栏各 Tab 的输入缓存 */
export interface CardAiDraft {
  chatInput: string;
  chatMessages: Array<{ role: "user" | "assistant"; content: string }>;
  generateInput: string;
  extendInput: string;
  mathInput: string;
  mathResult: string;
}

/** 卡片对话框草稿（表单 + AI 侧栏输入，localStorage 持久化） */
export interface CardDraft {
  title: string;
  content: string;
  tags: string[];
  color: string;
  learningMode: LearningMode;
  width: number;
  ai: CardAiDraft;
}

/** 默认草稿（新建卡片初始值） */
export const DEFAULT_DRAFT: CardDraft = {
  title: "",
  content: "",
  tags: [],
  color: "#3b82f6",
  learningMode: "deep",
  width: 280,
  ai: {
    chatInput: "",
    chatMessages: [],
    generateInput: "",
    extendInput: "",
    mathInput: "",
    mathResult: "",
  },
};

/** 草稿 localStorage key（新建用 new，编辑用卡片 id） */
export function cardDraftKey(cardId: string | null): string {
  return `card-dialog:draft:${cardId ?? "new"}`;
}

/** 读取草稿（损坏数据清除并返回 null） */
export function readCardDraft(key: string): CardDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CardDraft;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      ...DEFAULT_DRAFT,
      ...parsed,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      ai: { ...DEFAULT_DRAFT.ai, ...(parsed.ai ?? {}) },
    };
  } catch (err) {
    console.warn(`[card-draft] 读取草稿 ${key} 失败，已清除损坏数据:`, err);
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* 忽略 */
    }
    return null;
  }
}

/**
 * 卡片对话框草稿 Hook
 * 每次 setDraft 即写入 localStorage（自动缓存）；clearDraft 在保存成功后调用
 */
export function useCardDialogDraft(cardId: string | null) {
  const key = cardDraftKey(cardId);
  const [draft, setDraftState] = useState<CardDraft | null>(() =>
    readCardDraft(key)
  );

  const setDraft = useCallback(
    (next: CardDraft | ((prev: CardDraft | null) => CardDraft)) => {
      setDraftState((prev) => {
        const resolved = next instanceof Function ? next(prev) : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(resolved));
        } catch (err) {
          console.warn(`[card-draft] 写入草稿 ${key} 失败:`, err);
        }
        return resolved;
      });
    },
    [key]
  );

  const clearDraft = useCallback(() => {
    setDraftState(null);
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* 忽略 */
    }
  }, [key]);

  return { draft, setDraft, clearDraft };
}
```

- [ ] **Step 2: 验证**

Run: `cd /j/Programs/Learning && npm run typecheck`
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
cd /j/Programs/Learning && git add lib/hooks/use-card-dialog-draft.ts && git commit -m "feat(hooks): 新增卡片对话框草稿缓存 Hook（含 AI 侧栏输入）"
```

---

### Task 5: 卡片对话框主体（CardDialog + 共享类型）

**Files:**
- Create: `components/cards/card-dialog-types.ts`
- Create: `components/cards/card-dialog.tsx`（表单部分 + 渲染骨架；AI 面板在 Task 6 实现）

**Interfaces:**
- Produces:
  - `type CardDialogState = { mode: "create" } | { mode: "edit"; nodeId: string } | { mode: "ai"; nodeId: string }`
  - `interface CardDialogPayload { title; content; tags; color; learningMode; width }`
  - `interface CreateNodeItem { data: Partial<FreeCardData>; position?; sourceId?; relationLabel? }`
  - `interface CardDialogProps { state; node?: FreeCardData | null; onClose; onSave(payload); onCreateNodes(items) }`
- Consumes: `useCardDialogDraft`、`Dialog`、`Select`、`RichTextEditor`、`FreeCardData`
- `CardDialog` 内部导出 `LEARNING_MODE_OPTIONS` 与 `buildInitialDraft(node?)` 供 AI 面板使用

- [ ] **Step 1: 创建 `components/cards/card-dialog-types.ts`**

```ts
import type { FreeCardData } from "./free-card-node";
import type { LearningMode } from "@/lib/hooks/use-card-dialog-draft";

/** 卡片对话框打开状态 */
export type CardDialogState =
  | { mode: "create" }
  | { mode: "edit"; nodeId: string }
  | { mode: "ai"; nodeId: string };

/** 保存到画布节点的载荷 */
export interface CardDialogPayload {
  title: string;
  content: string;
  tags: string[];
  color: string;
  learningMode: LearningMode;
  width: number;
}

/** AI 批量创建节点的描述（可带 sourceId 与关系线标签） */
export interface CreateNodeItem {
  data: Partial<FreeCardData>;
  position?: { x: number; y: number };
  /** 若提供，则创建从该节点到新节点的关系线 */
  sourceId?: string;
  /** 关系线标签（如"延伸拓展"） */
  relationLabel?: string;
}
```

- [ ] **Step 2: 创建 `components/cards/card-dialog.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "./rich-text-editor";
import { CardDialogAiPanel } from "./card-dialog-ai-panel";
import type { FreeCardData } from "./free-card-node";
import {
  DEFAULT_DRAFT,
  useCardDialogDraft,
  type CardDraft,
  type LearningMode,
} from "@/lib/hooks/use-card-dialog-draft";
import { toast } from "@/components/shared/toaster";
import { Plus, X } from "lucide-react";
import type {
  CardDialogPayload,
  CardDialogState,
  CreateNodeItem,
} from "./card-dialog-types";

/** 学习模式选项（Select 用） */
export const LEARNING_MODE_OPTIONS: Array<{
  value: LearningMode;
  label: string;
}> = [
  { value: "deep", label: "深度学习（画布+AI+关系线）" },
  { value: "review", label: "复式学习（测验+推荐+复习）" },
  { value: "both", label: "两者兼顾（先理解后记忆）" },
];

/** 颜色色板（与画布标签色一致） */
const COLOR_PALETTE = [
  "#3b82f6",
  "#22c55e",
  "#a855f7",
  "#f97316",
  "#ec4899",
  "#14b8a6",
  "#ef4444",
  "#6b7280",
];

/** 宽度选项 */
const WIDTH_OPTIONS = [240, 280, 320, 360].map((w) => ({
  value: String(w),
  label: `${w}px`,
}));

/** 由节点数据构建初始草稿（无保存草稿时使用） */
export function buildInitialDraft(node?: FreeCardData | null): CardDraft {
  return {
    title: node?.title ?? "",
    content: node?.content ?? "",
    tags: node?.tags ?? [],
    color: node?.color ?? "#3b82f6",
    learningMode: node?.learningMode ?? "deep",
    width: node?.width ?? 280,
    ai: { ...DEFAULT_DRAFT.ai },
  };
}

export function CardDialog({
  state,
  node,
  onClose,
  onSave,
  onCreateNodes,
}: {
  state: CardDialogState;
  node?: FreeCardData | null;
  onClose: () => void;
  onSave: (payload: CardDialogPayload) => void;
  onCreateNodes: (items: CreateNodeItem[]) => void;
}) {
  const cardId = state.mode === "create" ? null : state.nodeId;
  const { draft, setDraft, clearDraft } = useCardDialogDraft(cardId);

  // 草稿优先恢复，否则用节点/默认值初始化
  const current: CardDraft = draft ?? buildInitialDraft(node);

  // 表单字段
  const form: CardDialogPayload = {
    title: current.title,
    content: current.content,
    tags: current.tags,
    color: current.color,
    learningMode: current.learningMode,
    width: current.width,
  };

  const updateForm = (patch: Partial<CardDialogPayload>) => {
    setDraft((prev) => ({ ...(prev ?? buildInitialDraft(node)), ...patch }));
  };

  const updateAi = (patch: Partial<CardDraft["ai"]>) => {
    setDraft((prev) => {
      const base = prev ?? buildInitialDraft(node);
      return { ...base, ai: { ...base.ai, ...patch } };
    });
  };

  // 恢复草稿提示（仅在确有保存草稿且非新建时提示一次）
  const toastShown = useRef(false);
  useEffect(() => {
    if (draft && state.mode !== "create" && !toastShown.current) {
      toastShown.current = true;
      toast.info("已恢复上次未保存的内容");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 本地标签输入
  const [newTag, setNewTag] = useState("");

  const addTag = () => {
    const t = newTag.trim();
    if (t && !form.tags.includes(t)) {
      updateForm({ tags: [...form.tags, t] });
      setNewTag("");
    }
  };

  const removeTag = (tag: string) => {
    updateForm({ tags: form.tags.filter((t) => t !== tag) });
  };

  const handleSave = () => {
    onSave({
      title: form.title.trim() || "未命名卡片",
      content: form.content,
      tags: form.tags,
      color: form.color,
      learningMode: form.learningMode,
      width: form.width,
    });
    clearDraft();
  };

  const title = state.mode === "create" ? "新建卡片" : "编辑卡片";

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      maxWidth="max-w-6xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSave}>保存卡片</Button>
        </>
      }
    >
      <div className="flex h-full">
        {/* ===== 左侧：编辑表单 ===== */}
        <div className="w-[54%] border-r border-border flex flex-col">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* 标题 */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">标题</label>
              <Input
                value={form.title}
                onChange={(e) => updateForm({ title: e.target.value })}
                placeholder="卡片标题"
              />
            </div>

            {/* 学习方式 */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">学习方式</label>
              <Select
                value={form.learningMode}
                onChange={(v) =>
                  updateForm({ learningMode: v as LearningMode })
                }
                options={LEARNING_MODE_OPTIONS}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">
                深度学习：画布 + AI 提问/扩展 + 关系线，用于理解与构建知识体系；
                复式学习：导入后经测验、推荐、复习巩固记忆与运用。
              </p>
            </div>

            {/* 内容 */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">内容</label>
              <RichTextEditor
                content={form.content}
                onChange={(html) => updateForm({ content: html })}
                minHeight={160}
                placeholder="输入卡片内容... 支持 LaTeX：$x^2$ 行内，$$\int$$ 块级"
              />
            </div>

            {/* 标签 */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">标签</label>
              <div className="flex items-center gap-2">
                <Input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="输入标签后回车添加"
                />
                <Button type="button" variant="outline" size="sm" onClick={addTag}>
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  添加
                </Button>
              </div>
              {form.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {form.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary"
                    >
                      {tag}
                      <button
                        onClick={() => removeTag(tag)}
                        className="hover:text-destructive"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* 颜色 + 宽度 */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium">卡片颜色</label>
                <div className="flex flex-wrap gap-1.5">
                  {COLOR_PALETTE.map((c) => (
                    <button
                      key={c}
                      onClick={() => updateForm({ color: c })}
                      className={cn(
                        "w-6 h-6 rounded-full transition-transform",
                        form.color === c
                          ? "ring-2 ring-offset-1 ring-primary scale-110"
                          : "hover:scale-110"
                      )}
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="block text-sm font-medium">卡片宽度</label>
                <Select
                  value={String(form.width)}
                  onChange={(v) => updateForm({ width: Number(v) })}
                  options={WIDTH_OPTIONS}
                  className="w-full"
                />
              </div>
            </div>
          </div>
        </div>

        {/* ===== 右侧：AI 侧栏 ===== */}
        <CardDialogAiPanel
          ai={current.ai}
          updateAi={updateAi}
          form={form}
          updateForm={updateForm}
          onCreateNodes={onCreateNodes}
          sourceId={state.mode === "create" ? undefined : state.nodeId}
        />
      </div>
    </Dialog>
  );
}
```

注意：`CardDialog` 使用了 `cn`，需在文件头导入：

```ts
import { cn } from "@/lib/utils/cn";
```

- [ ] **Step 3: 验证**

`CardDialogAiPanel` 尚未创建，此时 typecheck 会报错。先创建 Task 6 的 AI 面板后再统一验证；本任务验证延迟到 Task 6 Step 4。

- [ ] **Step 4: 提交（与 Task 6 一起提交）**

---

### Task 6: 对话框 AI 面板（模型选择 + 提问/生成/扩展/数学）

**Files:**
- Create: `components/cards/card-dialog-ai-panel.tsx`

**Interfaces:**
- Consumes: `CardDialogPayload`/`CreateNodeItem`（`card-dialog-types`）、`CardDraft["ai"]`、`LEARNING_MODE_OPTIONS`/`buildInitialDraft`（如需要）、`Select`/`Tabs`/`Button`/`Textarea`、`RichCardContent`
- Produces: `CardDialogAiPanel({ ai, updateAi, form, updateForm, onCreateNodes, sourceId? })`

- [ ] **Step 1: 创建 `components/cards/card-dialog-ai-panel.tsx`**

```tsx
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
```

- [ ] **Step 2: 补全 Task 5 的 `card-dialog.tsx` 顶部导入（`cn`）**

在 `card-dialog.tsx` 的 import 区添加：

```ts
import { cn } from "@/lib/utils/cn";
```

- [ ] **Step 3: 验证**

Run: `cd /j/Programs/Learning && npm run typecheck`
Expected: 无错误。

- [ ] **Step 4: 提交**

```bash
cd /j/Programs/Learning && git add components/cards/card-dialog-types.ts components/cards/card-dialog.tsx components/cards/card-dialog-ai-panel.tsx && git commit -m "feat(cards): 新增卡片对话框（编辑表单 + AI 侧栏：提问/生成/扩展/数学，模型可选）"
```

---

### Task 7: 画布接入（CardCanvas / SidePanel / FreeCardNode 改造）

**Files:**
- Modify: `components/cards/card-canvas.tsx` — 对话框状态、事件接线、双击创建、保存/批量创建节点
- Modify: `components/cards/side-panel.tsx` — 添加卡片走对话框；新增「AI 转化复式学习」入口
- Modify: `components/cards/free-card-node.tsx` — 移除内联编辑，编辑/AI 按钮派发事件，学习模式徽章
- Modify: `components/cards/card-dialog-types.ts` — `FreeCardData` 新增 `learningMode` 字段（见 Step 5）

**Interfaces:**
- Consumes: `CardDialog`/`CardDialogState`/`CardDialogPayload`/`CreateNodeItem`、`AiReviewBridge`（Task 8 创建，本任务先留占位导入——见 Step 8 说明）
- Produces: 窗口事件 `canvas:edit-card`（detail=nodeId）、`canvas:ai-card`（detail=nodeId）、`canvas:ai-bridge`（无 detail）

- [ ] **Step 1: `card-canvas.tsx` — 导入与状态**

在 `card-canvas.tsx` 顶部添加导入：

```ts
import { CardDialog } from "./card-dialog";
import { AiReviewBridge } from "./ai-review-bridge";
import type { CardDialogState } from "./card-dialog-types";
import type { CardDialogPayload, CreateNodeItem } from "./card-dialog-types";
```

组件内新增状态（`const [searchMatchIds, ...]` 附近）：

```ts
/** 卡片对话框状态（null = 关闭） */
const [dialog, setDialog] = useState<CardDialogState | null>(null);
/** AI 复式学习桥接对话框开关 */
const [bridgeOpen, setBridgeOpen] = useState(false);
```

- [ ] **Step 2: `card-canvas.tsx` — 对话框处理函数**

在 `addCard` 定义之后添加：

```ts
/**
 * 打开新建卡片对话框（取代直接创建空白卡片）
 * 位置在保存时计算（视口中心），保证新卡片可见
 */
const openCreateDialog = useCallback(() => {
  setDialog({ mode: "create" });
}, []);

/** 计算视口中心坐标（用于新建/批量创建卡片定位） */
const viewportCenter = useCallback(() => {
  let position = {
    x: 100 + Math.random() * 200,
    y: 100 + Math.random() * 100,
  };
  const inst = rfInstance.current;
  const wrapper = reactFlowWrapper.current;
  if (inst && wrapper) {
    const rect = wrapper.getBoundingClientRect();
    const center = inst.screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    position = {
      x: center.x + (Math.random() - 0.5) * 60,
      y: center.y + (Math.random() - 0.5) * 60,
    };
  }
  return position;
}, []);

/** 对话框保存：新建节点或更新已有节点 */
const handleDialogSave = useCallback(
  (payload: CardDialogPayload) => {
    if (!dialog) return;
    if (dialog.mode === "create") {
      const newNode = injectOnUpdate({
        id: `card-${Date.now()}`,
        type: "freeCard",
        position: viewportCenter(),
        data: {
          ...payload,
          tags: payload.tags ?? [],
          favorite: false,
        },
      });
      setNodes((nds) => [...nds, newNode]);
    } else {
      const nodeId = dialog.nodeId;
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, ...payload } } : n
        )
      );
    }
    setDialog(null);
  },
  [dialog, injectOnUpdate, setNodes, viewportCenter]
);

/**
 * AI 批量创建节点（生成/扩展 Tab）
 * 支持从 sourceId 创建关系线
 */
const handleCreateNodes = useCallback(
  (items: CreateNodeItem[]) => {
    if (items.length === 0) return;
    const base = viewportCenter();
    const baseId = Date.now();
    const created = items.map((it, i) => {
      const id = `card-${baseId}-${i}`;
      const pos = it.position ?? {
        x: base.x + (i % 3) * 340 + (Math.random() - 0.5) * 40,
        y: base.y + Math.floor(i / 3) * 260,
      };
      return {
        id,
        sourceId: it.sourceId,
        relationLabel: it.relationLabel,
        node: injectOnUpdate({
          id,
          type: "freeCard",
          position: pos,
          data: {
            title: "新卡片",
            content: "",
            tags: [],
            width: 280,
            favorite: false,
            ...it.data,
          },
        }),
      };
    });
    setNodes((nds) => [...nds, ...created.map((c) => c.node)]);
    const newEdges = created
      .filter((c) => c.sourceId)
      .map((c) =>
        injectOnEdgeUpdate({
          id: `edge-${baseId}-${c.id}`,
          source: c.sourceId!,
          target: c.id,
          type: "freeEdge",
          data: { label: c.relationLabel ?? "" },
          ...defaultEdgeOptions,
        } as Edge<FreeCardEdgeData>)
      );
    if (newEdges.length > 0) {
      setEdges((eds) => [...eds, ...newEdges]);
    }
  },
  [injectOnUpdate, injectOnEdgeUpdate, setNodes, setEdges, viewportCenter]
);
```

注意：`Edge`、`FreeCardEdgeData` 已在文件头部导入，无需新增。

- [ ] **Step 3: `card-canvas.tsx` — 事件接线**

在事件监听 `useEffect` 内新增三个 handler，并注册/注销：

```ts
/** 编辑卡片（由卡片编辑按钮触发） */
const handleEditCard = (e: Event) => {
  const nodeId = (e as CustomEvent).detail as string;
  if (!nodeId) return;
  setDialog({ mode: "edit", nodeId });
};

/** AI 提问卡片（由卡片 AI 按钮触发） */
const handleAiCard = (e: Event) => {
  const nodeId = (e as CustomEvent).detail as string;
  if (!nodeId) return;
  setDialog({ mode: "ai", nodeId });
};

/** AI 转化复式学习（由侧边栏按钮触发） */
const handleAiBridge = () => {
  const sel = nodes.filter((n) => n.selected);
  if (sel.length === 0) {
    toast.warning("请先选中要转化的卡片");
    return;
  }
  setBridgeOpen(true);
};
```

在现有 `window.addEventListener(...)` 段（`canvas:clear` 之后）添加：

```ts
window.addEventListener("canvas:edit-card", handleEditCard);
window.addEventListener("canvas:ai-card", handleAiCard);
window.addEventListener("canvas:ai-bridge", handleAiBridge);
```

在清理段添加对应 `removeEventListener`。将 `useEffect` 依赖数组补上 `nodes`。

同时把 `handleAdd` 改为打开对话框：

```ts
const handleAdd = () => openCreateDialog();
```

并把 `useEffect` 依赖数组 `[addCard, ...]` 中的 `addCard` 替换为 `openCreateDialog`。

- [ ] **Step 4: `card-canvas.tsx` — 双击空白创建 + 渲染对话框**

在 `<ReactFlow>` 外层 wrapper `<div>` 上添加双击事件（在 `style={{...}}` 后）：

```tsx
onDoubleClick={(e) => {
  // 双击卡片不触发新建
  if ((e.target as HTMLElement).closest(".react-flow__node")) return;
  openCreateDialog();
}}
```

在返回 JSX 末尾（`</ReactFlowProvider>` 之前）渲染对话框：

```tsx
{/* 卡片对话框（新建/编辑/AI 提问） */}
{dialog && (
  <CardDialog
    state={dialog}
    node={
      dialog.mode === "create"
        ? null
        : (nodes.find((n) => n.id === dialog.nodeId)?.data as FreeCardData | undefined) ?? null
    }
    onClose={() => setDialog(null)}
    onSave={handleDialogSave}
    onCreateNodes={handleCreateNodes}
  />
)}

{/* AI 复式学习桥接对话框 */}
<AiReviewBridge
  open={bridgeOpen}
  onClose={() => setBridgeOpen(false)}
  nodes={nodes
    .filter((n) => n.selected)
    .map((n) => ({ id: n.id, title: n.data.title, content: n.data.content }))}
/>
```

- [ ] **Step 5: `free-card-node.tsx` — 类型新增 learningMode**

在 `FreeCardData` 接口（`groupId?: string;` 之后）添加：

```ts
/** 学习模式：deep 深度学习 / review 复式学习 / both 两者（由对话框设置） */
learningMode?: "deep" | "review" | "both";
```

- [ ] **Step 6: `free-card-node.tsx` — 移除内联编辑，改造按钮区**

导入调整：移除 `RichTextEditor` 导入（第 26 行），新增 `Sparkles` 图标：

```ts
import { RichTextEditor } from "./rich-text-editor"; // 删除此行
```

```ts
import {
  Edit3,
  Check,   // 删除（仅编辑模式用）
  X,       // 保留（层级面板关闭按钮使用）
  Star,
  CircleDot,
  CircleHelp,
  CircleCheck,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Layers,
  Sparkles, // 新增
} from "lucide-react";
```

删除以下内联编辑相关代码：
- `const [editing, setEditing] = useState(false);`（第 716 行）
- `const [title, setTitle] = useState(data.title);` / `content` / `tags` / `cardType` 状态（717-723 行）
- `const [newTag, setNewTag] = useState("");`（728 行）
- `useEffect` 关闭层级面板段（736-743 行，`editing` 相关）
- 同步外部数据 effect（783-794 行）中除 `learningStatus` 外的部分（保留 learningStatus 同步）
- `handleSave` / `handleCancel`（796-814 行）
- `addTag` / `removeTag`（834-844 行）

保留 `cycleLearningStatus`（822-832 行）与 `learningStatus` 状态。

注意 `useState` 若不再使用则调整导入（`useRef` 仍需用于 editInputRef? free-card-node 的 LayerPanel 中可能有 ref——保留现有导入，typecheck 时按 lint 处理）。

按钮区替换（原 1152-1211 行 `{!editing && (...)}` 与 `{editing ? (...) : (...)}` 整段）为：

```tsx
{/*
  层级面板入口（hover 时可见）
  不限制选中 + 重叠条件，即使没有重叠也可以打开面板查看当前层级
*/}
<button
  onClick={() => setLayerPanelOpen((o) => !o)}
  className={cn(
    "p-1 rounded hover:bg-accent text-muted-foreground hover:text-primary relative transition-colors",
    layerPanelOpen && "bg-accent text-primary"
  )}
  title={overlapping ? `管理层级（共 ${overlappingNodes.length + 1} 张重叠卡片）` : "层级管理"}
>
  <Layers className="w-3.5 h-3.5" />
  {overlapping && (
    <span className="absolute -top-1 -right-1 text-[8px] bg-primary text-primary-foreground rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold leading-none">
      {overlappingNodes.length + 1}
    </span>
  )}
</button>
{/* 学习状态快速切换按钮（循环切换 0→1→2→0） */}
<button
  onClick={cycleLearningStatus}
  className="p-1 rounded hover:bg-accent transition-colors"
  style={{ color: statusColor }}
  title={`学习状态：${statusConfig.label}（点击切换）`}
>
  <StatusIcon className="w-3.5 h-3.5" />
</button>
{/* AI 提问按钮（打开卡片对话框 AI 面板） */}
<button
  onClick={() =>
    window.dispatchEvent(new CustomEvent("canvas:ai-card", { detail: id }))
  }
  className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-primary"
  title="AI 提问"
>
  <Sparkles className="w-3.5 h-3.5" />
</button>
{/* 编辑按钮（打开卡片对话框） */}
<button
  onClick={() =>
    window.dispatchEvent(new CustomEvent("canvas:edit-card", { detail: id }))
  }
  className="p-1 rounded hover:bg-accent text-muted-foreground"
  title="编辑"
>
  <Edit3 className="w-3.5 h-3.5" />
</button>
```

外层容器 class 中删除 `editing && "ring-2 ring-primary"` 条件（第 1056 行）。

标题区：删除 `editing ? (input) : (...)` 分支，只保留展示分支（用 `data.title`）：

```tsx
<h3 className="font-semibold text-sm flex-1 truncate text-foreground flex items-center gap-1.5">
  {/* 类型标识（小图标 + 颜色点） */}
  {currentCardType !== "general" && (
    <span ...>{typeConfig.icon}</span>
  )}
  <span className="truncate">{data.title || "未命名卡片"}</span>
  {/* 学习模式徽章 */}
  {data.learningMode === "review" && (
    <span className="text-[9px] px-1 py-0.5 rounded-full bg-accent text-muted-foreground">复式</span>
  )}
  {data.learningMode === "both" && (
    <span className="text-[9px] px-1 py-0.5 rounded-full bg-accent text-muted-foreground">深度+复式</span>
  )}
</h3>
```

注意：原 JSX 用 `title` 变量显示标题，删除 `title` state 后统一改用 `data.title`。按钮容器 class 的 `selected || editing` 改为 `selected`。

删除「编辑模式：卡片类型 + 学习状态选择器」整段（原 1216-1272 行）。

内容区（原 1274-1288 行）替换为始终渲染：

```tsx
{/* 卡片内容 */}
<div className="pl-4 pr-3 pb-2">
  <div className="text-xs overflow-hidden line-clamp-[8] max-h-[200px] text-foreground/90">
    <RichCardContent content={data.content} />
  </div>
</div>
```

标签区（原 1290-1331 行）替换为仅展示：

```tsx
{/* 标签区（色点 + 文本） */}
{(data.tags ?? []).length > 0 && (
  <div className="pl-4 pr-3 pb-2 flex items-center gap-1.5 flex-wrap">
    {(data.tags ?? []).map((tag) => {
      const color = resolveTagColor(tag, data.getTagColor);
      return (
        <span
          key={tag}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground"
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
          {tag}
        </span>
      );
    })}
  </div>
)}
```

底部信息栏条件（原 1334 行）`(data.favorite || editing || groupColor)` → `(data.favorite || groupColor)`。

层级面板渲染条件（原 1362 行）`{!editing && layerPanelOpen && (` → `{layerPanelOpen && (`。

`tags.length > 0 || editing` 相关判断全部按上述替换处理。删除文件中残留的 `tags` 变量引用（统一用 `data.tags ?? []`）。

- [ ] **Step 7: `side-panel.tsx` — 添加卡片走对话框 + AI 桥接入口**

导入新增 `Sparkles` 图标（在 `GraduationCap` 之后）：

```ts
Sparkles,
```

`ToolAction` 联合类型添加 `"ai-bridge"`：

```ts
type ToolAction =
  | "add"
  | "import"
  | "export"
  | "clear"
  | "help"
  | "export-tree"
  | "export-pack"
  | "import-learn"
  | "ai-bridge";
```

`LEARN_TOOL_BUTTONS` 数组追加（在 `import-learn` 之后）：

```ts
{
  action: "ai-bridge",
  label: "AI 转化",
  icon: Sparkles,
  variant: "outline",
},
```

`handleTool` 的 `case "add"` 修改为：

```ts
case "add":
  // 打开新建卡片对话框（对话框内填写后创建）
  window.dispatchEvent(new CustomEvent("canvas:add-card"));
  break;
```

`case "import-learn"` 之后新增：

```ts
case "ai-bridge":
  // AI 将选中卡片转化为复式学习可用的单词/句子列表
  window.dispatchEvent(new CustomEvent("canvas:ai-bridge"));
  break;
```

- [ ] **Step 8: 临时占位 `components/cards/ai-review-bridge.tsx`**

`card-canvas.tsx` 已在 Step 1 导入 `AiReviewBridge`，但该组件在 Task 8 才实现。先创建最小占位（Task 8 会用完整实现覆盖）：

```tsx
"use client";

/** 占位：完整实现在 Task 8（AI 复式学习桥接对话框） */
export function AiReviewBridge(_props: {
  open: boolean;
  onClose: () => void;
  nodes: Array<{ id: string; title: string; content: string }>;
}) {
  return null;
}
```

- [ ] **Step 9: 验证**

Run: `cd /j/Programs/Learning && npm run typecheck`
Expected: 无错误。若 lint 报未使用导入（如 `Check`），按报错删除。

- [ ] **Step 10: 提交**

```bash
cd /j/Programs/Learning && git add components/cards/card-canvas.tsx components/cards/side-panel.tsx components/cards/free-card-node.tsx components/cards/ai-review-bridge.tsx && git commit -m "feat(cards): 画布接入卡片对话框，移除内联编辑，新增 AI 提问按钮与桥接入口"
```

---

### Task 8: AI 复式学习桥接（route + 预览对话框）

**Files:**
- Create: `app/api/ai/to-review-list/route.ts`
- Replace: `components/cards/ai-review-bridge.tsx`（覆盖占位）

**Interfaces:**
- Produces: `POST /api/ai/to-review-list` body `{ cards: {id,title,content}[], modelId? }` → 流式 JSON 数组 `ReviewItem[]`
- Produces: `interface ReviewItem { kind: "word" | "sentence"; title; phonetic?; partOfSpeech?; meanings: string[]; sentences: string[]; translation?; keyPoints? }`
- Consumes: `resolveChatProvider`、`Dialog`/`Button`/`Textarea`、`/api/learn/import-canvas`

- [ ] **Step 1: 创建 `app/api/ai/to-review-list/route.ts`**

```ts
/**
 * AI 复式学习转化 API（流式）
 * POST /api/ai/to-review-list
 *
 * 接收画布选中卡片，AI 分析内容并提炼为复式学习可用的结构化条目
 * （单词/句子），前端预览确认后复用 /api/learn/import-canvas 导入学习系统。
 *
 * 请求体：
 *   { cards: [{ id, title, content }], modelId?: string }
 *
 * 响应：
 *   - 流式 JSON 数组（text/plain）
 *     [{ kind: "word", title, phonetic?, partOfSpeech?, meanings[], sentences[], ... }]
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveChatProvider } from "@/lib/ai";
import { getLogger } from "@/lib/utils/logger";

const logger = getLogger("AI-ToReviewList");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 转化系统提示词：将知识内容提炼为记忆单元（单词/句子） */
const TO_REVIEW_LIST_SYSTEM = `你是一个学习内容转化助手，擅长把知识卡片内容提炼为适合测验与复习的记忆单元。

任务：分析给定的卡片内容，提取可用来做"复式学习"（测验+推荐+复习）的条目，输出 JSON 数组。

条目类型由内容性质决定：
- kind: "word"（英语单词/短语）→ 字段：title(单词), phonetic(音标), partOfSpeech(词性), meanings(释义数组), sentences(例句数组，含中文翻译)
- kind: "sentence"（重点句子/公式/定义）→ 字段：title(句子或要点原文), translation(中文翻译/含义), keyPoints(记忆要点数组)

要求：
1. 卡片内容是中文知识则提炼为 sentence（定义/公式/要点）
2. 卡片内容是英文单词则提炼为 word
3. 每条目内容必须能从原文中找到依据，不要编造
4. 只输出 JSON 数组，不要其他文字

格式：
[{"kind":"word","title":"...","phonetic":"...","partOfSpeech":"...","meanings":["..."],"sentences":["..."]}]`;

export async function POST(request: NextRequest) {
  try {
    const { cards, modelId } = await request.json();

    if (!Array.isArray(cards) || cards.length === 0) {
      return NextResponse.json(
        { error: "请提供要转化的卡片内容" },
        { status: 400 }
      );
    }

    logger.info("AI 复式学习转化请求", { cardCount: cards.length });

    const { provider } = await resolveChatProvider(modelId);

    const cardText = cards
      .map(
        (c: { title: string; content: string }, i: number) =>
          `卡片 ${i + 1}：${c.title}\n${c.content || ""}`
      )
      .join("\n\n---\n\n");

    const stream = provider.chat(
      [
        { role: "system", content: TO_REVIEW_LIST_SYSTEM },
        {
          role: "user",
          content: `请将以下卡片内容转化为复式学习条目：\n\n${cardText}`,
        },
      ],
      { temperature: 0.3, jsonMode: true }
    );

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        } catch (err) {
          logger.error("AI 复式学习转化流式失败", { error: String(err) });
          controller.error(err);
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    logger.error("AI 复式学习转化失败", { error: String(err) });
    return NextResponse.json(
      { error: "AI 转化失败", detail: String(err) },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: 完整实现 `components/cards/ai-review-bridge.tsx`**

```tsx
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
```

- [ ] **Step 3: 验证**

Run: `cd /j/Programs/Learning && npm run typecheck`
Expected: 无错误。

- [ ] **Step 4: 提交**

```bash
cd /j/Programs/Learning && git add app/api/ai/to-review-list/route.ts components/cards/ai-review-bridge.tsx && git commit -m "feat(ai): 新增 AI 复式学习桥接（画布卡片→单词/句子→导入 /learn）"
```

---

### Task 9: 页面整合（导航 4 项 + 删页 + 项目记忆抽屉）

**Files:**
- Modify: `components/shared/main-nav.tsx` — 导航精简为 4 项
- Modify: `app/(main)/qa/page.tsx` — 改为重定向到 /canvas
- Delete: `app/(main)/review/`、`app/(main)/roadmap/`、`app/(main)/english/`
- Modify: `app/(main)/canvas/page.tsx` — 项目记忆抽屉
- Delete: `components/ai/ai-chat.tsx`、`components/cards/card-form.tsx`、`components/cards/card-item.tsx`、`components/cards/card-detail-actions.tsx`（确认无引用后）

**Interfaces:**
- Produces: 主导航 `[stats, canvas, learn, settings]`；`/qa` 重定向到 `/canvas`
- Consumes: `ProjectMemoryPanel`（`@/components/ai/project-memory-panel`）

- [ ] **Step 1: 修改 `main-nav.tsx` 导航项**

```ts
const navItems = [
  { href: "/stats", label: "统计", icon: "📊" },
  { href: "/canvas", label: "画布", icon: "🎨" },
  { href: "/learn", label: "学习", icon: "📚" },
  { href: "/settings", label: "设置", icon: "⚙️" },
];
```

同时更新注释说明（顶部文件注释段）：

```ts
/**
 * 主导航栏
 * 页面重组说明：
 *   - AI 问答合并至画布（卡片对话框内提问，支持模型选择）
 *   - 删除卡片库/复习/路线图/英语独立页（功能收敛到画布与学习）
 *   - 导入、编解码器为工具页，通过 /import、/tools/codec 直接访问
 */
```

- [ ] **Step 2: 替换 `app/(main)/qa/page.tsx` 为重定向页**

```tsx
import { redirect } from "next/navigation";

/**
 * AI 问答已合并至画布卡片对话框
 * /qa 重定向到 /canvas
 */
export default function QAPage() {
  redirect("/canvas");
}
```

- [ ] **Step 3: 删除次要页面**

```bash
cd /j/Programs/Learning && rm -rf "app/(main)/review" "app/(main)/roadmap" "app/(main)/english"
```

删除前确认无代码引用这些路由：

```bash
cd /j/Programs/Learning && grep -rn "/review\|/roadmap\|/english" app components lib --include="*.tsx" --include="*.ts" | grep -v "englishSubject\|slug: \"english\"\|/api/learn" || echo "无引用"
```

若有 `/review`/`/roadmap` 链接残留（如 stats 页），一并删除对应链接项。

- [ ] **Step 4: `app/(main)/canvas/page.tsx` 项目记忆抽屉**

新增导入与状态：

```ts
import { ProjectMemoryPanel } from "@/components/ai/project-memory-panel";
import { Brain } from "lucide-react";
```

组件内新增：

```ts
const [memoryOpen, setMemoryOpen] = useState(false);
```

在 `</SidePanel>` 之后渲染抽屉：

```tsx
{/* 项目记忆抽屉（AI 提问上下文来源） */}
<button
  onClick={() => setMemoryOpen((v) => !v)}
  className={cn(
    "fixed right-4 top-1/2 -translate-y-1/2 z-20",
    "w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg hover:scale-110 hover:shadow-xl transition-all duration-300 ease-out border-2 border-background",
    memoryOpen && "rotate-180"
  )}
  title={memoryOpen ? "收起记忆面板" : "项目记忆"}
  aria-label={memoryOpen ? "收起记忆面板" : "项目记忆"}
>
  <Brain className="w-5 h-5" />
</button>

{memoryOpen && (
  <div className="fixed right-4 top-1/2 -translate-y-1/2 z-20 w-80 mr-16 bg-card border rounded-xl shadow-2xl max-h-[70vh] overflow-y-auto">
    <ProjectMemoryPanel />
  </div>
)}
```

注意：`cn` 需在 `page.tsx` 中导入：`import { cn } from "@/lib/utils/cn";`。按钮位置需与 SidePanel 的圆形按钮不重叠——SidePanel 按钮位于 `right-4`，本按钮亦为 `right-4`，会重叠。将记忆抽屉按钮放在 `right-4 bottom-8`（底部右侧），避开 SidePanel 中部按钮：

```tsx
<button
  onClick={() => setMemoryOpen((v) => !v)}
  className={cn(
    "fixed right-4 bottom-8 z-20 ..."
  )}
>
```

- [ ] **Step 5: 删除孤儿组件**

确认引用后删除：

```bash
cd /j/Programs/Learning && grep -rn "components/ai/ai-chat\|components/cards/card-form\|components/cards/card-item\|components/cards/card-detail-actions" app components lib --include="*.tsx" --include="*.ts" || echo "无引用"
```

若输出为空（`/qa` 已改为 redirect，`/english` 已删除），执行：

```bash
cd /j/Programs/Learning && rm components/ai/ai-chat.tsx components/cards/card-form.tsx components/cards/card-item.tsx components/cards/card-detail-actions.tsx
```

- [ ] **Step 6: 验证**

Run: `cd /j/Programs/Learning && npm run typecheck`
Expected: 无错误。若 `english/page.tsx` 删除导致 `prisma` 相关类型残留引用报错，一并清理。

- [ ] **Step 7: 提交**

```bash
cd /j/Programs/Learning && git add -A && git commit -m "refactor: 页面整合——导航精简为4项，/qa 重定向画布，删除复习/路线图/英语独立页，画布新增项目记忆抽屉"
```

---

### Task 10: 全量验证与收尾

**Files:**
- Verify: 全项目

- [ ] **Step 1: 类型检查 + 生产构建**

Run: `cd /j/Programs/Learning && npm run typecheck && npm run build`
Expected: `tsc --noEmit` 无错误；`next build` 成功（各路由编译通过，无 lint 错误）。

- [ ] **Step 2: 手动功能验证清单（启动 dev server）**

Run: `cd /j/Programs/Learning && npm run dev`（后台运行）

逐项验证：

1. 侧边栏「添加卡片」→ 打开新建对话框（不再直接创建空白卡片）。
2. 画布双击空白 → 打开新建对话框。
3. 对话框填写标题/内容/标签/学习方式/颜色/宽度 → 保存 → 画布出现新卡片。
4. 点卡片 ✏️ → 打开编辑对话框，内容预填。
5. 点卡片 ✨ → 打开编辑对话框并聚焦「提问」Tab。
6. 设置页配置一个 language 模型（apiKey 可用 `${ENV_VAR}`），返回画布打开对话框 → AI 面板模型下拉可选该模型。
7. 「提问」Tab 发送消息 → 流式回答；关闭对话框重开 → 对话历史仍在。
8. 「生成」Tab 输入文本 → 生成预览 → 「创建为卡片」在画布生成新卡片。
9. 「扩展」Tab → 创建进阶卡片（带"延伸拓展"关系线）。
10. 「数学」Tab 输入题目 → 结果渲染 LaTeX → 填入表单。
11. 选中多张卡片 → 侧边栏「AI 转化」→ 提炼预览 → 勾选导入 → toast 成功，/learn 可见新条目。
12. 编辑卡片未保存直接关闭 → 重开对话框提示「已恢复上次未保存的内容」；保存后重开不提示。
13. 主导航仅 4 项；访问 `/qa` 自动跳转 `/canvas`；`/review`、`/roadmap`、`/english` 返回 404。
14. 画布右下角项目记忆按钮 → 打开记忆面板。
15. 撤销/重做、复制/粘贴、标签筛选、层级面板等原有功能不受影响。

- [ ] **Step 3: 更新设计进度文档（可选）**

若 `.doc/PROGRESS.md` 存在，追加本次改造摘要。

- [ ] **Step 4: 最终提交（如有验证期修复）**

```bash
cd /j/Programs/Learning && git add -A && git commit -m "chore: 全量验证与收尾"
```

---

## Self-Review 备注

- **规格覆盖**：§3（CardDialog）→ Task 5/6；§4（模型接入）→ Task 2/3；§5（桥接）→ Task 8；§6（草稿/历史）→ Task 4/6；§7（页面整合）→ Task 9；§8（错误处理）→ 各任务内 toast/回退逻辑；§9.4（learningMode/metadata）→ Task 7 Step 5。
- **对话历史存储**：规格 §6.2 建议独立 key `card-dialog:chat:{id}`，实现将其并入草稿 `CardDraft.ai.chatMessages`（同一 localStorage 持久化语义，key 数量更少，行为一致）。
- **项目记忆抽屉**：规格 §7.2 的二选一，选择「画布右下角可折叠抽屉」方案，复用现有 `ProjectMemoryPanel`。
- **桥接链路**：规格 §5.2 要求复用 `/api/learn/import-canvas`，实现通过构造合成 CanvasState 达成。
- **类型一致性**：`LearningMode` 定义于 `use-card-dialog-draft.ts`，`card-dialog-types.ts` 复用之；`CardDialogState`/`CardDialogPayload`/`CreateNodeItem` 唯一出处为 `card-dialog-types.ts`；`AiReviewBridge` 的 props（open/onClose/nodes）在 Task 7 占位与 Task 8 完整实现中一致。
