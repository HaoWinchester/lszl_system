"""P4.6 第 1 轮性能门禁：练题页发布试卷改走 paper-releases 细粒度 API。

bootstrap 不再向学习页（practice/workspace/recall）整包下发
kg_exam_papers_published_v1（约 7.65MB）与发布历史键；
题库管理页（questions namespace）在第二轮切换前暂保留。
"""

from fastapi.testclient import TestClient

from app.main import app
from app.services.runtime_state_service import (
    BOOTSTRAP_NAMESPACE_EXACT_KEYS,
)

from tests.test_runtime_state import bootstrap_api, login

PUBLISHED_KEY = "kg_exam_papers_published_v1"
HISTORY_KEY = "kg_exam_paper_release_history_v1"

LEARNER_PAGES = (
    "practice-mode.html",
    "question-workspace.html",
    "knowledge-recall.html",
)


def test_learner_namespaces_do_not_ship_published_paper_keys() -> None:
    for namespace in ("practice", "workspace", "recall"):
        keys = BOOTSTRAP_NAMESPACE_EXACT_KEYS.get(namespace, frozenset())
        assert PUBLISHED_KEY not in keys, namespace
        assert HISTORY_KEY not in keys, namespace


def test_learner_bootstrap_payload_has_no_published_paper_blob() -> None:
    with TestClient(app) as client:
        login(client, "学生")
        for page in LEARNER_PAGES:
            payload = bootstrap_api(client, page)
            storage = payload.get("storage") or {}
            assert PUBLISHED_KEY not in storage, page
            assert HISTORY_KEY not in storage, page


def test_question_bank_management_page_no_longer_ships_published_keys() -> None:
    # R2-3：题库管理页也已切换，发布大键从所有 namespace 移除
    keys = BOOTSTRAP_NAMESPACE_EXACT_KEYS.get("questions", frozenset())
    assert PUBLISHED_KEY not in keys
    assert HISTORY_KEY not in keys


def test_no_namespace_ships_published_paper_keys() -> None:
    for namespace, keys in BOOTSTRAP_NAMESPACE_EXACT_KEYS.items():
        assert PUBLISHED_KEY not in keys, namespace
        assert HISTORY_KEY not in keys, namespace


def test_paper_release_catalog_is_paginated_and_limited() -> None:
    from app.services import paper_release_service

    import inspect

    signature = inspect.signature(paper_release_service.catalog)
    assert "page_size" in signature.parameters
    # /questions 响应有 1MB 上限（MAX_QUESTIONS_RESPONSE_BYTES）
    assert paper_release_service.MAX_QUESTIONS_RESPONSE_BYTES <= 1024 * 1024
