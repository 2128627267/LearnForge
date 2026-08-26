#!/usr/bin/env bash
# ============================================================================
# LearnForge 一键部署配置脚本（macOS / Linux，Bash）
#
# 自动完成：环境检测（Node/npm）→ .env.local 生成引导 → 依赖安装 →
# 数据库初始化（Prisma generate + db push）→ 启动服务（dev/prod）。
#
# 设计原则：
# - 配置项集中在顶部常量区，避免硬编码散落
# - set -euo pipefail 严格模式：任何失败立即终止并以非零码退出
# - 幂等可重复执行（已存在的配置/依赖自动跳过）
#
# 用法：
#   ./scripts/setup.sh                    # 开发模式（默认）
#   ./scripts/setup.sh -m prod            # 生产模式（build + start）
#   ./scripts/setup.sh -s -d -n           # 跳过安装/数据库/启动（仅配置 env）
#
# 选项：
#   -m <dev|prod>   启动模式（默认 dev）
#   -s              跳过依赖安装
#   -d              跳过数据库初始化
#   -n              不启动服务（仅完成环境配置）
#   -h              显示帮助
# ============================================================================
set -euo pipefail

# ==================== 配置项（集中管理） ====================

# Node 最低大版本（Next.js 14 要求 >= 18.17）
MIN_NODE_MAJOR=18
# 服务监听地址：仅绑定回环，禁止局域网访问
# （安全加固：防止外部主机伪造 Host: localhost 获取本地访问令牌）
BIND_HOST="127.0.0.1"
# 开发/生产服务端口（与 Next 默认一致）
PORT=3000
# 环境变量文件（Next.js 按 .env.local > .env 优先级加载）
ENV_EXAMPLE_FILE=".env.example"
ENV_LOCAL_FILE=".env.local"
# Prisma schema 路径（db push 的目标）
PRISMA_SCHEMA="prisma/schema.prisma"

# ==================== 日志与错误处理辅助 ====================

# 统一失败出口：红字提示 + 非零退出码（1）
fail() {
  printf "  \033[31m[失败]\033[0m %s\n\n" "$1"
  exit 1
}

step() {
  printf "\n\033[36m==> %s\033[0m\n" "$1"
}

ok() {
  printf "  \033[32m[OK]\033[0m %s\n" "$1"
}

warn() {
  printf "  \033[33m%s\033[0m\n" "$1"
}

# ==================== 参数解析 ====================

MODE="dev"
SKIP_INSTALL=0
SKIP_DB=0
NO_START=0

while getopts ":m:sdnh" opt; do
  case "$opt" in
    m) MODE="$OPTARG" ;;
    s) SKIP_INSTALL=1 ;;
    d) SKIP_DB=1 ;;
    n) NO_START=1 ;;
    h)
      sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    \?) fail "未知选项：-$OPTARG（使用 -h 查看帮助）" ;;
  esac
done

if [[ "$MODE" != "dev" && "$MODE" != "prod" ]]; then
  fail "启动模式无效：$MODE（仅支持 dev / prod）"
fi

# ==================== 环境检测 ====================

check_node_environment() {
  step "检测 Node.js 环境"

  if ! command -v node >/dev/null 2>&1; then
    fail "未找到 node。请安装 Node.js v${MIN_NODE_MAJOR}+ ：https://nodejs.org/（macOS 可用 brew install node）"
  fi

  # 解析主版本号（node -v 输出形如 v20.11.0）
  local version_raw major
  version_raw="$(node -v 2>/dev/null || true)"
  major="${version_raw#v}"
  major="${major%%.*}"
  if [[ ! "$major" =~ ^[0-9]+$ ]]; then
    fail "无法解析 node 版本（输出：$version_raw）"
  fi

  if (( major < MIN_NODE_MAJOR )); then
    fail "Node 版本过低（当前 v$major，要求 >= v${MIN_NODE_MAJOR}）。请升级：https://nodejs.org/"
  fi
  ok "Node.js $version_raw（要求 >= v${MIN_NODE_MAJOR}）"

  if ! command -v npm >/dev/null 2>&1; then
    fail "未找到 npm。Node.js 安装通常自带 npm，请检查安装完整性"
  fi
  ok "npm（$(command -v npm)）"
}

# ==================== 环境变量文件引导 ====================

