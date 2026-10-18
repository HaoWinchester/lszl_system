"""图谱文件 cutover 开关在 bootstrap 中的能力通告。"""

import asyncio

import pytest
from starlette.requests import Request

from app.core.config import settings
from app.web.bootstrap import build_bootstrap


def test_bootstrap_advertises_graph_files_cutover_capability(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "GRAPH_FILES_API_CUTOVER_ENABLED", True, raising=False)
    request = Request({
        "type": "http",
        "method": "GET",
        "path": "/index.html",
        "headers": [],
        "session": {},
    })

    payload = asyncio.run(
        build_bootstrap(
            request,
            None,
            page="index.html",
            release_version="test-release",
        )
    )

    assert payload["graphFilesApiCutoverEnabled"] is True


def test_default_configuration_enables_database_backed_graph_files(monkeypatch):
    from app.core.config import Settings
    monkeypatch.delenv('GRAPH_FILES_API_CUTOVER_ENABLED', raising=False)
    configured = Settings(_env_file=None)
    assert configured.GRAPH_FILES_API_CUTOVER_ENABLED is True
    monkeypatch.setattr(settings, 'GRAPH_FILES_API_CUTOVER_ENABLED', configured.GRAPH_FILES_API_CUTOVER_ENABLED)
    request = Request({'type':'http','method':'GET','path':'/index.html','headers':[],'session':{}})
    payload = asyncio.run(build_bootstrap(request, None, page='index.html', release_version='default-config'))
    assert payload['graphFilesApiCutoverEnabled'] is True


def test_explicit_legacy_configuration_keeps_capability_disabled(monkeypatch):
    from app.core.config import Settings
    monkeypatch.setenv('GRAPH_FILES_API_CUTOVER_ENABLED', 'false')
    configured = Settings(_env_file=None)
    assert configured.GRAPH_FILES_API_CUTOVER_ENABLED is False
    monkeypatch.setattr(settings, 'GRAPH_FILES_API_CUTOVER_ENABLED', configured.GRAPH_FILES_API_CUTOVER_ENABLED)
    request = Request({'type':'http','method':'GET','path':'/index.html','headers':[],'session':{}})
    payload = asyncio.run(build_bootstrap(request, None, page='index.html', release_version='legacy-config'))
    assert payload['graphFilesApiCutoverEnabled'] is False
