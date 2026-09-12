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
    guest_practice = (
        payload.get("page") == "practice-mode.html"
        and payload.get("authenticated") is False
    )
    direct = ""
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