initialize_env_file() {
  step "检查环境变量配置（$ENV_LOCAL_FILE）"

  if [[ -f "$ENV_LOCAL_FILE" ]]; then
    ok "已存在 $ENV_LOCAL_FILE，跳过生成"
    return
  fi

  if [[ ! -f "$ENV_EXAMPLE_FILE" ]]; then
    fail "未找到模板 $ENV_EXAMPLE_FILE（仓库不完整？）"
  fi

  # 从模板生成（保留模板全部键，默认值开箱可用：
  # SQLite 数据库路径与 NEXTAUTH 占位均可直接启动）
  cp "$ENV_EXAMPLE_FILE" "$ENV_LOCAL_FILE"
  ok "已从 $ENV_EXAMPLE_FILE 生成 $ENV_LOCAL_FILE"

  echo ""
  warn "提示：AI 功能需编辑 $ENV_LOCAL_FILE 填写实际配置："
  warn "  - AI_API_KEY   ：AI 服务商密钥（OpenAI 兼容协议）"
  warn "  - AI_BASE_URL  ：接入点（DeepSeek/智谱/Moonshot 等均可）"
  warn "  - AI_MODEL     ：模型名"
  warn "  - LOCAL_ACCESS_TOKEN：生产部署建议设置（API 访问令牌）"
  warn "  （不配置 AI 密钥不影响画布/学习核心功能，仅 AI 生成不可用）"
}

# ==================== 依赖安装 ====================

install_dependencies() {
  step "安装依赖（优先 npm ci，按 lockfile 精确安装）"

  # npm ci 严格要求 package-lock.json 与 package.json 同步；
  # 失败时（无 lockfile / 手动改过 package.json）降级 npm install
  if npm ci >/dev/null 2>&1; then
    ok "npm ci 完成（依赖与 lockfile 完全一致）"
    return
  fi

  warn "npm ci 未成功，降级为 npm install ..."
  if ! npm install >/dev/null 2>&1; then
    fail "依赖安装失败。常见原因：网络代理（可设 npm config set registry https://registry.npmmirror.com）/ 磁盘空间不足 / node_modules 损坏（rm -rf node_modules 后重试）"
  fi
  ok "npm install 完成"
}

# ==================== 数据库初始化 ====================

initialize_database() {
  step "初始化数据库（Prisma）"

  if [[ ! -f "$PRISMA_SCHEMA" ]]; then
    fail "未找到 $PRISMA_SCHEMA（仓库不完整？）"
  fi

  # 1) 生成 Prisma Client（TypeScript 类型与查询引擎）
  if ! npx prisma generate >/dev/null 2>&1; then
    fail "prisma generate 失败。常见原因：.env* 中 DATABASE_URL 缺失或格式错误（应为 file:./data/learnforge.db 形式）"
  fi
  ok "Prisma Client 已生成"

  # 2) 同步 schema 到 SQLite（首次创建库文件；已存在的库做增量变更）
  #    说明：本项目未使用 migrate 迁移历史，db push 即为标准初始化方式
  if ! npx prisma db push >/dev/null 2>&1; then
    fail "prisma db push 失败。常见原因：DATABASE_URL 指向的目录不存在或无写权限 / data/learnforge.db 被占用（关闭正在运行的服务后重试）"
  fi
  ok "数据库已同步（SQLite 文件按 DATABASE_URL 配置生成）"
}

# ==================== 服务启动 ====================

start_dev_server() {
  step "启动开发服务（热重载）"
  printf "  地址：http://%s:%s   Ctrl+C 停止\n" "$BIND_HOST" "$PORT"

  # -H 仅绑定回环地址（安全加固，与 Windows start-dev.bat 行为一致）
  exec npm run dev -- -H "$BIND_HOST"
}

start_prod_server() {
  step "构建生产包（next build）"
  if ! npm run build >/dev/null 2>&1; then
    fail "next build 失败。请先执行 npm run typecheck 与 npm run lint 定位错误"
  fi
  ok "生产构建完成"

  step "启动生产服务（next start）"
  printf "  地址：http://%s:%s   Ctrl+C 停止\n" "$BIND_HOST" "$PORT"
  exec npm run start -- -H "$BIND_HOST"
}

# ==================== 主流程 ====================

# 切换到脚本所在目录的上一级（项目根目录），保证相对路径稳定
# （无论从哪个工作目录调用本脚本，都能找到 package.json / .env.example）
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"
printf "项目根目录：%s\n" "$PROJECT_ROOT"
printf "启动模式：%s\n" "$MODE"

# 1. 环境检测
check_node_environment

# 2. 环境变量引导
initialize_env_file

# 3. 依赖安装
if (( SKIP_INSTALL )); then
  step "跳过依赖安装（-s）"
else
  install_dependencies
fi

# 4. 数据库初始化
if (( SKIP_DB )); then
  step "跳过数据库初始化（-d）"
else
  initialize_database
fi

# 5. 启动服务
if (( NO_START )); then
  step "环境配置完成（-n，未启动服务）"
  echo ""
  printf "后续手动启动：\n"
  echo "  开发：npm run dev -- -H $BIND_HOST"
  echo "  生产：npm run build && npm run start -- -H $BIND_HOST"
elif [[ "$MODE" == "prod" ]]; then
  start_prod_server
else
  start_dev_server
fi
