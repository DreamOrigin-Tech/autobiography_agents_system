#!/usr/bin/env bash
# 自传 Agent 系统 — 一键部署 / 启动脚本
#
# 用法:
#   ./start.sh              默认 Docker 部署并启动
#   ./start.sh docker       Docker 部署并启动
#   ./start.sh dev          Docker 开发模式启动（免登录）
#   ./start.sh local        本机开发模式启动（Python venv + npm）
#   ./start.sh prod          公网生产部署（jiumozhi.tech:6985/6986）
#   ./start.sh stop          停止所有服务
#   ./start.sh status        查看运行状态
#   ./start.sh logs          查看 Docker 日志（跟随输出）
#   ./start.sh logs prod     查看生产环境日志

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
PID_FILE="$ROOT_DIR/.start.pids"

# 服务端口（可通过环境变量覆盖）
FRONTEND_PORT="${FRONTEND_PORT:-6985}"
BACKEND_PORT="${BACKEND_PORT:-6986}"

# 公网域名（生产部署）
DOMAIN="${DOMAIN:-jiumozhi.tech}"

# 生产镜像构建使用的 Python 依赖源
BACKEND_PIP_INDEX_URL="${BACKEND_PIP_INDEX_URL:-https://mirrors.aliyun.com/pypi/simple/}"
BACKEND_PIP_TRUSTED_HOST="${BACKEND_PIP_TRUSTED_HOST:-mirrors.aliyun.com}"

PROD_ENV_FILE="$ROOT_DIR/.env.production"
PROD_COMPOSE=( -f docker-compose.prod.yml )

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

setup_node_runtime() {
  if command_exists node && command_exists npm; then
    return 0
  fi

  local node_bin
  for node_bin in /opt/homebrew/bin /usr/local/bin; do
    if [[ -x "$node_bin/node" && -x "$node_bin/npm" ]]; then
      export PATH="$node_bin:$PATH"
      return 0
    fi
  done

  local detected_nvm_dir="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$detected_nvm_dir/nvm.sh" ]]; then
    export NVM_DIR="$detected_nvm_dir"
    # shellcheck source=/dev/null
    source "$NVM_DIR/nvm.sh"
    nvm use --silent default >/dev/null 2>&1 \
      || nvm use --silent node >/dev/null 2>&1 \
      || true
  fi
}

check_node_version() {
  local node_major
  node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
  if (( node_major < 20 )); then
    error "Node.js 版本过低: $(node --version)，需要 Node.js 20 或更高版本"
    exit 1
  fi
}

docker_compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command_exists docker-compose; then
    docker-compose "$@"
  else
    error "未找到 docker compose，请先安装 Docker Desktop"
    exit 1
  fi
}

docker_compose_prod() {
  local env_args=()
  if [[ -f "$PROD_ENV_FILE" ]]; then
    env_args=( --env-file "$PROD_ENV_FILE" )
  fi
  docker_compose "${PROD_COMPOSE[@]}" "${env_args[@]}" "$@"
}

ensure_backend_env() {
  if [[ ! -f "$BACKEND_DIR/.env" ]]; then
    if [[ -f "$BACKEND_DIR/.env.example" ]]; then
      cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
      warn "已创建 backend/.env，请编辑并填入 API Key 后重新运行"
    else
      error "缺少 backend/.env.example，无法生成环境配置"
      exit 1
    fi
  fi

  if grep -qE 'sk-your-(openai|deepseek)-key' "$BACKEND_DIR/.env" 2>/dev/null; then
    warn "backend/.env 中仍为示例 API Key，LLM 功能将无法使用"
  fi
}

ensure_frontend_env() {
  if [[ ! -f "$FRONTEND_DIR/.env.local" ]]; then
    if [[ -f "$FRONTEND_DIR/.env.local.example" ]]; then
      cp "$FRONTEND_DIR/.env.local.example" "$FRONTEND_DIR/.env.local"
      ok "已创建 frontend/.env.local"
    fi
  fi
}

