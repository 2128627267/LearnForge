# 设计规格：卡片对话框 AI 整合与双学习模式

- 日期：2026-07-31
- 状态：已批准（用户确认）
- 目标页面：`/canvas` 画布页

## 1. 背景与目标

当前 LearnForge Web 应用存在三处"半成品"断点，导致 AI 能力无法真正服务于学习：

1. **AI 提问独立于卡片**：`/qa` 页面与画布卡片无关联，无法针对某张卡片提问；`AIChat` 每次提问新建会话，`conversationId` 从未传回，多轮上下文实际不生效。
2. **模型配置与运行时脱节**：设置页的 `AIModelConfig` 表 + `AITaskBinding` 表已有完整 CRUD UI，但运行时 provider（`lib/ai/provider-openai.ts`）只读环境变量，用户无法选择模型。
3. **AI 能力未接线**：`/api/ai/generate-cards`、`/api/ai/extend-explore`、`/api/ai/math-solve` 三个 endpoint 完整实现但无 UI 入口；`AIConversation.cardId` 预留了卡片关联却无使用。

**本设计目标**：

- 将 AI 提问/生成/扩展/数学能力全部并入画布卡片的编辑对话框，卡片创建与编辑统一走对话框。
- 运行时模型选择器接入 `AIModelConfig`，让"自由选择配置的模型"真正生效。
- 引入**双学习模式**：深度学习（canvas + AI + 关系线）与复式学习（quiz + recommend + review），由 AI 桥接转化打通。
- 草稿缓存 + 对话历史持久化。
- 页面整合与视觉统一：主导航精简为 4 项，删除死链/占位页。

## 2. 双学习模式架构

```
┌────────────────────── 深度学习 ──────────────────────┐
│  /canvas 画布（localStorage 卡片）                     │
│  · 自由卡片 + 关系线 + 撤销/搜索/标签                  │
│  · 卡片对话框（编辑 + AI 提问/生成/扩展/数学）           │
│  · 新增：学习模式标记、metadata、AI 生成内容            │
└──────────────────────┬──────────────────────────────┘
                       │ ① AI 桥接转化（选中→提炼→预览→导入）
                       ▼
┌────────────────────── 复式学习 ──────────────────────┐
│  DB 卡片 + WordProfile（Prisma）                     │
│  · quiz / recommend / review（SM-2）＝ /learn         │
│  · 学科字段保留（服务单词/句子数据）                    │
└─────────────────────────────────────────────────────┘
模型配置：AIModelConfig 表 → 运行时 provider（对话框可选模型）
```

### 2.1 学习模式定义

| 学习模式 | 载体 | 面向 | 学习方式 |
|---|---|---|---|
| 深度学习（deep） | 画布卡片（localStorage） | 理科逻辑、理解、知识体系 | canvas + AI 提问/生成/扩展 + 关系线 |
| 复式学习（review） | DB 卡片 + WordProfile | 记忆、运用 | quiz + recommend + review（SM-2） |
| 两者（both） | 画布卡片 + 可导入 DB | 先理解后记忆 | 深度学习产出 → AI 桥接 → 复式学习巩固 |

卡片格式不再按学科硬编码（不做"英语专属字段"/"数学专属字段"表单区分）；卡片具体内容结构由 AI 生成时按知识性质自动决定（数学→公式+解法，概念→定义+例子，单词→释义+例句……）。

## 3. 卡片对话框（核心组件 `CardDialog`）

### 3.1 布局（方案 B：编辑 + AI 侧栏）

