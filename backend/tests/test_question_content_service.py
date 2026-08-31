from copy import deepcopy

import pytest
from pydantic import ValidationError

from app.schemas.content_prep import (
    CatalogError,
    ContentPrepBatchRequest,
    ContentPrepBatchResult,
    LockGrant,
)
from app.schemas.question_catalog import QuestionPayload
from app.services.content_prep_service import _validate_question_content
from app.services.question_content_service import (
    canonical_question_hash,
    normalize_question_metadata,
    normalize_question_payload,
    normalize_scope,
)


def complete_question() -> dict:
    return {
        "id": "d4818d33-2ede-4db4-9374-7debd9222f81",
        "title": "已发送不等于已沟通",
        "type": "single_choice",
        "subject": "PMP",
        "difficulty": "基础",
        "domain": "沟通绩效域",
        "topic": "项目沟通管理的概念",
        "tags": ["基础练习", "核心题", "自编题", "内部使用"],
        "stage": "基础练习",
        "stemParts": [{"text": "项目经理首先应该认识到什么？"}],
        "options": [
            {"id": "A", "text": "发送即完成", "trap": "发送等于沟通", "correct": False},
            {"id": "B", "text": "确认接收和理解", "trap": "", "correct": True},
        ],
        "correctAnswer": "B",
        "analysis": "有效沟通需要反馈闭环。",
        "translations": {
            "en": {
                "title": "Sent Does Not Mean Understood",
                "stemParts": [{"text": "What should the project manager recognize?"}],
                "options": [
                    {"id": "A", "text": "Sending is enough"},
                    {"id": "B", "text": "Confirm receipt and understanding"},
                ],
                "analysis": "Effective communication requires feedback.",
                "optionFeedback": {"A": "Incorrect", "B": "Correct"},
            }
        },
        "clues": [
            {
                "id": "kw-001",
                "text": "首先",
                "keywordLevel": "core",
                "recallNodeId": "recall-action-order",
                "conceptIds": ["kp-communication"],
                "matchLocations": [{"field": "stem", "optionId": "", "count": 1}],
            }
        ],
        "concepts": [
            {
                "id": "kp-communication",
                "title": "项目沟通管理的概念",
                "rule": "确认接收、理解和行动。",
            }
        ],
        "reasoningSteps": [
            {
                "id": "rs-1",
                "title": "识别线索",
                "content": "首先表示优先判断。",
                "relatedKeywords": ["首先"],
                "relatedKnowledgePoints": ["kp-communication"],
            }
        ],
        "keyPath": {
            "label": "沟通有效性 → 反馈确认 → B",
            "clueIds": ["kw-001"],
            "conceptIds": ["kp-communication"],
            "answerId": "B",
        },
        "metadata": {
            "translationStatus": "bilingual",
            "knowledge": {
                "primaryNodeId": "kp-communication",
                "relatedNodeIds": [],
                "mappingStatus": "confirmed",
                "pathSnapshot": ["PMP", "人", "沟通"],
            },
            "principleIds": ["principle-effective-communication"],
            "optionPrincipleMap": {"A": [], "B": ["principle-effective-communication"]},
            "tagPaths": [
                {
                    "groupId": "source",
                    "categoryId": "scope",
                    "label": "内部使用",
                }
            ],
            "keywordSystemV2": {
                "schemaVersion": 2,
                "keywords": [{"clueId": "kw-001", "keywordLevel": "core"}],
            },
            "origin": {
                "creatorId": "creator_001",
                "deviceId": "device-local",
                "batchId": "batch-local",
                "createdAt": "2026-08-09T00:00:00Z",
            },
        },
        "status": {
            "contentReady": True,
            "keywordsReady": True,
            "knowledgeReady": True,
            "reasoningReady": True,
            "published": False,
        },
        "lifecycle": {"status": "active", "deletedAt": ""},
        "teacherNumber": "PMP-001",
        "explanation": "有效沟通需要反馈闭环。",
    }


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ({"tags": ["可公开"]}, "public"),
        ({"metadata": {"tagPaths": [{"categoryId": "scope", "label": "可公开"}]}}, "public"),
        ({"scope": "public"}, "public"),
        ({"tags": ["内部使用"]}, "internal"),
        ({"tags": ["可公开", "内部使用"]}, "internal"),
        ({"scope": "public", "metadata": {"tagPaths": [{"label": "内部使用"}]}}, "internal"),
        ({}, "internal"),
        ({"scope": "unrecognized"}, "internal"),
    ],
)
def test_scope_normalization_enforces_internal_precedence(payload: dict, expected: str) -> None:
    assert normalize_scope(payload) == expected


