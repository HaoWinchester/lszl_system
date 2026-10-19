from fastapi.testclient import TestClient
import pytest
from uuid import uuid4

from app.main import app


def login(client: TestClient, username: str) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": "111111"},
    )
    assert response.status_code == 200, response.text


def test_teacher_can_save_and_reopen_large_graph_without_student_card_quota() -> None:
    with TestClient(app) as client:
        login(client, "老师")
        nodes = [{"id": f"n-{i}", "title": str(i), "x": i * 10, "y": 100} for i in range(495)]
        created = client.post("/api/v1/files", json={"name": "teacher-large-graph", "graphData": {"nodes": nodes, "links": []}})
        assert created.status_code == 200, created.text
        record = created.json()["file"]
        try:
            nodes.append({"id": "n-495", "title": "新增卡牌"})
            saved = client.put(f"/api/v1/files/{record['id']}", json={"graphData": {"nodes": nodes, "links": []}, "expectedRevision": record["revision"]})
            assert saved.status_code == 200, saved.text
            reopened = client.get(f"/api/v1/files/{record['id']}")
            assert reopened.status_code == 200, reopened.text
            assert len(reopened.json()["graphData"]["nodes"]) == 496
        finally:
            client.delete(f"/api/v1/files/{record['id']}")
            client.delete(f"/api/v1/files/{record['id']}/permanent")


def test_save_uses_expected_revision_and_returns_structured_conflict() -> None:
    with TestClient(app) as client:
        login(client, "学生")
        created = client.post(
            "/api/v1/files",
            json={
                "name": "revision-contract",
                "graphData": {"meta": {"title": "v1"}, "nodes": [], "links": []},
            },
        )
        assert created.status_code == 200, created.text
        file_id = created.json()["file"]["id"]
        initial_revision = created.json()["file"]["revision"]
        try:
            saved = client.put(
                f"/api/v1/files/{file_id}",
                json={
                    "graphData": {"meta": {"title": "v2"}, "nodes": [{"id": "n2"}], "links": []},
                    "expectedRevision": initial_revision,
                },
            )
            assert saved.status_code == 200, saved.text
            assert saved.json()["file"]["revision"] == initial_revision + 1

            stale = client.put(
                f"/api/v1/files/{file_id}",
                json={
                    "graphData": {"meta": {"title": "stale"}, "nodes": [], "links": []},
                    "expectedRevision": initial_revision,
                },
            )
            assert stale.status_code == 409, stale.text
            assert stale.json()["detail"] == {
                "code": "FILE_REVISION_CONFLICT",
                "message": "图谱文件已更新，请重新加载后重试",
                "currentRevision": initial_revision + 1,
            }

            opened = client.get(f"/api/v1/files/{file_id}")
            assert opened.json()["graphData"]["meta"]["title"] == "v2"
        finally:
            client.delete(f"/api/v1/files/{file_id}")
            client.delete(f"/api/v1/files/{file_id}/permanent")


def test_files_folders_tags_and_current_are_owner_isolated() -> None:
    with TestClient(app) as owner_client, TestClient(app) as other_client:
        login(owner_client, "学生")
        login(other_client, "老师")
        folder = owner_client.post("/api/v1/files/folders", json={"name": "owner-only"}).json()["folder"]
        tag = owner_client.post("/api/v1/files/tags", json={"name": "owner-tag"}).json()["tag"]
        created = owner_client.post(
            "/api/v1/files",
            json={"name": "owner-file", "folderId": folder["id"]},
        ).json()["file"]
        try:
            assert other_client.get(f"/api/v1/files/{created['id']}").status_code == 404
            assert other_client.patch(
                f"/api/v1/files/{created['id']}", json={"name": "hijacked"}
            ).status_code == 404
            assert other_client.patch(
                f"/api/v1/files/folders/{folder['id']}", json={"name": "hijacked"}
            ).status_code == 404
            assert other_client.patch(
                f"/api/v1/files/tags/{tag['id']}", json={"name": "hijacked"}
            ).status_code == 404
            assert other_client.put(
                "/api/v1/files/current", json={"fileId": created["id"]}
            ).status_code == 404
        finally:
            owner_client.delete(f"/api/v1/files/{created['id']}")
            owner_client.delete(f"/api/v1/files/{created['id']}/permanent")
            owner_client.delete(f"/api/v1/files/folders/{folder['id']}")
            owner_client.delete(f"/api/v1/files/folders/{folder['id']}/permanent")
            owner_client.delete(f"/api/v1/files/tags/{tag['id']}")


def test_file_and_folder_lifecycle_preserves_restore_locations_and_favorites() -> None:
    with TestClient(app) as client:
        login(client, "学生")
        root = client.post("/api/v1/files/folders", json={"name": "lifecycle-root"}).json()["folder"]
        child = client.post(
            "/api/v1/files/folders",
            json={"name": "lifecycle-child", "parentId": root["id"]},
        ).json()["folder"]
        created = client.post(
            "/api/v1/files",
            json={"name": "lifecycle-file", "folderId": child["id"]},
        ).json()["file"]
        file_id = created["id"]

        favorite = client.patch(f"/api/v1/files/{file_id}", json={"favorite": True})
        assert favorite.status_code == 200, favorite.text
        assert favorite.json()["file"]["favorite"] is True

        moved_root = client.patch(
            f"/api/v1/files/folders/{child['id']}", json={"parentId": None}
        )
        assert moved_root.status_code == 200, moved_root.text
        assert moved_root.json()["folder"]["parentId"] is None
        moved_back = client.patch(
            f"/api/v1/files/folders/{child['id']}", json={"parentId": root["id"]}
        )
        assert moved_back.status_code == 200, moved_back.text

        trashed = client.delete(f"/api/v1/files/folders/{root['id']}")
        assert trashed.status_code == 200, trashed.text
        trash_files = client.get("/api/v1/files?status=trashed&page_size=200").json()["files"]
        trash_folders = client.get("/api/v1/files/folders?status=trashed").json()["folders"]
        assert next(item for item in trash_files if item["id"] == file_id)["folderId"] == child["id"]
        assert {item["id"] for item in trash_folders}.issuperset({root["id"], child["id"]})

        restored = client.post(f"/api/v1/files/folders/{root['id']}/restore")
        assert restored.status_code == 200, restored.text
        active_files = client.get("/api/v1/files?status=active&page_size=200").json()["files"]
        assert next(item for item in active_files if item["id"] == file_id)["folderId"] == child["id"]

        assert client.delete(f"/api/v1/files/{file_id}").status_code == 200
        restored_file = client.post(f"/api/v1/files/{file_id}/restore")
        assert restored_file.status_code == 200, restored_file.text
        assert restored_file.json()["file"]["folderId"] == child["id"]

        assert client.delete(f"/api/v1/files/folders/{root['id']}").status_code == 200
        blocked = client.delete(f"/api/v1/files/folders/{root['id']}/permanent")
        assert blocked.status_code == 409, blocked.text
        emptied = client.post("/api/v1/files/trash/empty")
        assert emptied.status_code == 200, emptied.text
        assert emptied.json()["deletedFiles"] >= 1
        assert emptied.json()["deletedFolders"] >= 2


def readonly_file_fixture():
    admin, client = TestClient(app), TestClient(app)
    login(admin, "佩奇007")
    username = "readonly_files_" + uuid4().hex[:10]
    created = admin.post("/api/v1/users", json={"username": username, "password": "111111", "role": "student"})
    assert created.status_code == 200, created.text
    login(client, username)
    folder = client.post("/api/v1/files/folders", json={"name": "保留目录"}).json()["folder"]
    tag = client.post("/api/v1/files/tags", json={"name": "保留标签"}).json()["tag"]
    file = client.post("/api/v1/files", json={"name": "保留原图", "graphData": {"nodes": [{"id": "kept", "title": "不可覆盖"}], "links": []}}).json()["file"]
    changed = admin.put(f"/api/v1/users/{username}", json={"role": "viewer"})
    assert changed.status_code == 200, changed.text
    return client, file, folder, tag


@pytest.mark.parametrize("kind", ["create", "save", "folder", "tag"])
def test_viewer_cannot_write_owned_file_content_or_organize(kind: str) -> None:
    client, file, folder, tag = readonly_file_fixture()
    operations = {
        "create": ("POST", "/api/v1/files", {"name": "不应新建"}),
        "save": ("PUT", f"/api/v1/files/{file['id']}", {"graphData": {"nodes": [], "links": []}, "expectedRevision": file["revision"]}),
        "folder": ("POST", "/api/v1/files/folders", {"name": "不应创建目录"}),
        "tag": ("POST", "/api/v1/files/tags", {"name": "不应创建标签"}),
    }
    method, path, body = operations[kind]
    denied = client.request(method, path, json=body)
    assert denied.status_code == 403, denied.text
    opened = client.get(f"/api/v1/files/{file['id']}")
    assert opened.status_code == 200, opened.text
    assert opened.json()["graphData"]["nodes"] == [{"id": "kept", "title": "不可覆盖"}]
    assert client.put("/api/v1/files/current", json={"fileId": file["id"]}).status_code == 200
    assert client.get("/api/v1/files/current").json()["fileId"] == file["id"]


def test_viewer_cannot_mutate_existing_files_folders_tags_or_bulk_operations() -> None:
    client, file, folder, tag = readonly_file_fixture()
    operations = [
        ("PUT", "/order", {"fileIds": [file["id"]]}),
        ("POST", "/import-legacy", {"files": []}),
        ("POST", "/trash/empty", {}),
        ("PATCH", f"/folders/{folder['id']}", {"name": "改名"}),
        ("DELETE", f"/folders/{folder['id']}", None),
        ("POST", f"/folders/{folder['id']}/restore", {}),
        ("DELETE", f"/folders/{folder['id']}/permanent", None),
        ("PATCH", f"/tags/{tag['id']}", {"name": "改名"}),
        ("DELETE", f"/tags/{tag['id']}", None),
        ("PUT", f"/{file['id']}/tag", {"tagId": tag["id"]}),
        ("PATCH", f"/{file['id']}", {"name": "改名"}),
        ("DELETE", f"/{file['id']}", None),
        ("POST", f"/{file['id']}/restore", {}),
        ("DELETE", f"/{file['id']}/permanent", None),
        ("POST", f"/{file['id']}/duplicate", {"name": "副本"}),
        ("POST", f"/{file['id']}/fragments", {"fragment": {"format": "kg-graph-fragment", "version": 1, "nodes": [], "links": [], "elements": [], "tables": [], "source": {"fileId": file["id"], "revision": file["revision"]}}}),
    ]
    for method, path, body in operations:
        response = client.request(method, "/api/v1/files" + path, json=body)
        assert response.status_code == 403, (method, path, response.text)
    assert client.get(f"/api/v1/files/{file['id']}").json()["graphData"]["nodes"][0]["id"] == "kept"
    assert client.get("/api/v1/files/folders").json()["folders"][0]["name"] == "保留目录"
    assert client.get("/api/v1/files/tags").json()["tags"][0]["name"] == "保留标签"


@pytest.mark.parametrize("username", ["佩奇007", "老师", "学生"])
def test_graph_writers_keep_owned_create_save_folder_and_tag_access(username: str) -> None:
    client = TestClient(app)
    login(client, username)
    created = client.post("/api/v1/files", json={"name": "正常创建", "graphData": {"nodes": [], "links": []}})
    assert created.status_code == 200, created.text
    file = created.json()["file"]
    saved = client.put(f"/api/v1/files/{file['id']}", json={"graphData": {"nodes": [{"id": "saved"}], "links": []}, "expectedRevision": file["revision"]})
    assert saved.status_code == 200, saved.text
    assert client.get(f"/api/v1/files/{file['id']}").json()["graphData"]["nodes"] == [{"id": "saved"}]
    assert client.post("/api/v1/files/folders", json={"name": "正常目录"}).status_code == 200
    assert client.post("/api/v1/files/tags", json={"name": "正常标签"}).status_code == 200