ensure_production_env() {
  if [[ ! -f "$PROD_ENV_FILE" ]]; then
    if [[ -f "$ROOT_DIR/.env.production.example" ]]; then
      cp "$ROOT_DIR/.env.production.example" "$PROD_ENV_FILE"
      ok "已创建 .env.production"
    fi
  fi

  if [[ ! -f "$BACKEND_DIR/.env" ]]; then
    if [[ -f "$BACKEND_DIR/.env.production.example" ]]; then
      cp "$BACKEND_DIR/.env.production.example" "$BACKEND_DIR/.env"
      warn "已从生产模板创建 backend/.env，请填入 API Key"
    else
      ensure_backend_env
    fi
  fi

  if grep -qE 'sk-your-(openai|deepseek)-key' "$BACKEND_DIR/.env" 2>/dev/null; then
    warn "backend/.env 中仍为示例 API Key，LLM 功能将无法使用"
  fi
}

wait_for_url() {
  local url="$1"
  local name="$2"
  local max_attempts="${3:-30}"
  local attempt=0

  info "等待 ${name} 就绪: ${url}"
  while (( attempt < max_attempts )); do
    if curl -sf "$url" >/dev/null 2>&1; then
      ok "${name} 已就绪"
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 2
  done

  warn "${name} 启动超时，请检查日志"
  return 1
}

print_urls() {
  echo
  echo "========================================"
  echo "  自传 Agent 系统已启动"
  echo "========================================"
  echo "  前端:     http://localhost:${FRONTEND_PORT}"
  echo "  后端 API: http://localhost:${BACKEND_PORT}/api"
  echo "  API 文档: http://localhost:${BACKEND_PORT}/docs"
  echo "  健康检查: http://localhost:${BACKEND_PORT}/health"
  echo "========================================"
  echo
}

print_prod_urls() {
  echo
  echo "========================================"
  echo "  自传 Agent 系统 — 生产环境"
  echo "========================================"
  echo "  网站:     http://${DOMAIN}:${FRONTEND_PORT}"
  echo "  后端 API: http://${DOMAIN}:${BACKEND_PORT}/api"
  echo "  API 文档: http://${DOMAIN}:${BACKEND_PORT}/docs"
  echo "  健康检查: http://${DOMAIN}:${BACKEND_PORT}/health"
  echo "========================================"
  echo
}

start_prod() {
  if ! command_exists docker; then
    error "未安装 Docker"
    exit 1
  fi

  ensure_production_env
  cd "$ROOT_DIR"
  export DEV_AUTH_BYPASS=false

  info "生产部署: http://${DOMAIN}:${FRONTEND_PORT}"
  info "API 地址: http://${DOMAIN}:${BACKEND_PORT}/api"
  warn "请确认 DNS 已解析到本机: ${DOMAIN}"
  warn "请确认防火墙已开放 ${FRONTEND_PORT}、${BACKEND_PORT} 端口"

  export BACKEND_PIP_INDEX_URL BACKEND_PIP_TRUSTED_HOST
  info "后端 pip 依赖源: ${BACKEND_PIP_INDEX_URL}"
  info "构建并启动生产容器..."
  docker_compose_prod up --build -d

  wait_for_url "http://${DOMAIN}:${BACKEND_PORT}/health" "后端" 120 || true
  wait_for_url "http://${DOMAIN}:${FRONTEND_PORT}" "前端" 120 || true

  print_prod_urls
  info "查看日志: ./start.sh logs prod"
  info "停止服务: ./start.sh stop"
}