def test_question_normalization_preserves_the_complete_prep_contract() -> None:
    raw = complete_question()

    normalized = normalize_question_payload(raw, subject="PMP")

    assert normalized["id"] == raw["id"]
    assert normalized["scope"] == "internal"
    assert normalized["translations"] == raw["translations"]
    assert normalized["metadata"]["stemPrincipleIds"] == [
        "principle-effective-communication"
    ]
    assert normalized["metadata"]["optionPrincipleMap"] == raw["metadata"][
        "optionPrincipleMap"
    ]
    assert normalized["metadata"]["principleIds"] == raw["metadata"]["principleIds"]
    assert normalized["keyPath"] == raw["keyPath"]
    assert normalized["clues"] == raw["clues"]
    assert normalized["concepts"] == raw["concepts"]
    assert normalized["reasoningSteps"] == raw["reasoningSteps"]
    assert normalized["lifecycle"] == raw["lifecycle"]
    assert normalized["stage"] == "基础练习"
    assert normalized["explanation"] == raw["explanation"]


def test_question_metadata_separates_stem_bindings_and_derives_search_union() -> None:
    metadata = normalize_question_metadata(
        {
            "stemPrincipleIds": ["principle-stem", "principle-stem", ""],
            "principleIds": ["stale-index-value"],
            "optionPrincipleMap": {
                "A": ["principle-trap", "principle-trap"],
                "B": ["principle-answer"],
                "Z": ["must-be-ignored"],
            },
        },
        option_ids={"A", "B"},
    )

    assert metadata["stemPrincipleIds"] == ["principle-stem"]
    assert metadata["optionPrincipleMap"] == {
        "A": ["principle-trap"],
        "B": ["principle-answer"],
    }
    assert metadata["principleIds"] == [
        "principle-stem",
        "principle-trap",
        "principle-answer",
    ]


def test_question_metadata_promotes_legacy_principles_to_stem_bindings() -> None:
    metadata = normalize_question_metadata(
        {"principleIds": ["principle-legacy", "principle-legacy"]},
        option_ids={"A", "B"},
    )

    assert metadata["stemPrincipleIds"] == ["principle-legacy"]
    assert metadata["optionPrincipleMap"] == {}
    assert metadata["principleIds"] == ["principle-legacy"]


def test_question_payload_round_trips_aliases_and_extension_fields() -> None:
    raw = complete_question()
    raw["futurePrepField"] = {"preserved": True}

    dumped = QuestionPayload.model_validate(raw).model_dump(by_alias=True)

    assert dumped["stemParts"] == raw["stemParts"]
    assert dumped["correctAnswer"] == "B"
    assert dumped["reasoningSteps"] == raw["reasoningSteps"]
    assert dumped["keyPath"] == raw["keyPath"]
    assert dumped["teacherNumber"] == "PMP-001"
    assert dumped["futurePrepField"] == {"preserved": True}


@pytest.mark.parametrize("correct_answer", ["AB", ["A", "B"]])
def test_content_prep_accepts_multiple_choice_answer_forms(correct_answer: object) -> None:
    raw = complete_question()
    raw["type"] = "multiple_choice"
    raw["correctAnswer"] = correct_answer
    raw["options"].append({"id": "C", "text": "错误选项", "correct": False})

    normalized = normalize_question_payload(raw, subject="PMP")

    assert normalized["correctAnswer"] is None
    assert normalized["correctOptionIds"] == ["A", "B"]
    assert _validate_question_content(normalized, is_new=True) == []


def test_multiple_choice_payload_preserves_canonical_answer_array() -> None:
    raw = complete_question()
    raw.update({
        "type": "multiple_choice",
        "options": [
            {"id": "A", "text": "A", "correct": True},
            {"id": "B", "text": "B", "correct": False},
            {"id": "C", "text": "C", "correct": True},
        ],
        "correctOptionIds": ["C", "A"],
        "correctAnswer": None,
    })

    normalized = normalize_question_payload(raw, subject="PMP")

    assert normalized["correctOptionIds"] == ["A", "C"]
    assert normalized["correctAnswer"] is None


def test_multiple_choice_hash_ignores_answer_array_order() -> None:
    first = complete_question()
    first.update({
        "type": "multiple_choice",
        "options": [
            {"id": "A", "text": "A"},
            {"id": "B", "text": "B"},
            {"id": "C", "text": "C"},
        ],
        "correctOptionIds": ["A", "C"],
        "correctAnswer": None,
    })
    reordered = deepcopy(first)
    reordered["correctOptionIds"] = ["C", "A"]

    assert canonical_question_hash(first) == canonical_question_hash(reordered)


def test_multiple_choice_draft_without_analysis_is_not_content_ready() -> None:
    raw = complete_question()
    raw.update({
        "type": "multiple_choice",
        "options": [
            {"id": "A", "text": "A"},
            {"id": "B", "text": "B"},
            {"id": "C", "text": "C"},
        ],
        "correctOptionIds": ["A", "C"],
        "correctAnswer": None,
        "analysis": "",
        "status": {"contentReady": True},
    })

    normalized = normalize_question_payload(raw, subject="PMP")

    assert normalized["status"]["contentReady"] is False


@pytest.mark.parametrize(
    ("question_type", "correct_answer"),
    [
        ("single_choice", ["B"]),
        ("multiple_choice", ["AB", "C"]),
        ("multiple_choice", ["A", "", "B"]),
    ],
)
def test_content_prep_rejects_noncanonical_answer_arrays(
    question_type: str,
    correct_answer: list[str],
) -> None:
    raw = complete_question()
    raw["type"] = question_type
    raw["correctAnswer"] = correct_answer
    raw["options"].append({"id": "C", "text": "继续", "correct": False})

    normalized = normalize_question_payload(raw, subject="PMP")
    issues = _validate_question_content(normalized, is_new=True)

    if question_type == "multiple_choice":
        assert normalized["correctAnswer"] is None
        assert normalized["correctOptionIds"] == []
    else:
        assert normalized["correctAnswer"] == correct_answer
    assert [issue.code for issue in issues] == ["CORRECT_ANSWER_MISSING"]


def test_hash_is_stable_across_key_order_identity_and_sync_metadata() -> None:
    original = complete_question()
    retried = {key: deepcopy(original[key]) for key in reversed(original)}
    retried.update({
        "id": "1c607d1c-d48b-41f8-a865-623b9ab12173",
        "questionId": "client-question-id",
        "contentHash": "forged-client-hash",
        "revision": 99,
        "serverRevision": 99,
        "serverContentHash": "stale-server-hash",
        "lastSyncedAt": "2099-01-01T00:00:00Z",
        "lockToken": "secret",
        "creatorId": "creator_006",
        "creatorName": "女帝",
        "sourceId": "reimported-question-id",
        "source_id": "legacy-source-question-id",
    })
    retried["metadata"]["origin"] = {
        "creatorId": "creator_006",
        "deviceId": "another-device",
        "batchId": "another-batch",
        "createdAt": "2099-01-01T00:00:00Z",
    }

    assert canonical_question_hash(original) == canonical_question_hash(retried)
    assert len(canonical_question_hash(original)) == 64


def test_hash_changes_when_any_meaningful_content_changes() -> None:
    original = complete_question()
    changed = deepcopy(original)
    changed["translations"]["en"]["analysis"] = "Changed English explanation."

    assert canonical_question_hash(original) != canonical_question_hash(changed)


