"""Read-only inventory of references to the relational question catalog.

The cleanup report must distinguish mutable current containers from immutable
published snapshots.  This module only reads and classifies references; repair
operations belong to a later, separately authorized cleanup phase.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping
import hashlib
import json
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.question import ExamPaper, PaperQuestion
from app.models.shared_runtime_state import SharedRuntimeState
from app.schemas.question_cleanup import QuestionCleanupReference


CURRENT_RUNTIME_KEY_TYPES: dict[str, str] = {
    "kg_exam_papers_v1__teacher_shared": "paper_draft",
    "kg_exam_paper_categories_v1__teacher_shared": "paper_category",
    "kg_course_config_drafts_v1": "course_draft",
    "kg_course_config_active_release_v1": "active_course",
    "kg_learning_tasks_v1": "learning_task",
    "kg_principle_repository_v1": "principle_repository",
    "kg_synthesis_preset_repository_v1": "synthesis_preset_repository",
    "kg_assessment_papers_v1": "workbench_aggregate",
}

PUBLISHED_RUNTIME_KEY_TYPES: dict[str, str] = {
    "kg_exam_papers_published_v1": "published_paper_snapshot",
    "kg_exam_paper_release_history_v1": "published_paper_snapshot",
    "kg_course_config_releases_v1": "published_course_snapshot",
}

RECALL_ASSOCIATION_PREFIX = "kg_recall_association_library_v1__subject__"

REPORT_RUNTIME_EXACT_KEYS = frozenset(
    {*CURRENT_RUNTIME_KEY_TYPES, *PUBLISHED_RUNTIME_KEY_TYPES}
)

_DIRECT_QUESTION_FIELDS = (
    "questionId",
    "sourceQuestionId",
    "originalQuestionId",
)
_QUESTION_ARRAY_FIELDS = (
    "questionIds",
    "sourceQuestionIds",
    "originalQuestionIds",
)
_QUESTION_COLLECTION_FIELDS = frozenset(
    {
        "questions",
        "questionRefs",
        "legacyQuestionRefs",
        "questionSnapshots",
    }
)


def _canonical_json(value: object) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _sha256(value: object) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _json_pointer_token(value: object) -> str:
    return str(value).replace("~", "~0").replace("/", "~1")


def _clean_question_id(value: object) -> str:
    if value is None or isinstance(value, bool):
        return ""
    result = str(value).strip()
    return result if 0 < len(result) <= 64 else ""


def _walk_question_references(
    value: object,
    *,
    path: str = "",
    collection_item: bool = False,
) -> Iterator[tuple[str, str]]:
    """Yield explicit question identifiers and their JSON pointer paths.

    An object's bare ``id`` is a question identifier only when that object is
    inside a known question collection.  This avoids treating paper, course,
    principle, association-node, or activity IDs as relational questions.
    """

    if isinstance(value, Mapping):
        seen_here: set[tuple[str, str]] = set()
        for field in _DIRECT_QUESTION_FIELDS:
            question_id = _clean_question_id(value.get(field))
            if question_id:
                pair = (question_id, f"{path}/{_json_pointer_token(field)}")
                if pair not in seen_here:
                    seen_here.add(pair)
                    yield pair
        if collection_item and not seen_here:
            question_id = _clean_question_id(value.get("id"))
            if question_id:
                yield question_id, f"{path}/id"
        for field in _QUESTION_ARRAY_FIELDS:
            rows = value.get(field)
            if isinstance(rows, list):
                for index, raw_id in enumerate(rows):
                    question_id = _clean_question_id(raw_id)
                    if question_id:
                        yield (
                            question_id,
                            f"{path}/{_json_pointer_token(field)}/{index}",
                        )
        for key, child in value.items():
            if key in _DIRECT_QUESTION_FIELDS or key in _QUESTION_ARRAY_FIELDS:
                continue
            child_path = f"{path}/{_json_pointer_token(key)}"
            if isinstance(child, list):
                child_is_question_collection = key in _QUESTION_COLLECTION_FIELDS
                for index, item in enumerate(child):
                    yield from _walk_question_references(
                        item,
                        path=f"{child_path}/{index}",
                        collection_item=child_is_question_collection,
                    )
            elif isinstance(child, Mapping):
                yield from _walk_question_references(child, path=child_path)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from _walk_question_references(item, path=f"{path}/{index}")


def _container_id(row: object, *, key: str, index: int) -> str:
    if isinstance(row, Mapping):
        for field in (
            "releaseId",
            "paperId",
            "courseId",
            "taskId",
            "id",
        ):
            value = str(row.get(field) or "").strip()
            if value:
                return value[:256]
    return f"{key}#{index}"


def _runtime_containers(key: str, payload: object) -> list[tuple[str, object, str]]:
    if isinstance(payload, list):
        rows = list(payload)
        if all(isinstance(row, Mapping) for row in rows):
            rows.sort(
                key=lambda row: (
                    _container_id(row, key=key, index=0),
                    _canonical_json(row),
                )
            )
        return [
            (_container_id(row, key=key, index=index), row, f"/{index}")
            for index, row in enumerate(rows)
        ]
    if isinstance(payload, Mapping):
        return [(_container_id(payload, key=key, index=0), payload, "")]
    return []


def _reference(
    *,
    container_type: str,
    container_id: str,
    question_id: str,
    repair_action: str,
    storage_key: str | None,
    reference_path: str | None,
) -> QuestionCleanupReference:
    identity = {
        "containerType": container_type,
        "containerId": container_id,
        "questionId": question_id,
        "repairAction": repair_action,
        "storageKey": storage_key,
        "referencePath": reference_path,
    }
    return QuestionCleanupReference(
        referenceId=_sha256(identity),
        **identity,
    )


def _canonical_runtime_payload(key: str, payload: object) -> object:
    """Remove collection insertion order without erasing semantic inner order."""

    if isinstance(payload, list) and all(isinstance(row, Mapping) for row in payload):
        return sorted(
            payload,
            key=lambda row: (
                _container_id(row, key=key, index=0),
                _canonical_json(row),
            ),
        )
    if isinstance(payload, Mapping) and key in {
        "kg_principle_repository_v1",
        "kg_synthesis_preset_repository_v1",
    }:
        normalized = dict(payload)
        items = normalized.get("items")
        if isinstance(items, list) and all(isinstance(row, Mapping) for row in items):
            normalized["items"] = sorted(
                items,
                key=lambda row: (str(row.get("id") or ""), _canonical_json(row)),
            )
        return normalized
    if isinstance(payload, Mapping) and key.startswith(RECALL_ASSOCIATION_PREFIX):
        normalized = dict(payload)
        for field in ("nodes", "edges"):
            rows = normalized.get(field)
            if isinstance(rows, list) and all(isinstance(row, Mapping) for row in rows):
                normalized[field] = sorted(
                    rows,
                    key=lambda row: (
                        str(row.get("id") or ""),
                        _canonical_json(row),
                    ),
                )
        return normalized
    return payload


def _runtime_key_type(key: str) -> tuple[str, str] | None:
    if key in CURRENT_RUNTIME_KEY_TYPES:
        return CURRENT_RUNTIME_KEY_TYPES[key], "remove_question_and_recalculate"
    if key in PUBLISHED_RUNTIME_KEY_TYPES:
        return PUBLISHED_RUNTIME_KEY_TYPES[key], "preserve_historical_snapshot"
    if key.startswith(RECALL_ASSOCIATION_PREFIX) and len(key) > len(
        RECALL_ASSOCIATION_PREFIX
    ):
        return "recall_association_library", "remove_question_and_recalculate"
    return None


def _container_repair_action(
    key: str,
    container: object,
    default: str,
) -> str:
    if (
        key == "kg_learning_tasks_v1"
        and isinstance(container, Mapping)
        and (
            str(container.get("status") or "").strip().casefold() == "published"
            or bool(str(container.get("publishedAt") or "").strip())
        )
    ):
        return "preserve_historical_snapshot"
    return default


async def inventory_question_references(
    db: AsyncSession,
) -> tuple[list[QuestionCleanupReference], list[dict[str, object]]]:
    """Read every relevant current/published reference without mutating state."""

    references: list[QuestionCleanupReference] = []
    relational_snapshot: list[dict[str, object]] = []
    relational = await db.execute(
        select(PaperQuestion, ExamPaper)
        .join(ExamPaper, ExamPaper.id == PaperQuestion.paper_id)
        .order_by(PaperQuestion.paper_id, PaperQuestion.order_index, PaperQuestion.question_id)
    )
    for link, paper in relational:
        references.append(
            _reference(
                container_type="relational_paper",
                container_id=str(link.paper_id),
                question_id=str(link.question_id),
                repair_action="remove_question_and_recalculate",
                storage_key=None,
                reference_path=f"paper_questions/{link.paper_id}/{link.question_id}",
            )
        )
        relational_snapshot.append(
            {
                "paperId": str(link.paper_id),
                "paperRevision": int(paper.revision),
                "paperStatus": str(paper.status),
                "paperDeletedAt": (
                    paper.deleted_at.isoformat() if paper.deleted_at else None
                ),
                "questionId": str(link.question_id),
                "orderIndex": int(link.order_index),
            }
        )

    runtime_query = (
        select(SharedRuntimeState)
        .where(
            or_(
                SharedRuntimeState.key.in_(REPORT_RUNTIME_EXACT_KEYS),
                SharedRuntimeState.key.startswith(RECALL_ASSOCIATION_PREFIX),
            )
        )
        .order_by(SharedRuntimeState.key)
    )
    runtime_rows = (await db.execute(runtime_query)).scalars().all()
    runtime_snapshot: list[dict[str, object]] = []
    for row in runtime_rows:
        key = str(row.key)
        classification = _runtime_key_type(key)
        if classification is None:
            continue
        container_type, repair_action = classification
        try:
            payload = json.loads(row.value)
        except (TypeError, ValueError, json.JSONDecodeError):
            payload = {"invalidJsonSha256": hashlib.sha256(row.value.encode()).hexdigest()}
        canonical_payload = _canonical_runtime_payload(key, payload)
        runtime_snapshot.append(
            {
                "key": key,
                "schemaVersion": int(row.schema_version),
                "valueHash": _sha256(canonical_payload),
            }
        )
        for container_id, container, base_path in _runtime_containers(
            key,
            canonical_payload,
        ):
            container_repair_action = _container_repair_action(
                key,
                container,
                repair_action,
            )
            for question_id, relative_path in _walk_question_references(
                container,
                path=base_path,
            ):
                references.append(
                    _reference(
                        container_type=container_type,
                        container_id=container_id,
                        question_id=question_id,
                        repair_action=container_repair_action,
                        storage_key=key,
                        reference_path=relative_path or "/",
                    )
                )

    deduplicated = {reference.reference_id: reference for reference in references}
    sorted_references = sorted(
        deduplicated.values(),
        key=lambda item: (
            item.container_type,
            item.container_id,
            item.question_id,
            item.storage_key or "",
            item.reference_path or "",
            item.repair_action,
        ),
    )
    snapshot = [
        {"kind": "relationalPaperQuestion", **item}
        for item in relational_snapshot
    ] + [
        {"kind": "sharedRuntime", **item}
        for item in runtime_snapshot
    ]
    snapshot.sort(key=_canonical_json)
    return sorted_references, snapshot


__all__ = [
    "CURRENT_RUNTIME_KEY_TYPES",
    "PUBLISHED_RUNTIME_KEY_TYPES",
    "RECALL_ASSOCIATION_PREFIX",
    "REPORT_RUNTIME_EXACT_KEYS",
    "inventory_question_references",
]
