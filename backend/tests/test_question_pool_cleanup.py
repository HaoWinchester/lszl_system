from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError

from app.db.session import AsyncSessionLocal
from app.models.content_prep import (
    QuestionAuditLog,
    QuestionEditLock,
    QuestionUploadBatch,
)
from app.models.question import (
    ExamPaper,
    PaperQuestion,
    Question,
    QuestionBank,
    QuestionCleanupAudit,
)
from app.models.shared_runtime_state import SharedRuntimeState
from app.models.training import LearningEvent, RecallProgress, TrainingProgress
from app.schemas.question_cleanup import (
    QuestionCleanupDecision,
    QuestionCleanupReport,
    QuestionCleanupReviewDecisionFile,
)
from app.services.question_cleanup_service import (
    QuestionCleanupApplyError,
    QuestionCleanupBackupReceipt,
    SEEDED_TEST_BATCH_IDS,
    apply_cleanup,
    apply_review_decisions,
    build_report,
    calculate_manifest_hash,
    classify_question,
)
from app.services import (
    question_cleanup_service,
    question_service,
    teaching_content_revision_service,
)
from scripts import question_pool_maintenance


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


def _review_decision_report() -> QuestionCleanupReport:
    def decision(
        question_id: str,
        value: str,
        evidence_codes: list[str],
        fingerprint: str,
    ) -> dict[str, object]:
        return {
            "questionId": question_id,
            "decision": value,
            "evidenceCodes": evidence_codes,
            "sourceFingerprint": fingerprint,
            "affectedReferenceIds": [f"ref:{question_id}"],
        }

    return QuestionCleanupReport.model_validate(
        {
            "policyVersion": "question-cleanup-v1",
            "generatedAt": "2026-08-10T12:00:00Z",
            "summary": {
                "totalCount": 4,
                "keepCount": 1,
                "deleteCount": 1,
                "reviewCount": 2,
                "referenceCount": 7,
                "repairReferenceCount": 5,
                "preservedReferenceCount": 2,
            },
            "keep": [
                decision(
                    "q-formal",
                    "keep_formal_import",
                    ["verified_import:committed_batch"],
                    "1" * 64,
                )
            ],
            "delete": [
                decision(
                    "q-automated-test",
                    "delete_explicit_test",
                    ["explicit_test:metadata_fixture"],
                    "2" * 64,
                )
            ],
            "review": [
                decision(
                    "q-review-b",
                    "review",
                    ["source:ambiguous", "trace:legacy-row"],
                    "4" * 64,
                ),
                decision(
                    "q-review-a",
                    "review",
                    ["source:ambiguous"],
                    "3" * 64,
                ),
            ],
            "references": [],
            "snapshotHash": "a" * 64,
            "manifestHash": "7313229abfa6c9cceb2b1f1a4f25d0032ff7629f7e734acb85a3091fc0e166b6",
        }
    )


def test_review_decisions_resolve_the_exact_closed_set_and_rehash_report():
    """Catch partial resolution or loss of machine evidence during human review."""

    report = _review_decision_report()
    decisions = QuestionCleanupReviewDecisionFile.model_validate_json(
        (FIXTURE_ROOT / "review-decisions.json").read_text(encoding="utf-8")
    )

    resolved = apply_review_decisions(report, decisions)

    assert resolved.summary.model_dump(by_alias=True) == {
        "totalCount": 4,
        "keepCount": 2,
        "deleteCount": 2,
        "reviewCount": 0,
        "referenceCount": 7,
        "repairReferenceCount": 5,
        "preservedReferenceCount": 2,
    }
    assert [item.question_id for item in resolved.keep] == [
        "q-formal",
        "q-review-a",
    ]
    assert [item.question_id for item in resolved.delete] == [
        "q-automated-test",
        "q-review-b",
    ]
    resolved_by_id = {
        item.question_id: item for item in [*resolved.keep, *resolved.delete]
    }
    assert resolved_by_id["q-review-a"].evidence_codes == [
        "human-review:已核对为正式导入",
        "source:ambiguous",
    ]
    assert resolved_by_id["q-review-b"].evidence_codes == [
        "human-review:已核对为非导入题",
        "source:ambiguous",
        "trace:legacy-row",
    ]
    assert resolved_by_id["q-review-a"].source_fingerprint == "3" * 64
    assert resolved_by_id["q-review-b"].affected_reference_ids == [
        "ref:q-review-b"
    ]
    assert resolved.manifest_hash != report.manifest_hash
    assert resolved.manifest_hash == calculate_manifest_hash(resolved)


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (
            lambda payload: payload.update(manifestHash="c" * 64),
            "manifest",
        ),
        (
            lambda payload: payload["decisions"].pop(),
            "missing",
        ),
        (
            lambda payload: payload["decisions"].append(
                dict(payload["decisions"][0])
            ),
            "duplicate",
        ),
        (
            lambda payload: payload["decisions"].append(
                {
                    "questionId": "q-not-in-review",
                    "decision": "delete_non_imported",
                    "reason": "额外题目",
                }
            ),
            "extra",
        ),
        (
            lambda payload: payload["decisions"][0].update(reason="   "),
            "reason",
        ),
        (
            lambda payload: payload["decisions"][0].update(
                decision="delete_explicit_test"
            ),
            "decision",
        ),
    ],
)
def test_review_decisions_reject_stale_or_non_closed_set_input(mutate, message):
    """Catch stale, incomplete, duplicated, extra, or unsafe manual decisions."""

    payload = json.loads(
        (FIXTURE_ROOT / "review-decisions.json").read_text(encoding="utf-8")
    )
    mutate(payload)

    with pytest.raises((ValueError, ValidationError), match=message):
        apply_review_decisions(_review_decision_report(), payload)


def test_review_decision_unicode_colons_keep_evidence_and_hash_deterministic():
    """Catch delimiter-like Unicode reasons destabilizing evidence or hashes."""

    payload = json.loads(
        (FIXTURE_ROOT / "review-decisions.json").read_text(encoding="utf-8")
    )
    for item in payload["decisions"]:
        item["reason"] = "  人工复核：外部来源:批次甲/✅  "

    forward = apply_review_decisions(_review_decision_report(), payload)
    payload["decisions"].reverse()
    reversed_order = apply_review_decisions(_review_decision_report(), payload)

    expected_code = "human-review:人工复核：外部来源:批次甲/✅"
    assert forward == reversed_order
    assert forward.manifest_hash == reversed_order.manifest_hash
    assert all(
        expected_code in item.evidence_codes
        for item in [*forward.keep, *forward.delete]
        if item.question_id.startswith("q-review-")
    )


def test_review_decisions_reject_a_report_changed_after_its_manifest_was_set():
    """Catch decisions being applied to mutable report content under an old hash."""

    report = _review_decision_report()
    report.keep.clear()
    decisions = json.loads(
        (FIXTURE_ROOT / "review-decisions.json").read_text(encoding="utf-8")
    )

    with pytest.raises(ValueError, match="report manifest"):
        apply_review_decisions(report, decisions)


def test_review_decisions_revalidate_a_mutated_schema_instance():
    """Catch post-validation mutation bypassing the human decision allowlist."""

    decisions = QuestionCleanupReviewDecisionFile.model_validate_json(
        (FIXTURE_ROOT / "review-decisions.json").read_text(encoding="utf-8")
    )
    decisions.decisions[0].decision = "delete_explicit_test"  # type: ignore[assignment]

    with pytest.raises(ValueError, match="decision"):
        apply_review_decisions(_review_decision_report(), decisions)


