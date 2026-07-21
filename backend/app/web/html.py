"""HTML response helpers for the direct upstream runtime."""

import json
from pathlib import Path

from fastapi.responses import HTMLResponse


def inject_bootstrap(html: str, payload: dict) -> str:
    encoded = (
        json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        .replace("<", "\\u003c")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )
    direct = f"<script>window.__KG_DIRECT_BOOTSTRAP__={encoded};</script><!-- kg-direct-bootstrap -->"
    marker = '<script src="./server-state-bootstrap.js"></script>'
    if marker not in html:
        raise RuntimeError("generated page is missing server-state-bootstrap.js")
    return html.replace(marker, f"{direct}\n{marker}", 1)


def html_response(path: Path, bootstrap: dict) -> HTMLResponse:
    return HTMLResponse(
        inject_bootstrap(path.read_text(encoding="utf-8"), bootstrap),
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )
