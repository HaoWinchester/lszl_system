import json
import re
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.services.runtime_state_service import EXACT_KEYS, PREFIXES, key_allowed


ROOT = Path(__file__).resolve().parents[2]


def bootstrap(html: str) -> dict:
    match = re.search(r"window\.__KG_DIRECT_BOOTSTRAP__=(.*?);</script>", html)
    assert match
    return json.loads(match.group(1))


def login(client: TestClient, username: str) -> None:
    response = client.post("/api/v1/auth/login", json={"username": username, "password": "111111"})
    assert response.status_code == 200


def update_payload(*, key: str, value: str, revision: int = 0) -> dict:
    return {
        "page": "learning-path.html",
        "namespace": "guided-learning",
        "operation": "setItem",
        "key": key,
        "value": value,
        "storage": {key: value},
        "requestId": f"pytest-{key}-{revision}",
        "revision": revision,
    }


def test_runtime_state_is_saved_in_postgres_and_preloaded_after_refresh() -> None:
    with TestClient(app) as client:
        login(client, "学生")
        initial = bootstrap(client.get("/learning-path.html").text)
        response = client.put(
            "/api/v1/runtime/state",
            json=update_payload(
                key="kg_default_entry_mode_v1",
                value="free",
                revision=initial["revision"],
            ),
        )
        assert response.status_code == 200, response.text
        refreshed = bootstrap(client.get("/learning-path.html").text)

    assert refreshed["storage"]["kg_default_entry_mode_v1"] == "free"
    assert refreshed["revision"] == response.json()["revision"]


def test_frontend_compatibility_contract_matches_backend_storage_allowlist() -> None:
    contract = json.loads(
        (ROOT / "frontend/scripts/new-legacy-contract.json").read_text(encoding="utf-8")
    )["runtimeStorage"]

    assert set(contract["exactKeys"]) == EXACT_KEYS
    assert tuple(contract["prefixes"]) == PREFIXES


def test_runtime_state_accepts_scoped_multi_question_preferences() -> None:
    for base_key in (
        "kg_multi_question_analysis_sections_v1",
        "kg_multi_question_font_scale_v1",
        "kg_multi_question_highlight_color_v1",
        "kg_multi_question_paper_selection_v1",
    ):
        assert key_allowed(f"{base_key}__%E4%BD%A9%E5%A5%87007")
    assert key_allowed(
        "通用知识点关系图谱工具_多科目重点聚焦版_v2__user__%E4%BD%A9%E5%A5%87007"
    )


def test_runtime_state_rejects_unknown_storage_keys() -> None:
    with TestClient(app) as client:
        login(client, "学生")
        response = client.put(
            "/api/v1/runtime/state",
            json=update_payload(key="unexpected_business_blob", value='{"secret":true}'),
        )

    assert response.status_code == 422
    assert "未登记" in response.json()["detail"]


def test_runtime_state_rejects_page_namespace_mismatch() -> None:
    with TestClient(app) as client:
        login(client, "佩奇007")
        payload = update_payload(key="kg_default_entry_mode_v1", value="learning")
        payload["page"] = "system-settings.html"
        response = client.put("/api/v1/runtime/state", json=payload)

    assert response.status_code == 422
    assert "页面与数据域不匹配" in response.json()["detail"]


def test_runtime_state_rejects_a_stale_revision_without_overwriting() -> None:
    with TestClient(app) as client:
        login(client, "学生")
        current = bootstrap(client.get("/learning-path.html").text)
        first = client.put(
            "/api/v1/runtime/state",
            json=update_payload(
                key="kg_question_language_mode_v1",
                value="zh",
                revision=current["revision"],
            ),
        )
        assert first.status_code == 200
        stale = client.put(
            "/api/v1/runtime/state",
            json={**update_payload(
                key="kg_question_language_mode_v1",
                value="en",
                revision=current["revision"],
            ), "requestId": "pytest-stale-language-revision"},
        )

    assert stale.status_code == 409
    assert "数据已更新" in stale.json()["detail"]


