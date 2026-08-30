import asyncio
import json
from uuid import uuid4

import pytest
from sqlalchemy import delete, select

from app.db.session import AsyncSessionLocal
from app.models.file import CurrentFile, FileContent, FileTag, Folder, GraphFile, Tag
from app.models.runtime_state import RuntimeState
from app.models.user import User
from app.services import file_service
from app.services.files_runtime_migration_service import migrate_owner_graph_files
from app.services.files_runtime_migration_service import (
    deterministic_target_id,
    scan_runtime_graph_storage,
    verify_all_graph_files,
)


def test_duplicate_folder_ids_and_casefold_tag_aliases_are_blockers() -> None:
    suffix = uuid4().hex[:10]
    owner = f"graph-migration-bijection-{suffix}"
    folder_id = f"folder-bijection-{suffix}"
    storage = {
        "kg_graph_folders_v1": [
            {"id": folder_id, "owner": owner, "name": "First"},
            {"id": folder_id, "owner": owner, "name": "Second"},
        ],
        "kg_graph_file_tags_v2": {
            owner: [
                {"id": f"tag-a-{suffix}", "name": "Focus"},
                {"id": f"tag-b-{suffix}", "name": "focus"},
            ]
        },
    }
    scan = scan_runtime_graph_storage(owner, storage)
    assert {warning["code"] for warning in scan["warnings"]} >= {
        "duplicate-folder-id",
        "tag-name-alias-collision",
    }

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            db.add(
                User(
                    username=owner,
                    password_hash="test-only",
                    role="teacher",
                    status="active",
                )
            )
            await db.flush()
            db.add(RuntimeState(owner_id=owner, storage=storage, revision=1))
            await db.commit()
            try:
                with pytest.raises(ValueError, match="one-to-one"):
                    await migrate_owner_graph_files(db, owner)
                assert await db.scalar(
                    select(Folder).where(Folder.owner_id == owner)
                ) is None
                assert await db.scalar(select(Tag).where(Tag.owner_id == owner)) is None
            finally:
                await db.rollback()
                await db.execute(delete(RuntimeState).where(RuntimeState.owner_id == owner))
                await db.execute(delete(User).where(User.username == owner))
                await db.commit()

    asyncio.run(scenario())


def test_migrate_owner_graph_files_recovers_orphan_content_and_uses_smallest_order_as_current() -> None:
    suffix = uuid4().hex[:10]
    owner = f"graph-migration-{suffix}"
    indexed_id = f"graph-indexed-{suffix}"
    orphan_id = f"graph-orphan-{suffix}"
    index_key = "kg_graph_file_index_v2"
    current_key = "kg_graph_current_file_v2"
    indexed_content_key = f"kg_graph_file_content_v2__{owner}__{indexed_id}"
    orphan_content_key = f"kg_graph_file_content_v2__{owner}__{orphan_id}"

    graph = lambda title, nodes: {
        "meta": {"title": title},
        "nodes": [{"id": f"n-{index}"} for index in range(nodes)],
        "links": [],
    }
    storage = {
        index_key: json.dumps([
            {
                "schemaVersion": 2,
                "id": indexed_id,
                "owner": owner,
                "name": "有索引图谱",
                "order": 3000,
                "status": "active",
                "createdAt": 1_700_000_000_000,
                "updatedAt": 1_700_000_100_000,
                "revision": 5,
            },
        ]),
        current_key: json.dumps({owner: "missing-file"}),
        indexed_content_key: json.dumps({
            "schemaVersion": 2,
            "graphData": graph("有索引图谱", 2),
            "learningState": {"flashcards": {}},
            "revision": 5,
            "savedAt": 1_700_000_100_000,
        }),
        orphan_content_key: json.dumps({
            "schemaVersion": 2,
            "graphData": graph("幸存的 51 节点图谱", 51),
            "learningState": {"deepRecall": {}},
            "revision": 584,
            "savedAt": 1_700_000_200_000,
        }),
    }

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            db.add(User(username=owner, password_hash="test-only", role="student", status="active"))
            await db.flush()
            db.add(RuntimeState(owner_id=owner, schema_version=1, storage=storage, revision=1))
            await db.commit()
            try:
                report = await migrate_owner_graph_files(db, owner)

                assert report["migrated"] is True
                assert report["files"] == 2
                assert report["orphanContents"] == 1
                files = list((await db.scalars(
                    select(GraphFile).where(GraphFile.owner_id == owner).order_by(GraphFile.order_index)
                )).all())
                assert [file.id for file in files] == [orphan_id, indexed_id]
                assert [file.node_count for file in files] == [51, 2]
                orphan_content = await db.get(FileContent, orphan_id)
                assert orphan_content is not None
                assert len(orphan_content.graph_data["nodes"]) == 51
                current = await db.get(CurrentFile, owner)
                assert current is not None
                assert current.file_id == orphan_id
                fallback_proof = await verify_all_graph_files(db, owners=[owner])
                assert fallback_proof["verified"] is True
                assert fallback_proof["sourceHash"] == fallback_proof["targetHash"]
                source = await db.get(RuntimeState, owner)
                assert source.storage == storage
            finally:
                await db.execute(delete(CurrentFile).where(CurrentFile.owner_id == owner))
                await db.execute(delete(FileContent).where(FileContent.file_id.in_([indexed_id, orphan_id])))
                await db.execute(delete(GraphFile).where(GraphFile.owner_id == owner))
                await db.execute(delete(RuntimeState).where(RuntimeState.owner_id == owner))
                await db.execute(delete(User).where(User.username == owner))
                await db.commit()

    asyncio.run(scenario())