def test_hash_treats_blank_optional_text_as_database_null() -> None:
    browser_payload = complete_question()
    database_payload = complete_question()
    for field in ("difficulty", "domain", "topic", "stage", "teacherNumber"):
        browser_payload[field] = ""
        database_payload[field] = None

    assert canonical_question_hash(browser_payload) == canonical_question_hash(database_payload)


def test_batch_schema_accepts_frontend_aliases_and_rejects_actor_spoofing() -> None:
    raw = {
        "idempotencyKey": "upload-001",
        "clientInstanceId": "browser-001",
        "targetBankId": "bank-001",
        "creatorId": "creator_001",
        "prepVersion": "0.4.0",
        "workspaceVersion": "1",
        "questions": [{"question": complete_question(), "baseRevision": None, "lockToken": None}],
        "principles": {"schemaVersion": 1, "items": []},
        "synthesisPresets": {"schemaVersion": 1, "items": []},
        "tagConfig": {"schemaVersion": 2, "names": {}},
    }

    parsed = ContentPrepBatchRequest.model_validate(raw)

    assert parsed.target_bank_id == "bank-001"
    assert parsed.questions[0].question.correct_answer == "B"
    with pytest.raises(ValidationError):
        ContentPrepBatchRequest.model_validate({**raw, "actorUsername": "admin"})


def test_response_dtos_emit_stable_camel_case_contracts() -> None:
    result = ContentPrepBatchResult.model_validate(
        {
            "batchId": "batch-001",
            "bankId": "bank-001",
            "replayed": False,
            "questions": [
                {
                    "questionId": "question-001",
                    "status": "created",
                    "revision": 1,
                    "contentHash": "a" * 64,
                }
            ],
        }
    ).model_dump(by_alias=True)
    lock = LockGrant.model_validate(
        {
            "questionId": "question-001",
            "lockToken": "plain-token-returned-once",
            "lockedBy": "teacher",
            "creatorId": "creator_001",
            "creatorName": "波塞冬",
            "clientInstanceId": "browser-001",
            "acquiredAt": "2026-08-09T00:00:00Z",
            "expiresAt": "2026-08-09T00:05:00Z",
            "heartbeatIntervalSeconds": 30,
            "leaseSeconds": 300,
        }
    ).model_dump(by_alias=True, mode="json")
    error = CatalogError.model_validate(
        {
            "code": "QUESTION_VALIDATION_FAILED",
            "message": "题目内容校验失败",
            "batchId": None,
            "issues": [
                {
                    "questionId": "question-001",
                    "field": "options",
                    "code": "CORRECT_ANSWER_MISSING",
                    "message": "必须设置正确答案",
                }
            ],
        }
    ).model_dump(by_alias=True)

    assert result["questions"][0]["contentHash"] == "a" * 64
    assert lock["lockedBy"] == "teacher"
    assert lock["creatorName"] == "波塞冬"
    assert lock["heartbeatIntervalSeconds"] == 30
    assert lock["leaseSeconds"] == 300
    assert error == {
        "code": "QUESTION_VALIDATION_FAILED",
        "message": "题目内容校验失败",
        "batchId": None,
        "issues": [
            {
                "questionId": "question-001",
                "field": "options",
                "code": "CORRECT_ANSWER_MISSING",
                "message": "必须设置正确答案",
            }
        ],
    }


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("基础", "简单"),
        ("简单", "简单"),
        ("easy", "简单"),
        ("L1", "简单"),
        ("中等", "中等"),
        ("medium", "中等"),
        ("困难", "困难"),
        ("hard", "困难"),
        ("L4", "困难"),
        ("", "中等"),
        (None, "中等"),
    ],
)
def test_question_difficulty_normalizes_to_three_levels(raw: object, expected: str) -> None:
    """P4.5.29 差异 21：正式难度统一三档；旧“基础”/英文/L1–L4 只在导入迁移层归一。"""
    question = complete_question()
    question["difficulty"] = raw  # type: ignore[assignment]

    normalized = normalize_question_payload(question, subject="PMP")

    assert normalized["difficulty"] == expected
