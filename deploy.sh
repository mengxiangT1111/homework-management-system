#!/bin/bash
# ============================================
# 一键部署脚本 - 在服务器上执行
# 用法：bash deploy.sh
# ============================================
set -e

echo "========================================"
echo "  在线作业提交管理系统 - 部署脚本"
echo "========================================"

# 检查生产配置（.env 不入库；从仓库模板 .env.example 复制生成）
if [ ! -f .env ]; then
  echo "✗ 未找到 .env，请先从模板创建并修改密码："
  echo "    cp .env.example .env && vi .env"
  exit 1
fi

echo ""
echo "[1/4] 构建并启动所有服务..."
docker compose -f docker-compose.prod.yml --env-file .env up -d --build

echo ""
echo "[2/4] 等待 MySQL 就绪..."
sleep 20

echo ""
echo "[3/4] 初始化管理员账号..."
docker exec hw_backend node src/seeders/seedProd.js || echo "（初始化可能已完成，忽略）"

echo ""
echo "[4/4] 检查服务状态..."
docker compose -f docker-compose.prod.yml ps

echo ""
echo "========================================"
echo "  ✅ 部署完成！"
echo "========================================"
echo ""
echo "  访问地址：http://你的服务器IP"
echo "  管理员：admin / .env 中的 ADMIN_PASSWORD（请尽快修改密码）"
echo ""
echo "  查看日志：docker compose -f docker-compose.prod.yml logs -f"
echo "  停止服务：docker compose -f docker-compose.prod.yml down"
echo "========================================"