def test_migration_preserves_folder_tag_current_and_is_idempotent() -> None:
    suffix = uuid4().hex[:10]
    owner = f"graph-migration-rel-{suffix}"
    folder_id = f"folder-{suffix}"
    file_id = f"file-{suffix}"
    tag_id = f"tag-{suffix}"
    second_tag_id = f"tag-second-{suffix}"
    storage = {
        "kg_graph_file_index_v2": json.dumps([{
            "id": file_id, "owner": owner, "name": "带关系图谱", "folderId": folder_id,
            "tags": ["重点", "次要"], "status": "active", "order": 1000,
        }]),
        f"kg_graph_file_content_v2__{owner}__{file_id}": json.dumps({
            "graphData": {"meta": {"title": "带关系图谱"}, "nodes": [], "links": []}
        }),
        "kg_graph_folders_v1": json.dumps([{
            "id": folder_id, "owner": owner, "name": "章节一", "status": "active", "order": 1000,
        }]),
        "kg_graph_file_tags_v2": json.dumps({owner: [
            {"id": tag_id, "name": "重点", "color": "#ff0000"},
            {"id": second_tag_id, "name": "次要", "color": "#00ff00"},
        ]}),
        "kg_graph_current_file_v2": json.dumps({owner: file_id}),
    }

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            db.add(User(username=owner, password_hash="test-only", role="student", status="active"))
            await db.flush()
            db.add(RuntimeState(owner_id=owner, schema_version=1, storage=storage, revision=1))
            await db.commit()
            try:
                report = await migrate_owner_graph_files(db, owner)
                assert report["files"] == 1
                assert report["folders"] == 1
                assert report["tags"] == 2
                assert (await db.get(CurrentFile, owner)).file_id == file_id
                assert (await db.get(GraphFile, file_id)).folder_id == folder_id
                assert (await db.get(FileTag, (file_id, tag_id))) is not None
                assert (await db.get(FileTag, (file_id, second_tag_id))) is not None
                assert (await db.get(Tag, tag_id)).name == "重点"
                assert (await verify_all_graph_files(db, owners=[owner]))["verified"] is True
                await db.execute(
                    delete(FileTag).where(
                        FileTag.file_id == file_id,
                        FileTag.tag_id == second_tag_id,
                    )
                )
                await db.commit()
                tampered = await verify_all_graph_files(db, owners=[owner])
                assert tampered["verified"] is False
                assert tampered["sourceHash"] != tampered["targetHash"]
                second = await migrate_owner_graph_files(db, owner)
                assert second["created"] == 0
                assert second["foldersCreated"] == 0
                assert second["tagsCreated"] == 0
            finally:
                await db.execute(delete(FileTag).where(FileTag.file_id == file_id))
                await db.execute(delete(CurrentFile).where(CurrentFile.owner_id == owner))
                await db.execute(delete(FileContent).where(FileContent.file_id == file_id))
                await db.execute(delete(GraphFile).where(GraphFile.owner_id == owner))
                await db.execute(delete(Folder).where(Folder.owner_id == owner))
                await db.execute(delete(Tag).where(Tag.owner_id == owner))
                await db.execute(delete(RuntimeState).where(RuntimeState.owner_id == owner))
                await db.execute(delete(User).where(User.username == owner))
                await db.commit()

    asyncio.run(scenario())


