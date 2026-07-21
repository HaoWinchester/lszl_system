#!/usr/bin/env bash
set -euo pipefail

RELEASE_ROOT="${1:?缺少 release root}"
RELEASE_VERSION="${2:?缺少 release version}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VALIDATION_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/kg-release-validation.XXXXXX")"
INTEGRATED_LOG="$VALIDATION_ROOT/integrated.log"
RAW_LOG="$VALIDATION_ROOT/raw.log"
INTEGRATED_PID=""
RAW_PID=""

cleanup() {
  if [[ -n "$INTEGRATED_PID" ]]; then kill "$INTEGRATED_PID" 2>/dev/null || true; fi
  if [[ -n "$RAW_PID" ]]; then kill "$RAW_PID" 2>/dev/null || true; fi
  rm -rf "$VALIDATION_ROOT"
}
trap cleanup EXIT INT TERM

free_port() {
  python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'
}

wait_for_health() {
  local url="$1"
  local log="$2"
  for _ in $(seq 1 120); do
    if curl -fsS "$url/api/v1/health" >/dev/null 2>&1; then return 0; fi
    sleep 0.1
  done
  sed -n '1,240p' "$log" >&2
  return 1
}

cd "$REPO_DIR/backend"
.venv/bin/python -m pytest tests/ -q

cd "$REPO_DIR/frontend"
pnpm test

mkdir -p "$VALIDATION_ROOT/releases/$RELEASE_VERSION"
cp -R "$RELEASE_ROOT/$RELEASE_VERSION/." "$VALIDATION_ROOT/releases/$RELEASE_VERSION/"
python3 - "$VALIDATION_ROOT/releases/current.json" "$RELEASE_VERSION" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
version = sys.argv[2]
release = json.loads((path.parent / version / "release.json").read_text(encoding="utf-8"))
path.write_text(json.dumps({
    "schemaVersion": 1,
    "version": version,
    "previousVersion": None,
    "site": f"{version}/site",
    "sourceHash": release["sourceHash"],
    "adapterHash": release["adapterHash"],
}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY

INTEGRATED_PORT="$(free_port)"
cd "$REPO_DIR/backend"
NEW_LEGACY_RELEASE_ROOT="$VALIDATION_ROOT/releases" \
  .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port "$INTEGRATED_PORT" \
  >"$INTEGRATED_LOG" 2>&1 &
INTEGRATED_PID=$!
wait_for_health "http://127.0.0.1:$INTEGRATED_PORT" "$INTEGRATED_LOG"

RAW_PORT="$(free_port)"
cd "$RELEASE_ROOT/$RELEASE_VERSION/source"
python3 -m http.server "$RAW_PORT" --bind 127.0.0.1 >"$RAW_LOG" 2>&1 &
RAW_PID=$!

for _ in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:$RAW_PORT/learning-path.html" >/dev/null 2>&1; then break; fi
  sleep 0.1
done
curl -fsS "http://127.0.0.1:$RAW_PORT/learning-path.html" >/dev/null

cd "$REPO_DIR"
E2E_BASE_URL="http://127.0.0.1:$INTEGRATED_PORT" \
E2E_RELEASE_VERSION="$RELEASE_VERSION" \
  python3 frontend/e2e/new_legacy_smoke.py
python3 frontend/e2e/direct_new_legacy_visual.py \
  --integrated "http://127.0.0.1:$INTEGRATED_PORT" \
  --raw "http://127.0.0.1:$RAW_PORT" \
  --output "$VALIDATION_ROOT/visual"
