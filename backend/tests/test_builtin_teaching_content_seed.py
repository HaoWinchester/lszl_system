"""Regression coverage for the packaged PMP teaching-content baseline."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from app.services import builtin_teaching_content_seed_service as seed_service


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