```
┌────────────────────────────────────────────────────────┐
│ 编辑卡片  ◼ 新建卡片                 [AI 模型: gpt-4o ▾] │
│ ┌───────────────────┐  ┌──────────────────────────────┐ │
│ │ 标题 [___________] │  │ ┌──────────────────────────┐ │ │
│ │ 学习模式 [深度▾]    │  │ │ 提问 │ 生成 │ 扩展 │ 数学  │ │ │
│ │ 内容（Tiptap富文本  │  │ └──────────────────────────┘ │ │
│ │   + LaTeX 支持）    │  │   AI 内容区                   │ │
│ │ 标签 [___] [添加]   │  │   · 提问：流式对话（多轮）      │ │
│ │ 颜色 ▓▓▓▓ 宽度 [▾]  │  │   · 生成：素材→多卡片→预览填入  │ │
│ └───────────────────┘  │   · 扩展：进阶/应用/跨学科→建关系 │ │
│                        │   · 数学：解题+公式→填入卡片      │ │
│                        └──────────────────────────────┘ │
│                    [取消] [保存卡片]                       │
└────────────────────────────────────────────────────────┘
```

### 3.2 触发方式

| 触发 | 打开状态 |
|---|---|
| 侧边栏「添加卡片」按钮 / 双击画布空白 | 新建对话框（草稿 key：`card-dialog:draft:new`） |
| 选中卡片点 ✏️（编辑图标） | 编辑对话框（草稿 key：`card-dialog:draft:{cardId}`） |
| 选中卡片点 🤖（AI 图标） | 编辑对话框，聚焦「提问」Tab |

- 原有卡片**内联编辑**（free-card-node 内的 Tiptap 原地展开）**移除**，统一走对话框。
- 原有侧边栏「添加卡片」直接创建空白卡片的快速路径保留：点击后打开**新建对话框**（预填标题"新卡片"，内容空），而不是直接落盘——保留原有功能语义（点按钮就准备创建卡片），但入口收敛为对话框。

### 3.3 编辑表单（通用化）

字段：标题、内容（Tiptap 富文本，保留 `$...$` LaTeX 纯文本约定）、标签（增删）、颜色（色板）、学习模式（deep/review/both）、宽度。不再按学科展示专属字段。

### 3.4 AI 侧栏

- **模型选择器**：顶部下拉，数据来自 `AIModelConfig`（`category=language` 且 `isActive`）。请求带 `modelId`。
- **Tab 区**（4 个 Tab，均可流式输出、支持 LaTeX 渲染）：

| Tab | 功能 | 输入 | 输出 | 落点 |
|---|---|---|---|---|
| 提问 | 针对当前卡片内容的自由多轮对话 | 用户消息（上下文=当前卡片标题+内容+历史消息） | 流式文本 | 对话区 |
| 生成 | AI 生成卡片 | 素材文本（可引用当前卡片内容） | 结构化多卡片（title/content/type/difficulty/tags） | 预览 → 一键填入表单 / 直接创建为画布新卡片 |
| 扩展 | 知识扩展 | 当前卡片内容 | advanced/applications/crossSubject/suggestedOrder | 预览 → 一键创建关联卡片 + 关系线 |
| 数学 | 解题 | 题目文本 | 解法 + 公式 + 答案 | 预览 → 填入表单 |

- 复用现有：`RichCardContent`（KaTeX 渲染）、`AICardExtractionSchema`、`/api/ai/generate-cards`、`/api/ai/extend-explore`、`/api/ai/math-solve` 的 prompt/输出约定。

## 4. 模型运行时接入

### 4.1 现状断点

`OpenAICompatProvider`（`lib/ai/provider-openai.ts`）只读 `AI_PROVIDER/AI_API_KEY/AI_BASE_URL/AI_MODEL` 环境变量；`AIModelConfig`/`AITaskBinding` 的运行时消费路径未打通。

### 4.2 改动

1. **新增 `lib/ai/provider-resolver.ts`**：`resolveChatModel(modelId?)` —— 按 `modelId` 查 `AIModelConfig`（active 校验）→ `env-resolver.resolveValue` 解析 apiKey/apiUrl → 创建 OpenAI 兼容 provider；未传 `modelId` 时回退顺序：`AITaskBinding(chat).primaryModelId` → 环境变量 `AI_MODEL/AI_API_KEY/AI_BASE_URL`。
2. **所有 AI route**（`/api/ai/qa`、`generate-cards`、`extend-explore`、`math-solve`、新增桥接 route）请求体增加可选 `modelId`，服务端经 `resolveChatModel` 解析后调用 provider。
3. **对话框模型选择器**：`GET /api/settings/models?category=language&includeInactive=false` → 下拉；切换即写入请求体。
4. **无可用模型**：AI 面板禁用，提示「请先在设置页配置模型」并附 `/settings` 链接。

