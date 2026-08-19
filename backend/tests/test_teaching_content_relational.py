import asyncio
import inspect

from app.db.base import Base
from sqlalchemy import select
from app.db.session import AsyncSessionLocal
from app.models.teaching_content import (
    ActivityCollection,
    ActivityOverride,
    ActivityTag,
    ContentSubject,
    ContentTaxonomy,
    RecallAssociationLibrary,
    TaxonomyNode,
    TeachingContentAudit,
)


def test_teaching_content_relational_tables_are_registered():
    assert {
        "content_subjects", "content_taxonomies", "taxonomy_nodes",
        "activity_collections", "activity_tags", "activity_overrides",
        "recall_association_libraries", "teaching_content_audits",
    } <= set(Base.metadata.tables)


def test_taxonomy_has_subject_fk_and_lifecycle_constraint():
    table = Base.metadata.tables["content_taxonomies"]
    assert any(f.target_fullname == "content_subjects.id" for f in table.foreign_keys)
    assert any("status IN" in str(c.sqltext) for c in table.constraints if hasattr(c, "sqltext"))


def test_content_services_do_not_import_shared_runtime_state():
    from app.services import content_prep_shared_service, content_reference_service

    assert "SharedRuntimeState" not in inspect.getsource(content_prep_shared_service)
    assert "SharedRuntimeState" not in inspect.getsource(content_reference_service)


def test_taxonomy_release_replaces_existing_nodes_atomically():
    from app.services.teaching_content_service import release_taxonomy

    async def scenario():
        async with AsyncSessionLocal() as db:
            subject_id = "subject-taxonomy-replace-test"
            taxonomy_id = "taxonomy-replace-test"
            db.add(ContentSubject(id=subject_id, code="TAXREPL", name="Taxonomy Replace", content_metadata={}))
            await db.commit()
            await release_taxonomy(db, subject_id=subject_id, taxonomy_id=taxonomy_id, version=1, title="v1", nodes=[{"id": "old", "title": "旧"}], actor="admin")
            await release_taxonomy(db, subject_id=subject_id, taxonomy_id=taxonomy_id, version=2, title="v2", nodes=[{"id": "new", "title": "新"}], actor="admin")
            rows = (await db.execute(select(TaxonomyNode).where(TaxonomyNode.taxonomy_id == taxonomy_id))).scalars().all()
            assert [row.node_id for row in rows] == ["new"]
            await db.delete(await db.get(ContentTaxonomy, taxonomy_id))
            await db.delete(await db.get(ContentSubject, subject_id))
            await db.commit()

    asyncio.run(scenario())


def test_recall_library_is_subject_scoped_and_auditable():
    table = Base.metadata.tables["recall_association_libraries"]
    assert any(f.target_fullname == "content_subjects.id" for f in table.foreign_keys)
    audit = Base.metadata.tables["teaching_content_audits"]
    assert {"entity_type", "entity_id", "action", "actor_username"} <= set(audit.columns.keys())
