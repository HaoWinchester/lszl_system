"""HTML response helpers for the direct upstream runtime."""

import json
from pathlib import Path

from fastapi.responses import HTMLResponse

_BOOTSTRAP_MARKERS = (
    "<!-- kg-direct-bootstrap-anchor -->",
    '<script src="./server-state-bootstrap.js"></script>',
    '<script src="/server-state-bootstrap.js"></script>',
)


def inject_bootstrap(html: str, payload: dict) -> str:
    direct = ""
    encoded = (
        json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        .replace("<", "\\u003c")
        .replace(" ", "\\u2028")
        .replace(" ", "\\u2029")
    )
    direct += (
        f"\n<script>window.__KG_DIRECT_BOOTSTRAP__={encoded};</script>"
        "<!-- kg-direct-bootstrap -->"
    )
    marker = next((candidate for candidate in _BOOTSTRAP_MARKERS if candidate in html), None)
    if marker is None:
        raise RuntimeError("generated page is missing the direct bootstrap anchor")
    return html.replace(marker, f"{direct}\n{marker}", 1)


def has_bootstrap_anchor(html: str) -> bool:
    """页面是否带 bootstrap 注入锚点；搜索引擎验证文件等静态 html 没有。"""
    return any(candidate in html for candidate in _BOOTSTRAP_MARKERS)


def html_response(path: Path, bootstrap: dict) -> HTMLResponse:
    return HTMLResponse(
        inject_bootstrap(path.read_text(encoding="utf-8"), bootstrap),
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )
