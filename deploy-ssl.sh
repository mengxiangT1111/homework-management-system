#!/bin/bash
# ============================================
# HTTPS 配置脚本 - 申请免费 SSL 证书
# 前提：域名已解析到服务器IP，且 80/443 端口已开放
# 用法：bash deploy-ssl.sh your-domain.com
# ============================================
set -e

DOMAIN=$1
EMAIL=${2:-admin@$DOMAIN}

if [ -z "$DOMAIN" ]; then
  echo "用法: bash deploy-ssl.sh your-domain.com [your-email@example.com]"
  echo "示例: bash deploy-ssl.sh homework.example.com"
  exit 1
fi

echo "========================================"
echo "  为 $DOMAIN 配置 HTTPS"
echo "========================================"

# 安装 certbot
if ! command -v certbot &> /dev/null; then
  echo "[1/4] 安装 certbot..."
  if command -v apt &> /dev/null; then
    apt update -y && apt install -y certbot
  elif command -v yum &> /dev/null; then
    yum install -y certbot
  fi
fi

# 申请证书（webroot 方式，需要 web 容器的 80 端口运行中）
echo "[2/4] 申请 SSL 证书..."
mkdir -p /etc/letsencrypt

# 用 standalone 模式申请（会临时占用 80 端口）
echo "  临时停止 web 容器以申请证书..."
docker stop hw_web 2>/dev/null || true

certbot certonly --standalone \
  -d $DOMAIN \
  --email $EMAIL \
  --agree-tos \
  --no-eff-email \
  --non-interactive

echo "  重新启动 web 容器..."
docker start hw_web

echo "[3/4] 证书申请成功！路径："
echo "  /etc/letsencrypt/live/$DOMAIN/fullchain.pem"
echo "  /etc/letsencrypt/live/$DOMAIN/privkey.pem"

echo ""
echo "[4/4] 接下来请修改 nginx 配置启用 HTTPS："
echo "  1. 编辑 client/nginx-ssl.conf，把 \$DOMAIN 替换为 $DOMAIN"
echo "  2. 重新构建 web 容器："
echo "     docker compose -f docker-compose.prod.yml up -d --build web"
echo ""
echo "  或直接运行：DOMAIN=$DOMAIN bash setup-ssl-nginx.sh"
echo "========================================"
echo "  ✅ SSL 证书申请完成！"
echo "========================================"
