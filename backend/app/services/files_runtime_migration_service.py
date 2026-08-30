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


def _relation_source_warnings(
    owner: str, storage: dict[str, object]
) -> list[dict[str, str]]:
    """Reject source relations that cannot map one-to-one into relational IDs."""

    warnings: list[dict[str, str]] = []
    raw_folders = _json(storage.get(FOLDERS_KEY), [])
    folder_ids: set[str] = set()
    for row in raw_folders if isinstance(raw_folders, list) else []:
        if not isinstance(row, dict) or str(row.get("owner") or owner) != owner:
            continue
        source_id = str(row.get("id") or "").strip()
        if not source_id:
            continue
        if source_id in folder_ids:
            warnings.append({"code": "duplicate-folder-id", "sourceId": source_id})
        folder_ids.add(source_id)

    raw_tags = _json(storage.get(TAGS_KEY), {})
    tag_rows = raw_tags.get(owner, []) if isinstance(raw_tags, dict) else []
    tag_ids: set[str] = set()
    names: dict[str, str] = {}
    for row in tag_rows if isinstance(tag_rows, list) else []:
        if not isinstance(row, dict):
            continue
        source_id = str(row.get("id") or "").strip()
        name = str(row.get("name") or "").strip()
        if source_id:
            if source_id in tag_ids:
                warnings.append({"code": "duplicate-tag-id", "sourceId": source_id})
            tag_ids.add(source_id)
        # Tag persistence uses the database's 40-character name contract.
        # Detect aliases against that exact normalized value before any write.
        folded = name[:40].casefold()
        prior = names.get(folded)
        if folded and prior is not None and prior != source_id:
            warnings.append(
                {
                    "code": "tag-name-alias-collision",
                    "sourceId": source_id,
                }
            )
        elif folded:
            names[folded] = source_id
    return warnings


def scan_runtime_graph_storage(owner: str, storage: dict[str, object]) -> dict:
    indexed, contents, warnings = _collect_runtime_graphs(owner, storage)
    warnings.extend(_relation_source_warnings(owner, storage))
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
    relation_warnings = _relation_source_warnings(owner, storage)
    warnings.extend(relation_warnings)
    if relation_warnings:
        raise ValueError("legacy folder/tag relations are not one-to-one")

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
        seen_tag_ids: set[str] = set()
        for tag_value in (index.get("tags") if isinstance(index.get("tags"), list) else []):
            tag = tag_map.get(str(tag_value).casefold()) or tag_map.get(str(tag_value))
            if tag and tag.id not in seen_tag_ids:
                seen_tag_ids.add(tag.id)
                if await db.get(FileTag, (file.id, tag.id)) is None:
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


def _canonical_hash(value: object) -> str:
    rendered = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(rendered).hexdigest()


