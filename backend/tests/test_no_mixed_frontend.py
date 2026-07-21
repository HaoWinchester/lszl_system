import json
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
        assert "<iframe" not in html


def test_direct_runtime_source_has_no_parent_message_protocol() -> None:
    source = (ROOT / "frontend/scripts/new-legacy-assets/server-state-bootstrap.js").read_text(encoding="utf-8")
    assert "parent.postMessage" not in source
    assert "__KG_NEW_LEGACY_BOOTSTRAP__" not in source
