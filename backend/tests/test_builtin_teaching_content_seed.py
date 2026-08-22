"""Regression coverage for the packaged PMP teaching-content baseline."""

from __future__ import annotations

import asyncio
import json
import shutil
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from app import main as app_main
from app.db.session import AsyncSessionLocal
from app.models.content_prep import Principle, SynthesisPreset
from app.models.teaching_content import (
    ContentSubject,
    ContentTaxonomy,
    RecallAssociationLibrary,
    TaxonomyNode,
)
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


def test_builtin_sync_restores_canonical_records_and_preserves_custom_content() -> None:
    bundle = seed_service.load_builtin_bundle()
    principle_item = bundle.principles[0]
    preset_item = next(
        item
        for item in bundle.synthesis_presets
        if item["principleId"] == principle_item["id"]
    )
    custom_principle_id = "custom-principle-outside-builtin-bundle"
    custom_preset_id = "custom-preset-outside-builtin-bundle"

    async def exercise() -> None:
        async with AsyncSessionLocal() as db:
            await seed_service.sync_builtin_teaching_content(db, bundle)
            principle = await db.get(Principle, principle_item["id"])
            preset = await db.get(SynthesisPreset, preset_item["id"])
            recall = await db.get(RecallAssociationLibrary, seed_service.RECALL_LIBRARY_ID)
            assert principle is not None and preset is not None and recall is not None
            principle.name = "被改动的内置原则"
            principle.revision = 7
            preset.content = "被改动的内置归纳卡"
            preset.revision = 11
            recall.nodes = []
            db.add(
                Principle(
                    id=custom_principle_id,
                    name="自定义原则",
                    status="active",
                    confusable_principle_ids=[],
                    revision=4,
                )
            )
            db.add(
                SynthesisPreset(
                    id=custom_preset_id,
                    principle_id=custom_principle_id,
                    title="自定义归纳卡",
                    content="自定义内容",
                    status="active",
                    business_version=3,
                    revision=6,
                )
            )
            await db.commit()
            revision_before = int((await teaching_content_revision_service.current(db))["revision"])

            restored = await seed_service.sync_builtin_teaching_content(db, bundle)
            assert restored.updated >= 3
            await db.refresh(principle)
            await db.refresh(preset)
            await db.refresh(recall)
            assert principle.name == principle_item["name"]
            assert principle.revision == 8
            assert preset.content == preset_item["content"]
            assert preset.revision == 12
            assert len(recall.nodes) == 471
            assert int((await teaching_content_revision_service.current(db))["revision"]) == revision_before + 1

            custom_principle = await db.get(Principle, custom_principle_id)
            custom_preset = await db.get(SynthesisPreset, custom_preset_id)
            assert custom_principle is not None and custom_principle.name == "自定义原则"
            assert custom_principle.revision == 4
            assert custom_preset is not None and custom_preset.content == "自定义内容"
            assert custom_preset.revision == 6

            upgraded_preset = {**preset_item, "content": "由新版内置文件提供的内容"}
            upgraded_bundle = replace(
                bundle,
                synthesis_presets=tuple(
                    upgraded_preset if item["id"] == preset_item["id"] else item
                    for item in bundle.synthesis_presets
                ),
            )
            upgraded = await seed_service.sync_builtin_teaching_content(db, upgraded_bundle)
            assert upgraded.updated == 1
            await db.refresh(preset)
            assert preset.content == "由新版内置文件提供的内容"
            assert preset.revision == 13

    asyncio.run(exercise())


def test_builtin_sync_allocates_versions_without_deleting_custom_content() -> None:
    bundle = seed_service.load_builtin_bundle()
    custom_taxonomy_id = "custom-taxonomy-occupying-builtin-version"

    async def exercise() -> None:
        async with AsyncSessionLocal() as db:
            await seed_service.sync_builtin_teaching_content(db, bundle)
            await db.execute(
                delete(TaxonomyNode).where(TaxonomyNode.taxonomy_id == seed_service.TAXONOMY_ID)
            )
            await db.execute(
                delete(ContentTaxonomy).where(ContentTaxonomy.id == seed_service.TAXONOMY_ID)
            )
            subject = await db.get(ContentSubject, seed_service.SUBJECT_ID)
            assert subject is not None
            db.add(
                ContentTaxonomy(
                    id=custom_taxonomy_id,
                    subject_id=subject.id,
                    version=int(bundle.taxonomy["version"]),
                    status="published",
                    title="自定义知识树",
                    content_metadata={"custom": True},
                )
            )
            await db.commit()

            await seed_service.sync_builtin_teaching_content(db, bundle)
            builtin = await db.get(ContentTaxonomy, seed_service.TAXONOMY_ID)
            custom = await db.get(ContentTaxonomy, custom_taxonomy_id)
            assert builtin is not None and builtin.version > int(bundle.taxonomy["version"])
            assert custom is not None and custom.title == "自定义知识树"

    asyncio.run(exercise())