def test_report_hashes_are_stable_across_insertion_order_and_change_on_question_edit():
    """Catch row-order-dependent hashes and snapshots that miss live question edits."""

    suffix = uuid4().hex[:12]
    bank_id = f"cleanup-bank-{suffix}"
    batch_id = f"cleanup-batch-{suffix}"
    paper_id = f"cleanup-paper-{suffix}"
    question_ids = [
        f"cleanup-formal-{suffix}",
        f"cleanup-manual-{suffix}",
        f"cleanup-review-{suffix}",
    ]
    audit_id = f"cleanup-audit-{suffix}"
    runtime_keys = [
        "kg_exam_papers_v1__teacher_shared",
        "kg_exam_paper_categories_v1__teacher_shared",
        "kg_course_config_drafts_v1",
        "kg_course_config_active_release_v1",
        "kg_learning_tasks_v1",
        "kg_principle_repository_v1",
        "kg_synthesis_preset_repository_v1",
        f"kg_recall_association_library_v1__subject__cleanup-{suffix}",
        "kg_assessment_papers_v1",
        "kg_exam_papers_published_v1",
        "kg_exam_paper_release_history_v1",
        "kg_course_config_releases_v1",
    ]

    def question_rows(reverse: bool = False) -> list[Question]:
        rows = [
            Question(
                id=question_ids[0],
                bank_id=bank_id,
                title="正式导入题",
                content_metadata={"origin": "content_prep"},
                revision=3,
            ),
            Question(
                id=question_ids[1],
                bank_id=bank_id,
                title="临时录入题",
                content_metadata={"origin": "manual"},
                revision=2,
            ),
            Question(
                id=question_ids[2],
                bank_id=bank_id,
                title="来源待确认题",
                content_metadata={},
                revision=1,
            ),
        ]
        return list(reversed(rows)) if reverse else rows

    runtime_values = {
        "kg_exam_papers_v1__teacher_shared": [
            {
                "id": "runtime-paper-current-b",
                "status": "published",
                "questions": [
                    {
                        "bankId": bank_id,
                        "questionId": question_ids[1],
                        "order": 1,
                    }
                ],
            }
            ,
            {
                "id": "runtime-paper-current-a",
                "status": "draft",
                "questions": [
                    {
                        "bankId": bank_id,
                        "questionId": question_ids[1],
                        "order": 1,
                    }
                ],
            },
        ],
        "kg_exam_paper_categories_v1__teacher_shared": [
            {"id": "paper-category-current", "paperIds": ["runtime-paper-current"]}
        ],
        "kg_course_config_drafts_v1": [
            {
                "id": "course-draft-current",
                "nodes": [
                    {
                        "id": "course-node-current",
                        "settings": {"questionIds": [question_ids[1]]},
                    }
                ],
            }
        ],
        "kg_course_config_active_release_v1": {
            "courseId": "course-draft-current",
            "releaseId": "release-current",
        },
        "kg_learning_tasks_v1": [
            {
                "id": "learning-task-published",
                "status": "published",
                "config": {
                    "legacyQuestionRefs": [
                        {"bankId": bank_id, "questionId": question_ids[1]}
                    ]
                },
            },
            {
                "id": "learning-task-draft",
                "status": "draft",
                "config": {
                    "legacyQuestionRefs": [
                        {"bankId": bank_id, "questionId": question_ids[1]}
                    ]
                },
            },
            {
                "id": "learning-task-archived-published",
                "status": "archived",
                "publishedAt": "2026-08-01T10:00:00Z",
                "config": {
                    "legacyQuestionRefs": [
                        {"bankId": bank_id, "questionId": question_ids[1]}
                    ]
                },
            },
            {
                "id": "learning-task-archived-never-published",
                "status": "archived",
                "publishedAt": "",
                "config": {
                    "legacyQuestionRefs": [
                        {"bankId": bank_id, "questionId": question_ids[1]}
                    ]
                },
            },
        ],
        "kg_principle_repository_v1": {
            "schemaVersion": 1,
            "items": [
                {
                    "id": "principle-current-b",
                    "metadata": {"questionId": question_ids[1]},
                },
                {
                    "id": "principle-current-a",
                    "metadata": {"questionId": question_ids[2]},
                },
            ],
        },
        "kg_synthesis_preset_repository_v1": {
            "schemaVersion": 1,
            "items": [
                {
                    "id": "preset-current-b",
                    "principleId": "principle-current-b",
                    "metadata": {"questionId": question_ids[1]},
                },
                {
                    "id": "preset-current-a",
                    "principleId": "principle-current-a",
                    "metadata": {"questionId": question_ids[2]},
                },
            ],
        },
        f"kg_recall_association_library_v1__subject__cleanup-{suffix}": {
            "schemaVersion": 1,
            "nodes": [
                    {
                        "id": "association-current-b",
                        "title": "关联节点 B",
                        "metadata": {"questionIds": [question_ids[1]]},
                    },
                    {
                        "id": "association-current-a",
                        "title": "关联节点 A",
                        "metadata": {"questionIds": [question_ids[2]]},
                    }
                ],
                "edges": [
                    {
                        "id": "association-edge-b",
                        "from": "association-current-a",
                        "to": "association-current-b",
                        "metadata": {"questionId": question_ids[1]},
                    },
                    {
                        "id": "association-edge-a",
                        "from": "association-current-b",
                        "to": "association-current-a",
                        "metadata": {"questionId": question_ids[2]},
                    },
                ],
        },
        "kg_assessment_papers_v1": [
            {
                "id": "workbench-paper-current",
                "status": "published",
                "sections": [
                    {
                        "id": "workbench-section-current",
                        "items": [
                            {
                                "activityId": "activity-not-a-question-reference",
                                "metadata": {"questionId": question_ids[1]},
                            }
                        ],
                    }
                ],
            }
        ],
        "kg_exam_papers_published_v1": [
            {
                "paperId": "published-paper",
                "releaseId": "published-release",
                "questions": [
                    {"bankId": bank_id, "questionId": question_ids[1]}
                ],
                "questionSnapshots": [
                    {"id": question_ids[1], "title": "冻结题目快照"}
                ],
            }
        ],
        "kg_exam_paper_release_history_v1": [
            {
                "paperId": "published-paper",
                "releaseId": "historical-release",
                "questionRefs": [
                    {"bankId": bank_id, "questionId": question_ids[1]}
                ],
                "questionSnapshots": [
                    {"id": question_ids[1], "title": "历史冻结题目快照"}
                ],
            }
        ],
        "kg_course_config_releases_v1": [
            {
                "id": "course-release-historical",
                "course": {
                    "id": "course-historical",
                    "nodes": [
                        {"id": "historical-node", "questionIds": [question_ids[1]]}
                    ],
                },
            }
        ],
    }

    async def clear_fixture(db) -> None:
        await db.execute(
            delete(QuestionAuditLog).where(QuestionAuditLog.id == audit_id)
        )
        await db.execute(
            delete(PaperQuestion).where(PaperQuestion.paper_id == paper_id)
        )
        await db.execute(delete(ExamPaper).where(ExamPaper.id == paper_id))
        await db.execute(delete(Question).where(Question.id.in_(question_ids)))
        await db.execute(
            delete(QuestionUploadBatch).where(QuestionUploadBatch.id == batch_id)
        )
        await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
        await db.execute(
            delete(SharedRuntimeState).where(SharedRuntimeState.key.in_(runtime_keys))
        )

    async def insert_fixture(db, reverse: bool = False) -> None:
        db.add(
            QuestionBank(
                id=bank_id,
                owner_id="admin",
                name="清理报告测试题库",
                subject="PMP",
            )
        )
        await db.flush()
        db.add(
            QuestionUploadBatch(
                id=batch_id,
                idempotency_key=f"cleanup-idempotency-{suffix}",
                bank_id=bank_id,
                actor_username="admin",
                actor_role="admin",
                client_instance_id=f"cleanup-client-{suffix}",
                manifest_hash="a" * 64,
                status="committed",
            )
        )
        db.add_all(question_rows(reverse))
        await db.flush()
        db.add(
            QuestionAuditLog(
                id=audit_id,
                entity_type="question",
                entity_id=question_ids[0],
                question_id=question_ids[0],
                bank_id=bank_id,
                batch_id=batch_id,
                action="question_created",
                actor_username="admin",
                actor_role="admin",
                outcome="success",
                detail={},
            )
        )
        db.add(
            ExamPaper(
                id=paper_id,
                owner_id="admin",
                name="关系型当前试卷",
                subject="PMP",
                status="published",
                revision=4,
            )
        )
        await db.flush()
        db.add(
            PaperQuestion(
                paper_id=paper_id,
                question_id=question_ids[1],
                order_index=0,
            )
        )
        runtime_rows = []
        for key in runtime_keys:
            value = json.loads(json.dumps(runtime_values[key], ensure_ascii=False))
            if reverse and key == "kg_exam_papers_v1__teacher_shared":
                value = list(reversed(value))
            if reverse and key in {
                "kg_principle_repository_v1",
                "kg_synthesis_preset_repository_v1",
            }:
                value["items"] = list(reversed(value["items"]))
            if reverse and key.startswith(
                "kg_recall_association_library_v1__subject__"
            ):
                value["nodes"] = list(reversed(value["nodes"]))
                value["edges"] = list(reversed(value["edges"]))
            runtime_rows.append(
                SharedRuntimeState(
                    key=key,
                    value=json.dumps(value, ensure_ascii=False),
                    schema_version=1,
                    updated_by="admin",
                )
            )
        db.add_all(list(reversed(runtime_rows)) if reverse else runtime_rows)
        await db.commit()

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            try:
                await clear_fixture(db)
                await db.commit()
                await insert_fixture(db, reverse=False)
                report_a = await build_report(db)

                await clear_fixture(db)
                await db.commit()
                await insert_fixture(db, reverse=True)
                report_b = await build_report(db)

                assert report_a.manifest_hash == report_b.manifest_hash
                assert report_a.snapshot_hash == report_b.snapshot_hash
                assert [item.question_id for item in report_a.delete] == sorted(
                    item.question_id for item in report_a.delete
                )
                assert report_a.policy_version == "question-cleanup-v1"

                manual_refs = [
                    row
                    for row in report_a.references
                    if row.question_id == question_ids[1]
                ]
                assert {
                    (row.container_type, row.repair_action) for row in manual_refs
                } >= {
                    ("relational_paper", "remove_question_and_recalculate"),
                    ("paper_draft", "remove_question_and_recalculate"),
                    ("course_draft", "remove_question_and_recalculate"),
                    ("learning_task", "remove_question_and_recalculate"),
                    ("learning_task", "preserve_historical_snapshot"),
                    ("principle_repository", "remove_question_and_recalculate"),
                    (
                        "synthesis_preset_repository",
                        "remove_question_and_recalculate",
                    ),
                    ("recall_association_library", "remove_question_and_recalculate"),
                    ("workbench_aggregate", "remove_question_and_recalculate"),
                    ("published_paper_snapshot", "preserve_historical_snapshot"),
                    ("published_course_snapshot", "preserve_historical_snapshot"),
                }
                assert all(
                    row.repair_action == "remove_question_and_recalculate"
                    for row in manual_refs
                    if row.storage_key
                    == "kg_exam_papers_v1__teacher_shared"
                ), "the mutable current paper stays repairable even when status=published"
                task_actions = {
                    row.container_id: row.repair_action
                    for row in manual_refs
                    if row.storage_key == "kg_learning_tasks_v1"
                }
                assert task_actions == {
                    "learning-task-archived-never-published": "remove_question_and_recalculate",
                    "learning-task-archived-published": "preserve_historical_snapshot",
                    "learning-task-draft": "remove_question_and_recalculate",
                    "learning-task-published": "preserve_historical_snapshot",
                }

                question = await db.get(Question, question_ids[1])
                assert question is not None
                question.title = "临时录入题。"
                question.revision += 1
                await db.commit()
                report_changed = await build_report(db)
                assert report_changed.snapshot_hash != report_b.snapshot_hash
                assert report_changed.manifest_hash != report_b.manifest_hash
            finally:
                await clear_fixture(db)
                await db.commit()

    asyncio.run(scenario())


