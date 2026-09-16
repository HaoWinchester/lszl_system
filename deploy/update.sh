#!/usr/bin/env bash
# 一键更新 lszl.aihuanpu.com（佩奇老师）
# 流程：本地重新构建 new-legacy 产物 → rsync 到服务器 → 重建后端镜像并重启（alembic 迁移自动执行）
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="resume-prod"
REMOTE_DIR="/home/ubuntu/lszl-kg"
COMPOSE_BASE_ARGS="-f docker-compose.prod.yml"
COMPOSE_ARGS="$COMPOSE_BASE_ARGS -f docker-compose.mini-uat.yml"
ENV_FILE=".env.prod"
PROJECT="lszl-kg"
REMOTE_BACKUP_ROOT="/home/ubuntu/lszl-backups"
BACKUP_TS="$(date +'%Y%m%d_%H%M%S')"
REMOTE_BACKUP_DIR="${REMOTE_BACKUP_ROOT}/${BACKUP_TS}"
source "$REPO_DIR/deploy/timing.sh"
deployment_timing_start production
trap 'deployment_timing_finish "$?"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
ROLLBACK_IMAGE="lszl-kg-backend:rollback-${BACKUP_TS}"

backup_remote_release() {
  ssh "$REMOTE" "install -d -m 700 '${REMOTE_BACKUP_DIR}'"
  ssh "$REMOTE" "umask 077; cd '${REMOTE_DIR}' && tar -czf '${REMOTE_BACKUP_DIR}/repo_${BACKUP_TS}.tar.gz' \
    --exclude='./.git' --exclude='./.venv' --exclude='./backend/.venv' --exclude='./backend/__pycache__' \
    --exclude='./backend/.pytest_cache' --exclude='./frontend/node_modules' --exclude='**/__pycache__' \
    --exclude='node_modules' --exclude='*.pyc' --exclude='.DS_Store' --exclude='._*' ."

  # \${...} 必须转义为字面量传到容器内展开（本地无该变量，set -u 下会 unbound）
  ssh "$REMOTE" "umask 077; cd '${REMOTE_DIR}' && docker compose -p ${PROJECT} ${COMPOSE_BASE_ARGS} --env-file ${ENV_FILE} exec -T db sh -lc '
    PGPASSWORD=\"\${POSTGRES_PASSWORD}\"
    pg_dump --format=custom --no-owner --no-acl -U \"\${POSTGRES_USER:-kg}\" -d \"\${POSTGRES_DB:-kg_graph}\"' \
    > '${REMOTE_BACKUP_DIR}/db_${BACKUP_TS}.dump'"

  # 备份文件为空或格式不可读时必须在任何正式同步/重启之前中止。
  ssh "$REMOTE" "test -s '${REMOTE_BACKUP_DIR}/repo_${BACKUP_TS}.tar.gz' \
    && tar -tzf '${REMOTE_BACKUP_DIR}/repo_${BACKUP_TS}.tar.gz' >/dev/null \
    && test -s '${REMOTE_BACKUP_DIR}/db_${BACKUP_TS}.dump' \
    && cd '${REMOTE_DIR}' \
    && docker compose -p ${PROJECT} ${COMPOSE_BASE_ARGS} --env-file ${ENV_FILE} exec -T db pg_restore --list \
      < '${REMOTE_BACKUP_DIR}/db_${BACKUP_TS}.dump' >/dev/null"

  # 给当前运行镜像保留明确标签，防止部署后的 dangling 清理移除回滚镜像。
  ssh "$REMOTE" "docker tag \$(docker inspect --format '{{.Image}}' lszl-kg-backend-1) '${ROLLBACK_IMAGE}'"

  ssh "$REMOTE" "umask 077; cat > '${REMOTE_BACKUP_DIR}/manifest.txt' <<EOF
project=lszl-kg
backup_ts=${BACKUP_TS}
backup_dir=${REMOTE_BACKUP_DIR}
repo_backup=${REMOTE_BACKUP_DIR}/repo_${BACKUP_TS}.tar.gz
db_backup=${REMOTE_BACKUP_DIR}/db_${BACKUP_TS}.dump
rollback_image=${ROLLBACK_IMAGE}
EOF"
  ssh "$REMOTE" "test -s '${REMOTE_BACKUP_DIR}/manifest.txt'"
  echo "      BACKUP_VERIFIED=${REMOTE_BACKUP_DIR}"
}

# The same isolated mini overlay is used in UAT and production. Its filename is
# retained for compatibility; the base compose still owns PC/payment/DB settings.
check_mini_config() {
  ssh "$REMOTE" "cd $REMOTE_DIR && test -s backend/.env.wechat-mini.local && docker compose -p $PROJECT $COMPOSE_BASE_ARGS -f - --env-file $ENV_FILE config --quiet" < "$REPO_DIR/docker-compose.mini-uat.yml"
}
case "${1:-}" in
  --check-config) check_mini_config; exit 0 ;;
  '') ;;
  *) echo 'Usage: update.sh [--check-config]' >&2; exit 2 ;;
esac
if [ "$(git -C "$REPO_DIR" branch --show-current)" != main ]; then
  echo '正式部署必须从已验收并合入的 main 分支执行' >&2; exit 1
fi
if [ -n "$(git -C "$REPO_DIR" status --porcelain)" ]; then
  echo '正式部署前工作区必须干净' >&2; exit 1
fi
check_mini_config

deployment_timing_stage backup
echo "[0/5] 发布前备份远端当前代码与数据库"
backup_remote_release

deployment_timing_stage frontend-build
echo "[1/5] 本地构建 new-legacy 产物（前端页面 + 引导课程 seed）"
cd "$REPO_DIR/frontend"
node scripts/manage-new-legacy.js update ../new-legacy
node scripts/export-guided-course.mjs
node scripts/prepare-new-legacy-runtime.js
cd "$REPO_DIR"

deployment_timing_stage transfer
echo "[2/5] rsync 代码到 $REMOTE:$REMOTE_DIR"
rsync -az --delete --stats \
  --exclude-from "$REPO_DIR/deploy/rsync-excludes.txt" \
  "$REPO_DIR/" "$REMOTE:$REMOTE_DIR/"

deployment_timing_stage image-restart
echo "[3/5] 重建后端镜像并重启"
ssh "$REMOTE" "cd $REMOTE_DIR && docker compose -p ${PROJECT} ${COMPOSE_ARGS} --env-file ${ENV_FILE} up -d --build"

deployment_timing_stage health-maintenance
echo "[4/5] 等待健康检查并执行非阻断空间维护"
ssh "$REMOTE" 'healthy=0; for attempt in $(seq 1 30); do if curl -fsS http://127.0.0.1:18086/api/v1/health >/dev/null; then healthy=1; break; fi; sleep 1; done; test "$healthy" -eq 1'
ssh "$REMOTE" "cd $REMOTE_DIR && docker compose -p $PROJECT $COMPOSE_ARGS --env-file $ENV_FILE exec -T backend python -m app.cli.check_mini_readiness"
ssh "$REMOTE" 'docker image prune -f >/dev/null || true; docker builder prune -f --filter until=168h >/dev/null || true; sudo -n journalctl --vacuum-size=512M >/dev/null || true; df -h /'

echo
echo "✓ 更新完成：https://lszl.aihuanpu.com"
echo "  查看日志：ssh $REMOTE 'cd $REMOTE_DIR && docker compose -p lszl-kg logs backend --tail 50'"
