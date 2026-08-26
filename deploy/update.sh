#!/usr/bin/env bash
# 一键更新 lszl.aihuanpu.com（佩奇老师）
# 流程：本地重新构建 new-legacy 产物 → rsync 到服务器 → 重建后端镜像并重启（alembic 迁移自动执行）
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="resume-prod"
REMOTE_DIR="/home/ubuntu/lszl-kg"
COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.prod"
PROJECT="lszl-kg"
REMOTE_BACKUP_ROOT="/home/ubuntu/lszl-backups"
BACKUP_TS="$(date +'%Y%m%d_%H%M%S')"
REMOTE_BACKUP_DIR="${REMOTE_BACKUP_ROOT}/${BACKUP_TS}"

backup_remote_release() {
  ssh "$REMOTE" "install -d -m 700 '${REMOTE_BACKUP_DIR}'"
  ssh "$REMOTE" "umask 077; cd '${REMOTE_DIR}' && tar -czf '${REMOTE_BACKUP_DIR}/repo_${BACKUP_TS}.tar.gz' \
    --exclude='./.git' --exclude='./.venv' --exclude='./backend/.venv' --exclude='./backend/__pycache__' \
    --exclude='./backend/.pytest_cache' --exclude='./frontend/node_modules' --exclude='**/__pycache__' \
    --exclude='node_modules' --exclude='*.pyc' --exclude='.DS_Store' --exclude='._*' ."

  # \${...} 必须转义为字面量传到容器内展开（本地无该变量，set -u 下会 unbound）
  ssh "$REMOTE" "umask 077; cd '${REMOTE_DIR}' && docker compose -p ${PROJECT} -f ${COMPOSE_FILE} --env-file ${ENV_FILE} exec -T db sh -lc '
    PGPASSWORD=\"\${POSTGRES_PASSWORD}\"
    pg_dump --format=custom --no-owner --no-acl -U \"\${POSTGRES_USER:-kg}\" -d \"\${POSTGRES_DB:-kg_graph}\"' \
    > '${REMOTE_BACKUP_DIR}/db_${BACKUP_TS}.dump'"

  ssh "$REMOTE" "umask 077; cat > '${REMOTE_BACKUP_DIR}/manifest.txt' <<EOF
project=lszl-kg
backup_ts=${BACKUP_TS}
backup_dir=${REMOTE_BACKUP_DIR}
repo_backup=${REMOTE_BACKUP_DIR}/repo_${BACKUP_TS}.tar.gz
db_backup=${REMOTE_BACKUP_DIR}/db_${BACKUP_TS}.dump
EOF"
}

echo "[0/5] 发布前备份远端当前代码与数据库"
backup_remote_release

echo "[1/5] 本地构建 new-legacy 产物（前端页面 + 引导课程 seed）"
cd "$REPO_DIR/frontend"
node scripts/sync-new-legacy.js
node scripts/export-guided-course.mjs
node scripts/prepare-new-legacy-runtime.js
cd "$REPO_DIR"

echo "[2/5] rsync 代码到 $REMOTE:$REMOTE_DIR"
rsync -az --delete \
  --exclude-from "$REPO_DIR/deploy/rsync-excludes.txt" \
  "$REPO_DIR/" "$REMOTE:$REMOTE_DIR/"

echo "[3/5] 重建后端镜像并重启"
ssh "$REMOTE" "cd $REMOTE_DIR && docker compose -p ${PROJECT} -f ${COMPOSE_FILE} --env-file ${ENV_FILE} up -d --build"

echo "[4/5] 等待健康检查并执行非阻断空间维护"
ssh "$REMOTE" 'healthy=0; for attempt in $(seq 1 30); do if curl -fsS http://127.0.0.1:18086/api/v1/health >/dev/null; then healthy=1; break; fi; sleep 1; done; test "$healthy" -eq 1'
ssh "$REMOTE" 'docker image prune -f >/dev/null || true; docker builder prune -f --filter until=168h >/dev/null || true; sudo -n journalctl --vacuum-size=512M >/dev/null || true; df -h /'

echo
echo "✓ 更新完成：https://lszl.aihuanpu.com"
echo "  查看日志：ssh $REMOTE 'cd $REMOTE_DIR && docker compose -p lszl-kg logs backend --tail 50'"