def test_file_service_rejects_foreign_or_inactive_references() -> None:
    suffix = uuid4().hex[:10]
    owner = f"graph-owner-{suffix}"
    other = f"graph-other-{suffix}"

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            db.add_all([
                User(username=owner, password_hash="test-only", role="student", status="active"),
                User(username=other, password_hash="test-only", role="student", status="active"),
            ])
            await db.flush()
            own_file = await file_service.create_file(db, owner, name="own")
            foreign_folder = await file_service.create_folder(db, other, "foreign")
            foreign_tag = await file_service.create_tag(db, other, "foreign")
            inactive_folder = await file_service.create_folder(db, owner, "inactive")
            await file_service.delete_folder(db, owner, inactive_folder.id)
            try:
                assert await file_service.move_file(db, owner, own_file.id, foreign_folder.id) is None
                assert await file_service.move_file(db, owner, own_file.id, inactive_folder.id) is None
                assert await file_service.set_file_tag(db, owner, own_file.id, foreign_tag.id) is False
                assert await file_service.set_current(db, owner, foreign_folder.id) is False
                assert await file_service.set_current(db, owner, own_file.id) is True
                assert (await db.get(CurrentFile, owner)).file_id == own_file.id
            finally:
                await db.execute(delete(CurrentFile).where(CurrentFile.owner_id.in_([owner, other])))
                await db.execute(delete(FileTag).where(FileTag.file_id == own_file.id))
                await db.execute(delete(FileContent).where(FileContent.file_id == own_file.id))
                await db.execute(delete(GraphFile).where(GraphFile.owner_id.in_([owner, other])))
                await db.execute(delete(Folder).where(Folder.owner_id.in_([owner, other])))
                await db.execute(delete(Tag).where(Tag.owner_id.in_([owner, other])))
                await db.execute(delete(User).where(User.username.in_([owner, other])))
                await db.commit()

    asyncio.run(scenario())


def test_scan_reports_corrupt_index_missing_content_and_content_only_records() -> None:
    owner = "scan-user"
    missing_id = "missing-content"
    orphan_id = "content-only"
    corrupt = scan_runtime_graph_storage(
        owner,
        {
            "kg_graph_file_index_v2": json.dumps([
                {"id": missing_id, "owner": owner, "name": "只有索引"},
                "not-an-object",
            ]),
            f"kg_graph_file_content_v2__{owner}__{orphan_id}": json.dumps({
                "graphData": {"meta": {"title": "孤儿正文"}, "nodes": [], "links": []},
                "revision": 9,
            }),
            f"kg_graph_file_content_v2__{owner}__broken": "{invalid-json",
        },
    )

    assert corrupt["indexed"] == 1
    assert corrupt["contentOnly"] == 1
    assert corrupt["missingContent"] == 1
    assert corrupt["corrupt"] == 2
    assert {item["code"] for item in corrupt["warnings"]} == {
        "invalid-index-entry",
        "invalid-content-json",
        "missing-content",
    }


def test_deterministic_target_id_is_owner_scoped_and_stable() -> None:
    first = deterministic_target_id("graph", "owner-a", "same-source")

    assert first == deterministic_target_id("graph", "owner-a", "same-source")
    assert first != deterministic_target_id("graph", "owner-b", "same-source")
    assert first.startswith("f_runtime_")
    assert len(first) <= 64


