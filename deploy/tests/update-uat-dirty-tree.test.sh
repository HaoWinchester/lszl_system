#!/usr/bin/env bash
set -euo pipefail

SOURCE_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE_BIN="$SOURCE_REPO/deploy/tests/fixtures/bin"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/kg-update-uat-dirty-test.XXXXXX")"
TEST_REPO="$TEST_ROOT/repo"
OUTPUT_LOG="$TEST_ROOT/output.log"
CALL_LOG="$TEST_ROOT/calls.log"
trap 'rm -rf "$TEST_ROOT"' EXIT

mkdir -p "$TEST_REPO/deploy" "$TEST_REPO/backend"
cp "$SOURCE_REPO/deploy/update-uat.sh" "$TEST_REPO/deploy/update-uat.sh"
printf '%s\n' 'before' > "$TEST_REPO/backend/app.py"
git -C "$TEST_REPO" init -q
git -C "$TEST_REPO" config user.email uat-test@example.com
git -C "$TEST_REPO" config user.name 'UAT test'
git -C "$TEST_REPO" add .
git -C "$TEST_REPO" commit -qm baseline
printf '%s\n' 'dirty backend change' > "$TEST_REPO/backend/app.py"
touch "$CALL_LOG"

set +e
PATH="$FIXTURE_BIN:$PATH" UAT_TEST_CALL_LOG="$CALL_LOG" \
  bash "$TEST_REPO/deploy/update-uat.sh" >"$OUTPUT_LOG" 2>&1
status=$?
set -e

if [[ "$status" -eq 0 ]] || ! grep -q '工作区有未提交修改' "$OUTPUT_LOG"; then
  echo "UAT deployment must reject a dirty working tree before classifying changes" >&2
  sed -n '1,160p' "$OUTPUT_LOG" >&2
  exit 1
fi

echo "UAT deploy rejects dirty working trees before scope classification"