start_docker() {
  if ! command_exists docker; then
    error "未安装 Docker，请安装 Docker Desktop 或使用: ./start.sh local"
    exit 1
  fi

  ensure_backend_env
  cd "$ROOT_DIR"
  export DEV_AUTH_BYPASS=true
  export BACKEND_PIP_INDEX_URL BACKEND_PIP_TRUSTED_HOST

  info "构建并启动 Docker 容器（本地开发模式）..."
  info "开发模式免登录已开启（Docker）"
  info "后端 pip 依赖源: ${BACKEND_PIP_INDEX_URL}"
  warn "公网服务器请使用: ./start.sh prod"
  docker_compose up --build -d

  wait_for_url "http://localhost:${BACKEND_PORT}/health" "后端" 45 || true
  wait_for_url "http://localhost:${FRONTEND_PORT}" "前端" 60 || true

  print_urls
  info "查看日志: ./start.sh logs"
  info "停止服务: ./start.sh stop"
}

start_dev() {
  ensure_backend_env
  ensure_frontend_env

  if ! command_exists python3; then
    error "未找到 python3"
    exit 1
  fi

  setup_node_runtime
  if ! command_exists node || ! command_exists npm; then
    if command_exists docker; then
      warn "未找到本机 Node.js/npm，自动切换到 Docker 开发模式"
      start_docker
      return
    fi
    error "未找到 Node.js/npm，且 Docker 不可用"
    info "macOS 可执行: brew install node"
    info "也可以安装 Docker Desktop 后执行: ./start.sh dev"
    exit 1
  fi
  check_node_version
  info "Node.js: $(node --version)，npm: $(npm --version)"

  # 若 Docker 容器在跑，先提示
  if command_exists docker && docker_compose ps --status running 2>/dev/null | grep -q .; then
    warn "检测到 Docker 服务正在运行，建议先执行 ./start.sh stop"
  fi

  info "安装后端依赖..."
  cd "$BACKEND_DIR"
  if [[ ! -d .venv ]]; then
    python3 -m venv .venv
  fi
  # shellcheck disable=SC1091
  source .venv/bin/activate
  pip install -q -e .

  info "安装前端依赖..."
  cd "$FRONTEND_DIR"
  if [[ ! -d node_modules ]]; then
    npm install
  fi

  info "启动后端 (port ${BACKEND_PORT})..."
  cd "$BACKEND_DIR"
  export DEV_AUTH_BYPASS=true
  info "开发模式免登录已开启（仅当前开发进程）"
  # shellcheck disable=SC1091
  source .venv/bin/activate
  uvicorn app.main:app --reload --host 0.0.0.0 --port "$BACKEND_PORT" \
    > "$ROOT_DIR/.backend.log" 2>&1 &
  BACKEND_PID=$!

  info "启动前端 (port ${FRONTEND_PORT})..."
  cd "$FRONTEND_DIR"
  npm run dev -- -p "$FRONTEND_PORT" > "$ROOT_DIR/.frontend.log" 2>&1 &
  FRONTEND_PID=$!

  echo "$BACKEND_PID" > "$PID_FILE"
  echo "$FRONTEND_PID" >> "$PID_FILE"

  wait_for_url "http://localhost:${BACKEND_PORT}/health" "后端" 30 || true
  wait_for_url "http://localhost:${FRONTEND_PORT}" "前端" 45 || true

  print_urls
  info "后端日志: tail -f $ROOT_DIR/.backend.log"
  info "前端日志: tail -f $ROOT_DIR/.frontend.log"
  info "停止服务: ./start.sh stop"
}

stop_services() {
  stopped=false

  if [[ -f "$PID_FILE" ]]; then
    info "停止本地开发进程..."
    while IFS= read -r pid; do
      if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
        ok "已停止进程 $pid"
        stopped=true
      fi
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  fi

  if command_exists docker; then
    cd "$ROOT_DIR"
    if docker_compose_prod ps --status running 2>/dev/null | grep -q .; then
      info "停止生产 Docker 容器..."
      docker_compose_prod down
      stopped=true
    fi
    if docker_compose ps --status running 2>/dev/null | grep -q .; then
      info "停止 Docker 容器..."
      docker_compose down
      stopped=true
    fi
  fi

  if [[ "$stopped" == false ]]; then
    info "没有检测到运行中的服务"
  else
    ok "所有服务已停止"
  fi
}

