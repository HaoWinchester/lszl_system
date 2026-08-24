"""将 legacy runtime-state 图谱数据迁入关系化 files 域，且不修改旧 runtime storage。"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from urllib.parse import quote, unquote

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import now_utc
from app.models.file import ACTIVE, TRASHED, CurrentFile, FileContent, FileTag, Folder, GraphFile, Tag
from app.models.runtime_state import RuntimeState
from app.services import file_service

INDEX_KEY = "kg_graph_file_index_v2"
CURRENT_KEY = "kg_graph_current_file_v2"
TAGS_KEY = "kg_graph_file_tags_v2"
FOLDERS_KEY = "kg_graph_folders_v1"
CONTENT_PREFIX = "kg_graph_file_content_v2__"


def _json(value: object, fallback: object) -> object:
    if not isinstance(value, str):
        return value if value is not None else fallback
    try:
        return json.loads(value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return fallback


def _timestamp(value: object) -> datetime:
    if isinstance(value, (int, float)) and value > 0:
        return datetime.fromtimestamp(float(value) / 1000, tz=timezone.utc)
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            pass
    return now_utc()


def _positive_revision(*values: object) -> int:
    for value in values:
        try:
            revision = int(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            continue
        if revision > 0:
            return revision
    return 1


def _source_file_id(key: str, owner: str) -> str | None:
    prefix = f"{CONTENT_PREFIX}{quote(owner, safe='')}__"
    if not key.startswith(prefix):
        return None
    file_id = unquote(key.removeprefix(prefix)).strip()
    return file_id or None


def _graph_data(value: object, name: str) -> dict:
    return value if isinstance(value, dict) else file_service.blank_graph_data(name)


def _status(value: object) -> str:
    return TRASHED if value == TRASHED else ACTIVE


def deterministic_target_id(kind: str, owner: str, source_id: str) -> str:
    prefixes = {"graph": "f_runtime_", "folder": "d_runtime_", "tag": "t_runtime_"}
    prefix = prefixes.get(kind, "x_runtime_")
    digest = hashlib.sha256(f"{kind}\0{owner}\0{source_id}".encode("utf-8")).hexdigest()
    return f"{prefix}{digest}"[:64]


def _collect_runtime_graphs(
    owner: str,
    storage: dict[str, object],
) -> tuple[dict[str, dict], dict[str, dict], list[dict[str, str]]]:
    warnings: list[dict[str, str]] = []
    indexed: dict[str, dict] = {}
    raw_index_value = storage.get(INDEX_KEY)
    raw_index = _json(raw_index_value, None)
    if raw_index_value is not None and not isinstance(raw_index, list):
        warnings.append({"code": "invalid-index-json", "key": INDEX_KEY})
        raw_index = []
    for position, item in enumerate(raw_index or []):
        if not isinstance(item, dict):
            warnings.append({
                "code": "invalid-index-entry",
                "key": INDEX_KEY,
                "position": str(position),
            })
            continue
        source_id = str(item.get("id") or "").strip()
        item_owner = str(item.get("owner") or owner)
        if not source_id or item_owner != owner:
            warnings.append({
                "code": "invalid-index-entry",
                "key": INDEX_KEY,
                "position": str(position),
            })
            continue
        if source_id in indexed:
            warnings.append({
                "code": "duplicate-index-entry",
                "sourceFileId": source_id,
            })
            continue
        indexed[source_id] = item

    contents: dict[str, dict] = {}
    for key, value in storage.items():
        source_id = _source_file_id(str(key), owner)
        if not source_id:
            continue
        parsed = _json(value, None)
        if not isinstance(parsed, dict):
            warnings.append({
                "code": "invalid-content-json",
                "key": str(key),
                "sourceFileId": source_id,
            })
            continue
        contents[source_id] = parsed

    for source_id in indexed:
        if source_id not in contents:
            warnings.append({
                "code": "missing-content",
                "sourceFileId": source_id,
            })
    return indexed, contents, warnings


def scan_runtime_graph_storage(owner: str, storage: dict[str, object]) -> dict:
    indexed, contents, warnings = _collect_runtime_graphs(owner, storage)
    return {
        "owner": owner,
        "indexed": len(indexed),
        "contents": len(contents),
        "contentOnly": len(set(contents) - set(indexed)),
        "missingContent": len(set(indexed) - set(contents)),
        "corrupt": sum(
            warning["code"].startswith("invalid-") for warning in warnings
        ),
        "warnings": warnings,
    }


async def _target_id(db: AsyncSession, model: type, source_id: str, owner: str, kind: str) -> str:
    row = await db.get(model, source_id)
    if row is None or row.owner_id == owner:
        return source_id
    base = deterministic_target_id(kind, owner, source_id)
    candidate, suffix = base, 2
    while True:
        row = await db.get(model, candidate)
        if row is None or row.owner_id == owner:
            return candidate
        candidate = f"{base[:61]}_{suffix}"[:64]
        suffix += 1


async def migrate_owner_graph_files(db: AsyncSession, owner: str) -> dict[str, int | bool | str]:
    """幂等迁移一个 owner 的图谱、目录、标签、当前文件和孤儿正文。"""
    runtime = await db.get(RuntimeState, owner)
    if runtime is None:
        return {"owner": owner, "migrated": False, "files": 0, "folders": 0, "tags": 0, "orphanContents": 0, "reason": "runtime-state-missing"}

    storage = dict(runtime.storage or {})
    indexed, contents, warnings = _collect_runtime_graphs(owner, storage)

    raw_folders = _json(storage.get(FOLDERS_KEY), [])
    folder_rows = [item for item in raw_folders if isinstance(item, dict) and str(item.get("owner") or owner) == owner] if isinstance(raw_folders, list) else []
    raw_tags = _json(storage.get(TAGS_KEY), {})
    tag_rows = raw_tags.get(owner, []) if isinstance(raw_tags, dict) else []
    tag_rows = [item for item in tag_rows if isinstance(item, dict)] if isinstance(tag_rows, list) else []
    source_ids = list(indexed) + [source_id for source_id in contents if source_id not in indexed]
    if not source_ids and not folder_rows and not tag_rows:
        return {"owner": owner, "migrated": False, "files": 0, "folders": 0, "tags": 0, "orphanContents": 0, "reason": "no-legacy-graphs", "warnings": warnings}

    folder_map: dict[str, str] = {}
    folders_created = 0
    owner_folders = {item.id: item for item in (await db.scalars(select(Folder).where(Folder.owner_id == owner))).all()}
    for position, row in enumerate(folder_rows, 1):
        source_id = str(row.get("id") or "").strip()
        if not source_id:
            continue
        target_id = source_id if source_id in owner_folders else await _target_id(db, Folder, source_id, owner, "folder")
        folder_map[source_id] = target_id
        if target_id not in owner_folders:
            folder = Folder(id=target_id, owner_id=owner, name=str(row.get("name") or "未命名文件夹")[:120], parent_id=None,
                            restore_parent_id=None,
                            order_index=int(row.get("order") or position * 1000), status=_status(row.get("status")),
                            deleted_at=_timestamp(row.get("deletedAt")) if row.get("deletedAt") else None,
                            created_at=_timestamp(row.get("createdAt")), updated_at=_timestamp(row.get("updatedAt")))
            db.add(folder)
            owner_folders[target_id] = folder
            folders_created += 1
    await db.flush()
    for row in folder_rows:
        folder_id = folder_map.get(str(row.get("id") or "").strip())
        parent_id = folder_map.get(str(row.get("parentId") or "").strip())
        if folder_id and parent_id and folder_id != parent_id:
            owner_folders[folder_id].parent_id = parent_id
        restore_parent_id = folder_map.get(str(row.get("restoreParentId") or "").strip())
        if folder_id and restore_parent_id and folder_id != restore_parent_id:
            owner_folders[folder_id].restore_parent_id = restore_parent_id

    tags_created = 0
    owner_tags = {item.id: item for item in (await db.scalars(select(Tag).where(Tag.owner_id == owner))).all()}
    tags_by_name = {item.name.casefold(): item for item in owner_tags.values()}
    tag_map: dict[str, Tag] = {}
    for row in tag_rows:
        source_id = str(row.get("id") or "").strip()
        name = str(row.get("name") or "").strip()[:40]
        if not name:
            continue
        tag = owner_tags.get(source_id) if source_id else None
        tag = tag or tags_by_name.get(name.casefold())
        if tag is None:
            target_id = await _target_id(db, Tag, source_id or f"tag-{name}", owner, "tag")
            tag = Tag(id=target_id, owner_id=owner, name=name, color=str(row.get("color") or "#64748b")[:16])
            db.add(tag)
            owner_tags[tag.id] = tag
            tags_by_name[name.casefold()] = tag
            tags_created += 1
        if source_id:
            tag_map[source_id] = tag
        tag_map[name.casefold()] = tag
    await db.flush()

    owner_files = {item.id: item for item in (await db.scalars(select(GraphFile).where(GraphFile.owner_id == owner))).all()}
    by_source = {item.source_file_id: item for item in owner_files.values() if item.source == "runtime-migration" and item.source_file_id}
    created = 0
    updated_files = 0
    repaired_contents = 0
    conflicts = 0
    orphan_contents = 0
    targets: dict[str, GraphFile] = {}
    for position, source_id in enumerate(source_ids, 1):
        index = indexed.get(source_id, {})
        content = contents.get(source_id, {})
        raw_graph = content.get("graphData") if isinstance(content, dict) else None
        title = str(index.get("name") or (raw_graph or {}).get("meta", {}).get("title") or "自动恢复图谱").strip()[:200]
        graph_data = _graph_data(raw_graph, title)
        orphan = source_id not in indexed
        if orphan:
            title = f"{title}（自动恢复）"[:200]
            orphan_contents += 1
        file = by_source.get(source_id)
        direct = owner_files.get(source_id)
        if file is None and direct is not None:
            if direct.source == "runtime-migration" and direct.source_file_id == source_id:
                file = direct
        if file is None:
            target_id = await _target_id(db, GraphFile, source_id, owner, "graph")
            occupied = await db.get(GraphFile, target_id)
            if occupied is not None and not (
                occupied.owner_id == owner
                and occupied.source == "runtime-migration"
                and occupied.source_file_id == source_id
            ):
                target_id = deterministic_target_id("graph", owner, source_id)
            learning_state = content.get("learningState") if isinstance(content, dict) else {}
            source_revision = _positive_revision(content.get("revision"), index.get("revision"))
            file = GraphFile(id=target_id, owner_id=owner, name=title, description=str(index.get("description") or "") or None,
                             folder_id=folder_map.get(str(index.get("folderId") or "").strip()),
                             restore_folder_id=folder_map.get(str(index.get("restoreFolderId") or "").strip()),
                             favorite=index.get("favorite") is True,
                             order_index=0 if orphan else int(index.get("order") or position * 1000), status=_status(index.get("status")),
                             deleted_at=_timestamp(index.get("deletedAt")) if index.get("deletedAt") else None,
                             node_count=len(graph_data.get("nodes") or []), link_count=len(graph_data.get("links") or []),
                             byte_size=file_service._byte_size(graph_data), revision=source_revision,
                             source="runtime-migration", source_file_id=source_id,
                             preview=index.get("preview") if isinstance(index.get("preview"), dict) else None,
                             structure_hash=file_service._structure_hash(graph_data),
                             created_at=_timestamp(index.get("createdAt") or content.get("savedAt")),
                             updated_at=_timestamp(index.get("updatedAt") or content.get("savedAt")),
                             last_opened_at=_timestamp(index.get("lastOpenedAt")) if index.get("lastOpenedAt") else None)
            db.add(file)
            await db.flush()
            db.add(FileContent(file_id=file.id, graph_data=graph_data, learning_state=learning_state if isinstance(learning_state, dict) else {},
                               revision=file.revision, saved_at=_timestamp(content.get("savedAt") or index.get("updatedAt"))))
            owner_files[file.id] = file
            by_source[source_id] = file
            created += 1
        else:
            source_revision = _positive_revision(content.get("revision"), index.get("revision"))
            target_content = await db.get(FileContent, file.id)
            if target_content is None:
                learning_state = content.get("learningState") if isinstance(content, dict) else {}
                repaired_revision = max(file.revision, source_revision)
                db.add(FileContent(
                    file_id=file.id,
                    graph_data=graph_data,
                    learning_state=learning_state if isinstance(learning_state, dict) else {},
                    revision=repaired_revision,
                    saved_at=_timestamp(content.get("savedAt") or index.get("updatedAt")),
                ))
                if source_revision > file.revision:
                    file.node_count = len(graph_data.get("nodes") or [])
                    file.link_count = len(graph_data.get("links") or [])
                    file.byte_size = file_service._byte_size(graph_data)
                    file.revision = source_revision
                    file.structure_hash = file_service._structure_hash(graph_data)
                    updated_files += 1
                repaired_contents += 1
            elif source_revision > file.revision:
                learning_state = content.get("learningState") if isinstance(content, dict) else {}
                file.name = title
                file.description = str(index.get("description") or "") or None
                file.folder_id = folder_map.get(str(index.get("folderId") or "").strip())
                file.restore_folder_id = folder_map.get(str(index.get("restoreFolderId") or "").strip())
                file.favorite = index.get("favorite") is True
                file.order_index = 0 if orphan else int(index.get("order") or position * 1000)
                file.status = _status(index.get("status"))
                file.deleted_at = _timestamp(index.get("deletedAt")) if index.get("deletedAt") else None
                file.node_count = len(graph_data.get("nodes") or [])
                file.link_count = len(graph_data.get("links") or [])
                file.byte_size = file_service._byte_size(graph_data)
                file.revision = source_revision
                file.preview = index.get("preview") if isinstance(index.get("preview"), dict) else None
                file.structure_hash = file_service._structure_hash(graph_data)
                file.updated_at = _timestamp(index.get("updatedAt") or content.get("savedAt"))
                target_content.graph_data = graph_data
                target_content.learning_state = learning_state if isinstance(learning_state, dict) else {}
                target_content.revision = source_revision
                target_content.saved_at = _timestamp(content.get("savedAt") or index.get("updatedAt"))
                updated_files += 1
            elif source_revision < file.revision:
                conflicts += 1
        targets[source_id] = file
        for tag_value in (index.get("tags") if isinstance(index.get("tags"), list) else [])[:1]:
            tag = tag_map.get(str(tag_value).casefold()) or tag_map.get(str(tag_value))
            if tag and await db.get(FileTag, (file.id, tag.id)) is None:
                existing_link = await db.scalar(select(FileTag).where(FileTag.file_id == file.id))
                if existing_link is None:
                    db.add(FileTag(file_id=file.id, tag_id=tag.id))

    current_map = _json(storage.get(CURRENT_KEY), {})
    current = targets.get(str(current_map.get(owner) or "")) if isinstance(current_map, dict) else None
    active = [file for file in targets.values() if file.status == ACTIVE]
    if current is None or current.status != ACTIVE:
        current = min(active, key=lambda file: (file.order_index, file.created_at, file.id)) if active else None
    current_row = await db.get(CurrentFile, owner)
    if current_row is None:
        db.add(CurrentFile(owner_id=owner, file_id=current.id if current else None))
    else:
        current_row.file_id = current.id if current else None
    await db.commit()
    return {"owner": owner, "migrated": bool(created or updated_files or repaired_contents or folders_created or tags_created), "files": len(targets), "created": created,
            "updatedFiles": updated_files, "repairedContents": repaired_contents, "conflicts": conflicts,
            "folders": len(folder_map), "foldersCreated": folders_created, "tags": len({tag.id for tag in tag_map.values()}),
            "tagsCreated": tags_created, "orphanContents": orphan_contents, "currentFileId": current.id if current else "",
            "warnings": warnings}


async def migrate_all_graph_files(db: AsyncSession) -> dict:
    owners = list((await db.scalars(select(RuntimeState.owner_id).order_by(RuntimeState.owner_id))).all())
    reports = []
    for owner in owners:
        try:
            reports.append(await migrate_owner_graph_files(db, owner))
        except Exception as exc:
            await db.rollback()
            reports.append({
                "owner": owner,
                "migrated": False,
                "files": 0,
                "error": type(exc).__name__,
                "message": str(exc),
            })
    return {"owners": len(owners), "migratedOwners": sum(bool(report.get("migrated")) for report in reports),
            "failedOwners": sum(bool(report.get("error")) for report in reports),
            "files": sum(int(report.get("files") or 0) for report in reports), "reports": reports}


async def scan_all_graph_files(db: AsyncSession) -> dict:
    owners = list((await db.scalars(select(RuntimeState.owner_id).order_by(RuntimeState.owner_id))).all())
    reports = []
    for owner in owners:
        runtime = await db.get(RuntimeState, owner)
        reports.append(scan_runtime_graph_storage(owner, dict(runtime.storage or {})))
    return {
        "owners": len(owners),
        "files": sum(report["indexed"] + report["contentOnly"] for report in reports),
        "warnings": sum(len(report["warnings"]) for report in reports),
        "reports": reports,
    }


async def verify_all_graph_files(
    db: AsyncSession,
    owners: list[str] | None = None,
) -> dict:
    failures: list[dict[str, str]] = []
    if owners is None:
        owners = list((await db.scalars(select(RuntimeState.owner_id).order_by(RuntimeState.owner_id))).all())
    for owner in owners:
        runtime = await db.get(RuntimeState, owner)
        if runtime is None:
            failures.append({"owner": owner, "sourceFileId": "", "reason": "runtime-state-missing"})
            continue
        storage = dict(runtime.storage or {})
        indexed, contents, _warnings = _collect_runtime_graphs(owner, storage)
        source_ids = list(indexed) + [source_id for source_id in contents if source_id not in indexed]
        migrated = list((await db.scalars(select(GraphFile).where(
            GraphFile.owner_id == owner,
            GraphFile.source == "runtime-migration",
        ))).all())
        by_source: dict[str, list[GraphFile]] = {}
        for item in migrated:
            if item.source_file_id:
                by_source.setdefault(item.source_file_id, []).append(item)

        targets: dict[str, GraphFile] = {}
        for source_id in source_ids:
            matches = by_source.get(source_id, [])
            if not matches:
                failures.append({"owner": owner, "sourceFileId": source_id, "reason": "missing-relational-file"})
                continue
            if len(matches) != 1:
                failures.append({"owner": owner, "sourceFileId": source_id, "reason": "duplicate-relational-file"})
                continue
            file = matches[0]
            targets[source_id] = file
            target_content = await db.get(FileContent, file.id)
            if target_content is None:
                failures.append({"owner": owner, "sourceFileId": source_id, "reason": "missing-relational-content"})
                continue
            if target_content.revision != file.revision:
                failures.append({"owner": owner, "sourceFileId": source_id, "reason": "content-revision-mismatch"})

            source_content = contents.get(source_id, {})
            source_revision = _positive_revision(
                source_content.get("revision"),
                indexed.get(source_id, {}).get("revision"),
            )
            if file.revision < source_revision:
                failures.append({"owner": owner, "sourceFileId": source_id, "reason": "stale-relational-revision"})
            if file.revision == source_revision:
                source_graph = _graph_data(
                    source_content.get("graphData"),
                    str(indexed.get(source_id, {}).get("name") or "自动恢复图谱"),
                )
                target_graph = target_content.graph_data if isinstance(target_content.graph_data, dict) else {}
                source_shape = (
                    len(source_graph.get("nodes") or []),
                    len(source_graph.get("links") or []),
                )
                target_shape = (
                    len(target_graph.get("nodes") or []),
                    len(target_graph.get("links") or []),
                )
                if source_shape != target_shape:
                    failures.append({"owner": owner, "sourceFileId": source_id, "reason": "graph-shape-mismatch"})

        current_map = _json(storage.get(CURRENT_KEY), {})
        requested_source_id = str(current_map.get(owner) or "") if isinstance(current_map, dict) else ""
        expected_current = targets.get(requested_source_id)
        active = [item for item in targets.values() if item.status == ACTIVE]
        if expected_current is None or expected_current.status != ACTIVE:
            expected_current = min(
                active,
                key=lambda item: (item.order_index, item.created_at, item.id),
            ) if active else None
        current_row = await db.get(CurrentFile, owner)
        actual_current_id = current_row.file_id if current_row else None
        expected_current_id = expected_current.id if expected_current else None
        if actual_current_id != expected_current_id:
            failures.append({"owner": owner, "sourceFileId": requested_source_id, "reason": "current-file-mismatch"})
    return {"owners": len(owners), "verified": not failures, "failures": len(failures), "details": failures}


async def drop_check_all_graph_files(db: AsyncSession) -> dict:
    verification = await verify_all_graph_files(db)
    return {
        **verification,
        "safeToDrop": verification["verified"],
        "dropPerformed": False,
    }
