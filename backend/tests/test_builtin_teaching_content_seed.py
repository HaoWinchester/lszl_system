"""Regression coverage for the packaged PMP teaching-content baseline."""

from __future__ import annotations

import asyncio
import json
import shutil
from pathlib import Path

import pytest
from sqlalchemy import delete, func, select

from app.db.session import AsyncSessionLocal
from app.models.content_prep import Principle, SynthesisPreset
from app.models.teaching_content import ContentTaxonomy, RecallAssociationLibrary, TaxonomyNode
from app.services import builtin_teaching_content_seed_service as seed_service
from app.services import teaching_content_revision_service


SEED_FILENAMES = (
    "pmp_taxonomy_v8_6_2.json",
    "pmp_recall_association_v9.json",
    "pmp_principle_cards_v1.json",
)


def _copy_seed_directory(target: Path) -> None:
    target.mkdir(parents=True, exist_ok=True)
    for filename in SEED_FILENAMES:
        shutil.copy2(seed_service.SEED_DIR / filename, target / filename)


def test_real_builtin_bundle_has_the_approved_shape() -> None:
    bundle = seed_service.load_builtin_bundle()

    assert bundle.subject_id == "subject-pmp"
    assert bundle.taxonomy["id"] == "taxonomy-pmp-complete-v1"
    assert len(bundle.taxonomy["nodes"]) == 317
    assert len(bundle.recall_library["nodes"]) == 471
    assert len(bundle.recall_library["edges"]) == 2840
    assert len(bundle.principles) == 8
    assert len(bundle.synthesis_presets) == 8
    assert {row["id"] for row in bundle.principles} == {
        row["principleId"] for row in bundle.synthesis_presets
    }


def test_builtin_bundle_rejects_broken_recall_cross_references(tmp_path: Path) -> None:
    _copy_seed_directory(tmp_path)
    recall_path = tmp_path / "pmp_recall_association_v9.json"
    recall = json.loads(recall_path.read_text(encoding="utf-8"))
    recall["edges"][0]["to"] = "missing-recall-node"
    recall_path.write_text(json.dumps(recall, ensure_ascii=False), encoding="utf-8")

    with pytest.raises(seed_service.BuiltinSeedValidationError, match="联想关系"):
        seed_service.load_builtin_bundle(tmp_path)


def test_builtin_bundle_syncs_once_and_repeated_runs_are_idempotent() -> None:
    bundle = seed_service.load_builtin_bundle()
    principle_ids = [row["id"] for row in bundle.principles]
    preset_ids = [row["id"] for row in bundle.synthesis_presets]

    async def exercise() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(SynthesisPreset).where(SynthesisPreset.id.in_(preset_ids)))
            await db.execute(delete(Principle).where(Principle.id.in_(principle_ids)))
            await db.execute(
                delete(TaxonomyNode).where(TaxonomyNode.taxonomy_id == seed_service.TAXONOMY_ID)
            )
            await db.execute(
                delete(ContentTaxonomy).where(ContentTaxonomy.id == seed_service.TAXONOMY_ID)
            )
            await db.execute(
                delete(RecallAssociationLibrary).where(
                    RecallAssociationLibrary.id == seed_service.RECALL_LIBRARY_ID
                )
            )
            await db.commit()

            first = await seed_service.sync_builtin_teaching_content(db, bundle)
            assert first.created == 18
            assert first.updated == 0

            taxonomy = await db.get(ContentTaxonomy, seed_service.TAXONOMY_ID)
            recall = await db.get(RecallAssociationLibrary, seed_service.RECALL_LIBRARY_ID)
            assert taxonomy is not None and taxonomy.status == "published"
            assert recall is not None
            assert len(recall.nodes) == 471
            assert len(recall.edges) == 2840
            taxonomy_node_count = int(
                (
                    await db.execute(
                        select(func.count())
                        .select_from(TaxonomyNode)
                        .where(TaxonomyNode.taxonomy_id == taxonomy.id)
                    )
                ).scalar_one()
            )
            assert taxonomy_node_count == 317
            assert len((await db.execute(select(Principle).where(Principle.id.in_(principle_ids)))).scalars().all()) == 8
            assert len((await db.execute(select(SynthesisPreset).where(SynthesisPreset.id.in_(preset_ids)))).scalars().all()) == 8

            revision_before = await teaching_content_revision_service.current(db)
            second = await seed_service.sync_builtin_teaching_content(db, bundle)
            revision_after = await teaching_content_revision_service.current(db)
            assert second.created == 0
            assert second.updated == 0
            assert revision_after == revision_before

    asyncio.run(exercise())
