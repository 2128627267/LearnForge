# 设计规格：旧版 AISettings 迁移到 AIModelConfig 体系

- 日期：2026-08-01
- 状态：已批准（用户确认）
- 目标：移除遗留的 `/api/settings/ai` 旧版 AI 配置体系，数据迁移至 `AIModelConfig` + `AITaskBinding`，并适配全部消费者

## 1. 背景与目标

项目存在两套 AI 配置体系：

| 体系 | 载体 | 状态 |
|---|---|---|
| 新版 | `AIModelConfig` 表 + `AITaskBinding` 表，CRUD API `/api/settings/models`、`/api/settings/task-bindings`，UI `ModelConfigSection`/`TaskBindingSection`，运行时 `lib/ai/provider-resolver.ts` 已接入 | 现行 |
| 旧版 | 单行 `AISettings` 表（id="default"），API `/api/settings/ai`（GET/PUT），UI「AI 库配置（旧版兼容）」卡片，schema 标注 deprecated | 遗留 |

**探索确认的关键事实**：

- 旧版 `temperature`/`maxTokens`/`ragEnabled`/`ragTopK`/`apiKeys` 轮换池/`currentKeyIdx`/`embeddingDims` 全部是**死字段**——运行时零消费（provider 只读环境变量，`app/api/settings/knowledge` 注释明示 RAG 未实现，QA 只注入 ProjectMemory）。
- 真正有数据价值的是 `apiKey`/`apiUrl`/`chatModel`/`embeddingModel`。
- 消费者共三处：`app/api/settings/ai/route.ts`、`components/settings/settings-panel.tsx` 旧卡片与导入导出、`app/(main)/tools/codec/page.tsx` 的 `applySettings`。
- `package.json` 的 `"import:legacy": "tsx scripts/import-legacy.ts"` 已声明但脚本文件缺失——本次迁移补上，作为迁移脚本落点。

**本设计目标**：

1. 数据迁移：旧版凭据/模型 → 新版 AIModelConfig + AITaskBinding。
2. 删除旧版：`/api/settings/ai` 路由、`AISettings` 表、设置页旧卡片。
3. 消费者适配：codec 的 settings 应用改为写新版 models API；导入备份中 `aiSettings` 键忽略并提示。
4. 全程幂等、可验证、无运行时破坏。

## 2. 数据迁移脚本 `scripts/import-legacy.ts`

手动运行（补上 package.json 已声明脚本），幂等 upsert：

```
读取 AISettings(id="default")
├─ 存在 apiKey 且 chatModel → upsert language 配置：
│    name="旧版迁移语言模型"  category="language"
│    provider=activeProvider（openai/anthropic/deepseek 直接映射，local→local，其他→custom）
│    modelName=chatModel  apiKey  apiUrl（原值存储，含 ${ENV_VAR}/file:// 语法原样保留）
│    metadata={ migratedFromLegacy: true, migratedAt: ISO }
│    幂等：按 metadata.migratedFromLegacy=true 或 name 精确匹配查找，存在则跳过
├─ 存在 embeddingModel → 同模式 upsert embedding 配置（name="旧版迁移嵌入模型"）
├─ 若创建了 language 配置 且 AITaskBinding(chat) 不存在 → 创建 chat 绑定 primaryModelId
└─ 输出摘要：创建 N 条 / 跳过 M 条 / 绑定 B 条
```

关键约束：

- 直接读 DB 取**真值** apiKey（GET 响应脱敏，脚本绕过 API 直连 Prisma，参照 `scripts/seed.ts` 用 `new PrismaClient()`）。
- 无 AISettings 行或字段为空 → 打印「无数据可迁移」，正常退出（退出码 0）。
- 未设置 chat 绑定且无语言模型 → 不动。
- 不动已有新版配置（不覆盖、不删除）。

## 3. 删除旧版

| 项 | 处置 |
|---|---|
| `app/api/settings/ai/route.ts` | 删除文件 |
| `prisma/schema.prisma` 中 `AISettings` 模型（约 594-621 行）及重构说明注释 | 删除 + `npx prisma migrate dev --name remove-legacy-ai-settings` |
| `package.json` scripts：`"import:legacy"` | 保留命令但指向真实存在的 `scripts/import-legacy.ts`（本次创建） |
| `lib/ai/index.ts` / provider 链 | 不受影响（从不读 AISettings） |

