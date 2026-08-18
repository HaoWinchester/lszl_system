"""教学内容关系模型 CRUD。"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.teaching_content import (
    ActivityCollection,
    ActivityOverride,
    ContentSubject,
    ContentTaxonomy,
    RecallAssociationLibrary,
    TaxonomyNode,
    TeachingContentAudit,
)
from app.services import teaching_content_revision_service


def _audit(entity_type: str, entity_id: str, action: str, actor: str, after: dict | None = None) -> TeachingContentAudit:
    return TeachingContentAudit(id=uuid4().hex, entity_type=entity_type, entity_id=entity_id, action=action, actor_username=actor, after=after or {})


async def _bump(db: AsyncSession, actor: str, entity_type: str, entity_id: str, action: str) -> dict:
    return await teaching_content_revision_service.bump(db, actor, [{"entityType": entity_type, "entityId": entity_id, "action": action}])


async def list_subjects(db: AsyncSession, *, offset: int = 0, limit: int = 50) -> dict[str, Any]:
    limit, offset = min(max(limit, 1), 200), max(offset, 0)
    rows = list((await db.execute(select(ContentSubject).order_by(ContentSubject.code).offset(offset).limit(limit))).scalars())
    total = int((await db.execute(select(func.count()).select_from(ContentSubject))).scalar_one())
    return {"items": [{"id": r.id, "code": r.code, "name": r.name, "status": r.status, "metadata": r.content_metadata or {}} for r in rows], "offset": offset, "limit": limit, "total": total}


async def upsert_subject(db: AsyncSession, *, subject_id: str, code: str, name: str, actor: str, metadata: dict | None = None) -> dict:
    await teaching_content_revision_service.acquire_lock(db)
    row = await db.get(ContentSubject, subject_id)
    values = (code, name, metadata or {})
    if row is not None and (row.code, row.name, row.content_metadata or {}) == values:
        revision = await teaching_content_revision_service.current(db)
        return {"subject": {"id": row.id, "code": row.code, "name": row.name}, "contentRevision": int(revision["revision"])}
    action = "created" if row is None else "updated"
    if row is None:
        row = ContentSubject(id=subject_id, code=code, name=name, content_metadata=metadata or {})
        db.add(row)
    else:
        row.code, row.name, row.content_metadata = values
    db.add(_audit("subject", subject_id, action, actor, {"code": code, "name": name}))
    revision = await _bump(db, actor, "subject", subject_id, action)
    await db.commit()
    return {"subject": {"id": row.id, "code": row.code, "name": row.name}, "contentRevision": int(revision["revision"])}


async def list_taxonomies(db: AsyncSession, *, subject_id: str, offset: int = 0, limit: int = 50) -> dict[str, Any]:
    limit, offset = min(max(limit, 1), 200), max(offset, 0)
    where = ContentTaxonomy.subject_id == subject_id
    rows = list((await db.execute(select(ContentTaxonomy).where(where).order_by(ContentTaxonomy.version.desc()).offset(offset).limit(limit))).scalars())
    total = int((await db.execute(select(func.count()).select_from(ContentTaxonomy).where(where))).scalar_one())
    return {"items": [{"id": r.id, "subjectId": r.subject_id, "version": r.version, "status": r.status, "title": r.title} for r in rows], "offset": offset, "limit": limit, "total": total}


async def release_taxonomy(db: AsyncSession, *, subject_id: str, taxonomy_id: str, version: int, title: str, nodes: list[dict], actor: str) -> dict:
    await teaching_content_revision_service.acquire_lock(db)
    if await db.get(ContentSubject, subject_id) is None:
        raise ValueError("subject not found")
    normalized_nodes = []
    for position, node in enumerate(nodes):
        node_id = str(node.get("id") or "").strip()
        if not node_id:
            raise ValueError("taxonomy node id is required")
        normalized_nodes.append((node_id, node, int(node.get("position", position))))
    row = await db.get(ContentTaxonomy, taxonomy_id)
    if row is not None and row.subject_id != subject_id:
        raise ValueError("taxonomy belongs to another subject")
    conflict = (await db.execute(select(ContentTaxonomy).where(ContentTaxonomy.subject_id == subject_id, ContentTaxonomy.version == version, ContentTaxonomy.id != taxonomy_id))).scalar_one_or_none()
    if conflict is not None:
        raise ValueError("taxonomy version already belongs to another taxonomy")
    current_nodes = [] if row is None else list((await db.execute(select(TaxonomyNode).where(TaxonomyNode.taxonomy_id == taxonomy_id).order_by(TaxonomyNode.position))).scalars())
    unchanged = row is not None and row.version == version and row.title == title and row.status == "published" and [n.record for n in current_nodes] == [n[1] for n in normalized_nodes]
    if unchanged:
        revision = await teaching_content_revision_service.current(db)
        return {"taxonomy": {"id": row.id, "subjectId": row.subject_id, "version": row.version, "status": row.status}, "contentRevision": int(revision["revision"])}
    if row is None:
        row = ContentTaxonomy(id=taxonomy_id, subject_id=subject_id, version=version, title=title, status="published", published_at=func.now(), created_by=actor, updated_by=actor, content_metadata={})
        db.add(row)
        await db.flush()
    else:
        row.version, row.title, row.status, row.updated_by, row.published_at = version, title, "published", actor, func.now()
    await db.execute(delete(TaxonomyNode).where(TaxonomyNode.taxonomy_id == taxonomy_id))
    for node_id, node, position in normalized_nodes:
        db.add(TaxonomyNode(id=f"{taxonomy_id}:{node_id}", taxonomy_id=taxonomy_id, node_id=node_id, parent_node_id=node.get("parentId"), title=str(node.get("title") or ""), record=node, position=position, status=str(node.get("status") or "active")))
    db.add(_audit("taxonomy", taxonomy_id, "published", actor, {"subjectId": subject_id, "version": version, "nodeCount": len(nodes)}))
    revision = await _bump(db, actor, "taxonomy", taxonomy_id, "published")
    await db.commit()
    return {"taxonomy": {"id": row.id, "subjectId": row.subject_id, "version": row.version, "status": row.status}, "contentRevision": int(revision["revision"])}


async def delete_taxonomy(db: AsyncSession, *, taxonomy_id: str, subject_id: str, actor: str) -> dict:
    await teaching_content_revision_service.acquire_lock(db)
    row = await db.get(ContentTaxonomy, taxonomy_id)
    if row is None:
        raise ValueError("taxonomy not found")
    if row.subject_id != subject_id:
        raise ValueError("taxonomy belongs to another subject")
    await db.delete(row)
    db.add(_audit("taxonomy", taxonomy_id, "deleted", actor))
    revision = await _bump(db, actor, "taxonomy", taxonomy_id, "deleted")
    await db.commit()
    return {"deletedId": taxonomy_id, "contentRevision": int(revision["revision"])}


def _recall_payload(row: RecallAssociationLibrary) -> dict:
    return {"id": row.id, "subjectId": row.subject_id, "version": row.version, "status": row.status, "nodes": row.nodes or [], "edges": row.edges or [], "metadata": row.content_metadata or {}, "updatedAt": row.updated_at.isoformat() if row.updated_at else ""}


async def list_recall_libraries(db: AsyncSession, *, subject_id: str, offset: int = 0, limit: int = 50) -> dict[str, Any]:
    limit, offset = min(max(limit, 1), 200), max(offset, 0)
    where = RecallAssociationLibrary.subject_id == subject_id
    rows = list((await db.execute(select(RecallAssociationLibrary).where(where).order_by(RecallAssociationLibrary.version.desc()).offset(offset).limit(limit))).scalars())
    total = int((await db.execute(select(func.count()).select_from(RecallAssociationLibrary).where(where))).scalar_one())
    return {"items": [_recall_payload(r) for r in rows], "offset": offset, "limit": limit, "total": total}


async def upsert_recall_library(db: AsyncSession, *, subject_id: str, version: int, nodes: list[dict], edges: list[dict], metadata: dict, actor: str) -> dict:
    await teaching_content_revision_service.acquire_lock(db)
    if await db.get(ContentSubject, subject_id) is None:
        raise ValueError("subject not found")
    row = (await db.execute(select(RecallAssociationLibrary).where(RecallAssociationLibrary.subject_id == subject_id, RecallAssociationLibrary.version == version))).scalar_one_or_none()
    if row is not None and row.nodes == nodes and row.edges == edges and (row.content_metadata or {}) == metadata:
        revision = await teaching_content_revision_service.current(db)
        return {"library": _recall_payload(row), "contentRevision": int(revision["revision"])}
    action = "created" if row is None else "updated"
    if row is None:
        row = RecallAssociationLibrary(id=f"recall-{subject_id}-{version}", subject_id=subject_id, version=version, status="published", nodes=nodes, edges=edges, content_metadata=metadata, updated_by=actor)
        db.add(row)
    else:
        row.nodes, row.edges, row.content_metadata, row.updated_by = nodes, edges, metadata, actor
    db.add(_audit("recallLibrary", row.id, action, actor, {"subjectId": subject_id, "version": version}))
    revision = await _bump(db, actor, "recallLibrary", row.id, action)
    await db.commit()
    await db.refresh(row)
    return {"library": _recall_payload(row), "contentRevision": int(revision["revision"])}


async def apply_activity_override(db: AsyncSession, *, collection_id: str, activity_id: str, record: dict, actor: str) -> dict:
    await teaching_content_revision_service.acquire_lock(db)
    if await db.get(ActivityCollection, collection_id) is None:
        raise ValueError("activity collection not found")
    row = (await db.execute(select(ActivityOverride).where(ActivityOverride.collection_id == collection_id, ActivityOverride.activity_id == activity_id))).scalar_one_or_none()
    if row is not None and row.record == record:
        revision = await teaching_content_revision_service.current(db)
        return {"override": {"id": row.id, "collectionId": row.collection_id, "activityId": row.activity_id, "record": row.record, "revision": row.revision}, "contentRevision": int(revision["revision"])}
    action = "created" if row is None else "updated"
    if row is None:
        row = ActivityOverride(id=uuid4().hex, collection_id=collection_id, activity_id=activity_id, record=record, updated_by=actor)
        db.add(row)
    else:
        row.record, row.revision, row.updated_by = record, row.revision + 1, actor
    db.add(_audit("activityOverride", row.id, action, actor, record))
    revision = await _bump(db, actor, "activityOverride", row.id, action)
    await db.commit()
    return {"override": {"id": row.id, "collectionId": row.collection_id, "activityId": row.activity_id, "record": row.record, "revision": row.revision}, "contentRevision": int(revision["revision"])}


async def delete_activity_override(db: AsyncSession, *, collection_id: str, activity_id: str, actor: str) -> dict:
    await teaching_content_revision_service.acquire_lock(db)
    row = (await db.execute(select(ActivityOverride).where(ActivityOverride.collection_id == collection_id, ActivityOverride.activity_id == activity_id))).scalar_one_or_none()
    if row is None:
        raise ValueError("activity override not found")
    row_id = row.id
    await db.delete(row)
    db.add(_audit("activityOverride", row_id, "deleted", actor))
    revision = await _bump(db, actor, "activityOverride", row_id, "deleted")
    await db.commit()
    return {"deletedId": row_id, "contentRevision": int(revision["revision"])}


async def list_audits(db: AsyncSession, *, entity_type: str | None = None, entity_id: str | None = None, offset: int = 0, limit: int = 50) -> dict[str, Any]:
    limit, offset = min(max(limit, 1), 200), max(offset, 0)
    stmt, count_stmt = select(TeachingContentAudit), select(func.count()).select_from(TeachingContentAudit)
    if entity_type:
        stmt, count_stmt = stmt.where(TeachingContentAudit.entity_type == entity_type), count_stmt.where(TeachingContentAudit.entity_type == entity_type)
    if entity_id:
        stmt, count_stmt = stmt.where(TeachingContentAudit.entity_id == entity_id), count_stmt.where(TeachingContentAudit.entity_id == entity_id)
    rows = list((await db.execute(stmt.order_by(TeachingContentAudit.created_at.desc()).offset(offset).limit(limit))).scalars())
    total = int((await db.execute(count_stmt)).scalar_one())
    return {"items": [{"id": r.id, "entityType": r.entity_type, "entityId": r.entity_id, "action": r.action, "actorUsername": r.actor_username, "before": r.before or {}, "after": r.after or {}, "createdAt": r.created_at.isoformat() if r.created_at else None} for r in rows], "offset": offset, "limit": limit, "total": total}
