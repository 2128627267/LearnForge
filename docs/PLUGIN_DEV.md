# LearnForge 插件开发指南

> LearnForge 插件/技能系统让外部 AI（Agent/模型/脚本）以"声明式清单 + 权限受控"方式接入画布。
> 本文档为面向插件作者的完整自含规范；协议细节的内部设计记录见开发环境 `.doc/` 目录（不入库）。

## 1. 概念速览

- **插件（Skill）**：一个 JSON manifest，声明元信息、权限作用域与一组工具
- **工具（Tool）**：OpenAI function-calling 格式 + HTTP 端点映射 + 所需权限
- **能力清单**：`GET /api/ai/capabilities` 聚合所有**启用**插件的工具
- **权限执行**：调用时携带 `x-plugin-id` header，服务端按权限作用域校验并写审计日志

插件**不做代码执行**——工具由 LearnForge 既有 HTTP 端点实现，插件只负责"把哪些工具、以什么权限暴露给模型"。

## 2. Manifest 结构

```jsonc
{
  // 必填
  "name": "my-study-pack",            // 唯一标识，kebab-case
  "displayName": "我的学习工具包",      // 展示名
  "version": "1.0.0",                  // semver
  "permissions": ["cards:read", "canvas:write"],   // 权限总集
  "tools": [
    {
      "name": "search_cards",          // 全局唯一工具名，snake_case
      "description": "按关键词搜索卡片",
      "parameters": {                  // JSON Schema（function-calling 格式）
        "type": "object",
        "properties": {
          "keyword": { "type": "string", "description": "搜索关键词" }
        },
        "required": ["keyword"]
      },
      "endpoint": { "method": "GET", "url": "/api/cards" },
      "permissions": ["cards:read"]    // 必须是插件 permissions 的子集
    }
  ],
  // 可选
  "description": "…",
  "author": "…"
}
```

校验规则（安装时违反即 400）：

| 规则 | 说明 |
|------|------|
| 结构 | zod schema 校验（字段类型/长度/格式） |
| 命名 | 插件名 kebab-case；工具名 snake_case |
| 工具名全局唯一 | 跨插件冲突拒绝安装（409） |
| `tools[].permissions ⊆ permissions` | 工具所需必须是插件声明总集的子集 |
| `endpoint.url` 以 `/api/` 开头 | 禁止外部 URL |
| 端点已在权限登记表登记 | 工具的 `endpoint`（方法+路径）必须是服务端 `ENDPOINT_SCOPES` 已登记端点；未登记端点无插件级权限校验，禁止暴露（防绕过） |
| parameters 大小/深度 | 序列化后 ≤64KB、嵌套 ≤16 层 |
| 保留名 | `builtin-canvas` 为内置插件保留名，用户安装通道不可占用 |

## 3. 权限作用域

| 作用域 | 说明 |
|--------|------|
| `cards:read` | 读取卡片/知识库（GET /api/cards） |
| `cards:write` | 创建/修改卡片（POST /api/cards、POST /api/cards/batch） |
| `canvas:read` | 读取画布（GET /api/canvas-layout） |
| `canvas:write` | 修改画布/连线（PUT /api/canvas-layout、POST /api/cards/connect） |
| `settings:read` / `settings:write` | 预留 |

注意：**执行期权限以服务端端点映射表为准**（`lib/plugins/scopes.ts` 的 `ENDPOINT_SCOPES`），manifest 中的 endpoint 声明只决定能力清单向模型暴露的路由信息——伪造低权限端点映射无法绕过校验。同时，安装期校验会拒绝暴露任何未登记端点（见第 2 节规则表），双保险封死绕过路径。

## 4. 安装与管理

### 方式一：管理界面

设置页 → "插件 / 技能系统" 分区 → 粘贴 manifest JSON → 安装。
支持启停（开关）、更新（展开详情编辑 manifest）、卸载。

### 方式二：API

```bash
# 安装
curl -X POST http://localhost:3000/api/plugins \
  -H "Content-Type: application/json" \
  -d @plugin-manifest.json

# 列表 / 详情
curl http://localhost:3000/api/plugins
curl http://localhost:3000/api/plugins/<id>

# 启停
curl -X PATCH http://localhost:3000/api/plugins/<id> \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'

# 更新（name 必须与注册表一致）
curl -X PUT http://localhost:3000/api/plugins/<id> \
  -H "Content-Type: application/json" \
  -d @plugin-manifest-v2.json

# 卸载（内置插件不可卸载）
curl -X DELETE http://localhost:3000/api/plugins/<id>
```

> 配置了 `LOCAL_ACCESS_TOKEN` 时所有请求需携带 `x-local-token` header。

## 5. 外部 AI 调用流程

```bash
# 1. 拉取能力清单（工具定义 + 端点映射）
curl http://localhost:3000/api/ai/capabilities

# 2. 把 tools 注入模型，模型选择工具后按 endpoints 路由请求，
#    以插件身份调用时携带 x-plugin-id（权限校验 + 审计）
curl -X POST http://localhost:3000/api/cards/batch \
  -H "Content-Type: application/json" \
  -H "x-plugin-id: my-study-pack" \
  -d '{"items": [{"title": "勾股定理", "content": "a²+b²=c²"}]}'
```

- 插件禁用/不存在/权限不足 → **403**
- 插件写操作在数据面板的变更日志中来源显示为 `plugin:<name>`

## 6. 示例

完整可安装示例见 [docs/examples/plugin-manifest.example.json](examples/plugin-manifest.example.json)
（只读查询插件：声明 `cards:read`，暴露 `search_cards` 工具）。

内置插件 `builtin-canvas`（v1.0.0）即原 4 工具集合，可作为 manifest 编写参考：
安装后通过 `GET /api/plugins` 查看其完整 manifest。

## 7. 兼容性承诺

- **能力清单结构**：`/api/ai/capabilities` 的顶层 `tools` / `endpoints` 结构在 **主版本不变**（当前 1.x）期间保持兼容，插件可长期缓存消费
- **权限作用域**：已发布作用域（上表）不会移除或收窄语义；新增作用域不视为破坏性变更
- **协议不变量**：`x-plugin-id` 校验语义（禁用/不存在/权限不足 → 403）与审计来源格式 `plugin:<name>` 保持稳定
- **内置插件**：`builtin-canvas` 的 4 个工具名保持不变，外部 AI 依赖其调用无需适配

## 8. FAQ

**Q：安装时报"工具名已被其他插件占用"**
A：PluginTool.name 全局唯一（保证能力清单无歧义）。换一个工具名，或更新占用该名字的插件。

**Q：禁用内置插件会怎样**
A：其 4 个工具从 `/api/ai/capabilities` 消失；以 `x-plugin-id: builtin-canvas` 调用返回 403。可随时重新启用。

**Q：更新插件时 name 能改吗**
A：不能。name 是注册表唯一键与调用身份标识，改名等于新插件（先卸载再安装）。

**Q：插件能调用未在 ENDPOINT_SCOPES 登记的端点吗**
A：不能。安装期校验会直接拒绝暴露未登记端点的 manifest（400）——未登记端点没有插件级权限校验，暴露即形成绕过路径。如需新端点支持，需先在服务端 `lib/plugins/scopes.ts` 登记其必需作用域。

**Q：能安装名为 builtin-canvas 的插件吗**
A：不能。该名称为内置插件保留名，安装通道返回 409；内置插件本身不可修改或卸载（可启停）。
