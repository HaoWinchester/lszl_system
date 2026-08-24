from fastapi.testclient import TestClient

from app.main import app


def login(client: TestClient, username: str) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": "111111"},
    )
    assert response.status_code == 200, response.text


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
        login(other_client, "乔治008")
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
