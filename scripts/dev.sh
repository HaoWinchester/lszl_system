#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR/backend"

.venv/bin/alembic upgrade head
exec .venv/bin/uvicorn app.main:app --reload --port "${KG_PORT:-5173}"
