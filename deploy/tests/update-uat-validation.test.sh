#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE_BIN="$REPO_DIR/deploy/tests/fixtures/bin"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/kg-update-uat-test.XXXXXX")"
CALL_LOG="$TEST_ROOT/calls.log"
OUTPUT_LOG="$TEST_ROOT/output.log"
trap 'rm -rf "$TEST_ROOT"' EXIT

touch "$CALL_LOG"
set +e
PATH="$FIXTURE_BIN:$PATH" UAT_TEST_CALL_LOG="$CALL_LOG" \
  bash "$REPO_DIR/deploy/update-uat.sh" >"$OUTPUT_LOG" 2>&1
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

echo "update-uat validation failure stops before promote"