def test_decisions_template_cli_builds_complete_blanket_policy_file_without_db(
    tmp_path,
):
    """Catch operators having to hand-edit a large review set or missing an ID."""

    report_path = tmp_path / "source-report.json"
    decisions_path = tmp_path / "review-decisions.json"
    original_bytes = (
        json.dumps(
            _review_decision_report().model_dump(mode="json", by_alias=True),
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    ).encode("utf-8")
    report_path.write_bytes(original_bytes)

    completed = subprocess.run(
        [
            sys.executable,
            "scripts/question_pool_maintenance.py",
            "decisions-template",
            "--report",
            str(report_path),
            "--output",
            str(decisions_path),
            "--reason",
            "已确认仅保留可验证正式导入",
        ],
        cwd=Path(__file__).resolve().parents[1],
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed.returncode == 2
    assert not decisions_path.exists()

    wrong_confirmation = subprocess.run(
        [
            sys.executable,
            "scripts/question_pool_maintenance.py",
            "decisions-template",
            "--report",
            str(report_path),
            "--output",
            str(decisions_path),
            "--reason",
            "已确认仅保留可验证正式导入",
            "--confirm",
            "DELETE-NON-IMPORTED-REVIEW:000000000000",
        ],
        cwd=Path(__file__).resolve().parents[1],
        check=False,
        capture_output=True,
        text=True,
    )
    assert wrong_confirmation.returncode != 0
    assert "delete_non_imported" in wrong_confirmation.stderr
    assert not decisions_path.exists()

    completed = subprocess.run(
        [
            sys.executable,
            "scripts/question_pool_maintenance.py",
            "decisions-template",
            "--report",
            str(report_path),
            "--output",
            str(decisions_path),
            "--reason",
            "已确认仅保留可验证正式导入",
            "--confirm",
            "DELETE-NON-IMPORTED-REVIEW:7313229abfa6",
        ],
        cwd=Path(__file__).resolve().parents[1],
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed.returncode == 0, completed.stderr
    assert report_path.read_bytes() == original_bytes
    payload = json.loads(decisions_path.read_text(encoding="utf-8"))
    assert payload == {
        "manifestHash": "7313229abfa6c9cceb2b1f1a4f25d0032ff7629f7e734acb85a3091fc0e166b6",
        "decisions": [
            {
                "questionId": "q-review-a",
                "decision": "delete_non_imported",
                "reason": "已确认仅保留可验证正式导入",
            },
            {
                "questionId": "q-review-b",
                "decision": "delete_non_imported",
                "reason": "已确认仅保留可验证正式导入",
            },
        ],
    }
    assert "database" not in completed.stderr.casefold()


@pytest.mark.parametrize("use_hard_link", [False, True])
def test_report_decisions_rejects_output_alias_before_database_access(
    tmp_path,
    monkeypatch,
    use_hard_link,
):
    """Catch a resolved report overwriting its decision file or hard-link alias."""

    decisions_path = tmp_path / "review-decisions.json"
    decisions_path.write_text(
        (FIXTURE_ROOT / "review-decisions.json").read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    output = decisions_path
    if use_hard_link:
        output = tmp_path / "resolved-report.json"
        output.hardlink_to(decisions_path)

    def fail_if_database_is_initialized():
        raise AssertionError("database must not be initialized")

    monkeypatch.setattr(
        question_pool_maintenance,
        "AsyncSessionLocal",
        fail_if_database_is_initialized,
    )

    with pytest.raises(ValueError, match="output.*decision"):
        question_pool_maintenance.main(
            [
                "report",
                "--decisions",
                str(decisions_path),
                "--output",
                str(output),
            ]
        )


def test_report_decisions_cli_resolves_a_controlled_report_without_database(
    tmp_path,
    monkeypatch,
):
    """Catch --decisions being ignored while avoiding the live dev report."""

    decisions_path = FIXTURE_ROOT / "review-decisions.json"
    output = tmp_path / "resolved-report.json"

    class _NoDatabaseSession:
        async def __aenter__(self):
            return object()

        async def __aexit__(self, exc_type, exc, traceback):
            return False

    async def controlled_report(_db):
        return _review_decision_report()

    monkeypatch.setattr(
        question_pool_maintenance,
        "AsyncSessionLocal",
        _NoDatabaseSession,
    )
    monkeypatch.setattr(
        question_pool_maintenance,
        "build_report",
        controlled_report,
    )

    exit_code = question_pool_maintenance.main(
        [
            "report",
            "--decisions",
            str(decisions_path),
            "--output",
            str(output),
        ]
    )

    assert exit_code == 0
    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["summary"] == {
        "totalCount": 4,
        "keepCount": 2,
        "deleteCount": 2,
        "reviewCount": 0,
        "referenceCount": 7,
        "repairReferenceCount": 5,
        "preservedReferenceCount": 2,
    }
    assert payload["snapshotHash"] == "a" * 64
    assert payload["manifestHash"] != _review_decision_report().manifest_hash


def test_report_requires_import_action_and_committed_batch_to_be_the_same_trace():
    """Catch preservation caused by mixing unrelated provenance audit records."""

    suffix = uuid4().hex[:12]
    bank_id = f"cleanup-pair-bank-{suffix}"
    batch_id = f"cleanup-pair-batch-{suffix}"
    question_id = f"cleanup-pair-question-{suffix}"
    audit_ids = [f"cleanup-pair-a-{suffix}", f"cleanup-pair-b-{suffix}"]

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            try:
                db.add(
                    QuestionBank(
                        id=bank_id,
                        owner_id="admin",
                        name="导入证据配对测试题库",
                        subject="PMP",
                    )
                )
                await db.flush()
                db.add(
                    QuestionUploadBatch(
                        id=batch_id,
                        idempotency_key=f"cleanup-pair-idempotency-{suffix}",
                        bank_id=bank_id,
                        actor_username="admin",
                        actor_role="admin",
                        client_instance_id=f"cleanup-pair-client-{suffix}",
                        manifest_hash="b" * 64,
                        status="committed",
                    )
                )
                db.add(
                    Question(
                        id=question_id,
                        bank_id=bank_id,
                        title="不能拼接证据的题目",
                        content_metadata={"origin": "content_prep"},
                    )
                )
                await db.flush()
                db.add_all(
                    [
                        QuestionAuditLog(
                            id=audit_ids[0],
                            entity_type="question",
                            entity_id=question_id,
                            question_id=question_id,
                            bank_id=bank_id,
                            batch_id=None,
                            action="question_created",
                            actor_username="admin",
                            actor_role="admin",
                            outcome="success",
                            detail={},
                        ),
                        QuestionAuditLog(
                            id=audit_ids[1],
                            entity_type="question",
                            entity_id=question_id,
                            question_id=question_id,
                            bank_id=bank_id,
                            batch_id=batch_id,
                            action="unrelated_action",
                            actor_username="admin",
                            actor_role="admin",
                            outcome="success",
                            detail={},
                        ),
                    ]
                )
                await db.commit()

                report = await build_report(db)
                decision = next(
                    item
                    for item in [*report.keep, *report.delete, *report.review]
                    if item.question_id == question_id
                )
                assert decision.decision == "review"
            finally:
                await db.execute(
                    delete(QuestionAuditLog).where(
                        QuestionAuditLog.id.in_(audit_ids)
                    )
                )
                await db.execute(delete(Question).where(Question.id == question_id))
                await db.execute(
                    delete(QuestionUploadBatch).where(
                        QuestionUploadBatch.id == batch_id
                    )
                )
                await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
                await db.commit()

    asyncio.run(scenario())


def test_report_waits_for_teaching_writer_and_reads_one_committed_snapshot():
    """Catch a manifest assembled from states on opposite sides of one write."""

    suffix = uuid4().hex[:12]
    bank_id = f"cleanup-snapshot-bank-{suffix}"
    question_id = f"cleanup-snapshot-question-{suffix}"

    async def scenario() -> None:
        async with AsyncSessionLocal() as setup_db:
            setup_db.add(
                QuestionBank(
                    id=bank_id,
                    owner_id="admin",
                    name="一致快照测试题库",
                    subject="PMP",
                )
            )
            await setup_db.flush()
            setup_db.add(
                Question(
                    id=question_id,
                    bank_id=bank_id,
                    title="写入前",
                    content_metadata={"origin": "manual"},
                    revision=1,
                )
            )
            await setup_db.commit()

        async with AsyncSessionLocal() as baseline_db:
            baseline = await build_report(baseline_db)

        writer_locked = asyncio.Event()
        release_writer = asyncio.Event()

        async def writer() -> None:
            async with AsyncSessionLocal() as writer_db:
                await teaching_content_revision_service.acquire_lock(writer_db)
                question = await writer_db.get(Question, question_id)
                assert question is not None
                question.title = "写入后"
                question.revision = 2
                await writer_db.flush()
                writer_locked.set()
                await release_writer.wait()
                await writer_db.commit()

        async def reader():
            async with AsyncSessionLocal() as reader_db:
                return await build_report(reader_db)

        writer_task = asyncio.create_task(writer())
        await writer_locked.wait()
        reader_task = asyncio.create_task(reader())
        await asyncio.sleep(0.1)
        assert not reader_task.done(), "report must wait behind the teaching writer lock"
        release_writer.set()
        await writer_task
        observed = await reader_task
        assert observed.snapshot_hash != baseline.snapshot_hash

        async with AsyncSessionLocal() as cleanup_db:
            await cleanup_db.execute(
                delete(Question).where(Question.id == question_id)
            )
            await cleanup_db.execute(
                delete(QuestionBank).where(QuestionBank.id == bank_id)
            )
            await cleanup_db.commit()

    asyncio.run(scenario())


def test_report_hashes_malformed_runtime_json_without_inventing_references():
    """Catch crashes, false references, or hash collisions on a damaged draft row."""

    suffix = uuid4().hex[:12]
    key = f"kg_recall_association_library_v1__subject__broken-{suffix}"

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            try:
                db.add(
                    SharedRuntimeState(
                        key=key,
                        value='{"questionId":"not-a-real-ref"',
                        schema_version=1,
                        updated_by="admin",
                    )
                )
                await db.commit()
                first = await build_report(db)
                assert not any(row.storage_key == key for row in first.references)

                damaged = await db.get(SharedRuntimeState, key)
                assert damaged is not None
                damaged.value = '{"questionId":"not-a-real-ref"!'
                await db.commit()
                second = await build_report(db)
                assert second.snapshot_hash != first.snapshot_hash
                assert second.manifest_hash != first.manifest_hash
                assert not any(row.storage_key == key for row in second.references)
            finally:
                await db.execute(
                    delete(SharedRuntimeState).where(SharedRuntimeState.key == key)
                )
                await db.commit()

    asyncio.run(scenario())


def test_report_cli_writes_only_report_and_exits_two_when_review_is_required(tmp_path):
    """Catch a report command that mutates data or treats review rows as success."""

    suffix = uuid4().hex[:12]
    bank_id = f"cleanup-cli-bank-{suffix}"
    question_id = f"cleanup-cli-review-{suffix}"
    runtime_key = f"kg_recall_association_library_v1__subject__cli-{suffix}"
    runtime_value = json.dumps(
        {
            "schemaVersion": 1,
            "nodes": [
                {
                    "id": "cli-node",
                    "title": "CLI 节点",
                    "metadata": {"questionId": question_id},
                }
            ],
            "edges": [],
        },
        ensure_ascii=False,
    )
    output = tmp_path / "nested" / "report.json"

    async def insert_fixture() -> None:
        async with AsyncSessionLocal() as db:
            db.add(
                QuestionBank(
                    id=bank_id,
                    owner_id="admin",
                    name="CLI 清理报告测试题库",
                    subject="PMP",
                )
            )
            await db.flush()
            db.add(
                Question(
                    id=question_id,
                    bank_id=bank_id,
                    title="CLI 来源待确认题",
                    content_metadata={},
                    revision=7,
                )
            )
            db.add(
                SharedRuntimeState(
                    key=runtime_key,
                    value=runtime_value,
                    schema_version=1,
                    updated_by="admin",
                )
            )
            await db.commit()

    async def assert_unchanged() -> None:
        async with AsyncSessionLocal() as db:
            question = await db.get(Question, question_id)
            assert question is not None
            assert question.title == "CLI 来源待确认题"
            assert question.revision == 7
            runtime = await db.get(SharedRuntimeState, runtime_key)
            assert runtime is not None
            assert runtime.value == runtime_value
            assert runtime.schema_version == 1

    async def database_counts() -> tuple[int, ...]:
        async with AsyncSessionLocal() as db:
            models = (
                QuestionBank,
                Question,
                QuestionUploadBatch,
                QuestionAuditLog,
                ExamPaper,
                PaperQuestion,
                SharedRuntimeState,
            )
            counts = []
            for model in models:
                count = (
                    await db.execute(select(func.count()).select_from(model))
                ).scalar_one()
                counts.append(int(count))
            return tuple(counts)

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(
                delete(SharedRuntimeState).where(
                    SharedRuntimeState.key == runtime_key
                )
            )
            await db.execute(delete(Question).where(Question.id == question_id))
            await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await db.commit()

    asyncio.run(insert_fixture())
    before_counts = asyncio.run(database_counts())
    try:
        completed = subprocess.run(
            [
                sys.executable,
                "scripts/question_pool_maintenance.py",
                "report",
                "--output",
                str(output),
            ],
            cwd=Path(__file__).resolve().parents[1],
            check=False,
            capture_output=True,
            text=True,
        )

        assert completed.returncode == 2
        assert output.is_file()
        payload = json.loads(output.read_text(encoding="utf-8"))
        assert payload["policyVersion"] == "question-cleanup-v1"
        assert payload["summary"]["reviewCount"] >= 1
        assert question_id in {item["questionId"] for item in payload["review"]}
        assert payload["manifestHash"] in completed.stdout
        assert payload["snapshotHash"] in completed.stdout
        assert sorted(path for path in tmp_path.rglob("*") if path.is_file()) == [
            output
        ]
        asyncio.run(assert_unchanged())
        assert asyncio.run(database_counts()) == before_counts
    finally:
        asyncio.run(cleanup())


def test_cleanup_audit_rows_are_unique_by_manifest_and_database_append_only():
    """Catch duplicate success records or later UPDATE/DELETE of cleanup history."""

    suffix = uuid4().hex[:12]
    audit_id = f"cleanup-audit-immutable-{suffix}"
    manifest_hash = (suffix * 6)[:64].ljust(64, "a")
    now = datetime.now(timezone.utc)

    def audit_row(row_id: str) -> QuestionCleanupAudit:
        return QuestionCleanupAudit(
            id=row_id,
            manifest_hash=manifest_hash,
            snapshot_hash="b" * 64,
            actor_username="admin",
            backup_path=f"/tmp/{suffix}.dump",
            backup_sha256="c" * 64,
            total_count=3,
            retained_count=1,
            deleted_count=2,
            repaired_reference_count=4,
            preserved_reference_count=1,
            deleted_question_ids=["q-delete-a", "q-delete-b"],
            repair_summary={"runtimeKeys": ["kg_course_config_drafts_v1"]},
            teaching_revision=7,
            started_at=now,
            completed_at=now,
        )

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            db.add(audit_row(audit_id))
            await db.commit()

        async with AsyncSessionLocal() as duplicate_db:
            duplicate_db.add(audit_row(f"{audit_id}-duplicate"))
            with pytest.raises(IntegrityError):
                await duplicate_db.commit()
            await duplicate_db.rollback()

        async with AsyncSessionLocal() as update_db:
            with pytest.raises(Exception, match="append-only"):
                await update_db.execute(
                    update(QuestionCleanupAudit)
                    .where(QuestionCleanupAudit.id == audit_id)
                    .values(actor_username="teacher-a")
                )
                await update_db.commit()
            await update_db.rollback()

        async with AsyncSessionLocal() as delete_db:
            with pytest.raises(Exception, match="append-only"):
                await delete_db.execute(
                    delete(QuestionCleanupAudit).where(
                        QuestionCleanupAudit.id == audit_id
                    )
                )
                await delete_db.commit()
            await delete_db.rollback()

        async with AsyncSessionLocal() as verify_db:
            stored = await verify_db.get(QuestionCleanupAudit, audit_id)
            assert stored is not None
            assert stored.actor_username == "admin"
            assert stored.deleted_question_ids == ["q-delete-a", "q-delete-b"]

    asyncio.run(scenario())


def _resolve_all_test_review_rows(
    report: QuestionCleanupReport,
) -> QuestionCleanupReport:
    if not report.review:
        return report
    return apply_review_decisions(
        report,
        {
            "manifestHash": report.manifest_hash,
            "decisions": [
                {
                    "questionId": row.question_id,
                    "decision": "keep_formal_import",
                    "reason": "pytest 隔离：保留既有非本夹具数据",
                }
                for row in report.review
            ],
        },
    )


async def _create_cleanup_guard_fixture(
    *,
    origin: str | None,
    resolve_review: bool = True,
):
    suffix = uuid4().hex[:12]
    bank_id = f"cleanup-guard-bank-{suffix}"
    question_id = f"cleanup-guard-question-{suffix}"
    async with AsyncSessionLocal() as db:
        db.add(
            QuestionBank(
                id=bank_id,
                owner_id="admin",
                name="清理事务保护测试题库",
                subject="PMP",
            )
        )
        await db.flush()
        db.add(
            Question(
                id=question_id,
                bank_id=bank_id,
                title="待清理题目",
                domain="守卫领域",
                content_metadata=(
                    {"origin": origin} if origin is not None else {}
                ),
            )
        )
        await db.commit()
    async with AsyncSessionLocal() as report_db:
        report = await build_report(report_db)
    if resolve_review:
        report = _resolve_all_test_review_rows(report)
    return bank_id, question_id, report


async def _remove_cleanup_guard_fixture(bank_id: str, question_id: str) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(delete(Question).where(Question.id == question_id))
        await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
        await db.commit()


def _backup_receipt(path: Path, manifest_hash: str) -> QuestionCleanupBackupReceipt:
    import hashlib

    return QuestionCleanupBackupReceipt(
        path=str(path),
        sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
        confirmation=f"DELETE-QUESTION-POOL:{manifest_hash[:12]}",
    )


def test_apply_rejects_a_manifest_with_unresolved_review_rows(tmp_path):
    """Catch destructive apply proceeding while any provenance is ambiguous."""

    backup_path = tmp_path / "verified.dump"
    backup_path.write_bytes(b"disposable pytest backup")

    async def scenario() -> None:
        bank_id, question_id, report = await _create_cleanup_guard_fixture(
            origin=None,
            resolve_review=False,
        )
        try:
            assert report.summary.review_count >= 1
            async with AsyncSessionLocal() as db:
                with pytest.raises(QuestionCleanupApplyError, match="review"):
                    await apply_cleanup(
                        db,
                        report,
                        actor="admin",
                        backup_receipt=_backup_receipt(
                            backup_path,
                            report.manifest_hash,
                        ),
                    )
            async with AsyncSessionLocal() as verify_db:
                assert await verify_db.get(Question, question_id) is not None
                audit_count = (
                    await verify_db.execute(
                        select(func.count())
                        .select_from(QuestionCleanupAudit)
                        .where(
                            QuestionCleanupAudit.manifest_hash
                            == report.manifest_hash
                        )
                    )
                ).scalar_one()
                assert audit_count == 0
        finally:
            await _remove_cleanup_guard_fixture(bank_id, question_id)

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "receipt_mutation, expected_message",
    [
        ("missing", "backup"),
        ("hash", "SHA-256"),
        ("confirmation", "confirmation"),
    ],
)
def test_apply_rejects_invalid_backup_or_confirmation_guards(
    tmp_path,
    receipt_mutation,
    expected_message,
):
    """Catch bypass of any independent backup-receipt or typed-token guard."""

    backup_path = tmp_path / "verified.dump"
    backup_path.write_bytes(b"disposable pytest backup")

    async def scenario() -> None:
        bank_id, question_id, report = await _create_cleanup_guard_fixture(
            origin="manual"
        )
        try:
            receipt = _backup_receipt(backup_path, report.manifest_hash)
            if receipt_mutation == "missing":
                receipt.path = str(tmp_path / "absent.dump")
            elif receipt_mutation == "hash":
                receipt.sha256 = "f" * 64
            else:
                receipt.confirmation = "DELETE-QUESTION-POOL:wrong-token"

            async with AsyncSessionLocal() as db:
                with pytest.raises(
                    QuestionCleanupApplyError,
                    match=expected_message,
                ):
                    await apply_cleanup(
                        db,
                        report,
                        actor="admin",
                        backup_receipt=receipt,
                    )
            async with AsyncSessionLocal() as verify_db:
                assert await verify_db.get(Question, question_id) is not None
        finally:
            await _remove_cleanup_guard_fixture(bank_id, question_id)

    asyncio.run(scenario())


def test_apply_rechecks_the_locked_snapshot_before_deletion(tmp_path):
    """Catch apply trusting an approved report after live content has changed."""

    backup_path = tmp_path / "verified.dump"
    backup_path.write_bytes(b"disposable pytest backup")

    async def scenario() -> None:
        bank_id, question_id, report = await _create_cleanup_guard_fixture(
            origin="manual"
        )
        try:
            async with AsyncSessionLocal() as writer_db:
                question = await writer_db.get(Question, question_id)
                assert question is not None
                question.title = "审批报告生成后发生变化"
                question.revision += 1
                await writer_db.commit()

            async with AsyncSessionLocal() as apply_db:
                with pytest.raises(QuestionCleanupApplyError, match="snapshot"):
                    await apply_cleanup(
                        apply_db,
                        report,
                        actor="admin",
                        backup_receipt=_backup_receipt(
                            backup_path,
                            report.manifest_hash,
                        ),
                    )

            async with AsyncSessionLocal() as verify_db:
                question = await verify_db.get(Question, question_id)
                assert question is not None
                assert question.title == "审批报告生成后发生变化"
        finally:
            await _remove_cleanup_guard_fixture(bank_id, question_id)

    asyncio.run(scenario())


def test_apply_fails_closed_on_malformed_managed_runtime_json(tmp_path):
    """Catch deletion leaving an unreadable current draft or unknown history link."""

    backup_path = tmp_path / "verified.dump"
    backup_path.write_bytes(b"disposable pytest backup")

    async def scenario() -> None:
        bank_id, question_id, _ = await _create_cleanup_guard_fixture(
            origin="manual"
        )
        runtime_key = (
            "kg_recall_association_library_v1__subject__malformed-"
            f"{uuid4().hex[:10]}"
        )
        malformed_value = f'{{"questionId":"{question_id}"'
        try:
            async with AsyncSessionLocal() as setup_db:
                setup_db.add(
                    SharedRuntimeState(
                        key=runtime_key,
                        value=malformed_value,
                        updated_by="admin",
                    )
                )
                await setup_db.commit()
            async with AsyncSessionLocal() as report_db:
                report = _resolve_all_test_review_rows(
                    await build_report(report_db)
                )
            async with AsyncSessionLocal() as revision_db:
                revision_before = int(
                    (
                        await teaching_content_revision_service.current(
                            revision_db
                        )
                    )["revision"]
                )

            async with AsyncSessionLocal() as apply_db:
                with pytest.raises(QuestionCleanupApplyError, match="malformed"):
                    await apply_cleanup(
                        apply_db,
                        report,
                        actor="admin",
                        backup_receipt=_backup_receipt(
                            backup_path,
                            report.manifest_hash,
                        ),
                    )
                assert not apply_db.in_transaction()

            async with AsyncSessionLocal() as verify_db:
                assert await verify_db.get(Question, question_id) is not None
                runtime = await verify_db.get(SharedRuntimeState, runtime_key)
                assert runtime is not None
                assert runtime.value == malformed_value
                revision = await teaching_content_revision_service.current(verify_db)
                assert revision["revision"] == revision_before
                audit_count = (
                    await verify_db.execute(
                        select(func.count())
                        .select_from(QuestionCleanupAudit)
                        .where(
                            QuestionCleanupAudit.manifest_hash
                            == report.manifest_hash
                        )
                    )
                ).scalar_one()
                assert audit_count == 0
        finally:
            async with AsyncSessionLocal() as cleanup_db:
                await cleanup_db.execute(
                    delete(SharedRuntimeState).where(
                        SharedRuntimeState.key == runtime_key
                    )
                )
                await cleanup_db.commit()
            await _remove_cleanup_guard_fixture(bank_id, question_id)

    asyncio.run(scenario())


def test_apply_rejects_a_self_hashed_manifest_with_duplicate_target_ids(tmp_path):
    """Catch a maliciously rehashed report deleting a non-closed target set."""

    backup_path = tmp_path / "verified.dump"
    backup_path.write_bytes(b"disposable pytest backup")

    async def scenario() -> None:
        bank_id, question_id, report = await _create_cleanup_guard_fixture(
            origin="manual"
        )
        try:
            forged = report.model_copy(deep=True)
            forged.delete.append(forged.delete[0].model_copy(deep=True))
            forged.summary.delete_count += 1
            forged.summary.total_count += 1
            forged.manifest_hash = calculate_manifest_hash(forged)
            async with AsyncSessionLocal() as db:
                with pytest.raises(QuestionCleanupApplyError, match="duplicate"):
                    await apply_cleanup(
                        db,
                        forged,
                        actor="admin",
                        backup_receipt=_backup_receipt(
                            backup_path,
                            forged.manifest_hash,
                        ),
                    )
            async with AsyncSessionLocal() as verify_db:
                assert await verify_db.get(Question, question_id) is not None
        finally:
            await _remove_cleanup_guard_fixture(bank_id, question_id)

    asyncio.run(scenario())


@pytest.mark.parametrize(
    ("forgery", "expected_message"),
    [
        ("keep_to_delete", "classification"),
        ("omit_keep", "closed"),
        ("omit_reference", "references"),
    ],
)
def test_apply_rejects_self_hashed_classification_or_reference_forgery(
    tmp_path,
    forgery,
    expected_message,
):
    """Catch a rehashed manifest overriding the locked automatic report."""

    backup_path = tmp_path / "verified.dump"
    backup_path.write_bytes(b"restorable disposable pytest backup")

    async def scenario() -> None:
        fixture = await _create_cleanup_apply_fixture()
        report = fixture["report"]
        assert isinstance(report, QuestionCleanupReport)
        forged = report.model_copy(deep=True)
        try:
            if forgery == "keep_to_delete":
                formal = next(
                    row
                    for row in forged.keep
                    if row.question_id == fixture["keep_id"]
                )
                forged.keep.remove(formal)
                formal.decision = "delete_non_imported"
                forged.delete.append(formal)
                forged.delete.sort(key=lambda row: row.question_id)
                forged.summary.keep_count -= 1
                forged.summary.delete_count += 1
            elif forgery == "omit_keep":
                forged.keep = [
                    row
                    for row in forged.keep
                    if row.question_id != fixture["keep_id"]
                ]
                forged.summary.keep_count -= 1
                forged.summary.total_count -= 1
            else:
                omitted = forged.references.pop()
                forged.summary.reference_count -= 1
                if omitted.repair_action == "remove_question_and_recalculate":
                    forged.summary.repair_reference_count -= 1
                else:
                    forged.summary.preserved_reference_count -= 1
            forged.manifest_hash = calculate_manifest_hash(forged)

            async with AsyncSessionLocal() as apply_db:
                with pytest.raises(
                    QuestionCleanupApplyError,
                    match=expected_message,
                ):
                    await apply_cleanup(
                        apply_db,
                        forged,
                        actor="admin",
                        backup_receipt=_backup_receipt(
                            backup_path,
                            forged.manifest_hash,
                        ),
                    )
            async with AsyncSessionLocal() as verify_db:
                assert await verify_db.get(
                    Question,
                    fixture["keep_id"],
                ) is not None
        finally:
            await _remove_cleanup_apply_fixture(fixture)

    asyncio.run(scenario())


async def _create_cleanup_apply_fixture() -> dict[str, object]:
    suffix = uuid4().hex[:10]
    main_bank_id = f"cleanup-main-{suffix}"
    empty_bank_id = f"cleanup-empty-{suffix}"
    historical_bank_id = f"cleanup-history-{suffix}"
    bank_only_history_id = f"cleanup-bank-only-{suffix}"
    keep_id = f"cleanup-keep-{suffix}"
    delete_id = f"cleanup-delete-{suffix}"
    empty_delete_id = f"cleanup-empty-q-{suffix}"
    historical_delete_id = f"cleanup-history-q-{suffix}"
    bank_only_delete_id = f"cleanup-bank-only-q-{suffix}"
    batch_id = f"cleanup-batch-{suffix}"
    test_batch_id = f"cleanup-test-batch-{suffix}"
    paper_id = f"cleanup-paper-{suffix}"
    audit_ids = [
        f"cleanup-log-keep-{suffix}",
        f"cleanup-log-delete-{suffix}",
        f"cleanup-log-test-batch-{suffix}",
    ]
    runtime_keys = [
        "kg_exam_papers_v1__teacher_shared",
        "kg_course_config_drafts_v1",
        "kg_learning_tasks_v1",
        "kg_principle_repository_v1",
        "kg_assessment_papers_v1",
        "kg_exam_papers_published_v1",
        "kg_course_config_releases_v1",
        f"kg_recall_association_library_v1__subject__apply-{suffix}",
    ]
    now = datetime.now(timezone.utc)
    published_task = {
        "id": f"published-task-{suffix}",
        "status": "published",
        "config": {"questionIds": [delete_id]},
    }
    archived_published_task = {
        "id": f"archived-published-task-{suffix}",
        "status": "archived",
        "publishedAt": "2026-08-01T08:00:00Z",
        "config": {"questionIds": [delete_id]},
    }
    runtime_payloads: dict[str, object] = {
        "kg_exam_papers_v1__teacher_shared": [
            {
                "id": f"runtime-paper-{suffix}",
                "questions": [
                    {"questionId": keep_id, "domain": "保留领域"},
                    {"questionId": delete_id, "domain": "淘汰领域"},
                ],
                "totalCount": 2,
                "questionCount": 2,
                "quotas": {"保留领域": 1, "淘汰领域": 1},
            }
        ],
        "kg_course_config_drafts_v1": [
            {
                "id": f"draft-course-{suffix}",
                "nodes": [
                    {
                        "id": f"draft-node-{suffix}",
                        "questionIds": [keep_id, delete_id],
                    }
                ],
            }
        ],
        "kg_learning_tasks_v1": [
            {
                "id": f"draft-task-{suffix}",
                "status": "draft",
                "config": {"questionIds": [keep_id, delete_id]},
            },
            published_task,
            archived_published_task,
            {
                "id": f"archived-draft-task-{suffix}",
                "status": "archived",
                "publishedAt": "",
                "config": {"questionIds": [keep_id, delete_id]},
            },
        ],
        "kg_principle_repository_v1": {
            "schemaVersion": 1,
            "items": [
                {
                    "id": f"principle-{suffix}",
                    "metadata": {"questionId": delete_id},
                }
            ],
        },
        "kg_assessment_papers_v1": [
            {
                "id": f"assessment-{suffix}",
                "items": [{"metadata": {"questionId": delete_id}}],
            }
        ],
        "kg_exam_papers_published_v1": [
            {
                "releaseId": f"published-release-{suffix}",
                "paperId": f"published-paper-{suffix}",
                "questions": [
                    {"bankId": main_bank_id, "questionId": delete_id},
                    {
                        "bankId": historical_bank_id,
                        "questionId": historical_delete_id,
                    },
                ],
                "detachedBankSnapshot": {
                    "bankId": bank_only_history_id,
                    "title": "仅保留题库标识的冻结快照",
                },
            }
        ],
        "kg_course_config_releases_v1": [
            {
                "id": f"course-release-{suffix}",
                "course": {"questionIds": [delete_id]},
            }
        ],
        runtime_keys[-1]: {
            "schemaVersion": 1,
            "nodes": [
                {
                    "id": f"association-node-{suffix}",
                    "metadata": {"questionIds": [keep_id, delete_id]},
                }
            ],
            "edges": [],
        },
    }
    published_task_raw = json.dumps(
        published_task,
        ensure_ascii=False,
        separators=(", ", ": "),
    )
    archived_published_task_raw = json.dumps(
        archived_published_task,
        ensure_ascii=False,
        indent=3,
    )
    learning_task_rows = runtime_payloads["kg_learning_tasks_v1"]
    runtime_values = {
        key: (
            json.dumps(value, ensure_ascii=False, indent=2)
            if key == "kg_exam_papers_published_v1"
            else "["
            + ",".join(
                [
                    json.dumps(
                        learning_task_rows[0],
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ),
                    published_task_raw,
                    archived_published_task_raw,
                    json.dumps(
                        learning_task_rows[3],
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ),
                ]
            )
            + "]"
            if key == "kg_learning_tasks_v1"
            else json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        )
        for key, value in runtime_payloads.items()
    }

    async with AsyncSessionLocal() as db:
        await db.execute(
            delete(SharedRuntimeState).where(
                SharedRuntimeState.key.in_(runtime_keys)
            )
        )
        db.add_all(
            [
                QuestionBank(
                    id=main_bank_id,
                    owner_id="admin",
                    name="保留正式导入题库",
                    subject="PMP",
                ),
                QuestionBank(
                    id=bank_only_history_id,
                    owner_id="admin",
                    name="仅题库标识历史依赖",
                    subject="PMP",
                ),
                QuestionBank(
                    id=empty_bank_id,
                    owner_id="admin",
                    name="清理后空题库",
                    subject="PMP",
                ),
                QuestionBank(
                    id=historical_bank_id,
                    owner_id="admin",
                    name="历史快照依赖题库",
                    subject="PMP",
                ),
            ]
        )
        await db.flush()
        db.add_all(
            [QuestionUploadBatch(
                id=batch_id,
                idempotency_key=f"cleanup-apply-{suffix}",
                bank_id=main_bank_id,
                actor_username="admin",
                actor_role="admin",
                client_instance_id=f"cleanup-client-{suffix}",
                manifest_hash="d" * 64,
                status="committed",
            ),
            QuestionUploadBatch(
                id=test_batch_id,
                idempotency_key=f"cleanup-test-apply-{suffix}",
                bank_id=empty_bank_id,
                actor_username="admin",
                actor_role="admin",
                client_instance_id=f"cleanup-test-client-{suffix}",
                manifest_hash="f" * 64,
                status="committed",
            )]
        )
        db.add_all(
            [
                Question(
                    id=keep_id,
                    bank_id=main_bank_id,
                    title="正式导入保留题",
                    domain="保留领域",
                    content_metadata={"origin": "content_prep"},
                ),
                Question(
                    id=delete_id,
                    bank_id=main_bank_id,
                    title="手工临时题",
                    domain="淘汰领域",
                    content_metadata={"origin": "manual"},
                ),
                Question(
                    id=bank_only_delete_id,
                    bank_id=bank_only_history_id,
                    title="仅题库标识历史依赖临时题",
                    domain="历史领域",
                    content_metadata={"origin": "manual"},
                ),
                Question(
                    id=empty_delete_id,
                    bank_id=empty_bank_id,
                    title="空题库临时题",
                    domain="空题库领域",
                    content_metadata={"origin": "manual"},
                ),
                Question(
                    id=historical_delete_id,
                    bank_id=historical_bank_id,
                    title="历史快照临时题",
                    domain="历史领域",
                    content_metadata={"origin": "manual"},
                ),
            ]
        )
        await db.flush()
        db.add_all(
            [
                QuestionAuditLog(
                    id=audit_ids[0],
                    entity_type="question",
                    entity_id=keep_id,
                    question_id=keep_id,
                    bank_id=main_bank_id,
                    batch_id=batch_id,
                    action="question_created",
                    actor_username="admin",
                    actor_role="admin",
                    outcome="success",
                    detail={},
                ),
                QuestionAuditLog(
                    id=audit_ids[2],
                    entity_type="question",
                    entity_id=empty_delete_id,
                    question_id=empty_delete_id,
                    bank_id=empty_bank_id,
                    batch_id=test_batch_id,
                    action="question_created",
                    actor_username="admin",
                    actor_role="admin",
                    outcome="success",
                    detail={"testFixture": True},
                ),
                QuestionAuditLog(
                    id=audit_ids[1],
                    entity_type="question",
                    entity_id=delete_id,
                    question_id=delete_id,
                    bank_id=main_bank_id,
                    action="manual_edit",
                    actor_username="admin",
                    actor_role="admin",
                    outcome="success",
                    detail={},
                ),
            ]
        )
        db.add(
            QuestionEditLock(
                question_id=delete_id,
                locked_by="admin",
                client_instance_id=f"cleanup-lock-{suffix}",
                token_hash="e" * 64,
                acquired_at=now,
                heartbeat_at=now,
                expires_at=now,
            )
        )
        db.add_all(
            [
                TrainingProgress(
                    id=f"cleanup-training-{suffix}",
                    owner_id="admin",
                    question_id=delete_id,
                    bank_id=main_bank_id,
                ),
                RecallProgress(
                    owner_id="admin",
                    question_id=delete_id,
                ),
                LearningEvent(
                    id=f"cleanup-event-{suffix}",
                    owner_id="admin",
                    question_id=delete_id,
                    event_type="answer",
                    payload={},
                ),
            ]
        )
        db.add(
            ExamPaper(
                id=paper_id,
                owner_id="admin",
                name="待修复关系型试卷",
                total_count=2,
                quotas={"保留领域": 1, "淘汰领域": 1},
                revision=5,
            )
        )
        await db.flush()
        db.add_all(
            [
                PaperQuestion(
                    paper_id=paper_id,
                    question_id=keep_id,
                    order_index=0,
                ),
                PaperQuestion(
                    paper_id=paper_id,
                    question_id=delete_id,
                    order_index=1,
                ),
            ]
        )
        db.add_all(
            [
                SharedRuntimeState(
                    key=key,
                    value=runtime_values[key],
                    schema_version=1,
                    updated_by="admin",
                )
                for key in runtime_keys
            ]
        )
        await db.commit()

    async with AsyncSessionLocal() as revision_db:
        revision_before = int(
            (await teaching_content_revision_service.current(revision_db))["revision"]
        )
    async with AsyncSessionLocal() as report_db:
        report = await build_report(report_db)
    report = _resolve_all_test_review_rows(report)
    assert report.summary.review_count == 0
    return {
        "suffix": suffix,
        "main_bank_id": main_bank_id,
        "empty_bank_id": empty_bank_id,
        "historical_bank_id": historical_bank_id,
        "bank_only_history_id": bank_only_history_id,
        "keep_id": keep_id,
        "delete_id": delete_id,
        "empty_delete_id": empty_delete_id,
        "historical_delete_id": historical_delete_id,
        "bank_only_delete_id": bank_only_delete_id,
        "batch_id": batch_id,
        "test_batch_id": test_batch_id,
        "paper_id": paper_id,
        "audit_ids": audit_ids,
        "runtime_keys": runtime_keys,
        "runtime_values": runtime_values,
        "published_task": published_task,
        "archived_published_task": archived_published_task,
        "published_task_raw": published_task_raw,
        "archived_published_task_raw": archived_published_task_raw,
        "revision_before": revision_before,
        "report": report,
    }


async def _remove_cleanup_apply_fixture(fixture: dict[str, object]) -> None:
    question_ids = [
        str(fixture[key])
        for key in (
            "keep_id",
            "delete_id",
            "empty_delete_id",
            "historical_delete_id",
            "bank_only_delete_id",
        )
    ]
    bank_ids = [
        str(fixture[key])
        for key in (
            "main_bank_id",
            "empty_bank_id",
            "historical_bank_id",
            "bank_only_history_id",
        )
    ]
    async with AsyncSessionLocal() as db:
        await db.execute(
            delete(TrainingProgress).where(
                TrainingProgress.question_id.in_(question_ids)
            )
        )
        await db.execute(
            delete(RecallProgress).where(RecallProgress.question_id.in_(question_ids))
        )
        await db.execute(
            delete(LearningEvent).where(LearningEvent.question_id.in_(question_ids))
        )
        await db.execute(
            delete(QuestionEditLock).where(
                QuestionEditLock.question_id.in_(question_ids)
            )
        )
        await db.execute(
            delete(QuestionAuditLog).where(
                QuestionAuditLog.id.in_(fixture["audit_ids"])
            )
        )
        await db.execute(
            delete(PaperQuestion).where(
                PaperQuestion.paper_id == fixture["paper_id"]
            )
        )
        await db.execute(
            delete(ExamPaper).where(ExamPaper.id == fixture["paper_id"])
        )
        await db.execute(delete(Question).where(Question.id.in_(question_ids)))
        await db.execute(
            delete(QuestionUploadBatch).where(
                QuestionUploadBatch.id.in_(
                    [fixture["batch_id"], fixture["test_batch_id"]]
                )
            )
        )
        await db.execute(
            delete(QuestionBank).where(QuestionBank.id.in_(bank_ids))
        )
        await db.execute(
            delete(SharedRuntimeState).where(
                SharedRuntimeState.key.in_(fixture["runtime_keys"])
            )
        )
        await db.commit()


def test_apply_repairs_current_references_preserves_history_and_audits_once(tmp_path):
    """Catch partial cleanup, historical rewrites, or multiple revision bumps."""

    backup_path = tmp_path / "verified.dump"
    backup_path.write_bytes(b"restorable disposable pytest backup")

    async def scenario() -> None:
        fixture = await _create_cleanup_apply_fixture()
        report = fixture["report"]
        assert isinstance(report, QuestionCleanupReport)
        try:
            async with AsyncSessionLocal() as apply_db:
                result = await apply_cleanup(
                    apply_db,
                    report,
                    actor="admin",
                    backup_receipt=_backup_receipt(
                        backup_path,
                        report.manifest_hash,
                    ),
                )

            expected_deleted = sorted(
                [
                    str(fixture["delete_id"]),
                    str(fixture["empty_delete_id"]),
                    str(fixture["historical_delete_id"]),
                    str(fixture["bank_only_delete_id"]),
                ]
            )
            assert result.deleted_question_ids == expected_deleted
            assert result.teaching_revision == int(fixture["revision_before"]) + 1

            async with AsyncSessionLocal() as verify_db:
                assert await verify_db.get(Question, fixture["keep_id"]) is not None
                for question_id in expected_deleted:
                    assert await verify_db.get(Question, question_id) is None

                paper = await verify_db.get(ExamPaper, fixture["paper_id"])
                assert paper is not None
                assert paper.total_count == 1
                assert paper.quotas == {"保留领域": 1}
                assert paper.revision == 6
                links = (
                    await verify_db.execute(
                        select(PaperQuestion)
                        .where(PaperQuestion.paper_id == fixture["paper_id"])
                        .order_by(PaperQuestion.order_index)
                    )
                ).scalars().all()
                assert [link.question_id for link in links] == [fixture["keep_id"]]
                assert links[0].order_index == 0

                current_paper_row = await verify_db.get(
                    SharedRuntimeState,
                    "kg_exam_papers_v1__teacher_shared",
                )
                current_paper = json.loads(current_paper_row.value)[0]
                assert [
                    row["questionId"] for row in current_paper["questions"]
                ] == [fixture["keep_id"]]
                assert current_paper["totalCount"] == 1
                assert current_paper["questionCount"] == 1
                assert current_paper["quotas"] == {"保留领域": 1}

                course_row = await verify_db.get(
                    SharedRuntimeState,
                    "kg_course_config_drafts_v1",
                )
                assert json.loads(course_row.value)[0]["nodes"][0][
                    "questionIds"
                ] == [fixture["keep_id"]]

                tasks_row = await verify_db.get(
                    SharedRuntimeState,
                    "kg_learning_tasks_v1",
                )
                tasks = {
                    row["id"]: row for row in json.loads(tasks_row.value)
                }
                assert tasks[f"draft-task-{fixture['suffix']}"]["config"][
                    "questionIds"
                ] == [fixture["keep_id"]]
                assert tasks[f"archived-draft-task-{fixture['suffix']}"][
                    "config"
                ]["questionIds"] == [fixture["keep_id"]]
                assert tasks[f"published-task-{fixture['suffix']}"] == fixture[
                    "published_task"
                ]
                assert tasks[
                    f"archived-published-task-{fixture['suffix']}"
                ] == fixture["archived_published_task"]
                assert fixture["published_task_raw"] in tasks_row.value
                assert fixture["archived_published_task_raw"] in tasks_row.value

                published_row = await verify_db.get(
                    SharedRuntimeState,
                    "kg_exam_papers_published_v1",
                )
                assert published_row.value == fixture["runtime_values"][
                    "kg_exam_papers_published_v1"
                ]
                published_course_row = await verify_db.get(
                    SharedRuntimeState,
                    "kg_course_config_releases_v1",
                )
                assert published_course_row.value == fixture["runtime_values"][
                    "kg_course_config_releases_v1"
                ]

                assert await verify_db.get(
                    QuestionBank,
                    fixture["empty_bank_id"],
                ) is None
                assert await verify_db.get(
                    QuestionUploadBatch,
                    fixture["test_batch_id"],
                ) is None
                assert await verify_db.get(
                    QuestionBank,
                    fixture["historical_bank_id"],
                ) is not None
                assert await verify_db.get(
                    QuestionBank,
                    fixture["bank_only_history_id"],
                ) is not None
                assert await verify_db.get(
                    QuestionEditLock,
                    fixture["delete_id"],
                ) is None
                for model in (TrainingProgress, RecallProgress, LearningEvent):
                    dependent_count = (
                        await verify_db.execute(
                            select(func.count())
                            .select_from(model)
                            .where(model.question_id == fixture["delete_id"])
                        )
                    ).scalar_one()
                    assert dependent_count == 0
                deleted_audit_count = (
                    await verify_db.execute(
                        select(func.count())
                        .select_from(QuestionAuditLog)
                        .where(
                            QuestionAuditLog.question_id
                            == fixture["delete_id"]
                        )
                    )
                ).scalar_one()
                assert deleted_audit_count == 0

                revision = await teaching_content_revision_service.current(verify_db)
                assert revision["revision"] == int(fixture["revision_before"]) + 1
                assert revision["changes"] == [
                    {
                        "entityType": "question_pool",
                        "entityId": report.manifest_hash,
                        "action": "cleanup",
                    }
                ]
                audit = await verify_db.get(QuestionCleanupAudit, result.audit_id)
                assert audit is not None
                assert audit.manifest_hash == report.manifest_hash
                assert audit.deleted_question_ids == expected_deleted
                assert audit.teaching_revision == revision["revision"]
                assert audit.repair_summary[
                    "publishedHistoricalReferences"
                ]

            async with AsyncSessionLocal() as second_db:
                with pytest.raises(QuestionCleanupApplyError, match="already"):
                    await apply_cleanup(
                        second_db,
                        report,
                        actor="admin",
                        backup_receipt=_backup_receipt(
                            backup_path,
                            report.manifest_hash,
                        ),
                    )
        finally:
            await _remove_cleanup_apply_fixture(fixture)

    asyncio.run(scenario())


def test_apply_rolls_back_repairs_deletes_audit_and_revision_on_failure(
    tmp_path,
    monkeypatch,
):
    """Catch a repair exception leaving any partial destructive state committed."""

    backup_path = tmp_path / "verified.dump"
    backup_path.write_bytes(b"restorable disposable pytest backup")

    async def scenario() -> None:
        fixture = await _create_cleanup_apply_fixture()
        report = fixture["report"]
        assert isinstance(report, QuestionCleanupReport)
        real_repair = question_cleanup_service.repair_current_question_references

        async def fail_after_real_repair(*args, **kwargs):
            await real_repair(*args, **kwargs)
            raise RuntimeError("injected repair failure")

        monkeypatch.setattr(
            question_cleanup_service,
            "repair_current_question_references",
            fail_after_real_repair,
        )
        try:
            async with AsyncSessionLocal() as apply_db:
                with pytest.raises(RuntimeError, match="injected repair failure"):
                    await apply_cleanup(
                        apply_db,
                        report,
                        actor="admin",
                        backup_receipt=_backup_receipt(
                            backup_path,
                            report.manifest_hash,
                        ),
                    )
                assert not apply_db.in_transaction()

            async with AsyncSessionLocal() as verify_db:
                for field in (
                    "keep_id",
                    "delete_id",
                    "empty_delete_id",
                    "historical_delete_id",
                    "bank_only_delete_id",
                ):
                    assert await verify_db.get(Question, fixture[field]) is not None
                for key, original in fixture["runtime_values"].items():
                    row = await verify_db.get(SharedRuntimeState, key)
                    assert row is not None
                    assert row.value == original
                paper = await verify_db.get(ExamPaper, fixture["paper_id"])
                assert paper is not None
                assert paper.total_count == 2
                assert paper.quotas == {"保留领域": 1, "淘汰领域": 1}
                assert paper.revision == 5
                revision = await teaching_content_revision_service.current(verify_db)
                assert revision["revision"] == fixture["revision_before"]
                audit_count = (
                    await verify_db.execute(
                        select(func.count())
                        .select_from(QuestionCleanupAudit)
                        .where(
                            QuestionCleanupAudit.manifest_hash
                            == report.manifest_hash
                        )
                    )
                ).scalar_one()
                assert audit_count == 0
        finally:
            monkeypatch.setattr(
                question_cleanup_service,
                "repair_current_question_references",
                real_repair,
            )
            await _remove_cleanup_apply_fixture(fixture)

    asyncio.run(scenario())


def test_apply_global_lock_blocks_official_writer_between_recheck_and_commit(
    tmp_path,
    monkeypatch,
):
    """Catch lock-order regressions that admit a Plan1 writer mid-cleanup."""

    backup_path = tmp_path / "verified.dump"
    backup_path.write_bytes(b"restorable disposable pytest backup")

    async def scenario() -> None:
        fixture = await _create_cleanup_apply_fixture()
        report = fixture["report"]
        assert isinstance(report, QuestionCleanupReport)
        repair_entered = asyncio.Event()
        release_repair = asyncio.Event()
        real_repair = question_cleanup_service.repair_current_question_references
        created_question_id: str | None = None

        async def pause_before_repair(*args, **kwargs):
            repair_entered.set()
            await release_repair.wait()
            return await real_repair(*args, **kwargs)

        monkeypatch.setattr(
            question_cleanup_service,
            "repair_current_question_references",
            pause_before_repair,
        )
        try:
            async def cleanup_task():
                async with AsyncSessionLocal() as apply_db:
                    return await apply_cleanup(
                        apply_db,
                        report,
                        actor="admin",
                        backup_receipt=_backup_receipt(
                            backup_path,
                            report.manifest_hash,
                        ),
                    )

            async def official_writer():
                async with AsyncSessionLocal() as writer_db:
                    return await question_service.create_question(
                        writer_db,
                        "admin",
                        str(fixture["main_bank_id"]),
                        {
                            "title": "清理锁释放后写入",
                            "domain": "保留领域",
                            "metadata": {"origin": "manual"},
                        },
                    )

            apply_task = asyncio.create_task(cleanup_task())
            await asyncio.wait_for(repair_entered.wait(), timeout=5)
            writer_task = asyncio.create_task(official_writer())
            await asyncio.sleep(0.1)
            assert not writer_task.done(), (
                "official teaching writer must wait for cleanup's global lock"
            )
            release_repair.set()
            await apply_task
            created = await asyncio.wait_for(writer_task, timeout=5)
            assert created is not None
            created_question_id = str(created.id)
        finally:
            release_repair.set()
            monkeypatch.setattr(
                question_cleanup_service,
                "repair_current_question_references",
                real_repair,
            )
            if created_question_id is not None:
                async with AsyncSessionLocal() as cleanup_db:
                    await cleanup_db.execute(
                        delete(Question).where(Question.id == created_question_id)
                    )
                    await cleanup_db.commit()
            await _remove_cleanup_apply_fixture(fixture)

    asyncio.run(scenario())


def test_cleanup_lock_contract_uses_the_plan1_global_writer_lock():
    """Catch cleanup's advisory lock diverging from every official writer."""

    async def scenario() -> None:
        bank_id, question_id, _ = await _create_cleanup_guard_fixture(
            origin="manual"
        )
        created_question_id: str | None = None
        writer_task = None
        try:
            async with AsyncSessionLocal() as cleanup_db:
                await teaching_content_revision_service.acquire_cleanup_lock(
                    cleanup_db
                )

                async def official_writer():
                    async with AsyncSessionLocal() as writer_db:
                        return await question_service.create_question(
                            writer_db,
                            "admin",
                            bank_id,
                            {
                                "title": "全局锁契约写入",
                                "metadata": {"origin": "manual"},
                            },
                        )

                writer_task = asyncio.create_task(official_writer())
                await asyncio.sleep(0.1)
                assert not writer_task.done(), (
                    "cleanup lock must include the shared teaching writer lock"
                )
                await cleanup_db.rollback()
                created = await asyncio.wait_for(writer_task, timeout=5)
                assert created is not None
                created_question_id = str(created.id)
        finally:
            if (
                created_question_id is None
                and writer_task is not None
            ):
                created = await asyncio.wait_for(writer_task, timeout=5)
                if created is not None:
                    created_question_id = str(created.id)
            if created_question_id is not None:
                async with AsyncSessionLocal() as cleanup_db:
                    await cleanup_db.execute(
                        delete(Question).where(Question.id == created_question_id)
                    )
                    await cleanup_db.commit()
            await _remove_cleanup_guard_fixture(bank_id, question_id)

    asyncio.run(scenario())