## 4. 设置页 `settings-panel.tsx`

- 删除「AI 库配置（旧版兼容）」卡片（约 565-874 行）及其全部关联状态/函数：
  - 状态：`aiSettings`（59-74）、`showApiKey`、`newKeyLabel`/`newKeyValue`、`aiLoading`/`aiSaving`
  - 函数：`loadAISettings`、`handleSaveAI`、`updateField`（若仅旧卡片使用则删）、`handleAddKey`、`handleRemoveKey`
  - 常量：`AISettings` 接口、`DEFAULT_AI_SETTINGS`、`PROVIDERS`
  - 导入导出：`handleExport` 的 JSON 移除 `aiSettings` 键；`handleImportSettings` 遇 `payload.aiSettings || payload.ai` 时忽略并 `toast.info("旧版 AI 配置已迁移，请在新版模型配置中设置")`，不阻断其他数据导入
- 新版 `ModelConfigSection`/`TaskBindingSection` 已在页面顶部，无需改动。

## 5. codec `applySettings` 适配新版

`app/(main)/tools/codec/page.tsx` 的 `applySettings`（约 470-492 行）改为调用 `POST /api/settings/models`（创建配置），替换原 `PUT /api/settings/ai`：

| settings body 字段 | 新版映射 |
|---|---|
| `modelName` | 必填；缺失则 toast.warning「该配置不含模型标识（modelName），无法应用」，返回 |
| `provider`（可选） | AIModelConfig.provider（默认 `custom`） |
| `apiKey` / `apiUrl`（可选） | 对应字段（原样存，支持 `${ENV_VAR}`/`file://`） |
| `name`（可选） | AIModelConfig.name（默认「导入配置」） |
| `category`（可选） | category（默认 `language`，仅允许 language/embedding） |
| `bindTo`（可选 `"chat"`/`"embedding"`） | 创建成功后 `PUT /api/settings/task-bindings` 设置绑定 |
| `temperature`/`maxTokens`/`ragEnabled`/`ragTopK` | 忽略（死字段，不写入） |

配套更新：

- `.lfdata` 快速模板（约 135 行）改为含 `modelName` 的示例，如 `{ "name": "示例模型", "modelName": "gpt-4o-mini", "provider": "openai", "apiKey": "${OPENAI_API_KEY}", "bindTo": "chat" }`。
- 确认对话框文案（约 518-522 行）改为「确定要将解码内容应用为新模型配置吗？」。
- 成功 toast 改为提示新配置 id/name（若有 bindTo 则提示已绑定）。

## 6. 验证

1. `npm run typecheck` 无错误。
2. `npm run build` 通过（`/api/settings/ai` 路由消失，无旧卡片）。
3. 迁移脚本运行：`npx tsx scripts/import-legacy.ts` 输出摘要；重复运行幂等（第二次全部跳过）。
4. 全项目 grep `settings/ai`、`aISettings`、`AISettings`、`aiSettings`（除设计文档外）应无残留。
5. Prisma 迁移后 `npx prisma migrate dev` 状态同步（`prisma/data/learnforge.db` 不再含 AISettings 表）。

## 7. 不在本次范围

- `lib/ai/provider-openai.ts` 的 env 回退链（AI_PROVIDER/AI_API_KEY/AI_BASE_URL/AI_MODEL）——保留，作为第三级回退。
- `lib/learning/tasks/ai-semantic.ts`、`app/api/learn/ai-complete/route.ts` 仍用 `getAIProvider()`（env 模式）——保留，后续任务可选接入 resolveChatProvider。
- 为 `temperature/maxTokens` 等引入新版全局参数——无消费方，YAGNI。
- `AIModelConfig.metadata` 的 UI 编辑——无消费方，不做。

## 8. 成功标准

1. `npm run import:legacy` 可将旧版凭据/模型迁移到新版并建立 chat 绑定；重复运行幂等。
2. `/api/settings/ai` 与 `AISettings` 表完全移除，无任何代码引用。
3. 设置页不再显示「旧版兼容」卡片；导出 JSON 无 `aiSettings` 键；导入旧备份不报错并提示。
4. codec 可把 settings 类型 .lfdata 应用为新版模型配置（含可选绑定）；不含 modelName 的旧模板被拒并提示。
5. `npm run typecheck` + `npm run build` 通过；grep 无残留。
