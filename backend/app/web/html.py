"""HTML response helpers for the direct upstream runtime."""

from pathlib import Path

from fastapi.responses import HTMLResponse


def html_response(path: Path) -> HTMLResponse:
    return HTMLResponse(
        path.read_text(encoding="utf-8"),
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )
