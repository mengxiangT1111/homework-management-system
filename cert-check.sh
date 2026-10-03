#!/bin/bash
# ============================================
# HTTPS 证书到期检查 - 剩余不足 21 天时告警
# 用法：bash cert-check.sh
# 建议 crontab 每日执行：
#   0 9 * * * cd /opt/homework && bash cert-check.sh
# （也可不做 crontab，deploy.sh 每次部署都会顺带检查一次）
# ============================================
CERT="client/ssl/server.crt"

if [ ! -f "$CERT" ]; then
  echo "ℹ 未找到 $CERT（未启用 HTTPS 可忽略）"
  exit 0
fi

END_STR=$(openssl x509 -enddate -noout -in "$CERT" 2>/dev/null | cut -d= -f2)
if [ -z "$END_STR" ]; then
  echo "⚠ 无法解析 $CERT，请确认为有效的 PEM 证书"
  exit 1
fi

END_TS=$(date -d "$END_STR" +%s 2>/dev/null)
if [ -z "$END_TS" ]; then
  echo "⚠ 无法解析到期时间：$END_STR"
  exit 1
fi

DAYS=$(( (END_TS - $(date +%s)) / 86400 ))
if [ "$DAYS" -lt 21 ]; then
  echo "⚠ HTTPS 证书剩余 ${DAYS} 天（到期时间：${END_STR}）"
  echo "  续期步骤：云控制台重新申请免费证书 → 下载 Nginx 格式 →"
  echo "  覆盖 client/ssl/server.crt 与 server.key → 执行："
  echo "  docker compose -f docker-compose.prod.yml restart frontend"
  exit 1
fi

echo "✓ HTTPS 证书剩余 ${DAYS} 天（到期时间：${END_STR}）"