def test_runtime_state_persists_all_coalesced_snapshot_changes() -> None:
    with TestClient(app) as client:
        login(client, "佩奇007")
        current = bootstrap(client.get("/question-training.html").text)
        storage = {
            **current["storage"],
            "pmp_question_font_size_v1": "compact",
            "pmp_question_font_size_v2": "large",
        }
        payload = {
            "page": "question-training.html",
            "namespace": "training",
            "operation": "setItem",
            "key": "pmp_question_font_size_v2",
            "value": "large",
            "storage": storage,
            "snapshotMode": "full",
            "requestId": "pytest-coalesced-font-state",
            "revision": current["revision"],
        }
        response = client.put("/api/v1/runtime/state", json=payload)
        assert response.status_code == 200, response.text
        persisted = client.get("/api/v1/runtime/state").json()["storage"]

    assert persisted["pmp_question_font_size_v1"] == "compact"
    assert persisted["pmp_question_font_size_v2"] == "large"


def test_runtime_state_is_isolated_between_accounts() -> None:
    with TestClient(app) as student, TestClient(app) as teacher:
        login(student, "学生")
        state = bootstrap(student.get("/learning-path.html").text)
        assert student.put(
            "/api/v1/runtime/state",
            json=update_payload(
                key="kg_question_language_mode_v1",
                value="bilingual",
                revision=state["revision"],
            ),
        ).status_code == 200

        login(teacher, "老师")
        teacher_state = bootstrap(teacher.get("/learning-path.html").text)

    assert teacher_state["storage"].get("kg_question_language_mode_v1") != "bilingual"


def test_every_upstream_page_declares_the_expected_namespace() -> None:
    expected = {
        "index.html": "files",
        "learning-path.html": "guided-learning",
        "guided-learning-node.html": "guided-learning",
        "guided-learning-placement-test.html": "guided-learning",
        "question-training.html": "training",
        "question-workspace.html": "workspace",
        "question-bank.html": "questions",
        "knowledge-recall.html": "recall",
        "file-manager.html": "files",
        "user-management.html": "users",
        "system-settings.html": "system",
    }
    with TestClient(app) as client:
        login(client, "佩奇007")
        for page, namespace in expected.items():
            payload = bootstrap(client.get(f"/{page}").text)
            assert payload["namespace"] == namespace


def test_admin_page_preloads_live_backend_accounts() -> None:
    with TestClient(app) as client:
        login(client, "佩奇007")
        payload = bootstrap(client.get("/user-management.html").text)

    users = json.loads(payload["storage"]["kg_local_users_v1"])
    assert users["佩奇007"]["role"] == "admin"
    assert users["老师"]["role"] == "teacher"
    assert users["学生"]["role"] == "student"
    assert users["乔治008"]["role"] == "viewer"


def test_graph_page_imports_existing_backend_files_once() -> None:
    with TestClient(app) as client:
        login(client, "老师")
        created = client.post(
            "/api/v1/files",
            json={
                "name": "直接运行迁移图谱",
                "graphData": {
                    "meta": {"title": "直接运行迁移图谱"},
                    "nodes": [{"id": "runtime-node"}],
                    "links": [],
                },
            },
        )
        assert created.status_code == 200
        payload = bootstrap(client.get("/index.html?mode=free").text)

    index = json.loads(payload["storage"]["kg_graph_file_index_v2"])
    imported = next(item for item in index if item["name"] == "直接运行迁移图谱")
    content_key = imported["contentKey"]
    content = json.loads(payload["storage"][content_key])
    assert content["graphData"]["nodes"][0]["id"] == "runtime-node"


def test_guided_page_imports_server_progress_and_course_metadata() -> None:
    with TestClient(app) as client:
        login(client, "学生")
        payload = bootstrap(client.get("/learning-path.html").text)

    progress_keys = [key for key in payload["storage"] if key.startswith("kg_guided_learning_progress_v2__")]
    assert len(progress_keys) == 1
    progress = json.loads(payload["storage"][progress_keys[0]])
    assert progress["userId"] == "学生"
    assert progress["courseId"]