show_status() {
  echo "=== 本地开发进程 ==="
  if [[ -f "$PID_FILE" ]]; then
    while IFS= read -r pid; do
      if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
        ok "PID $pid 运行中"
      else
        warn "PID $pid 已停止"
      fi
    done < "$PID_FILE"
  else
    info "无本地开发进程"
  fi

  echo
  echo "=== Docker 容器（开发）==="
  if command_exists docker; then
    cd "$ROOT_DIR"
    docker_compose ps 2>/dev/null || info "无开发容器"
  else
    info "未安装 Docker"
  fi

  echo
  echo "=== Docker 容器（生产）==="
  if command_exists docker; then
    cd "$ROOT_DIR"
    docker_compose_prod ps 2>/dev/null || info "无生产容器"
  fi

  echo
  echo "=== 本地端点探测 ==="
  curl -sf "http://localhost:${BACKEND_PORT}/health" >/dev/null 2>&1 \
    && ok "后端 http://localhost:${BACKEND_PORT} 可访问" \
    || warn "后端 http://localhost:${BACKEND_PORT} 不可访问"
  curl -sf "http://localhost:${FRONTEND_PORT}" >/dev/null 2>&1 \
    && ok "前端 http://localhost:${FRONTEND_PORT} 可访问" \
    || warn "前端 http://localhost:${FRONTEND_PORT} 不可访问"

  echo
  echo "=== 公网端点探测 ==="
  curl -sf "http://${DOMAIN}:${BACKEND_PORT}/health" >/dev/null 2>&1 \
    && ok "后端 http://${DOMAIN}:${BACKEND_PORT} 可访问" \
    || warn "后端 http://${DOMAIN}:${BACKEND_PORT} 不可访问"
  curl -sf "http://${DOMAIN}:${FRONTEND_PORT}" >/dev/null 2>&1 \
    && ok "前端 http://${DOMAIN}:${FRONTEND_PORT} 可访问" \
    || warn "前端 http://${DOMAIN}:${FRONTEND_PORT} 不可访问"
}

show_logs() {
  if ! command_exists docker; then
    error "未安装 Docker"
    exit 1
  fi
  cd "$ROOT_DIR"
  if [[ "${1:-}" == "prod" ]]; then
    docker_compose_prod logs -f
  else
    docker_compose logs -f
  fi
}

usage() {
  cat <<EOF
自传 Agent 系统 — 一键部署 / 启动

用法:
  ./start.sh [命令]

命令:
  docker    Docker 开发模式（本地端口，默认，免登录）
  dev       Docker 开发模式（本地端口，免登录）
  local     本机开发模式（Python venv + npm dev）
  prod      公网生产部署（jiumozhi.tech:6985/6986）
  stop      停止所有服务
  status    查看运行状态
  logs      查看开发 Docker 日志
  logs prod 查看生产 Docker 日志
  help      显示帮助

示例:
  ./start.sh              # 本地 Docker
  ./start.sh dev          # Docker 开发
  ./start.sh local        # 本机开发
  ./start.sh prod         # 公网部署
  ./start.sh stop         # 停止

公网部署前:
  1. DNS: jiumozhi.tech -> 服务器 IP
  2. 编辑 backend/.env 填入 API Key
  3. 开放服务器 6985、6986 端口
  4. ./start.sh prod
EOF
}

main() {
  local cmd="${1:-docker}"

  case "$cmd" in
    docker|up|start|"")
      start_docker
      ;;
    dev)
      start_docker
      ;;
    local)
      start_dev
      ;;
    prod|production)
      start_prod
      ;;
    stop|down)
      stop_services
      ;;
    status|ps)
      show_status
      ;;
    logs)
      show_logs "${2:-}"
      ;;
    help|-h|--help)
      usage
      ;;
    *)
      error "未知命令: $cmd"
      usage
      exit 1
      ;;
  esac
}

main "${1:-docker}"
