#!/bin/bash
# ============================================
# 一键启用 HTTPS（前提：deploy-ssl.sh 已申请证书）
# 用法：DOMAIN=your-domain.com bash setup-ssl-nginx.sh
# ============================================
set -e

DOMAIN=${DOMAIN:-$1}
if [ -z "$DOMAIN" ]; then
  echo "用法: DOMAIN=your-domain.com bash setup-ssl-nginx.sh"
  exit 1
fi

CONF=client/nginx-ssl.conf

echo "[1/3] 生成 $CONF （域名: $DOMAIN）..."
cp client/nginx-ssl.conf.template "$CONF"
sed -i "s|{{DOMAIN}}|$DOMAIN|g" "$CONF"

echo "[2/3] 用 SSL 版 compose 重建 web 容器..."
docker compose -f docker-compose.prod.yml -f docker-compose.ssl.yml \
  --env-file .env up -d --build web

echo "[3/3] 清理临时配置..."
rm -f "$CONF"

echo ""
echo "✅ HTTPS 已启用！"
echo "   访问：https://$DOMAIN"
echo "   HTTP 会自动跳转到 HTTPS"
