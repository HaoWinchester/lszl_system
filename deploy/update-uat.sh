#!/usr/bin/env bash
# 一键更新 uat.aihuanpu.com（佩奇老师 UAT 测试环境）
# 流程：磁盘预检 → 本地构建 new-legacy 产物 → 打包并发布 release → rsync 到服务器
#       → 重建后端镜像并重启 → 健康检查 → 清理构建缓存（防磁盘打满，2026-08-21 事故教训）
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="resume-prod"
REMOTE_DIR="/home/ubuntu/lszl-kg-uat"
PROJECT="lszl-kg-uat"
COMPOSE_FILE="docker-compose.uat.yml"
ENV_FILE=".env.uat"
HEALTH_URL="http://127.0.0.1:18087/api/v1/health"
PUBLIC_HEALTH_URL="https://uat.aihuanpu.com/api/v1/health"
NGINX_CONFIG="$REPO_DIR/deploy/nginx-uat.aihuanpu.com.conf"
MIN_FREE_GB=5   # 部署前服务器最低剩余磁盘（GB），不足则中止

version_file="$REPO_DIR/new-legacy/VERSION"

bump_version() {
  # v9.0-p4.1.127 -> v9.0-p4.1.128（末段自增）
  # 注意：macOS 自带 bash 3.2 的算术展开不支持表达式内引号，必须写成 $(( x + 1 ))
  local v n
  v="$(cat "$version_file")"
  case "${v##*.}" in
    ''|*[!0-9]*) echo "✗ VERSION 内容异常：$v" >&2; return 1 ;;
  esac
  n=$(( ${v##*.} + 1 )) || return 1
  printf '%s' "${v%.*}.$n" > "$version_file"
}

build_content_prep() {
  python3 "$REPO_DIR/new-legacy/content-prep-studio/build.py" >/dev/null
}

echo "[0/9] 服务器磁盘预检（剩余 < ${MIN_FREE_GB}GB 则中止）"
free_kb=$(ssh "$REMOTE" "df -P / | awk 'NR==2 {print \$4}'")
free_gb=$((free_kb / 1024 / 1024))
echo "      / 剩余 ${free_gb}GB"
if [ "$free_gb" -lt "$MIN_FREE_GB" ]; then
  echo "✗ 磁盘剩余不足 ${MIN_FREE_GB}GB，先执行清理（docker builder prune -f）再部署" >&2
  exit 1
fi

echo "[1/9] 本地构建 new-legacy 前端产物"
build_content_prep
cd "$REPO_DIR/frontend"
node scripts/sync-new-legacy.js
cd "$REPO_DIR"

echo "[2/9] 打包并发布 new-legacy release"
cd "$REPO_DIR/frontend"
# 若本地已有同版本号但内容不同的 release（开发分支忘记递增 VERSION），自动递增末段重打包。
# 只有 update 真正成功才允许继续，防止把旧包当新版本发布出去。
updated=0
for _ in 1 2 3; do
  if node scripts/manage-new-legacy.js update ../new-legacy > /tmp/kg-uat-release.log 2>&1; then
    updated=1
    break
  fi
  if grep -q '相同版本号' /tmp/kg-uat-release.log; then
    old="$(cat "$version_file")"
    bump_version || { echo "✗ 版本号递增失败" >&2; exit 1; }
    echo "      版本号冲突：$old -> $(cat "$version_file")，重新生成产物"
    build_content_prep || exit 1
    node scripts/sync-new-legacy.js || exit 1
  else
    cat /tmp/kg-uat-release.log
    echo "✗ release 打包或自动验收失败，候选包不会 promote" >&2
    exit 1
  fi
done
if [ "$updated" -ne 1 ]; then
  echo "✗ release 打包重试 3 次仍未成功，中止（未发布任何内容）" >&2
  exit 1
fi
VERSION="$(cat "$version_file")"
node scripts/manage-new-legacy.js promote "$VERSION"
node scripts/prepare-new-legacy-runtime.js
cd "$REPO_DIR"
echo "      当前发布版本：$VERSION"

echo "[3/9] rsync 代码与 release 到 $REMOTE:$REMOTE_DIR"
rsync -az --delete \
  --exclude '/.git' --exclude '/new-legacy' --exclude '/docs' \
  --exclude '/frontend/new-legacy-releases' --exclude '/backups' \
  --exclude '/测试数据' --exclude '/修改需求' --exclude '/转题目-json文档' --exclude '/内置数据' \
  --exclude '/bug清单.docx' --exclude '/task-1-report.md' --exclude '/task-2-report.md' --exclude '/test-practice-mode.js' \
  --exclude '/.superpowers' --exclude '/.pytest_cache' --exclude '/.gitattributes' \
  --exclude 'node_modules' --exclude '.venv' --exclude '__pycache__' --exclude '*.pyc' \
  --exclude '.DS_Store' --exclude '._*' --exclude '/frontend/e2e' --exclude '/e2e' \
  --exclude '.env.prod' --exclude '/backend/.env' --exclude '.env.uat' \
  --exclude '/deploy' \
  "$REPO_DIR/" "$REMOTE:$REMOTE_DIR/"

echo "[4/9] 重建 UAT 后端镜像并重启（alembic 迁移自动执行）"
ssh "$REMOTE" "cd $REMOTE_DIR && docker compose -p $PROJECT -f $COMPOSE_FILE --env-file $ENV_FILE up -d --build"

echo "[5/9] 等待健康检查（18087）"
ssh "$REMOTE" "healthy=0; for attempt in \$(seq 1 40); do if curl -fsS $HEALTH_URL >/dev/null; then healthy=1; break; fi; sleep 1; done; test \"\$healthy\" -eq 1" \
  || { echo "✗ 健康检查失败，查看日志：ssh $REMOTE 'cd $REMOTE_DIR && docker compose -p $PROJECT logs backend --tail 50'" >&2; exit 1; }
echo "      HEALTH_OK"

echo "[6/9] 安装 Git 管理的 UAT HTTPS/HTTP2/gzip 配置"
rsync -az "$NGINX_CONFIG" "$REMOTE:/tmp/nginx-uat.aihuanpu.com.conf"
ssh "$REMOTE" "test -s /etc/letsencrypt/live/uat.aihuanpu.com/fullchain.pem \
  && test -s /etc/letsencrypt/live/uat.aihuanpu.com/privkey.pem \
  && sudo install -m 0644 /tmp/nginx-uat.aihuanpu.com.conf /etc/nginx/conf.d/uat.aihuanpu.com.conf \
  && sudo nginx -t \
  && sudo systemctl reload nginx"
curl -fsS "$PUBLIC_HEALTH_URL" >/dev/null
echo "      HTTPS_HEALTH_OK"

echo "[7/9] 回填历史已发布试卷到关系化目录（仅限两个试卷发布键）"
ssh "$REMOTE" "cd $REMOTE_DIR && docker compose -p $PROJECT -f $COMPOSE_FILE --env-file $ENV_FILE exec -T backend python -m app.cli.runtime_domain_migration backfill \
  --run-id uat-paper-release-backfill-v1 \
  --source-key kg_exam_papers_published_v1 \
  --source-key kg_exam_paper_release_history_v1 \
  --report-json /tmp/uat-paper-release-backfill.json"
echo "      PAPER_RELEASE_BACKFILL_OK"

echo "[8/9] 清理构建缓存与悬空镜像（仅清理 dangling 资源，不动运行中容器）"
ssh "$REMOTE" 'docker image prune -f >/dev/null; docker builder prune -f --filter until=168h >/dev/null; true'

echo "[9/9] 磁盘水位与 UAT 版本核对"
ssh "$REMOTE" 'df -h / | tail -1'
curl -fsS "https://uat.aihuanpu.com/" | grep -o 'data-release="[^"]*"' | head -1 || true

echo
echo "✓ UAT 更新完成：https://uat.aihuanpu.com ($VERSION)"
echo "  查看日志：ssh $REMOTE 'cd $REMOTE_DIR && docker compose -p $PROJECT logs backend --tail 50'"
