#!/usr/bin/env bash
set -euo pipefail

SOURCE_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE_BIN="$SOURCE_REPO/deploy/tests/fixtures/bin"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/kg-update-uat-version-test.XXXXXX")"
TEST_REPO="$TEST_ROOT/repo"
CALL_LOG="$TEST_ROOT/calls.log"
OUTPUT_LOG="$TEST_ROOT/output.log"
STATE_FILE="$TEST_ROOT/conflict-seen"
trap 'rm -rf "$TEST_ROOT"' EXIT

mkdir -p "$TEST_REPO/deploy" "$TEST_REPO/frontend" "$TEST_REPO/new-legacy/content-prep-studio"
cp "$SOURCE_REPO/deploy/update-uat.sh" "$TEST_REPO/deploy/update-uat.sh"
printf '%s' 'v9.0-p4.1.155' > "$TEST_REPO/new-legacy/VERSION"
touch "$TEST_REPO/new-legacy/content-prep-studio/build.py" "$CALL_LOG"

PATH="$FIXTURE_BIN:$PATH" \
  UAT_TEST_SCENARIO=version-bump \
  UAT_TEST_STATE="$STATE_FILE" \
  UAT_TEST_CALL_LOG="$CALL_LOG" \
  bash "$TEST_REPO/deploy/update-uat.sh" >"$OUTPUT_LOG" 2>&1

expected=$'build v9.0-p4.1.155\nsync v9.0-p4.1.155\nexport v9.0-p4.1.155\nbuild v9.0-p4.1.156\nsync v9.0-p4.1.156\nexport v9.0-p4.1.156\nupdate v9.0-p4.1.156\npromote v9.0-p4.1.156'
actual="$(cat "$CALL_LOG")"
if [[ "$actual" != "$expected" ]]; then
  echo "version bump must rebuild every versioned artifact before updating the candidate" >&2
  diff -u <(printf '%s\n' "$expected") <(printf '%s\n' "$actual") >&2 || true
  sed -n '1,160p' "$OUTPUT_LOG" >&2
  exit 1
fi

echo "update-uat rebuilds every versioned artifact after a version bump"
