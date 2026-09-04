# LearnForge

> AI 赋能的便签卡片式 Web 学习工具 —— 画布知识管理 + 间隔重复单词学习 + AI 辅助 + 插件生态。

[English](./README.md)

## 项目简介

**LearnForge**（`learnforge-web`）由 Python 命令行数据处理系统重构而成（旧 `src/` 保留为数据包导入工具），是一个集自由画布、状态机驱动单词学习引擎与 AI 能力于一体的 Web 学习工具。

### 核心功能

- **知识卡片画布**：React Flow 自由画布 + 浮动工具/标签面板 + 项目记忆抽屉 + KaTeX 数学公式渲染 + 文字高光编辑
- **单词复式学习**：SM-2 变体间隔重复引擎，5 因子推荐打分，4 种考查形式（挖空/拼写/看释义/选择），前端状态机驱动
- **时间线**：历史大事件可视化整理（`/timeline`），支持时间点/时间段、公元前年份、AI 自然语言批量解析、重合事件分层分色
- **AI 赋能**：卡片生成/扩展、数学解题、针对卡片提问、AI 提炼复式学习条目（Vercel AI SDK v3，多 Provider 流式）
- **插件/技能系统**：声明式 manifest + 权限作用域，外部 AI 以 OpenAI function-calling 协议操作画布
- **局域网访问**：按需开启，支持手机端协同，防 Host 伪造窃取令牌
- **数据导入**：兼容原 `pack.json + data/*.json` 格式
- **数据安全**：乐观锁防丢失、快照恢复、变更日志、SyncAdapter 同步抽象

### 系统架构

```
LearnForge (Web 应用)
    ├── 画布层 (React Flow) ── 卡片 CRUD / 连线 / 布局持久化
    ├── 学习层 (状态机) ── 推荐算法 / 特征引擎 / 间隔重复
    ├── 时间线层 ── Timeline/TimelineEvent 模型 / 视图算法 / AI 解析
    ├── AI 层 (AI SDK v3) ── 多 Provider / 流式 / function-calling
    ├── 插件层 (Harness) ── manifest 注册 / 权限校验 / 审计日志
    └── 数据层 (Prisma + SQLite) ── 卡片 / 学习画像 / 快照 / 变更日志
```

## 技术栈

| 层 | 技术 |
|----|------|
| 框架 | Next.js 14 (App Router) + React 18 + TypeScript |
| 样式 | Tailwind CSS 3（自研轻量 UI 组件库） |
| 数据库 | Prisma 5 + SQLite（可迁移 PostgreSQL） |
| 可视化 | React Flow（画布）+ KaTeX（数学公式，惰性加载） |
| 富文本 | Tiptap（含自研高亮 Mark 扩展） |
| AI | Vercel AI SDK v3（多 Provider，流式），provider-resolver 按 modelId 解析 |
| 校验 | Zod |
| 状态 | Zustand + React Query + localStorage 持久化 |
| 测试 | Vitest 4 + @testing-library/react + jsdom（lib/ 覆盖率目标 ≥80%） |

## 快速开始

### 前置要求

- Node.js >= 18.17（建议 20 LTS）
- npm >= 9

### 一键脚本

**Windows（PowerShell）：**
```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

**macOS / Linux（Bash）：**
```bash
chmod +x scripts/setup.sh && ./scripts/setup.sh
```

脚本会检测依赖、从 `.env.example` 生成 `.env.local`、执行 `prisma generate` + `db push`，并启动开发服务器。

### 手动安装

```bash
npm install
cp .env.example .env.local   # 按需填写配置
npx prisma generate
npx prisma db push
npm run dev                  # http://localhost:3000
```

### 启动模式

```bat
:: 默认（仅回环绑定，禁止局域网访问）
start-dev.bat

:: 局域网模式（绑定 0.0.0.0，禁用自动令牌端点，手机可访问）
start-dev-lan.bat

