#!/usr/bin/env bash
# 一键更新 lszl.aihuanpu.com（佩奇老师）
# 流程：本地重新构建 new-legacy 产物 → rsync 到服务器 → 重建后端镜像并重启（alembic 迁移自动执行）
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="resume-prod"
REMOTE_DIR="/home/ubuntu/lszl-kg"

echo "[1/4] 本地构建 new-legacy 产物（前端页面 + 引导课程 seed）"
cd "$REPO_DIR/frontend"
node scripts/sync-new-legacy.js
node scripts/export-guided-course.mjs
cd "$REPO_DIR"

echo "[2/4] rsync 代码到 $REMOTE:$REMOTE_DIR"
rsync -az --delete \
  --exclude '/.git' --exclude '/new-legacy' --exclude '/docs' \
  --exclude '/.superpowers' --exclude '/.pytest_cache' --exclude '/.gitattributes' \
  --exclude 'node_modules' --exclude '.venv' --exclude '__pycache__' --exclude '*.pyc' \
  --exclude '.DS_Store' --exclude '._*' --exclude '/frontend/e2e' --exclude '/e2e' \
  --exclude '.env.prod' --exclude '/backend/.env' \
  "$REPO_DIR/" "$REMOTE:$REMOTE_DIR/"

echo "[3/4] 重建后端镜像并重启"
ssh "$REMOTE" "cd $REMOTE_DIR && docker compose -p lszl-kg -f docker-compose.prod.yml --env-file .env.prod up -d --build"

echo "[4/4] 等待健康检查并执行非阻断空间维护"
ssh "$REMOTE" 'healthy=0; for attempt in $(seq 1 30); do if curl -fsS http://127.0.0.1:18086/api/v1/health >/dev/null; then healthy=1; break; fi; sleep 1; done; test "$healthy" -eq 1'
ssh "$REMOTE" 'docker image prune -f >/dev/null || true; docker builder prune -f --filter until=168h >/dev/null || true; sudo -n journalctl --vacuum-size=512M >/dev/null || true; df -h /'

echo
echo "✓ 更新完成：https://lszl.aihuanpu.com"
echo "  查看日志：ssh $REMOTE 'cd $REMOTE_DIR && docker compose -p lszl-kg logs backend --tail 50'"
