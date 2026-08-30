import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_production_frontend_has_no_react_runtime_or_iframe_host() -> None:
    package = json.loads((ROOT / "frontend/package.json").read_text(encoding="utf-8"))
    dependencies = package.get("dependencies", {})
    assert "react" not in dependencies
    assert "react-dom" not in dependencies
    assert "react-router-dom" not in dependencies
    assert "zustand" not in dependencies
    assert not (ROOT / "frontend/src").exists()
    assert not (ROOT / "frontend/dist").exists()
    assert not (ROOT / "frontend/vite.config.ts").exists()


def test_generated_runtime_contains_no_frame_navigation_bridge() -> None:
    generated = ROOT / "frontend/public/new-legacy"
    assert not (generated / "new-legacy-navigation-bridge.js").exists()
    assert not (generated / "graph-bridge.js").exists()
    assert not (generated / "guided-learning-data-bridge.js").exists()
    for page in generated.glob("*.html"):
        html = page.read_text(encoding="utf-8")
        assert "new-legacy-navigation-bridge" not in html
        assert "graph-bridge" not in html
        for frame in re.findall(r"<iframe\b[^>]*>", html, flags=re.IGNORECASE):
            assert "data-embed-frame" in frame, f"unexpected iframe host in {page.name}: {frame}"


def test_direct_runtime_source_has_no_parent_message_protocol() -> None:
    assets = ROOT / "frontend/scripts/new-legacy-assets"
    assert not (assets / "server-state-bootstrap.js").exists()
    assert json.loads((assets / "runtime-retirement.json").read_text(encoding="utf-8")) == {
        "schemaVersion": 1,
        "status": "retired",
        "runtimeRequests": 0,
    }
