from fastapi.testclient import TestClient

from app.main import app
from app.web import routes
from app.web.releases import WebRelease


def test_clean_graph_url_uses_existing_page_bootstrap_without_redirect(monkeypatch, tmp_path):
    site = tmp_path / "site"
    site.mkdir()
    (site / "index.html").write_text(
        '<html><head><!-- kg-direct-bootstrap-anchor --></head><body>graph</body></html>',
        encoding="utf-8",
    )
    release = WebRelease(version="graph-alias-test", site=site, source_hash="test-hash")
    monkeypatch.setattr(routes, "active_release", lambda: release)
    observed = []

    async def bootstrap(request, db, *, page, release_version):
        observed.append((request.url.path, dict(request.query_params), page, release_version))
        return {"page": page, "authenticated": False, "releaseVersion": release_version}

    monkeypatch.setattr(routes, "build_bootstrap", bootstrap)
    with TestClient(app) as client:
        response = client.get('/graph?fileId=shared-file&auth=login&mode=free', follow_redirects=False)
        legacy = client.get('/index.html?fileId=shared-file', follow_redirects=False)
    assert response.status_code == 200
    assert "location" not in response.headers
    assert 'window.__KG_DIRECT_BOOTSTRAP__=' in response.text
    assert response.headers["cache-control"] == "no-store"
    assert observed[0] == ('/graph', {'fileId': 'shared-file', 'auth': 'login', 'mode': 'free'}, 'index.html', 'graph-alias-test')
    assert legacy.status_code == 200
    assert observed[1][2] == 'index.html'