def test_migration_repairs_missing_content_and_never_overwrites_newer_relational_revision() -> None:
    suffix = uuid4().hex[:10]
    owner = f"graph-repair-{suffix}"
    file_id = f"repair-file-{suffix}"
    content_key = f"kg_graph_file_content_v2__{owner}__{file_id}"

    def source_storage(revision: int, marker: str) -> dict[str, str]:
        return {
            "kg_graph_file_index_v2": json.dumps([{
                "id": file_id,
                "owner": owner,
                "name": "可修复图谱",
                "status": "active",
                "revision": revision,
            }]),
            content_key: json.dumps({
                "graphData": {
                    "meta": {"title": "可修复图谱", "marker": marker},
                    "nodes": [{"id": marker}],
                    "links": [],
                },
                "revision": revision,
            }),
        }

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            db.add(User(username=owner, password_hash="test-only", role="student", status="active"))
            await db.flush()
            db.add(RuntimeState(owner_id=owner, schema_version=1, storage=source_storage(5, "source-v5"), revision=1))
            await db.commit()
            try:
                await migrate_owner_graph_files(db, owner)
                await db.execute(delete(FileContent).where(FileContent.file_id == file_id))
                await db.commit()

                repaired = await migrate_owner_graph_files(db, owner)
                restored = await db.get(FileContent, file_id)
                assert repaired["repairedContents"] == 1
                assert restored is not None
                assert restored.graph_data["meta"]["marker"] == "source-v5"

                runtime = await db.get(RuntimeState, owner)
                runtime.storage = source_storage(7, "source-v7")
                await db.commit()
                upgraded = await migrate_owner_graph_files(db, owner)
                await db.refresh(restored)
                graph_file = await db.get(GraphFile, file_id)
                assert upgraded["updatedFiles"] == 1
                assert graph_file.revision == 7
                assert restored.revision == 7
                assert restored.graph_data["meta"]["marker"] == "source-v7"

                graph_file.revision = 9
                restored.revision = 9
                restored.graph_data = {
                    "meta": {"title": "关系化新版本", "marker": "relational-v9"},
                    "nodes": [{"id": "relational-v9"}],
                    "links": [],
                }
                runtime.storage = source_storage(8, "stale-source-v8")
                await db.commit()

                preserved = await migrate_owner_graph_files(db, owner)
                await db.refresh(restored)
                assert preserved["conflicts"] == 1
                assert restored.revision == 9
                assert restored.graph_data["meta"]["marker"] == "relational-v9"
            finally:
                await db.execute(delete(CurrentFile).where(CurrentFile.owner_id == owner))
                await db.execute(delete(FileTag).where(FileTag.file_id == file_id))
                await db.execute(delete(FileContent).where(FileContent.file_id == file_id))
                await db.execute(delete(GraphFile).where(GraphFile.owner_id == owner))
                await db.execute(delete(RuntimeState).where(RuntimeState.owner_id == owner))
                await db.execute(delete(User).where(User.username == owner))
                await db.commit()

    asyncio.run(scenario())


def test_deep_verify_detects_content_revision_and_graph_shape_mismatch() -> None:
    suffix = uuid4().hex[:10]
    owner = f"graph-verify-{suffix}"
    file_id = f"verify-file-{suffix}"
    storage = {
        "kg_graph_file_index_v2": json.dumps([{
            "id": file_id,
            "owner": owner,
            "name": "待验证图谱",
            "status": "active",
            "revision": 4,
        }]),
        f"kg_graph_file_content_v2__{owner}__{file_id}": json.dumps({
            "graphData": {
                "meta": {"title": "待验证图谱"},
                "nodes": [{"id": "source-node"}],
                "links": [],
            },
            "revision": 4,
        }),
    }

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            db.add(User(username=owner, password_hash="test-only", role="student", status="active"))
            await db.flush()
            db.add(RuntimeState(owner_id=owner, schema_version=1, storage=storage, revision=1))
            await db.commit()
            try:
                await migrate_owner_graph_files(db, owner)
                content = await db.get(FileContent, file_id)
                content.revision = 3
                content.graph_data = {"meta": {}, "nodes": [], "links": []}
                await db.commit()

                report = await verify_all_graph_files(db, owners=[owner])

                assert report["verified"] is False
                reasons = {item["reason"] for item in report["details"]}
                assert "content-revision-mismatch" in reasons
                assert "graph-shape-mismatch" in reasons
            finally:
                await db.execute(delete(CurrentFile).where(CurrentFile.owner_id == owner))
                await db.execute(delete(FileContent).where(FileContent.file_id == file_id))
                await db.execute(delete(GraphFile).where(GraphFile.owner_id == owner))
                await db.execute(delete(RuntimeState).where(RuntimeState.owner_id == owner))
                await db.execute(delete(User).where(User.username == owner))
                await db.commit()

    asyncio.run(scenario())
