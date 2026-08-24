import asyncio

import pytest
from starlette.requests import Request

from app.core.config import settings
from app.services import runtime_state_service as service
from app.web.bootstrap import build_bootstrap
from app.web.schemas import RuntimeMutation, RuntimeStateUpdate


GRAPH_INDEX_KEY = "kg_graph_file_index_v2"
GRAPH_CURRENT_KEY = "kg_graph_current_file_v2"
GRAPH_CONTENT_KEY = "kg_graph_file_content_v2__alice__graph-1"


def graph_update(key: str) -> RuntimeStateUpdate:
    return RuntimeStateUpdate(
        page="index.html",
        namespace="files",
        operation="setItem",
        key=key,
        value='{"stale":true}',
        storage={key: '{"stale":true}'},
        snapshotMode="full",
        mutations=[
            RuntimeMutation(
                operation="setItem",
                key=key,
                value='{"stale":true}',
            )
        ],
        requestId=f"pytest-graph-cutover-{key}",
        revision=0,
    )


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


def test_bootstrap_filters_deprecated_graph_storage_when_cutover_is_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "GRAPH_FILES_API_CUTOVER_ENABLED", True, raising=False)
    storage = {
        GRAPH_INDEX_KEY: "[]",
        GRAPH_CURRENT_KEY: '{"alice":"graph-1"}',
        GRAPH_CONTENT_KEY: '{"graphData":{"nodes":[],"links":[]}}',
        "kg_file_manager_layout_v1": "grid",
    }

    selected = service._filter_bootstrap_storage(
        storage,
        owner="alice",
        role="student",
        page="index.html",
    )

    assert selected == {"kg_file_manager_layout_v1": "grid"}


@pytest.mark.parametrize(
    "key",
    [GRAPH_INDEX_KEY, GRAPH_CURRENT_KEY, GRAPH_CONTENT_KEY],
)
def test_graph_cutover_rejects_runtime_graph_writes_before_database_access(
    monkeypatch: pytest.MonkeyPatch,
    key: str,
) -> None:
    monkeypatch.setattr(settings, "GRAPH_FILES_API_CUTOVER_ENABLED", True, raising=False)

    with pytest.raises(
        service.RuntimeStatePermissionError,
        match="图谱文件已迁移，请使用文件接口",
    ):
        asyncio.run(service.apply_update(None, "alice", "student", graph_update(key)))


def test_graph_runtime_keys_remain_available_when_cutover_is_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "GRAPH_FILES_API_CUTOVER_ENABLED", False, raising=False)

    assert service.deprecated_graph_key(GRAPH_INDEX_KEY)
    assert service.deprecated_graph_key(GRAPH_CONTENT_KEY)
    assert service._filter_bootstrap_storage(
        {GRAPH_INDEX_KEY: "[]"},
        owner="alice",
        role="student",
        page="index.html",
    ) == {GRAPH_INDEX_KEY: "[]"}