## 5. AI 桥接：复式学习转化

### 5.1 流程

```
选中卡片（勾选含 review/both 模式或全部）→ 侧边栏/工具栏「AI 转化复式学习」
  → POST /api/ai/to-review-list { cardIds, modelId? }
  → AI 分析画布卡片内容 → 生成 [{ kind: 'word'|'sentence', ... }]
      word: 拼写/音标/词性/释义/例句
      sentence: 原文/翻译/重点词
  → 预览表格（可勾选/编辑/丢弃）→ 确认
  → 复用 /api/learn/import-canvas 链路创建 DB Card + WordProfile
  → toast「已导入，可前往 /learn 复式学习」
```

### 5.2 关键点

- 输出 schema 由 AI 决定类型（word/sentence 或更多），前端预览表格按 kind 渲染对应列。
- 部分失败：列出失败条目，可重试（复用现有错误处理模式）。
- 新 route `/api/ai/to-review-list` 参照 `generate-cards` 的流式 + JSON 解析模式。

## 6. 草稿缓存 + 对话历史

### 6.1 草稿（localStorage）

| key | 内容 | 清除时机 |
|---|---|---|
| `card-dialog:draft:new` | 新建卡片未保存的表单 + AI 各 Tab 输入 | 保存/创建成功、手动丢弃 |
| `card-dialog:draft:{cardId}` | 编辑卡片未保存的表单 + AI 各 Tab 输入 | 保存成功、手动丢弃 |

- 对话框关闭且表单非空 → 自动写缓存；重新打开恢复并提示「已恢复草稿」。
- 新建与编辑分别缓存，互不覆盖。

### 6.2 对话历史（localStorage）

- `card-dialog:chat:{cardId}` / `card-dialog:chat:new`：该卡片（或新建流程）的 AI 提问多轮消息。
- 同一卡片反复打开上下文不丢失；提供「清空对话」按钮。
- 对话历史**本地持久化**（不依赖 DB 会话），轻量、离线可用；DB 会话表保留现状不动。

## 7. 页面整合 + 视觉统一

### 7.1 页面变更

| 页面 | 处置 |
|---|---|
| `/stats` | 保留（统计） |
| `/canvas` | 保留（核心画布，本次改造主战场） |
| `/learn` | 保留（复式学习：quiz/recommend/review） |
| `/settings` | 保留（模型配置等） |
| `/qa` | **删除**，`/qa` 重定向到 `/canvas`；`AIChat`/`ProjectMemoryPanel` 能力迁入画布（项目记忆可暂不迁移，作为独立面板保留在画布侧栏或移除，见 7.2） |
| `/review` | **删除**（死链页，复式学习在 /learn 内完成） |
| `/roadmap` | **删除**（占位页，路线图由画布关系线 + 扩展探索替代） |
| `/english` | **删除**，入口并入 `/learn` |
| `/import` | 保留为工具页（不入主导航） |
| `/tools/codec` | 保留为工具页（不入主导航） |

### 7.2 主导航

精简为 4 项：`/stats` 统计、`/canvas` 画布、`/learn` 学习、`/settings` 设置。

项目记忆面板（`ProjectMemoryPanel`）：迁入画布侧栏（SidePanel 新增 Tab 或在对话框 AI 面板顶部提供快捷查看）；若迁移成本过高，允许在本次设计中**保留独立面板组件但挂在画布页面**（画布右缘新增可折叠记忆抽屉）。实现时以成本与一致性权衡，二者必选其一。

### 7.3 视觉统一

