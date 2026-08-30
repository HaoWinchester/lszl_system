"""教学内容关系模型 CRUD。"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.teaching_content import (
    ContentSubject,
    ContentTaxonomy,
    RecallAssociationLibrary,
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


async def list_taxonomies(db: AsyncSession, *, subject_id: str, offset: int = 0, limit: int = 50) -> dict[str, Any]:
    limit, offset = min(max(limit, 1), 200), max(offset, 0)
    where = ContentTaxonomy.subject_id == subject_id
    rows = list((await db.execute(select(ContentTaxonomy).where(where).order_by(ContentTaxonomy.version.desc()).offset(offset).limit(limit))).scalars())
    total = int((await db.execute(select(func.count()).select_from(ContentTaxonomy).where(where))).scalar_one())
    return {"items": [{"id": r.id, "subjectId": r.subject_id, "version": r.version, "status": r.status, "title": r.title} for r in rows], "offset": offset, "limit": limit, "total": total}


def _recall_payload(row: RecallAssociationLibrary) -> dict:
    return {"id": row.id, "subjectId": row.subject_id, "version": row.version, "status": row.status, "nodes": row.nodes or [], "edges": row.edges or [], "metadata": row.content_metadata or {}, "updatedAt": row.updated_at.isoformat() if row.updated_at else ""}


async def list_recall_libraries(db: AsyncSession, *, subject_id: str, offset: int = 0, limit: int = 50) -> dict[str, Any]:
    limit, offset = min(max(limit, 1), 200), max(offset, 0)
    where = RecallAssociationLibrary.subject_id == subject_id
    rows = list((await db.execute(select(RecallAssociationLibrary).where(where).order_by(RecallAssociationLibrary.version.desc()).offset(offset).limit(limit))).scalars())
    total = int((await db.execute(select(func.count()).select_from(RecallAssociationLibrary).where(where))).scalar_one())
    return {"items": [_recall_payload(r) for r in rows], "offset": offset, "limit": limit, "total": total}


async def upsert_recall_library(db: AsyncSession, *, subject_id: str, content_revision: int, version: int, nodes: list[dict], edges: list[dict], metadata: dict, actor: str) -> dict:
    await teaching_content_revision_service.acquire_lock(db)
    await teaching_content_revision_service.assert_expected(
        db, content_revision, lock_acquired=True
    )
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