async def _graph_verification_proof(
    db: AsyncSession, owners: list[str]
) -> tuple[
    str,
    str,
    str,
    list[dict[str, str]],
    dict[str, dict[str, object]],
]:
    """Build payload-free aggregate proof over files, folders, tags and current."""

    source_entities: list[dict[str, str]] = []
    target_entities: list[dict[str, str]] = []
    failures: list[dict[str, str]] = []
    item_proofs: dict[str, dict[str, object]] = {}
    for owner in owners:
        runtime = await db.get(RuntimeState, owner)
        if runtime is None:
            failures.append({"owner": owner, "sourceFileId": "", "reason": "runtime-state-missing"})
            continue
        storage = dict(runtime.storage or {})
        indexed, contents, _warnings = _collect_runtime_graphs(owner, storage)
        source_ids = list(indexed) + [key for key in contents if key not in indexed]
        migrated = list((await db.scalars(select(GraphFile).where(
            GraphFile.owner_id == owner,
            GraphFile.source == "runtime-migration",
        ))).all())
        by_source = {row.source_file_id: row for row in migrated if row.source_file_id}

        raw_folders = _json(storage.get(FOLDERS_KEY), [])
        folder_sources = [
            row for row in raw_folders
            if isinstance(row, dict) and str(row.get("owner") or owner) == owner
        ] if isinstance(raw_folders, list) else []
        folder_targets = list((await db.scalars(select(Folder).where(Folder.owner_id == owner))).all())
        used_folder_targets: set[str] = set()
        folder_source_by_target: dict[str, str] = {}
        for position, source in enumerate(folder_sources, 1):
            source_id = str(source.get("id") or "").strip()
            if not source_id:
                continue
            target = next((row for row in folder_targets if row.id == source_id), None)
            if target is None:
                deterministic = deterministic_target_id("folder", owner, source_id)
                candidates = sorted(
                    (
                        row for row in folder_targets
                        if row.id == deterministic
                        or row.id.startswith(f"{deterministic[:61]}_")
                    ),
                    key=lambda row: row.id,
                )
                target = next(
                    (row for row in candidates if row.id not in used_folder_targets),
                    None,
                )
            expected = {
                "name": str(source.get("name") or "未命名文件夹")[:120],
                "parentId": str(source.get("parentId") or ""),
                "restoreParentId": str(source.get("restoreParentId") or ""),
                "order": int(source.get("order") or position * 1000),
                "status": _status(source.get("status")),
            }
            actual = None
            if target is not None:
                used_folder_targets.add(target.id)
                folder_source_by_target[target.id] = source_id
                actual = {
                    "name": target.name,
                    "parentId": "",  # resolved after the complete source->target map exists
                    "restoreParentId": "",
                    "order": target.order_index,
                    "status": target.status,
                }
            source_entities.append({"owner": owner, "kind": "folder", "id": source_id, "hash": _canonical_hash(expected)})
            target_entities.append({"owner": owner, "kind": "folder", "id": source_id, "hash": _canonical_hash(actual)})
        # Recompute folder target hashes with semantic source parent ids.
        folder_target_lookup = {row.id: row for row in folder_targets}
        for index, proof in enumerate(target_entities):
            if proof["owner"] != owner or proof["kind"] != "folder":
                continue
            target_id = next((key for key, value in folder_source_by_target.items() if value == proof["id"]), "")
            target = folder_target_lookup.get(target_id)
            if target is not None:
                actual = {
                    "name": target.name,
                    "parentId": folder_source_by_target.get(target.parent_id or "", ""),
                    "restoreParentId": folder_source_by_target.get(target.restore_parent_id or "", ""),
                    "order": target.order_index,
                    "status": target.status,
                }
                target_entities[index] = {**proof, "hash": _canonical_hash(actual)}

        raw_tags = _json(storage.get(TAGS_KEY), {})
        tag_sources = raw_tags.get(owner, []) if isinstance(raw_tags, dict) else []
        tag_sources = [row for row in tag_sources if isinstance(row, dict)] if isinstance(tag_sources, list) else []
        tag_targets = list((await db.scalars(select(Tag).where(Tag.owner_id == owner))).all())
        tag_source_by_target: dict[str, str] = {}
        tag_source_aliases: dict[str, str] = {}
        for source in tag_sources:
            source_id = str(source.get("id") or source.get("name") or "").strip()
            name = str(source.get("name") or "").strip()[:40]
            if not source_id or not name:
                continue
            target = next((row for row in tag_targets if row.id == str(source.get("id") or "")), None)
            target = target or next((row for row in tag_targets if row.name.casefold() == name.casefold()), None)
            expected = {"name": name, "color": str(source.get("color") or "#64748b")[:16]}
            actual = {"name": target.name, "color": target.color} if target else None
            if target is not None:
                tag_source_by_target[target.id] = source_id
            tag_source_aliases[source_id.casefold()] = source_id
            tag_source_aliases[name.casefold()] = source_id
            source_entities.append({"owner": owner, "kind": "tag", "id": source_id, "hash": _canonical_hash(expected)})
            target_entities.append({"owner": owner, "kind": "tag", "id": source_id, "hash": _canonical_hash(actual)})

        for position, source_id in enumerate(source_ids, 1):
            index_row = indexed.get(source_id, {})
            content = contents.get(source_id, {})
            raw_graph = content.get("graphData") if isinstance(content, dict) else None
            title = str(index_row.get("name") or (raw_graph or {}).get("meta", {}).get("title") or "自动恢复图谱").strip()[:200]
            orphan = source_id not in indexed
            if orphan:
                title = f"{title}（自动恢复）"[:200]
            graph_data = _graph_data(raw_graph, title)
            source_revision = _positive_revision(content.get("revision"), index_row.get("revision"))
            expected_content = {
                "revision": source_revision,
                "graphHash": _canonical_hash(graph_data),
                "learningHash": _canonical_hash(content.get("learningState") if isinstance(content.get("learningState"), dict) else {}),
            }
            expected_index = {
                "name": title,
                "folderId": str(index_row.get("folderId") or ""),
                "restoreFolderId": str(index_row.get("restoreFolderId") or ""),
                "favorite": index_row.get("favorite") is True,
                "order": 0 if orphan else int(index_row.get("order") or position * 1000),
                "status": _status(index_row.get("status")),
                "tags": sorted({
                    tag_source_aliases.get(str(value).casefold(), str(value))
                    for value in (
                        index_row.get("tags")
                        if isinstance(index_row.get("tags"), list)
                        else []
                    )
                }),
            }
            target = by_source.get(source_id)
            target_content = await db.get(FileContent, target.id) if target else None
            actual_index = None
            actual_content = None
            if target is not None and target_content is not None:
                links = list((await db.scalars(
                    select(FileTag).where(FileTag.file_id == target.id)
                )).all())
                actual_content = {
                    "revision": target.revision,
                    "graphHash": _canonical_hash(target_content.graph_data or {}),
                    "learningHash": _canonical_hash(target_content.learning_state or {}),
                }
                actual_index = {
                    "name": target.name,
                    "folderId": folder_source_by_target.get(target.folder_id or "", ""),
                    "restoreFolderId": folder_source_by_target.get(target.restore_folder_id or "", ""),
                    "favorite": target.favorite,
                    "order": target.order_index,
                    "status": target.status,
                    "tags": sorted({
                        tag_source_by_target.get(link.tag_id, link.tag_id)
                        for link in links
                    }),
                }
            if not orphan:
                source_entities.append({"owner": owner, "kind": "file-index", "id": source_id, "hash": _canonical_hash(expected_index)})
                target_entities.append({"owner": owner, "kind": "file-index", "id": source_id, "hash": _canonical_hash(actual_index)})
            source_entities.append({"owner": owner, "kind": "file-content", "id": source_id, "hash": _canonical_hash(expected_content)})
            target_entities.append({"owner": owner, "kind": "file-content", "id": source_id, "hash": _canonical_hash(actual_content)})

        current_map = _json(storage.get(CURRENT_KEY), {})
        requested_source_id = str(current_map.get(owner) or "") if isinstance(current_map, dict) else ""
        expected_current_file = by_source.get(requested_source_id)
        if expected_current_file is None or expected_current_file.status != ACTIVE:
            active_targets = [
                row for source_id, row in by_source.items()
                if source_id in source_ids and row.status == ACTIVE
            ]
            expected_current_file = min(
                active_targets,
                key=lambda row: (row.order_index, row.created_at, row.id),
            ) if active_targets else None
        expected_current = str(expected_current_file.source_file_id or "") if expected_current_file else ""
        current = await db.get(CurrentFile, owner)
        actual_current = ""
        if current and current.file_id:
            current_file = await db.get(GraphFile, current.file_id)
            actual_current = str(current_file.source_file_id or "") if current_file else ""
        source_entities.append({"owner": owner, "kind": "current", "id": owner, "hash": _canonical_hash(expected_current)})
        target_entities.append({"owner": owner, "kind": "current", "id": owner, "hash": _canonical_hash(actual_current)})

        owner_source = [row for row in source_entities if row["owner"] == owner]
        owner_target = [row for row in target_entities if row["owner"] == owner]

        def record_item(source_key: str, kinds: set[str], identifier: str | None = None) -> None:
            source_rows = [
                row for row in owner_source
                if row["kind"] in kinds and (identifier is None or row["id"] == identifier)
            ]
            target_rows = [
                row for row in owner_target
                if row["kind"] in kinds and (identifier is None or row["id"] == identifier)
            ]
            source_rows.sort(key=lambda row: (row["kind"], row["id"]))
            target_rows.sort(key=lambda row: (row["kind"], row["id"]))
            source_item_hash = _canonical_hash(source_rows)
            target_item_hash = _canonical_hash(target_rows)
            item_proofs[f"{owner}\0{source_key}"] = {
                "sourceCount": len(source_rows),
                "targetCount": len(target_rows),
                "sourceHash": source_item_hash,
                "targetHash": target_item_hash,
                "verificationHash": _canonical_hash(
                    {"sourceHash": source_item_hash, "targetHash": target_item_hash}
                ),
                "verified": source_item_hash == target_item_hash,
            }

        record_item(INDEX_KEY, {"file-index"})
        record_item(FOLDERS_KEY, {"folder"})
        record_item(TAGS_KEY, {"tag"})
        record_item(CURRENT_KEY, {"current"})
        for source_key in storage:
            source_id = _source_file_id(str(source_key), owner)
            if source_id:
                record_item(str(source_key), {"file-content"}, source_id)

    source_entities.sort(key=lambda row: (row["owner"], row["kind"], row["id"]))
    target_entities.sort(key=lambda row: (row["owner"], row["kind"], row["id"]))
    source_hash = _canonical_hash(source_entities)
    target_hash = _canonical_hash(target_entities)
    if source_hash != target_hash:
        failures.append({"owner": "", "sourceFileId": "", "reason": "canonical-proof-mismatch"})
    verification_hash = _canonical_hash({"sourceHash": source_hash, "targetHash": target_hash})
    return source_hash, target_hash, verification_hash, failures, item_proofs


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
    source_hash, target_hash, verification_hash, proof_failures, item_proofs = await _graph_verification_proof(db, owners)
    failures.extend(proof_failures)
    return {
        "owners": len(owners),
        "verified": not failures,
        "failures": len(failures),
        "details": failures,
        "sourceHash": source_hash,
        "targetHash": target_hash,
        "verificationHash": verification_hash,
        "itemProofs": item_proofs,
    }


async def drop_check_all_graph_files(db: AsyncSession) -> dict:
    verification = await verify_all_graph_files(db)
    return {
        **verification,
        "safeToDrop": verification["verified"],
        "dropPerformed": False,
    }
