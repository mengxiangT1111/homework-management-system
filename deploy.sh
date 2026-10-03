#!/bin/bash
# ============================================
# 一键部署脚本 - 在服务器上执行
# 用法：git pull && bash deploy.sh
# ============================================
set -e

echo "========================================"
echo "  在线作业提交管理系统 - 部署脚本"
echo "========================================"

# 打印本次部署的代码版本（无 git 历史或非 git 目录时静默跳过）
DEPLOY_VER=$(git log -1 --oneline 2>/dev/null || true)
[ -n "$DEPLOY_VER" ] && echo "部署版本：$DEPLOY_VER"

# 检查生产配置（.env 不入库；从仓库模板 .env.example 复制生成）
if [ ! -f .env ]; then
  echo "✗ 未找到 .env，请先从模板创建并修改密码："
  echo "    cp .env.example .env && vi .env"
  exit 1
fi

# 读取 .env 值：去掉行尾 CRLF（Windows 编辑过的文件常见）与包裹引号
get_env() {
  sed -n "s/^${1}=//p" .env | head -1 | tr -d '\r' | sed "s/^['\"]//;s/['\"]$//"
}

# 密钥门禁：仓库是公开的，默认值/占位符一旦上线等于把平台钥匙公开
# （JWT_SECRET 已知 = 任何人可伪造任意账号的登录态）
check_key() {
  local v
  v="$(get_env "$1")"
  if [ -z "$v" ] || printf '%s' "$v" | grep -qiE 'changeme|change_this|homework123|root123456|admin123|secret_in_production'; then
    echo "  ✗ $1 未设置，或仍为弱默认值/占位符"
    WEAK_KEY=1
  fi
}
WEAK_KEY=0
for k in JWT_SECRET DB_PASSWORD MYSQL_ROOT_PASSWORD ADMIN_PASSWORD; do
  check_key "$k"
done
if [ "$WEAK_KEY" -eq 1 ]; then
  echo ""
  echo "✗ 拒绝部署：请先在 .env 中为上述密钥设置强随机值"
  echo "    生成方式：openssl rand -base64 32"
  exit 1
fi

echo ""
echo "[1/6] 构建并启动所有服务..."
docker compose -f docker-compose.prod.yml --env-file .env up -d --build

echo ""
echo "[2/6] 等待 MySQL 就绪..."
MYSQL_OK=0
for i in $(seq 1 30); do
  # 不带凭证 ping：服务器有响应（含拒绝访问）即代表存活，且不会把口令泄进进程列表
  if docker exec hw_mysql mysqladmin ping -h localhost --silent 2>/dev/null; then
    MYSQL_OK=1
    break
  fi
  sleep 2
done
if [ "$MYSQL_OK" -ne 1 ]; then
  echo "✗ MySQL 60 秒内未就绪，请查日志：docker logs hw_mysql"
  exit 1
fi
echo "✓ MySQL 已就绪"

echo ""
echo "[3/6] 初始化管理员账号..."
# seedProd 幂等：账号已存在时正常退出；非零退出码代表真实故障（上方已打印具体报错）
if docker exec hw_backend node src/seeders/seedProd.js; then
  echo "✓ 管理员账号就绪"
else
  echo "⚠ 管理员初始化未成功：首次部署请按上方报错排查后重跑；老环境账号已存在时可忽略"
fi

echo ""
echo "[4/6] 检查服务状态..."
docker compose -f docker-compose.prod.yml ps

echo ""
echo "[5/6] 验证服务真实响应..."
HEALTH_FAIL=0
# 前端入口（走 nginx 全链路）
if curl -sf -o /dev/null --max-time 10 http://localhost/; then
  echo "✓ 前端入口响应正常（http://localhost/）"
else
  echo "✗ 前端入口无响应，请查：docker logs hw_frontend"
  HEALTH_FAIL=1
fi
# 后端进程探活：容器内 node 直连 3000，收到任意 HTTP 状态码（含 404/401）即视为存活
if docker exec hw_backend node -e "require('http').get('http://127.0.0.1:3000/',r=>process.exit(0)).on('error',()=>process.exit(1))" 2>/dev/null; then
  echo "✓ 后端 API 存活"
else
  echo "✗ 后端 API 无响应（可能正在崩溃循环），请查：docker logs hw_backend"
  HEALTH_FAIL=1
fi
# 查重检测服务（配置了 DETECTION_API_TOKEN 才接入；未配置仅提示，不算部署失败）
DET_TOKEN="$(get_env DETECTION_API_TOKEN)"
if [ -n "$DET_TOKEN" ]; then
  if docker exec hw_detection python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)" 2>/dev/null; then
    echo "✓ 查重检测服务存活"
  else
    echo "✗ 查重检测服务无响应，请查：docker logs hw_detection"
    HEALTH_FAIL=1
  fi
else
  echo "ℹ 未配置 DETECTION_API_TOKEN：查重功能禁用（.env 配置后重新部署即可启用）"
fi
# HTTPS 证书到期提醒（剩余不足 21 天告警，不影响部署结果）
bash cert-check.sh || true

echo ""
echo "[6/6] 清理悬空旧镜像..."
docker image prune -f

echo ""
if [ "$HEALTH_FAIL" -eq 1 ]; then
  echo "========================================"
  echo "  ⚠ 部署完成，但服务健康验证未通过！"
  echo "  容器仍在运行，请根据上方提示查看日志"
  echo "========================================"
  exit 1
fi

SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo "========================================"
echo "  ✅ 部署完成！"
echo "========================================"
echo ""
echo "  访问地址：http://${SERVER_IP:-你的服务器IP}"
echo "  管理员：admin / .env 中的 ADMIN_PASSWORD（请尽快修改密码）"
echo ""
echo "  查看日志：docker compose -f docker-compose.prod.yml logs -f"
echo "  停止服务：docker compose -f docker-compose.prod.yml down"
echo "========================================"
