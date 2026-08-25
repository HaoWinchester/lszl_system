"""Single source of truth for pages that still need the legacy KV runtime."""

from __future__ import annotations

import json
from pathlib import Path


_POLICY_PATH = Path(__file__).with_name("runtime_page_policy.json")
_POLICY = json.loads(_POLICY_PATH.read_text(encoding="utf-8"))
RUNTIME_PAGES = frozenset(str(page) for page in _POLICY["runtimePages"])


def uses_runtime(page: str) -> bool:
    return page in RUNTIME_PAGES