:: 停止
stop-dev.bat
```

> 局域网模式下，手机首次访问需手动输入 `LOCAL_ACCESS_TOKEN`（若已配置），输入一次后 localStorage 记住。详见 [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)。

## 项目结构

```
app/                    # Next.js App Router
├── (main)/             # 页面：canvas / learn / timeline / stats / settings / import / qa / tools/codec
├── api/                # Route Handlers（cards / ai / learn / timelines / settings / plugins / canvas-* 等）
components/
├── ui/                 # 基础组件：Dialog / Tabs / Select / Badge / Button
├── cards/              # 画布：card-canvas / free-card-node / card-dialog / rich-text-editor
├── learn/              # 学习：learn-session / question-renderer（状态机）
├── timeline/           # 时间线：timeline-view / timeline-selector / event-dialog / ai-input-bar
├── ai/                 # project-memory-panel / ai-review-bridge
├── settings/           # 设置分区（模型配置 / 任务绑定 / 编解码器 / 插件管理）
└── shared/             # main-nav / theme-toggle / toaster
lib/
├── ai/                 # Provider 抽象、resolver、prompts
├── learning/           # 特征引擎 / 推荐算法 / 定时任务 / auth / soft-layout
├── sync/               # SyncAdapter 抽象接口 + local 实现（乐观锁 / 快照 / 变更日志）
├── services/           # 业务层（cards / timelines / project-memory）
├── timeline/           # 时间线视图算法（view-scale 纯函数）
├── plugins/            # manifest / scopes / permissions / builtin / service
├── editor/             # 编辑器扩展（高亮 mark / 净化）
└── utils/              # cn / http-error（统一错误响应）
prisma/                 # schema.prisma（SQLite）
test/                   # Vitest 单元测试（lib/ 各模块镜像结构）
datapacks/              # 源数据包
data/                   # 导入数据 + SQLite 数据库
scripts/                # setup.ps1 / setup.sh / seed / git-net / ai-tools-demo
src/                    # 遗留 Python 数据包读取/处理工具（导入用，保留）
docs/                   # DEPLOYMENT.md / PLUGIN_DEV.md / examples / superpowers（历史设计文档）
```

## 功能页面

| 路由 | 功能 |
|------|------|
| `/canvas` | 全屏知识卡片画布 + 浮动面板 + 项目记忆抽屉 + CardDialog（AI 整合） |
| `/learn` | 复式学习（测验 + 推荐 + 复习，4 种考查形式） |
| `/timeline` | 历史大事件时间线（创建/编辑/AI 解析/重合事件分层分色） |
| `/qa` | 重定向 `/canvas`（AI 问答已并入卡片对话框） |
| `/stats` | 学习统计（近 5 年窗口） |
| `/settings` | AI 模型配置 / 多 Key 轮换池 / 知识库 / 数据管理 / 编解码器 / 插件管理 |
| `/import` | 数据导入 |
| `/tools/codec` | `.lfdata` 文件编解码器 |
| `/` | 重定向 `/canvas` |

## npm 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 生产构建 |
| `npm run start` | 启动生产服务器 |
| `npm run lint` | ESLint 检查（next/core-web-vitals） |
| `npm run typecheck` | TypeScript 类型检查（不输出文件） |
| `npm run test` | 运行一次 Vitest |
| `npm run test:watch` | Vitest 监听模式 |
| `npm run test:coverage` | Vitest 覆盖率报告 |
| `npm run db:generate` | 生成 Prisma Client |
| `npm run db:migrate` | Prisma 迁移（开发） |
| `npm run db:push` | Prisma 同步 schema 到数据库 |
| `npm run db:seed` | 填充种子数据 |

## 环境变量

关键变量（完整列表见 `.env.example`）：

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | SQLite 文件路径（默认 `file:./data/learnforge.db`） |
| `NEXTAUTH_SECRET` | NextAuth 密钥（必填） |
| `NEXTAUTH_URL` | 应用 URL（默认 `http://localhost:3000`） |
| `AI_PROVIDER` / `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` | 默认 AI Provider 配置 |
| `LOCAL_ACCESS_TOKEN` | 可选 API 访问令牌（局域网/公网部署强烈建议设置） |
| `CRON_SECRET` | `/api/cron/optimize` 的 Bearer 令牌 |
| `LAN_ACCESS` | 运行时标记，由 `start-dev-lan.bat` 注入（勿写入 .env） |

## 文档

| 文档 | 内容 |
|------|------|
| [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) | 部署指南、环境变量、FAQ、局域网访问 |
| [docs/PLUGIN_DEV.md](./docs/PLUGIN_DEV.md) | 插件/技能开发指南 + manifest 规范 |
| [docs/examples/plugin-manifest.example.json](./docs/examples/plugin-manifest.example.json) | 插件 manifest 示例 |

## 数据包格式

学习数据以数据包（DataPack）形式组织，位于 `datapacks/` 目录：

```
datapacks/your-pack-name/
├── pack.json        # 核心配置（information / structure / type_map）
└── data/            # 数据文件（JSON）
    ├── 1.json
    ├── 2.json
    └── ...
```

`pack.json` 包含三部分：
- **information**：数据包元信息（name / description / uuid / type）
- **structure**：数据结构映射（entrance 入口文件夹 + key_map 字段映射）
- **type_map**：词性映射（标准词性 → 多种显示格式）

数据包类型：`words_pack`（单词包）、`sentence_pack`（句子包）、`compound_pack`（复合包）。

## 质量门禁

开发期质量标准（每次 feature 合入前）：

```bash
npm run typecheck   # 0 错误
npm run lint        # 0 警告
npm run test        # 全绿 + 覆盖率达标（lib/ ≥80%）
npm run build       # 生产构建通过
```

当前基线（2026-08-28）：typecheck 0 错误、lint 0 警告、test 188/188 通过（18 文件）、build 通过。

## 许可

私有项目。
