# LearnForge 部署指南

> 适用版本：v0.1.x / v0.2.x（2026-08 迭代）
> 关联脚本：`scripts/setup.ps1`（Windows）、`scripts/setup.sh`（macOS/Linux）

## 1. 前置要求

| 依赖 | 版本要求 | 说明 |
|------|---------|------|
| Node.js | >= 18.17（建议 20 LTS） | Next.js 14 的最低要求；[下载地址](https://nodejs.org/) |
| npm | >= 9（Node 自带） | 包管理与脚本执行 |
| 操作系统 | Windows 10+ / macOS / Linux | 脚本双平台覆盖 |

> 本项目为**本地单机应用**（SQLite 存储），无需外部数据库服务。

## 2. 快速开始（一键脚本）

### 2.1 Windows（PowerShell）

```powershell
# 在项目根目录执行（首次推荐完整流程）
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

# 生产模式（构建 + 生产启动）
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -Mode prod

# 仅生成 .env.local 环境配置（不安装依赖/不启动）
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -SkipInstall -SkipDb -NoStart
```

### 2.2 macOS / Linux（Bash）

```bash
# 首次需赋予执行权限
chmod +x scripts/setup.sh

# 默认开发模式（完整流程）
./scripts/setup.sh

# 生产模式
./scripts/setup.sh -m prod

# 仅生成 .env.local 环境配置
./scripts/setup.sh -s -d -n
```

### 2.3 脚本选项

| 选项 | PowerShell | Bash | 说明 |
|------|-----------|------|------|
| 启动模式 | `-Mode dev\|prod` | `-m dev\|prod` | `dev` 热重载开发；`prod` 构建 + 生产启动（默认 `dev`） |
| 跳过依赖安装 | `-SkipInstall` | `-s` | 已安装过 / 离线环境 |
| 跳过数据库初始化 | `-SkipDb` | `-d` | 已初始化过 |
| 不启动服务 | `-NoStart` | `-n` | 仅完成环境配置 |
| 帮助 | — | `-h` | 显示用法 |

### 2.4 脚本执行流程

1. **环境检测**：Node 版本（>= 18）、npm 可用性
2. **环境变量引导**：`.env.local` 不存在时从 `.env.example` 生成，并提示需填写的 AI 配置
3. **依赖安装**：优先 `npm ci`（按 lockfile 精确安装），失败降级 `npm install`
4. **数据库初始化**：`prisma generate`（生成客户端）+ `prisma db push`（同步 schema 到 SQLite，首次自动建库）
5. **启动服务**：`next dev` 或 `next build && next start`，监听 `http://127.0.0.1:3000`

## 3. 环境变量说明（.env.local）

复制自 `.env.example`，按需修改：

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `DATABASE_URL` | 是 | `file:./data/learnforge.db` | SQLite 数据库文件路径（相对 `prisma/` 目录） |
| `NEXTAUTH_SECRET` | 是 | 占位值 | NextAuth 会话密钥，建议改为随机字符串 |
| `NEXTAUTH_URL` | 否 | `http://localhost:3000` | 应用对外地址 |
| `AI_PROVIDER` | 否 | `openai` | AI 协议（当前仅 OpenAI 兼容） |
| `AI_API_KEY` | AI 功能必填 | 占位值 | AI 服务商密钥 |
| `AI_BASE_URL` | AI 功能必填 | `https://api.openai.com/v1` | OpenAI 兼容接入点（DeepSeek/智谱/Moonshot 等均可） |
| `AI_MODEL` | AI 功能必填 | `gpt-4o-mini` | 模型名 |
| `APP_NAME` / `APP_LOCALE` | 否 | `LearnForge` / `zh-CN` | 应用名 / 语言 |
| `LOCAL_ACCESS_TOKEN` | 生产建议 | 空（不校验） | 本地 API 访问令牌；设置后 `/api/*` 需携带 `x-local-token` 头 |

> AI 密钥未配置时，画布/学习/复习等核心功能不受影响，仅 AI 生成不可用。

## 4. 手动部署（不使用脚本）

```bash
# 1. 生成环境配置
cp .env.example .env.local    # Windows: copy .env.example .env.local
#    编辑 .env.local 填写实际值

# 2. 安装依赖
npm ci                        # 或 npm install

# 3. 初始化数据库
npx prisma generate
npx prisma db push

# 4. 启动（二选一）
npm run dev -- -H 127.0.0.1           # 开发（热重载）
npm run build && npm run start -- -H 127.0.0.1   # 生产
```

## 5. 局域网访问（手机 / 内网穿透）

默认启动方式仅绑定回环地址（`-H 127.0.0.1`），**局域网设备无法访问**。如需在手机等设备上使用（例如同步手机拍摄的图片内容），或为内网穿透做准备，使用局域网模式：

### 5.1 Windows（推荐）

```bat
start-dev-lan.bat
```

脚本行为：
- 绑定 `0.0.0.0` 监听所有网卡，并列出本机局域网 IPv4 地址（如 `http://192.168.x.x:3000`），手机浏览器直接访问即可
- 设置 `LAN_ACCESS=1` 环境变量标记本次启动为局域网模式（详见 §5.3 安全说明）
- 首次启动 Windows 会弹出防火墙授权提示，需选择"允许"（Node.js 专用网络）

### 5.2 macOS / Linux（手动等价命令）

```bash
LAN_ACCESS=1 npm run dev -- -H 0.0.0.0
# 查看本机局域网 IP
ipconfig getifaddr en0     # macOS
hostname -I                # Linux
```

生产模式等价：`LAN_ACCESS=1 npm run start -- -H 0.0.0.0`（需先 `npm run build`）。

### 5.3 安全说明（必读）

1. **令牌自动下发被禁用**：绑定 `0.0.0.0` 后，局域网内主机可手写 HTTP 请求伪造 `Host: localhost` 头，绕过 `/api/local-token` 的来源校验窃取令牌。因此局域网模式下（`LAN_ACCESS=1`）该端点直接返回 404，令牌不再自动下发。
2. **令牌改为手动输入**：若 `.env.local` 配置了 `LOCAL_ACCESS_TOKEN`，每台设备（含本机）首次访问时会弹出输入框，输入令牌一次即可（保存在浏览器 localStorage，令牌变更后重新输入）。**未配置令牌时局域网内任何人可直接访问全部数据**，仅建议在可信家庭网络且理解风险时留空。
3. **用完关闭**：局域网模式仅在使用期间开启（关闭终端或运行 `stop-dev.bat`），平时请使用默认的 `start-dev.bat`（回环绑定）。
4. **内网穿透**：局域网模式即绑定 `0.0.0.0`，配合 frp / Tailscale 等穿透工具即可对外暴露。穿透暴露到公网时**必须**设置 `LOCAL_ACCESS_TOKEN`，并注意 `NEXTAUTH_URL` 需改为对外地址。

## 6. 安全加固（生产部署必读）

1. **仅绑定回环地址**：脚本与文档中的启动命令统一使用 `-H 127.0.0.1`，禁止局域网访问（防止外部主机伪造 `Host: localhost` 获取本地访问令牌）。需要局域网/穿透访问时，按 §5 使用局域网模式（含配套安全加固）。
2. **设置 `LOCAL_ACCESS_TOKEN`**：暴露到网络（含反向代理场景）时必须设置；设置后所有 `/api/*` 请求需携带 `x-local-token` 头，前端会自动从 `/api/local-token`（仅 localhost 可访问）获取；局域网模式下改为浏览器手动输入一次（见 §5.3）。
3. **更换 `NEXTAUTH_SECRET`**：默认占位值不可用于生产。
4. **数据库文件备份**：SQLite 文件位于 `prisma/data/learnforge.db`（按 `DATABASE_URL`），建议定期备份；画布数据另有快照与变更日志兜底（见侧栏"数据"面板）。

## 7. 常见问题（FAQ）

### Q1：端口 3000 被占用

```
Error: listen EADDRINUSE 127.0.0.1:3000
```

解决：找到占用进程后关闭，或换端口启动 `npm run dev -- -H 127.0.0.1 -p 3001`。
Windows 查找占用：`netstat -ano | findstr :3000`（PID 对应 `tasklist | findstr <PID>`）；
macOS/Linux：`lsof -i :3000`。

### Q2：Prisma 报错 `Environment variable not found: DATABASE_URL`

`.env.local` 或 `.env` 缺少 `DATABASE_URL`。运行脚本会自动从模板生成；手动场景请确认：

```bash
cp .env.example .env.local
```

注意 Next.js 的 env 加载顺序：`.env.local` > `.env`（`.env.local` 优先级更高）。

### Q3：`prisma db push` 失败：`Unable to open file`

- `DATABASE_URL` 指向的目录不存在 → 手动创建目录，或确认路径相对 `prisma/` 解析
- 数据库文件被占用 → 关闭正在运行的开发/生产服务后重试

### Q4：Node 版本不满足

```
Node 版本过低（当前 v16.x，要求 >= v18）
```

升级 Node 到 18.17+（建议 20 LTS）。多版本共存可用 [nvm-windows](https://github.com/coreybutler/nvm-windows) / [nvm](https://github.com/nvm-sh/nvm)。

### Q5：Windows 执行 PowerShell 脚本报"禁止运行脚本"

PowerShell 默认执行策略为 `Restricted`。两种解决方式：

```powershell
# 方式一：单次绕过（推荐，不改系统设置）
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

# 方式二：当前用户放行（管理员 PowerShell）
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Q6：依赖安装缓慢或失败

```bash
# 切换国内镜像源
npm config set registry https://registry.npmmirror.com

# node_modules 损坏时清理重装
rm -rf node_modules package-lock.json   # Windows: rmdir /s /q node_modules
npm install
```

### Q7：`npm run dev` 正常但 `next build` 失败

构建阶段会做完整类型检查。先本地定位：

```bash
npm run typecheck   # TypeScript 类型错误
npm run lint        # ESLint 规则错误
npm run test        # 单元测试（Vitest）
```

### Q8：数据存在哪里？如何备份？

- **数据库**：`prisma/data/learnforge.db`（SQLite 单文件，含卡片/学习记录/画布布局/快照/日志全部数据）
- **备份**：直接复制该文件（建议停止服务后复制）；画布另有内置快照机制（侧栏"数据"面板可查看与恢复）
- **AI 配置**：`.env.local`（不在版本库中，迁移机器时需手动携带）

## 8. Windows 10 专项说明

- 推荐使用 **PowerShell 5.1+**（系统自带）或 Windows Terminal 运行 `scripts\setup.ps1`
- 旧版 `start-dev.bat` / `stop-dev.bat` 仍可用（仅开发模式，无环境配置功能），推荐迁移到 `setup.ps1`；局域网访问用 `start-dev-lan.bat`
- 脚本内部显式调用 `npm.cmd`，规避 PowerShell 执行策略对 `npm.ps1` 的限制
- 路径含空格或中文时无需特殊处理（脚本自动切换到项目根目录）

---

*文档更新：2026-08-28（新增 §5 局域网访问章节）；2026-08-26（F4 一键部署配置脚本）*