def test_builtin_sync_rolls_back_when_a_preset_id_belongs_to_another_principle() -> None:
    bundle = seed_service.load_builtin_bundle()
    principle_item = bundle.principles[0]
    preset_item = next(
        item
        for item in bundle.synthesis_presets
        if item["principleId"] == principle_item["id"]
    )
    conflicting_principle_id = "custom-principle-with-conflicting-preset-id"

    async def exercise() -> None:
        async with AsyncSessionLocal() as db:
            await seed_service.sync_builtin_teaching_content(db, bundle)
            principle = await db.get(Principle, principle_item["id"])
            assert principle is not None
            principle.name = "事务回滚哨兵"
            await db.execute(delete(SynthesisPreset).where(SynthesisPreset.id == preset_item["id"]))
            db.add(
                Principle(
                    id=conflicting_principle_id,
                    name="冲突原则",
                    status="active",
                    confusable_principle_ids=[],
                    revision=1,
                )
            )
            await db.flush()
            db.add(
                SynthesisPreset(
                    id=preset_item["id"],
                    principle_id=conflicting_principle_id,
                    title="冲突归纳卡",
                    content="冲突内容",
                    status="active",
                    business_version=1,
                    revision=1,
                )
            )
            await db.commit()

            with pytest.raises(seed_service.BuiltinSeedValidationError, match="已绑定其他原则"):
                await seed_service.sync_builtin_teaching_content(db, bundle)
            await db.refresh(principle)
            assert principle.name == "事务回滚哨兵"

            await db.execute(delete(SynthesisPreset).where(SynthesisPreset.id == preset_item["id"]))
            await db.execute(delete(Principle).where(Principle.id == conflicting_principle_id))
            await db.commit()
            await seed_service.sync_builtin_teaching_content(db, bundle)

    asyncio.run(exercise())


def test_builtin_startup_wrapper_isolates_seed_failure(monkeypatch, caplog) -> None:
    async def fail_sync(db):
        raise seed_service.BuiltinSeedValidationError("测试内置数据损坏")

    monkeypatch.setattr(seed_service, "sync_builtin_teaching_content", fail_sync)
    app_main.app.state.db_ok = True

    result = asyncio.run(app_main._seed_builtin_teaching_content())

    assert result is None
    assert app_main.app.state.db_ok is True
    assert "Built-in teaching content sync failed" in caplog.text
    assert "knowledge-taxonomy-package-v1" not in caplog.text


def test_builtin_startup_wrapper_logs_only_summary(monkeypatch, caplog) -> None:
    expected = seed_service.BuiltinSeedSummary(
        created=18,
        updated=0,
        unchanged=0,
        changes=(
            {
                "entityType": "taxonomy",
                "entityId": seed_service.TAXONOMY_ID,
                "action": "created",
            },
        ),
    )

    async def successful_sync(db):
        return expected

    monkeypatch.setattr(seed_service, "sync_builtin_teaching_content", successful_sync)
    caplog.set_level("INFO", logger="app")

    result = asyncio.run(app_main._seed_builtin_teaching_content())

    assert result == expected
    assert "created=18 updated=0 unchanged=0" in caplog.text
    assert seed_service.TAXONOMY_ID not in caplog.text


def test_teacher_shared_content_api_restores_builtin_baseline_at_startup() -> None:
    bundle = seed_service.load_builtin_bundle()
    principle_ids = [row["id"] for row in bundle.principles]
    preset_ids = [row["id"] for row in bundle.synthesis_presets]

    async def remove_builtin_records() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(SynthesisPreset).where(SynthesisPreset.id.in_(preset_ids)))
            await db.execute(delete(Principle).where(Principle.id.in_(principle_ids)))
            await db.execute(
                delete(TaxonomyNode).where(
                    TaxonomyNode.taxonomy_id == seed_service.TAXONOMY_ID
                )
            )
            await db.execute(
                delete(ContentTaxonomy).where(
                    ContentTaxonomy.id == seed_service.TAXONOMY_ID
                )
            )
            await db.execute(
                delete(RecallAssociationLibrary).where(
                    RecallAssociationLibrary.id == seed_service.RECALL_LIBRARY_ID
                )
            )
            await db.commit()

    async def restore_builtin_records() -> None:
        async with AsyncSessionLocal() as db:
            await seed_service.sync_builtin_teaching_content(db, bundle)

    asyncio.run(remove_builtin_records())
    try:
        with TestClient(app_main.app) as client:
            login = client.post(
                "/api/v1/auth/login",
                json={"username": "老师", "password": "111111"},
            )
            assert login.status_code == 200, login.text
            response = client.get(
                "/api/v1/content-prep/shared-content",
                params={"subjectId": "PMP"},
            )
            assert response.status_code == 200, response.text
            payload = response.json()
            taxonomy = payload["knowledgeTree"]["taxonomy"]
            assert taxonomy["id"] == seed_service.TAXONOMY_ID
            assert len(taxonomy["nodes"]) == 317
            assert len(payload["recallLibrary"]["nodes"]) == 471
            assert len(payload["recallLibrary"]["edges"]) == 2840
            assert set(principle_ids).issubset(
                {item["id"] for item in payload["principles"]["items"]}
            )
    finally:
        asyncio.run(restore_builtin_records())
