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
