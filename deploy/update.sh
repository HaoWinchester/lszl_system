#!/usr/bin/env bash
# 一键更新 lszl.aihuanpu.com（佩奇老师）
# 流程：本地重新构建 new-legacy 产物 → rsync 到服务器 → 重建后端镜像并重启（alembic 迁移自动执行）
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="resume-prod"
REMOTE_DIR="/home/ubuntu/lszl-kg"

echo "[1/3] 本地构建 new-legacy 产物（前端页面 + 引导课程 seed）"
cd "$REPO_DIR/frontend"
node scripts/sync-new-legacy.js
node scripts/export-guided-course.mjs
cd "$REPO_DIR"

echo "[2/3] rsync 代码到 $REMOTE:$REMOTE_DIR"
rsync -az --delete \
  --exclude '/.git' --exclude '/legacy' --exclude '/new-legacy' --exclude '/docs' \
  --exclude '/.superpowers' --exclude '/.pytest_cache' --exclude '/.gitattributes' \
  --exclude 'node_modules' --exclude '.venv' --exclude '__pycache__' --exclude '*.pyc' \
  --exclude '.DS_Store' --exclude '._*' --exclude '/frontend/e2e' --exclude '/e2e' \
  --exclude '.env.prod' --exclude '/backend/.env' \
  "$REPO_DIR/" "$REMOTE:$REMOTE_DIR/"

echo "[3/3] 重建后端镜像并重启"
ssh "$REMOTE" "cd $REMOTE_DIR && docker compose -p lszl-kg -f docker-compose.prod.yml --env-file .env.prod up -d --build"

echo
echo "✓ 更新完成：https://lszl.aihuanpu.com"
echo "  查看日志：ssh $REMOTE 'cd $REMOTE_DIR && docker compose -p lszl-kg logs backend --tail 50'"
