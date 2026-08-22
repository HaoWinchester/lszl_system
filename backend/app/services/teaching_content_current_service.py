"""Resolve and update the authoritative teaching-content selection per subject."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.teaching_content import (
    ContentSubject,
    ContentTaxonomy,
    RecallAssociationLibrary,
    TaxonomyNode,
)


CURRENT_TAXONOMY_KEY = "currentTaxonomyId"
CURRENT_RECALL_LIBRARY_KEY = "currentRecallLibraryId"


def set_current_taxonomy(subject: ContentSubject, taxonomy_id: str) -> bool:
    metadata = dict(subject.content_metadata or {})
    if metadata.get(CURRENT_TAXONOMY_KEY) == taxonomy_id:
        return False
    metadata[CURRENT_TAXONOMY_KEY] = taxonomy_id
    subject.content_metadata = metadata
    return True


def set_current_recall_library(subject: ContentSubject, library_id: str) -> bool:
    metadata = dict(subject.content_metadata or {})
    if metadata.get(CURRENT_RECALL_LIBRARY_KEY) == library_id:
        return False
    metadata[CURRENT_RECALL_LIBRARY_KEY] = library_id
    subject.content_metadata = metadata
    return True


async def valid_taxonomy_pointer(
    db: AsyncSession, subject: ContentSubject
) -> ContentTaxonomy | None:
    taxonomy_id = str(
        (subject.content_metadata or {}).get(CURRENT_TAXONOMY_KEY) or ""
    ).strip()
    row = await db.get(ContentTaxonomy, taxonomy_id) if taxonomy_id else None
    if (
        row is None
        or row.subject_id != subject.id
        or row.status != "published"
    ):
        return None
    return row


async def valid_recall_pointer(
    db: AsyncSession, subject: ContentSubject
) -> RecallAssociationLibrary | None:
    library_id = str(
        (subject.content_metadata or {}).get(CURRENT_RECALL_LIBRARY_KEY) or ""
    ).strip()
    row = await db.get(RecallAssociationLibrary, library_id) if library_id else None
    if (
        row is None
        or row.subject_id != subject.id
        or row.status != "published"
    ):
        return None
    return row


async def current_taxonomy(
    db: AsyncSession, subject_id: str
) -> tuple[ContentTaxonomy, list[TaxonomyNode]] | None:
    subject = await db.get(ContentSubject, subject_id)
    if subject is None:
        return None
    row = await valid_taxonomy_pointer(db, subject)
    if row is None:
        row = (
            await db.execute(
                select(ContentTaxonomy)
                .where(
                    ContentTaxonomy.subject_id == subject_id,
                    ContentTaxonomy.status == "published",
                )
                .order_by(
                    ContentTaxonomy.version.desc(),
                    ContentTaxonomy.updated_at.desc(),
                    ContentTaxonomy.id.desc(),
                )
                .limit(1)
            )
        ).scalar_one_or_none()
    if row is None:
        return None
    nodes = list(
        (
            await db.execute(
                select(TaxonomyNode)
                .where(TaxonomyNode.taxonomy_id == row.id)
                .order_by(TaxonomyNode.position, TaxonomyNode.node_id)
            )
        ).scalars()
    )
    return row, nodes


async def current_recall_library(
    db: AsyncSession, subject_id: str
) -> RecallAssociationLibrary | None:
    subject = await db.get(ContentSubject, subject_id)
    if subject is None:
        return None
    row = await valid_recall_pointer(db, subject)
    if row is not None:
        return row
    return (
        await db.execute(
            select(RecallAssociationLibrary)
            .where(
                RecallAssociationLibrary.subject_id == subject_id,
                RecallAssociationLibrary.status == "published",
            )
            .order_by(
                RecallAssociationLibrary.version.desc(),
                RecallAssociationLibrary.updated_at.desc(),
                RecallAssociationLibrary.id.desc(),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
