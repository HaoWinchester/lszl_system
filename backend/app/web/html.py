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
    guest_practice = (
        payload.get("page") == "practice-mode.html"
        and payload.get("authenticated") is False
    )
    direct = f"<script>window.__KG_DIRECT_BOOTSTRAP__={encoded};</script><!-- kg-direct-bootstrap -->"
    if guest_practice:
        direct += """
<script>
(function(){
  const root=document.documentElement;
  const className="kg-practice-guest-first-paint";
  root.classList.add(className);
  document.addEventListener("DOMContentLoaded",function(){
    const release=function(){requestAnimationFrame(function(){root.classList.remove(className)})};
    const ready=window.KGQuestionCatalogAdapter?.ready;
    if(ready&&typeof ready.then==="function")ready.then(release,release);else release();
  },{once:true});
})();
</script>
<style id="kg-practice-guest-first-paint-style">
html.kg-practice-guest-first-paint .practice-library,
html.kg-practice-guest-first-paint .practice-setup-card,
html.kg-practice-guest-first-paint .practice-mode-grid{display:none!important}
html.kg-practice-guest-first-paint #practiceEmpty{display:block!important}
</style>"""
    markers = (
        '<script src="./server-state-bootstrap.js"></script>',
        '<script src="/server-state-bootstrap.js"></script>',
    )
    marker = next((candidate for candidate in markers if candidate in html), None)
    if marker is None:
        raise RuntimeError("generated page is missing server-state-bootstrap.js")
    return html.replace(marker, f"{direct}\n{marker}", 1)


def html_response(path: Path, bootstrap: dict) -> HTMLResponse:
    return HTMLResponse(
        inject_bootstrap(path.read_text(encoding="utf-8"), bootstrap),
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )
