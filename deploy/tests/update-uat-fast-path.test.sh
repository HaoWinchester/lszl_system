#!/usr/bin/env bash
set -euo pipefail

SOURCE_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE_BIN="$SOURCE_REPO/deploy/tests/fixtures/bin"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/kg-update-uat-fast-test.XXXXXX")"
TEST_REPO="$TEST_ROOT/repo"
CALL_LOG="$TEST_ROOT/calls.log"
OUTPUT_LOG="$TEST_ROOT/output.log"
REMOTE_BACKFILL_STATE="$TEST_ROOT/remote-backfill-state"
trap 'rm -rf "$TEST_ROOT"' EXIT

mkdir -p \
  "$TEST_REPO/deploy" \
  "$TEST_REPO/frontend" \
  "$TEST_REPO/new-legacy/content-prep-studio" \
  "$TEST_REPO/backend/app/cli" \
  "$TEST_REPO/backend/app/services"
cp "$SOURCE_REPO/deploy/update-uat.sh" "$TEST_REPO/deploy/update-uat.sh"
cp "$SOURCE_REPO/deploy/uat-change-scope.mjs" "$TEST_REPO/deploy/uat-change-scope.mjs"
cp "$SOURCE_REPO/deploy/nginx-uat.aihuanpu.com.conf" "$TEST_REPO/deploy/nginx-uat.aihuanpu.com.conf"
cp "$SOURCE_REPO/deploy/rsync-excludes.txt" "$TEST_REPO/deploy/rsync-excludes.txt"
printf '%s\n' 'v9.0-test.1' > "$TEST_REPO/new-legacy/VERSION"
printf '%s\n' '<main>before</main>' > "$TEST_REPO/new-legacy/practice-mode.html"
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
BASE_COMMIT="$(git -C "$TEST_REPO" rev-parse HEAD)"
printf '%s\n' '<main>after</main>' > "$TEST_REPO/new-legacy/practice-mode.html"
git -C "$TEST_REPO" add new-legacy/practice-mode.html
git -C "$TEST_REPO" commit -qm page-change
REAL_NODE="$(command -v node)"
NGINX_HASH="$(shasum -a 256 "$TEST_REPO/deploy/nginx-uat.aihuanpu.com.conf" | awk '{print $1}')"
SOURCE_SNAPSHOT_HASH='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
BACKFILL_CODE_HASH="$({
  printf '%s\n' 'uat-paper-release-backfill-v2'
  for tree in backend/app backend/alembic; do
    git -C "$TEST_REPO" rev-parse "HEAD:$tree" 2>/dev/null || printf '%s\n' "missing:$tree"
  done
} | shasum -a 256 | awk '{print $1}')"
BACKFILL_FINGERPRINT="$(printf '%s\n%s\n' "$SOURCE_SNAPSHOT_HASH" "$BACKFILL_CODE_HASH" | shasum -a 256 | awk '{print $1}')"

PATH="$FIXTURE_BIN:$PATH" \
  UAT_TEST_SCENARIO=fast-path \
  UAT_TEST_REAL_NODE="$REAL_NODE" \
  UAT_TEST_DEPLOYED_COMMIT="$BASE_COMMIT" \
  UAT_TEST_NGINX_HASH="$NGINX_HASH" \
  UAT_TEST_SOURCE_SNAPSHOT_HASH="$SOURCE_SNAPSHOT_HASH" \
  UAT_TEST_EXPECTED_BACKFILL_FINGERPRINT="$BACKFILL_FINGERPRINT" \
  UAT_TEST_REMOTE_BACKFILL_STATE="$REMOTE_BACKFILL_STATE" \
  UAT_TEST_PUBLIC_VERSION='v9.0-test.1' \
  UAT_TEST_CALL_LOG="$CALL_LOG" \
  bash "$TEST_REPO/deploy/update-uat.sh" >"$OUTPUT_LOG" 2>&1

if ! grep -q "^update .* --validation-profile uat-fast --uat-base-commit $BASE_COMMIT$" "$CALL_LOG"; then
  echo "page-only UAT deployment must select uat-fast validation" >&2
  cat "$CALL_LOG" >&2
  sed -n '1,180p' "$OUTPUT_LOG" >&2
  exit 1
fi
if grep -q '^build ' "$CALL_LOG"; then
  echo "page-only UAT deployment must not rebuild content-prep" >&2
  cat "$CALL_LOG" >&2
  exit 1
fi
if ! grep -q 'docker builder prune -f' "$CALL_LOG"; then
  echo "UAT deployment must still prune Docker build cache after every deployment" >&2
  cat "$CALL_LOG" >&2
  exit 1
fi
if grep -q 'systemctl reload nginx' "$CALL_LOG"; then
  echo "unchanged nginx config must not be reloaded" >&2
  cat "$CALL_LOG" >&2
  exit 1
fi
if ! grep -q 'runtime_domain_migration plan' "$CALL_LOG" || ! grep -q 'runtime_domain_migration backfill' "$CALL_LOG"; then
  echo "historical backfill must plan against live data and run when its fingerprint is new" >&2
  cat "$CALL_LOG" >&2
  exit 1
fi

printf '' > "$CALL_LOG"
set +e
PATH="$FIXTURE_BIN:$PATH" \
  UAT_TEST_SCENARIO=fast-path \
  UAT_TEST_REAL_NODE="$REAL_NODE" \
  UAT_TEST_DEPLOYED_COMMIT="$BASE_COMMIT" \
  UAT_TEST_NGINX_HASH="$NGINX_HASH" \
  UAT_TEST_SOURCE_SNAPSHOT_HASH="$SOURCE_SNAPSHOT_HASH" \
  UAT_TEST_EXPECTED_BACKFILL_FINGERPRINT="$BACKFILL_FINGERPRINT" \
  UAT_TEST_REMOTE_BACKFILL_STATE="$REMOTE_BACKFILL_STATE" \
  UAT_TEST_PUBLIC_VERSION='wrong-release' \
  UAT_TEST_CALL_LOG="$CALL_LOG" \
  bash "$TEST_REPO/deploy/update-uat.sh" >>"$OUTPUT_LOG" 2>&1
mismatch_status=$?
set -e
if grep -q 'runtime_domain_migration backfill' "$CALL_LOG"; then
  echo "unchanged live data and backfill code must skip the historical backfill" >&2
  cat "$CALL_LOG" >&2
  exit 1
fi
if [[ "$mismatch_status" -eq 0 ]] || grep -q "printf '%s\\n'.*\.deploy-state/git-commit" "$CALL_LOG"; then
  echo "a public release mismatch must fail without advancing deployment state (status=$mismatch_status)" >&2
  cat "$CALL_LOG" >&2
  tail -n 40 "$OUTPUT_LOG" >&2
  exit 1
fi

printf '' > "$CALL_LOG"
PATH="$FIXTURE_BIN:$PATH" \
  UAT_TEST_SCENARIO=fast-path \
  UAT_TEST_REAL_NODE="$REAL_NODE" \
  UAT_TEST_DEPLOYED_COMMIT="$BASE_COMMIT" \
  UAT_TEST_NGINX_HASH="$NGINX_HASH" \
  UAT_TEST_SOURCE_SNAPSHOT_HASH="$SOURCE_SNAPSHOT_HASH" \
  UAT_TEST_EXPECTED_BACKFILL_FINGERPRINT="$BACKFILL_FINGERPRINT" \
  UAT_TEST_REMOTE_BACKFILL_STATE="$REMOTE_BACKFILL_STATE" \
  UAT_TEST_FORCE_VERIFY_FAILURE=1 \
  UAT_TEST_PUBLIC_VERSION='v9.0-test.1' \
  UAT_TEST_CALL_LOG="$CALL_LOG" \
  bash "$TEST_REPO/deploy/update-uat.sh" >>"$OUTPUT_LOG" 2>&1
if ! grep -q 'runtime_domain_migration verify' "$CALL_LOG" || ! grep -q 'runtime_domain_migration backfill' "$CALL_LOG"; then
  echo "a matching host fingerprint must still backfill when database target verification fails" >&2
  cat "$CALL_LOG" >&2
  tail -n 80 "$OUTPUT_LOG" >&2
  exit 1
fi

printf '' > "$CALL_LOG"
FAST_CONFLICT_STATE="$TEST_ROOT/fast-version-conflict"
PATH="$FIXTURE_BIN:$PATH" \
  UAT_TEST_SCENARIO=fast-path \
  UAT_TEST_REAL_NODE="$REAL_NODE" \
  UAT_TEST_DEPLOYED_COMMIT="$BASE_COMMIT" \
  UAT_TEST_NGINX_HASH="$NGINX_HASH" \
  UAT_TEST_SOURCE_SNAPSHOT_HASH="$SOURCE_SNAPSHOT_HASH" \
  UAT_TEST_EXPECTED_BACKFILL_FINGERPRINT="$BACKFILL_FINGERPRINT" \
  UAT_TEST_REMOTE_BACKFILL_STATE="$REMOTE_BACKFILL_STATE" \
  UAT_TEST_FAST_CONFLICT_STATE="$FAST_CONFLICT_STATE" \
  UAT_TEST_PUBLIC_VERSION='v9.0-test.2' \
  UAT_TEST_CALL_LOG="$CALL_LOG" \
  bash "$TEST_REPO/deploy/update-uat.sh" >>"$OUTPUT_LOG" 2>&1
if [[ "$(grep -c -- "--validation-profile uat-fast --uat-base-commit $BASE_COMMIT" "$CALL_LOG")" -ne 2 ]]; then
  echo "an automatic VERSION bump must retain uat-fast on both release attempts" >&2
  cat "$CALL_LOG" >&2
  tail -n 80 "$OUTPUT_LOG" >&2
  exit 1
fi
if ! grep -q '^build v9.0-test.2$' "$CALL_LOG"; then
  echo "an automatic VERSION bump must rebuild the versioned content-prep artifact" >&2
  cat "$CALL_LOG" >&2
  exit 1
fi

echo "page-only UAT deploy uses fast validation and skips unchanged infrastructure work"