- 新增公共组件（从 `model-config-section.tsx` 手写范式提炼）：`components/ui/dialog.tsx`、`components/ui/tabs.tsx`、`components/ui/select.tsx`。
- 统一对话框/弹层遮罩、圆角/阴影/间距/过渡动画。
- 移除画布卡片内联编辑，避免两套编辑 UI 并存。

## 8. 错误处理

| 场景 | 处理 |
|---|---|
| AI 流式错误（无模型/密钥无效/超时/网络） | toast.error + 对话框内错误状态；不丢失已输入内容，可重试 |
| AI 输出 JSON 解析失败 | 展示原始文本 + 「重试」按钮 |
| 模型选择器空（未配置模型） | AI 面板禁用，提示前往 /settings |
| 桥接导入部分失败 | 列出失败条目，支持单条重试 |
| 草稿损坏（JSON parse 失败） | 清除该 key 的损坏数据（复用 use-local-storage.ts 的防御模式） |

## 9. 技术要点与文件影响

### 9.1 新增文件

- `components/cards/card-dialog.tsx` — 对话框主组件（编辑表单 + AI 侧栏）
- `components/cards/card-dialog-ai-panel.tsx` — AI 侧栏（模型选择 + 4 Tab）
- `components/cards/ai-review-bridge.tsx` — 桥接转化预览/确认
- `lib/ai/provider-resolver.ts` — 模型解析
- `app/api/ai/to-review-list/route.ts` — 桥接生成 API
- `components/ui/dialog.tsx`、`components/ui/tabs.tsx`、`components/ui/select.tsx`
- `lib/hooks/use-card-dialog-draft.ts` — 草稿缓存 hook

### 9.2 修改文件

- `components/cards/free-card-node.tsx` — 编辑图标改触发对话框（移除内联编辑区）；新增 🤖 AI 图标
- `components/cards/card-canvas.tsx` — 对话框状态管理、双击空白/添加卡片触发新建
- `components/cards/side-panel.tsx` — 添加卡片走对话框；新增「AI 转化复式学习」入口（选中时可用）
- `app/api/ai/qa/route.ts`、`generate-cards/route.ts`、`extend-explore/route.ts`、`math-solve/route.ts` — 支持 `modelId`
- `components/shared/main-nav.tsx` — 4 项导航
- `app/(main)/layout.tsx` — 移除 /qa 等页面相关处理（如需要）
- `lib/hooks/use-local-storage.ts` — 视需要暴露草稿存储通用能力

### 9.3 删除文件

- `app/(main)/qa/`、`app/(main)/review/`、`app/(main)/roadmap/`、`app/(main)/english/`
- `components/ai/ai-chat.tsx`（能力迁入 CardDialog AI 面板；若项目记忆面板也删除则一并移除）
- `components/cards/card-form.tsx`、`card-item.tsx`、`card-detail-actions.tsx`（孤儿组件，确认无引用后移除）

### 9.4 画布卡片数据模型（localStorage 内，`FreeCardData`）

新增字段：`learningMode?: 'deep' | 'review' | 'both'`（默认 `deep`）；`metadata?: string`（JSON，AI 生成的结构化内容；沿用现有 `metadata` 习惯）。

## 10. 成功标准

1. 画布上新建/编辑卡片全部经 `CardDialog`，内联编辑已移除。
2. 对话框可选择 `AIModelConfig` 中任意激活的语言模型，切换即生效。
3. 针对卡片提问可多轮对话（上下文基于卡片内容），对话历史刷新后仍可恢复。
4. 生成/扩展/数学输出可一键填入表单或创建为画布新卡片（扩展可带关系线）。
5. 选中卡片可 AI 转化为单词/句子列表并导入 `/learn` 复式学习。
6. 关闭未保存对话框后重开，草稿恢复并有提示。
7. 主导航 4 项；`/qa`、`/review`、`/roadmap`、`/english` 已移除（/qa 重定向）；无死链。
8. `npm run build` 通过；`npm run typecheck` 无错误。
