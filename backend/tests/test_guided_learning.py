import copy
import json
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app


SEED_PATH = Path(__file__).parents[1] / "app" / "seed" / "guided_course_v8_6_0.json"


def _name(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:10]}"


def _login(client: TestClient, username: str, password: str = "test1234") -> None:
    response = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text


def _student() -> TestClient:
    username = _name("guided")
    admin = TestClient(app)
    _login(admin, "admin", "admin123")
    created = admin.post(
        "/api/v1/users",
        json={"username": username, "password": "test1234", "role": "student", "subject": "PMP"},
    )
    assert created.status_code == 200, created.text
    client = TestClient(app)
    _login(client, username)
    return client


def test_public_default_course_contains_the_complete_v8_6_package() -> None:
    response = TestClient(app).get("/api/v1/guided-learning/courses/default")
    assert response.status_code == 200, response.text
    package = response.json()
    assert package["version"] == "v8.6.0"
    assert len(package["course"]["stages"]) == 3
    assert len(package["course"]["parts"]) == 9
    assert len(package["course"]["nodes"]) == 108
    assert len(package["activities"]) == 82


def test_node_completion_rejects_locked_nodes_and_keeps_one_current_node() -> None:
    client = _student()
    package = client.get("/api/v1/guided-learning/courses/default").json()
    course_id = package["course"]["id"]
    first, second, third = package["course"]["nodes"][:3]

    initial = client.get(f"/api/v1/guided-learning/courses/{course_id}/progress")
    assert initial.status_code == 200
    assert initial.json()["progress"]["nodes"][first["id"]]["status"] == "available"
    assert initial.json()["progress"]["nodes"][second["id"]]["status"] == "locked"

    locked = client.post(
        f"/api/v1/guided-learning/courses/{course_id}/nodes/{third['id']}/complete",
        json={"metrics": {"accuracy": 100}},
    )
    assert locked.status_code == 409
    completed = client.post(
        f"/api/v1/guided-learning/courses/{course_id}/nodes/{first['id']}/complete",
        json={"metrics": {"accuracy": 80}},
    )
    assert completed.status_code == 200, completed.text
    progress = completed.json()["progress"]
    assert progress["nodes"][first["id"]]["status"] == "completed"
    assert progress["nodes"][second["id"]]["status"] == "available"
    assert progress["nodes"][third["id"]]["status"] == "locked"
    assert sum(item["status"] == "available" for item in progress["nodes"].values()) == 1

    preferences = client.put(
        f"/api/v1/guided-learning/courses/{course_id}/progress",
        json={"preferences": {"languageMode": "en", "defaultMode": "learning"}},
    )
    assert preferences.status_code == 200, preferences.text
    assert preferences.json()["progress"]["preferences"]["languageMode"] == "en"
    reset = client.put(
        f"/api/v1/guided-learning/courses/{course_id}/progress",
        json={"reset": True},
    )
    assert reset.status_code == 200, reset.text
    assert reset.json()["progress"]["nodes"][first["id"]]["status"] == "available"
    assert reset.json()["progress"]["nodes"][second["id"]]["status"] == "locked"


def test_placement_failure_does_not_unlock_and_pass_completes_one_part() -> None:
    client = _student()
    package = client.get("/api/v1/guided-learning/courses/default").json()
    course = package["course"]
    course_id = course["id"]
    part = course["parts"][0]
    part_nodes = [node for node in course["nodes"] if node["partId"] == part["id"]]
    next_part_first = next(node for node in course["nodes"] if node["partId"] == course["parts"][1]["id"])
    endpoint = f"/api/v1/guided-learning/courses/{course_id}/parts/{part['id']}/placement-attempt"

    failed = client.post(endpoint, json={"correct": 8, "total": 12, "activeDurationSeconds": 91})
    assert failed.status_code == 200, failed.text
    assert failed.json()["result"]["passed"] is False
    failed_progress = failed.json()["progress"]
    assert failed_progress["nodes"][part_nodes[0]["id"]]["status"] == "available"
    assert failed_progress["nodes"][part_nodes[1]["id"]]["status"] == "locked"

    passed = client.post(endpoint, json={"correct": 10, "total": 12, "activeDurationSeconds": 104})
    assert passed.status_code == 200, passed.text
    progress = passed.json()["progress"]
    assert passed.json()["result"]["passed"] is True
    assert all(progress["nodes"][node["id"]]["status"] == "completed" for node in part_nodes)
    assert progress["nodes"][next_part_first["id"]]["status"] == "available"
    assert progress["placementTests"][part["id"]]["attemptCount"] == 2


def test_progress_requires_auth_is_owner_isolated_and_admin_preview_never_writes() -> None:
    public = TestClient(app).get("/api/v1/guided-learning/courses/default").json()
    course_id = public["course"]["id"]
    first_node_id = public["course"]["nodes"][0]["id"]
    assert TestClient(app).get(f"/api/v1/guided-learning/courses/{course_id}/progress").status_code == 401

    first = _student()
    second = _student()
    assert first.post(
        f"/api/v1/guided-learning/courses/{course_id}/nodes/{first_node_id}/complete", json={}
    ).status_code == 200
    second_progress = second.get(f"/api/v1/guided-learning/courses/{course_id}/progress").json()["progress"]
    assert second_progress["nodes"][first_node_id]["status"] == "available"

    admin = TestClient(app)
    _login(admin, "admin", "admin123")
    preview = admin.get(f"/api/v1/guided-learning/courses/{course_id}/progress", params={"preview": "true"})
    assert preview.status_code == 200
    assert preview.json()["preview"] is True
    denied = admin.post(
        f"/api/v1/guided-learning/courses/{course_id}/nodes/{first_node_id}/complete",
        params={"preview": "true"},
        json={},
    )
    assert denied.status_code == 409
    persisted = admin.get(f"/api/v1/guided-learning/courses/{course_id}/progress").json()["progress"]
    assert persisted["nodes"][first_node_id]["status"] == "available"


def test_seed_validator_rejects_duplicate_activities_and_broken_references() -> None:
    from app.services.guided_learning_service import validate_package

    package = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    duplicate = copy.deepcopy(package)
    duplicate["activities"].append(copy.deepcopy(duplicate["activities"][0]))
    assert any("重复" in error for error in validate_package(duplicate))

    broken = copy.deepcopy(package)
    broken["course"]["nodes"][0]["activityIds"].append("missing-activity")
    assert any("missing-activity" in error for error in validate_package(broken, verify_hash=False))
