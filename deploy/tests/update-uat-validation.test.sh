#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE_BIN="$REPO_DIR/deploy/tests/fixtures/bin"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/kg-update-uat-test.XXXXXX")"
TEST_REPO="$TEST_ROOT/repo"
CALL_LOG="$TEST_ROOT/calls.log"
OUTPUT_LOG="$TEST_ROOT/output.log"
trap 'rm -rf "$TEST_ROOT"' EXIT

mkdir -p \
  "$TEST_REPO/deploy" \
  "$TEST_REPO/frontend" \
  "$TEST_REPO/new-legacy/content-prep-studio" \
  "$TEST_REPO/backend/app/cli" \
  "$TEST_REPO/backend/app/services"
cp "$REPO_DIR/deploy/update-uat.sh" "$TEST_REPO/deploy/update-uat.sh"
cp "$REPO_DIR/deploy/nginx-uat.aihuanpu.com.conf" "$TEST_REPO/deploy/nginx-uat.aihuanpu.com.conf"
cp "$REPO_DIR/deploy/rsync-excludes.txt" "$TEST_REPO/deploy/rsync-excludes.txt"
printf '%s\n' 'v9.0-validation-test' > "$TEST_REPO/new-legacy/VERSION"
touch \
  "$TEST_REPO/new-legacy/content-prep-studio/build.py" \
  "$TEST_REPO/backend/app/cli/runtime_domain_migration.py" \
  "$TEST_REPO/backend/app/services/runtime_domain_migration_service.py" \
  "$TEST_REPO/backend/app/services/paper_release_service.py" \
  "$CALL_LOG"
git -C "$TEST_REPO" init -q
git -C "$TEST_REPO" config user.email uat-test@example.com
git -C "$TEST_REPO" config user.name 'UAT test'
git -C "$TEST_REPO" add .
git -C "$TEST_REPO" commit -qm baseline

set +e
PATH="$FIXTURE_BIN:$PATH" UAT_TEST_CALL_LOG="$CALL_LOG" \
  bash "$TEST_REPO/deploy/update-uat.sh" >"$OUTPUT_LOG" 2>&1
status=$?
set -e

if [[ "$status" -eq 0 ]]; then
  echo "expected update-uat.sh to fail when automatic release validation fails" >&2
  sed -n '1,160p' "$OUTPUT_LOG" >&2
  exit 1
fi
if grep -q '^promote ' "$CALL_LOG"; then
  echo "update-uat.sh promoted a candidate after failed validation" >&2
  cat "$CALL_LOG" >&2
  exit 1
fi
if ! grep -q '自动验收失败' "$OUTPUT_LOG"; then
  echo "expected the release validator failure to be the deployment blocker" >&2
  sed -n '1,160p' "$OUTPUT_LOG" >&2
  exit 1
fi

echo "update-uat validation failure stops before promote"
