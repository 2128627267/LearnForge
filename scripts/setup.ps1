#Requires -Version 5.1
<#
.SYNOPSIS
    LearnForge 一键部署配置脚本（Windows）

.DESCRIPTION
    自动完成：环境检测（Node/npm）→ .env.local 生成引导 → 依赖安装 →
    数据库初始化（Prisma generate + db push）→ 启动服务（dev/prod）。

    设计原则：
    - 配置项集中在顶部常量区，避免硬编码散落
    - 每步失败给出明确提示与非零退出码，便于 CI/自动化对接
    - 幂等可重复执行（已存在的配置/依赖自动跳过）

.PARAMETER Mode
    启动模式：dev（开发热重载，默认）| prod（构建 + 生产启动）

.PARAMETER SkipInstall
    跳过依赖安装（已安装过/离线环境）

.PARAMETER SkipDb
    跳过数据库初始化（已初始化过）

.PARAMETER NoStart
    只做环境配置，不启动服务

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
    # 默认开发模式：检测环境 → 安装依赖 → 初始化数据库 → 启动 dev 服务

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -Mode prod
    # 生产模式：安装依赖 → 初始化数据库 → next build → next start

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -SkipInstall -SkipDb -NoStart
    # 仅生成 .env.local 引导（首次配置环境变量）
#>
[CmdletBinding()]
param(
    [ValidateSet("dev", "prod")]
    [string]$Mode = "dev",
    [switch]$SkipInstall,
    [switch]$SkipDb,
    [switch]$NoStart
)

# ==================== 配置项（集中管理） ====================

# Node 最低大版本（Next.js 14 要求 >= 18.17）
$MinNodeMajor = 18
# 服务监听地址：仅绑定回环，禁止局域网访问
# （安全加固：防止外部主机伪造 Host: localhost 获取本地访问令牌）
$BindHost = "127.0.0.1"
# 开发/生产服务端口（与 Next 默认一致）
$Port = 3000
# 环境变量文件（Next.js 按 .env.local > .env 优先级加载）
$EnvExampleFile = ".env.example"
$EnvLocalFile = ".env.local"
# Prisma schema 路径（db push 的目标）
$PrismaSchema = "prisma/schema.prisma"

# ==================== 日志与错误处理辅助 ====================

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Message)
    Write-Host "  [OK] $Message" -ForegroundColor Green
}

function Write-Fail {
    # 统一失败出口：红字提示 + 非零退出码（1）
    param([string]$Message)
    Write-Host "  [失败] $Message" -ForegroundColor Red
    Write-Host ""
    exit 1
}

# ==================== 环境检测 ====================

function Test-NodeEnvironment {
    Write-Step "检测 Node.js 环境"

    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCmd) {
        Write-Fail "未找到 node。请安装 Node.js v$MinNodeMajor+ ：https://nodejs.org/"
    }

    # 解析主版本号（node -v 输出形如 v20.11.0）
    $versionRaw = (& node -v 2>$null)
    if ($versionRaw -notmatch '^v(\d+)\.') {
        Write-Fail "无法解析 node 版本（输出：$versionRaw）"
    }
    $major = [int]$Matches[1]

    if ($major -lt $MinNodeMajor) {
        Write-Fail "Node 版本过低（当前 v$major，要求 >= v$MinNodeMajor）。请升级：https://nodejs.org/"
    }
    Write-Ok "Node.js $versionRaw（要求 >= v$MinNodeMajor）"

    # Windows 下显式使用 npm.cmd：
    # PowerShell 默认可能解析到 npm.ps1，会受执行策略（Restricted）限制
    $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npmCmd) {
        # 非标准安装（如 scoop）可能只有 npm.ps1，回退检测
        $npmPs = Get-Command npm -ErrorAction SilentlyContinue
        if (-not $npmPs) {
            Write-Fail "未找到 npm。Node.js 安装通常自带 npm，请检查安装完整性"
        }
        # 记录为普通 npm 调用（执行策略已放开时可用）
        Write-Ok "npm（$($npmPs.Source)）"
        return "npm"
    }
    Write-Ok "npm.cmd（$($npmCmd.Source)）"
    return "npm.cmd"
}

# ==================== 环境变量文件引导 ====================

function Initialize-EnvFile {
    Write-Step "检查环境变量配置（$EnvLocalFile）"

    if (Test-Path $EnvLocalFile) {
        Write-Ok "已存在 $EnvLocalFile，跳过生成"
        return
    }

    if (-not (Test-Path $EnvExampleFile)) {
        Write-Fail "未找到模板 $EnvExampleFile（仓库不完整？）"
    }

    # 从模板生成（保留模板全部键，默认值开箱可用：
    # SQLite 数据库路径与 NEXTAUTH 占位均可直接启动）
    Copy-Item $EnvExampleFile $EnvLocalFile
    Write-Ok "已从 $EnvExampleFile 生成 $EnvLocalFile"

    Write-Host ""
    Write-Host "  提示：AI 功能需编辑 $EnvLocalFile 填写实际配置：" -ForegroundColor Yellow
    Write-Host "    - AI_API_KEY   ：AI 服务商密钥（OpenAI 兼容协议）" -ForegroundColor Yellow
    Write-Host "    - AI_BASE_URL  ：接入点（DeepSeek/智谱/Moonshot 等均可）" -ForegroundColor Yellow
    Write-Host "    - AI_MODEL     ：模型名" -ForegroundColor Yellow
    Write-Host "    - LOCAL_ACCESS_TOKEN：生产部署建议设置（API 访问令牌）" -ForegroundColor Yellow
    Write-Host "    （不配置 AI 密钥不影响画布/学习核心功能，仅 AI 生成不可用）" -ForegroundColor Yellow
}

