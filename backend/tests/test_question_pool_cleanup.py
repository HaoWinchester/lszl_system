from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.schemas.question_cleanup import QuestionCleanupDecision
from app.services.question_cleanup_service import (
    SEEDED_TEST_BATCH_IDS,
    classify_question,
)


FIXTURE_ROOT = Path(__file__).parent / "fixtures" / "question_cleanup"


def _record(**values):
    return SimpleNamespace(**values)


def _classify_fixture(
    origin: str | None,
    audit_action: str | None,
    batch_status: str | None,
    title: str,
) -> QuestionCleanupDecision:
    question = _record(
        id="q-classifier-matrix",
        title=title,
        content_metadata={"origin": origin} if origin is not None else {},
    )
    audits = (
        [_record(action=audit_action, batch_id="batch-matrix", detail={})]
        if audit_action is not None
        else []
    )
    batch = (
        _record(id="batch-matrix", status=batch_status)
        if batch_status is not None
        else None
    )
    return classify_question(question, audits, batch)


@pytest.mark.parametrize(
    ("origin", "audit_action", "batch_status", "title", "expected"),
    [
        (
            "content_prep",
            "question_created",
            "committed",
            "正式题目",
            "keep_formal_import",
        ),
        (
            "content_prep",
            "question_created",
            "committed",
            "__e2e_fixture__",
            "delete_explicit_test",
        ),
        (
            "legacy_import",
            "legacy_import_verified",
            None,
            "正式旧题",
            "keep_formal_import",
        ),
        ("manual", "question_created", None, "临时录入", "delete_non_imported"),
        (None, None, None, "来源未知", "review"),
    ],
)
def test_cleanup_classifier_priority(
    origin, audit_action, batch_status, title, expected
):
    assert _classify_fixture(origin, audit_action, batch_status, title).decision == expected


def test_classifier_uses_fixture_contracts_and_explicit_test_signals_override_import():
    fixture = json.loads((FIXTURE_ROOT / "test-import.json").read_text(encoding="utf-8"))
    assert frozenset(fixture["seededBatchIds"]) == SEEDED_TEST_BATCH_IDS

    for index, case in enumerate(fixture["cases"]):
        question = _record(
            id=f"q-test-signal-{index}",
            title=case["question"].get("title", "正式题目"),
            external_id=case["question"].get("externalId"),
            content_metadata=case["question"].get("metadata", {}),
        )
        audits = [_record(**row) for row in case.get("audits", [])]
        batch = _record(**case["batch"]) if case.get("batch") else None

        decision = classify_question(question, audits, batch)

        assert decision.decision == "delete_explicit_test", case["name"]
        assert any(code.startswith("explicit_test:") for code in decision.evidence_codes)


def test_classifier_keeps_only_verified_imports():
    fixture = json.loads((FIXTURE_ROOT / "formal-import.json").read_text(encoding="utf-8"))

    for index, case in enumerate(fixture["cases"]):
        question = _record(
            id=f"q-formal-{index}",
            title=case["question"]["title"],
            content_metadata=case["question"].get("metadata", {}),
        )
        audits = [_record(**row) for row in case.get("audits", [])]
        batch = _record(**case["batch"]) if case.get("batch") else None

        decision = classify_question(question, audits, batch)

        assert decision.decision == "keep_formal_import", case["name"]
        assert any(code.startswith("verified_import:") for code in decision.evidence_codes)


@pytest.mark.parametrize(
    ("origin", "audit_action", "batch_status"),
    [
        ("content_prep", None, None),
        ("legacy_import", None, None),
        ("content_prep", "question_created", "pending"),
        ("content_prep", "unrelated_action", "committed"),
        ("content_prep", "question_created", None),
    ],
)
def test_origin_or_partial_import_traces_are_not_verified(
    origin, audit_action, batch_status
):
    assert (
        _classify_fixture(origin, audit_action, batch_status, "普通题目").decision
        == "review"
    )


@pytest.mark.parametrize(
    "title",
    [
        "软件测试方法",
        "模拟题：项目风险管理",
        "pytest 是什么（正式培训题）",
        "这不是__test__前缀",
    ],
)
def test_ordinary_words_are_not_explicit_test_evidence(title):
    decision = _classify_fixture(
        "content_prep", "question_created", "committed", title
    )
    assert decision.decision == "keep_formal_import"
    assert not any(code.startswith("explicit_test:") for code in decision.evidence_codes)


@pytest.mark.parametrize(
    "metadata",
    [
        {"environment": "testing"},
        {"environment": "production-e2e"},
        {"fixture": "true"},
        {"fixture": 1},
    ],
)
def test_test_metadata_requires_exact_normalized_values(metadata):
    question = _record(
        id="q-near-miss",
        title="正式题目",
        content_metadata={"origin": "content_prep", **metadata},
    )
    decision = classify_question(
        question,
        [_record(action="question_created", batch_id="batch-formal", detail={})],
        _record(id="batch-formal", status="committed"),
    )
    assert decision.decision == "keep_formal_import"


def test_classifier_is_deterministic_serializable_and_sorts_stable_codes():
    question_a = {
        "id": "q-deterministic",
        "title": "  __E2E__正式导入样例 ",
        "metadata": {
            "origin": "content_prep",
            "environment": " E2E ",
            "nested": {"z": 1, "a": 2},
        },
    }
    question_b = {
        "metadata": {
            "nested": {"a": 2, "z": 1},
            "environment": " E2E ",
            "origin": "content_prep",
        },
        "title": "  __E2E__正式导入样例 ",
        "id": "q-deterministic",
    }
    audits = [
        {
            "action": "question_created",
            "batch_id": "batch-formal",
            "detail": {"testFixture": True, "z": 1, "a": 2},
        },
        {
            "action": "question_created",
            "batch_id": "batch-formal",
            "detail": {},
        },
    ]
    batch = {"id": "batch-formal", "status": "committed"}

    decision_a = classify_question(question_a, audits, batch)
    decision_b = classify_question(question_b, list(reversed(audits)), batch)

    assert decision_a == decision_b
    assert decision_a.evidence_codes == sorted(set(decision_a.evidence_codes))
    assert len(decision_a.source_fingerprint) == 64
    assert decision_a.model_dump(mode="json", by_alias=True) == {
        "questionId": "q-deterministic",
        "decision": "delete_explicit_test",
        "evidenceCodes": decision_a.evidence_codes,
        "sourceFingerprint": decision_a.source_fingerprint,
        "affectedReferenceIds": [],
    }


def test_decision_contract_sorts_reference_ids_and_rejects_missing_required_fields():
    decision = QuestionCleanupDecision.model_validate(
        {
            "questionId": "q-schema",
            "decision": "review",
            "evidenceCodes": ["source:ambiguous", "source:ambiguous"],
            "sourceFingerprint": "a" * 64,
            "affectedReferenceIds": ["paper:z", "paper:a", "paper:a"],
        }
    )
    assert decision.evidence_codes == ["source:ambiguous"]
    assert decision.affected_reference_ids == ["paper:a", "paper:z"]

    for missing in ("questionId", "decision", "evidenceCodes", "sourceFingerprint"):
        payload = {
            "questionId": "q-schema",
            "decision": "review",
            "evidenceCodes": ["source:ambiguous"],
            "sourceFingerprint": "a" * 64,
        }
        payload.pop(missing)
        with pytest.raises(ValidationError):
            QuestionCleanupDecision.model_validate(payload)