# ==================== 依赖安装 ====================

function Install-Dependencies {
    param([string]$NpmCommand)

    Write-Step "安装依赖（优先 npm ci，按 lockfile 精确安装）"

    # npm ci 严格要求 package-lock.json 与 package.json 同步；
    # 失败时（无 lockfile / 手动改过 package.json）降级 npm install
    & $NpmCommand ci 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "npm ci 完成（依赖与 lockfile 完全一致）"
        return
    }

    Write-Host "  npm ci 未成功，降级为 npm install ..." -ForegroundColor Yellow
    & $NpmCommand install 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "依赖安装失败。常见原因：网络代理（可设 npm config set registry https://registry.npmmirror.com）/ 磁盘空间不足 / node_modules 损坏（删除后重试）"
    }
    Write-Ok "npm install 完成"
}

# ==================== 数据库初始化 ====================

function Initialize-Database {
    param([string]$NpmCommand)

    Write-Step "初始化数据库（Prisma）"

    if (-not (Test-Path $PrismaSchema)) {
        Write-Fail "未找到 $PrismaSchema（仓库不完整？）"
    }

    # 1) 生成 Prisma Client（TypeScript 类型与查询引擎）
    & $NpmCommand exec -- prisma generate 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "prisma generate 失败。常见原因：.env* 中 DATABASE_URL 缺失或格式错误（应为 file:./data/learnforge.db 形式）"
    }
    Write-Ok "Prisma Client 已生成"

    # 2) 同步 schema 到 SQLite（首次创建库文件；已存在的库做增量变更）
    #    说明：本项目未使用 migrate 迁移历史，db push 即为标准初始化方式
    & $NpmCommand exec -- prisma db push 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "prisma db push 失败。常见原因：DATABASE_URL 指向的目录不存在或无写权限 / data/learnforge.db 被占用（关闭正在运行的服务后重试）"
    }
    Write-Ok "数据库已同步（SQLite 文件按 DATABASE_URL 配置生成）"
}

# ==================== 服务启动 ====================

function Start-DevServer {
    param([string]$NpmCommand)

    Write-Step "启动开发服务（热重载）"
    Write-Host "  地址：http://${BindHost}:${Port}   Ctrl+C 停止" -ForegroundColor DarkGray

    # -H 仅绑定回环地址（安全加固，与 start-dev.bat 行为一致）
    & $NpmCommand run dev -- -H $BindHost
    # run dev 为前台进程，正常退出（Ctrl+C）不视为脚本失败
}

function Start-ProdServer {
    param([string]$NpmCommand)

    Write-Step "构建生产包（next build）"
    & $NpmCommand run build 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "next build 失败。请先执行 npm run typecheck 与 npm run lint 定位错误"
    }
    Write-Ok "生产构建完成"

    Write-Step "启动生产服务（next start）"
    Write-Host "  地址：http://${BindHost}:${Port}   Ctrl+C 停止" -ForegroundColor DarkGray
    & $NpmCommand run start -- -H $BindHost
}

# ==================== 主流程 ====================

# 切换到脚本所在目录的上一级（项目根目录），保证相对路径稳定
# （无论从哪个工作目录调用本脚本，都能找到 package.json / .env.example）
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot
Write-Host "项目根目录：$ProjectRoot" -ForegroundColor DarkGray
Write-Host "启动模式：$Mode" -ForegroundColor DarkGray

# 1. 环境检测（返回实际可用的 npm 调用名）
$npm = Test-NodeEnvironment

# 2. 环境变量引导
Initialize-EnvFile

# 3. 依赖安装
if ($SkipInstall) {
    Write-Step "跳过依赖安装（-SkipInstall）"
} else {
    Install-Dependencies -NpmCommand $npm
}

# 4. 数据库初始化
if ($SkipDb) {
    Write-Step "跳过数据库初始化（-SkipDb）"
} else {
    Initialize-Database -NpmCommand $npm
}

# 5. 启动服务
if ($NoStart) {
    Write-Step "环境配置完成（-NoStart，未启动服务）"
    Write-Host ""
    Write-Host "后续手动启动：" -ForegroundColor Green
    Write-Host "  开发：npm run dev -- -H $BindHost"
    Write-Host "  生产：npm run build; npm run start -- -H $BindHost"
} elseif ($Mode -eq "prod") {
    Start-ProdServer -NpmCommand $npm
} else {
    Start-DevServer -NpmCommand $npm
}
