"""Inventory and transaction-local repair of question catalog references.

Reporting distinguishes mutable current containers from immutable published
snapshots.  Apply locks the same rows, repairs only current references, and
preserves published payload bytes and historical dependency evidence.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterator, Mapping
import hashlib
import json
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.paper_release import PaperRelease, PaperReleaseQuestion
from app.models.question import ExamPaper, PaperQuestion, Question, QuestionBank
from app.models.shared_runtime_state import SharedRuntimeState
from app.models.teaching_content import RecallAssociationLibrary
from app.schemas.question_cleanup import QuestionCleanupReference
from app.services import teaching_content_revision_service


CURRENT_RUNTIME_KEY_TYPES: dict[str, str] = {
    # allowed_until_task6: these exact keys lose their Runtime compatibility as
    # soon as Task 6 introduces the relational course/task owner.
    "kg_course_config_drafts_v1": "course_draft",
    "kg_course_config_active_release_v1": "active_course",
    "kg_learning_tasks_v1": "learning_task",
}

PUBLISHED_RUNTIME_KEY_TYPES: dict[str, str] = {
    # allowed_until_task6
    "kg_course_config_releases_v1": "published_course_snapshot",
}

RECALL_ASSOCIATION_PREFIX = None

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


class QuestionCleanupReferenceRepairError(ValueError):
    """A locked managed payload is unsafe to inspect or repair."""


async def relational_question_reference_counts(
    db: AsyncSession,
    question_id: str,
) -> dict[str, int]:
    """Count every authoritative draft and immutable-release reference."""

    draft_count = int(
        await db.scalar(
            select(func.count())
            .select_from(PaperQuestion)
            .where(PaperQuestion.question_id == question_id)
        )
        or 0
    )
    release_count = int(
        await db.scalar(
            select(func.count())
            .select_from(PaperReleaseQuestion)
            .where(PaperReleaseQuestion.question_id == question_id)
        )
        or 0
    )
    return {
        "draftReferenceCount": draft_count,
        "releaseReferenceCount": release_count,
    }


async def complete_relational_reference_snapshot(db: AsyncSession) -> dict[str, list[dict]]:
    """Return every relational question, draft-paper, and release reference.

    This intentionally has no selection or pagination inputs: admin reference
    checks must see unselected containers and immutable historical releases.
    """

    await teaching_content_revision_service.acquire_read_lock(db)
    banks = list((await db.scalars(select(QuestionBank).order_by(QuestionBank.id))).all())
    questions = list((await db.scalars(select(Question).order_by(Question.bank_id, Question.id))).all())
    questions_by_bank: dict[str, list[dict]] = {}
    for question in questions:
        questions_by_bank.setdefault(question.bank_id, []).append(
            {
                "id": question.id,
                "bankId": question.bank_id,
                "title": question.title,
                "teacherNumber": question.teacher_number,
                "metadata": question.content_metadata or {},
            }
        )

    bank_payloads = [
        {
            "id": bank.id,
            "name": bank.name,
            "subject": bank.subject,
            "questions": questions_by_bank.get(bank.id, []),
        }
        for bank in banks
    ]

    paper_rows = (
        await db.execute(
            select(ExamPaper, PaperQuestion)
            .outerjoin(PaperQuestion, PaperQuestion.paper_id == ExamPaper.id)
            .order_by(ExamPaper.id, PaperQuestion.order_index)
        )
    ).all()
    paper_payloads: list[dict] = []
    paper_by_id: dict[str, dict] = {}
    for paper, reference in paper_rows:
        payload = paper_by_id.get(paper.id)
        if payload is None:
            payload = {
                "id": paper.id,
                "title": paper.name,
                "subjectId": paper.subject,
                "status": paper.status,
                "sections": [{"id": "questions", "title": "试卷题目", "items": []}],
            }
            paper_by_id[paper.id] = payload
            paper_payloads.append(payload)
        if reference is not None:
            payload["sections"][0]["items"].append(
                {
                    "questionId": reference.question_id,
                    "order": reference.order_index + 1,
                    "score": float(reference.score),
                }
            )

    release_rows = (
        await db.execute(
            select(PaperRelease, PaperReleaseQuestion)
            .outerjoin(PaperReleaseQuestion, PaperReleaseQuestion.release_id == PaperRelease.id)
            .order_by(PaperRelease.id, PaperReleaseQuestion.order_index)
        )
    ).all()
    release_payloads: list[dict] = []
    release_by_id: dict[str, dict] = {}
    for release, reference in release_rows:
        payload = release_by_id.get(release.id)
        if payload is None:
            payload = {
                "id": release.id,
                "releaseId": release.id,
                "paperId": release.paper_id,
                "version": release.version,
                "title": release.name,
                "subjectId": release.subject,
                "status": release.status,
                "sections": [{"id": "questions", "title": "试卷题目", "items": []}],
            }
            release_by_id[release.id] = payload
            release_payloads.append(payload)
        if reference is not None:
            payload["sections"][0]["items"].append(
                {
                    "bankId": reference.bank_id,
                    "questionId": reference.question_id,
                    "order": reference.order_index + 1,
                    "score": 1,
                }
            )

    return {"banks": bank_payloads, "papers": paper_payloads, "releases": release_payloads}


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
    return payload


def _runtime_key_type(key: str) -> tuple[str, str] | None:
    if key in CURRENT_RUNTIME_KEY_TYPES:
        return CURRENT_RUNTIME_KEY_TYPES[key], "remove_question_and_recalculate"
    if key in PUBLISHED_RUNTIME_KEY_TYPES:
        return PUBLISHED_RUNTIME_KEY_TYPES[key], "preserve_historical_snapshot"
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

    release_snapshot: list[dict[str, object]] = []
    releases = await db.execute(
        select(PaperReleaseQuestion, PaperRelease)
        .join(PaperRelease, PaperRelease.id == PaperReleaseQuestion.release_id)
        .order_by(
            PaperReleaseQuestion.release_id,
            PaperReleaseQuestion.order_index,
            PaperReleaseQuestion.question_id,
        )
    )
    for link, release in releases:
        references.append(
            _reference(
                container_type="relational_paper_release",
                container_id=str(link.release_id),
                question_id=str(link.question_id),
                repair_action="preserve_historical_snapshot",
                storage_key=None,
                reference_path=(
                    f"paper_release_questions/{link.release_id}/{link.order_index}"
                ),
            )
        )
        release_snapshot.append(
            {
                "releaseId": str(link.release_id),
                "releaseStatus": str(release.status),
                "questionId": str(link.question_id),
                "orderIndex": int(link.order_index),
                "snapshotHash": _sha256(link.snapshot),
            }
        )

    recall_snapshot: list[dict[str, object]] = []
    recall_rows = list(
        (
            await db.execute(
                select(RecallAssociationLibrary).order_by(
                    RecallAssociationLibrary.subject_id,
                    RecallAssociationLibrary.version,
                    RecallAssociationLibrary.id,
                )
            )
        )
        .scalars()
        .all()
    )
    for library in recall_rows:
        payload = {
            "nodes": list(library.nodes or []),
            "edges": list(library.edges or []),
            "metadata": dict(library.content_metadata or {}),
        }
        recall_snapshot.append(
            {
                "libraryId": str(library.id),
                "subjectId": str(library.subject_id),
                "version": int(library.version),
                "status": str(library.status),
                "valueHash": _sha256(payload),
            }
        )
        for question_id, relative_path in _walk_question_references(payload):
            references.append(
                _reference(
                    container_type="relational_recall_association_library",
                    container_id=str(library.id),
                    question_id=question_id,
                    repair_action="remove_question_and_recalculate",
                    storage_key=None,
                    reference_path=relative_path or "/",
                )
            )

    runtime_query = (
        select(SharedRuntimeState)
        .where(SharedRuntimeState.key.in_(REPORT_RUNTIME_EXACT_KEYS))
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
        {"kind": "relationalPaperReleaseQuestion", **item}
        for item in release_snapshot
    ] + [
        {"kind": "relationalRecallAssociationLibrary", **item}
        for item in recall_snapshot
    ] + [
        {"kind": "sharedRuntime", **item}
        for item in runtime_snapshot
    ]
    snapshot.sort(key=_canonical_json)
    return sorted_references, snapshot


def _repair_json_value(
    value: object,
    deleted_question_ids: set[str],
    *,
    collection_item: bool = False,
) -> tuple[object, int, bool]:
    """Remove live question references without interpreting unrelated IDs."""

    if isinstance(value, Mapping):
        if collection_item:
            direct_ids = {
                _clean_question_id(value.get(field))
                for field in _DIRECT_QUESTION_FIELDS
            }
            direct_ids.discard("")
            if not direct_ids:
                candidate = _clean_question_id(value.get("id"))
                if candidate:
                    direct_ids.add(candidate)
            if direct_ids & deleted_question_ids:
                return {}, 1, True

        repaired = dict(value)
        removed = 0
        for field in _DIRECT_QUESTION_FIELDS:
            question_id = _clean_question_id(repaired.get(field))
            if question_id in deleted_question_ids:
                repaired.pop(field, None)
                removed += 1
        for field in _QUESTION_ARRAY_FIELDS:
            rows = repaired.get(field)
            if not isinstance(rows, list):
                continue
            kept_rows = [
                row
                for row in rows
                if _clean_question_id(row) not in deleted_question_ids
            ]
            removed += len(rows) - len(kept_rows)
            repaired[field] = kept_rows

        for key, child in list(repaired.items()):
            if key in _DIRECT_QUESTION_FIELDS or key in _QUESTION_ARRAY_FIELDS:
                continue
            if isinstance(child, list):
                child_is_question_collection = key in _QUESTION_COLLECTION_FIELDS
                repaired_rows: list[object] = []
                for item in child:
                    repaired_item, child_removed, remove_item = _repair_json_value(
                        item,
                        deleted_question_ids,
                        collection_item=child_is_question_collection,
                    )
                    removed += child_removed
                    if not remove_item:
                        repaired_rows.append(repaired_item)
                repaired[key] = repaired_rows
            elif isinstance(child, Mapping):
                repaired_child, child_removed, _ = _repair_json_value(
                    child,
                    deleted_question_ids,
                )
                removed += child_removed
                repaired[key] = repaired_child
        return repaired, removed, False

    if isinstance(value, list):
        repaired_rows = []
        removed = 0
        for item in value:
            repaired_item, child_removed, remove_item = _repair_json_value(
                item,
                deleted_question_ids,
            )
            removed += child_removed
            if not remove_item:
                repaired_rows.append(repaired_item)
        return repaired_rows, removed, False
    return value, 0, False


def _walk_bank_ids(value: object) -> Iterator[str]:
    if isinstance(value, Mapping):
        bank_id = _clean_question_id(value.get("bankId"))
        if bank_id:
            yield bank_id
        for child in value.values():
            yield from _walk_bank_ids(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_bank_ids(child)


def _raw_top_level_array_items(value: str) -> list[str] | None:
    """Return exact JSON bytes for top-level array elements when parseable."""

    decoder = json.JSONDecoder()
    length = len(value)
    index = 0
    while index < length and value[index].isspace():
        index += 1
    if index >= length or value[index] != "[":
        return None
    index += 1
    items: list[str] = []
    while True:
        while index < length and value[index].isspace():
            index += 1
        if index < length and value[index] == "]":
            index += 1
            break
        start = index
        try:
            _, end = decoder.raw_decode(value, index)
        except (TypeError, ValueError, json.JSONDecodeError):
            return None
        items.append(value[start:end])
        index = end
        while index < length and value[index].isspace():
            index += 1
        if index < length and value[index] == ",":
            index += 1
            continue
        if index < length and value[index] == "]":
            index += 1
            break
        return None
    if value[index:].strip():
        return None
    return items


def _recalculate_runtime_papers(
    payload: object,
    question_domains: Mapping[str, str | None],
) -> object:
    rows = payload if isinstance(payload, list) else [payload]
    for paper in rows:
        if not isinstance(paper, dict):
            continue
        questions = paper.get("questions")
        if not isinstance(questions, list):
            continue
        question_ids: list[str] = []
        for question in questions:
            if not isinstance(question, Mapping):
                continue
            question_id = next(
                (
                    _clean_question_id(question.get(field))
                    for field in _DIRECT_QUESTION_FIELDS
                    if _clean_question_id(question.get(field))
                ),
                "",
            )
            if question_id:
                question_ids.append(question_id)
        total = len(questions)
        if "totalCount" in paper:
            paper["totalCount"] = total
        if "questionCount" in paper:
            paper["questionCount"] = total
        if isinstance(paper.get("quotas"), Mapping):
            quotas = Counter(
                str(question_domains.get(question_id) or "").strip()
                for question_id in question_ids
            )
            quotas.pop("", None)
            paper["quotas"] = dict(sorted(quotas.items()))
    return payload


async def _lock_runtime_rows(db: AsyncSession) -> list[SharedRuntimeState]:
    query = (
        select(SharedRuntimeState)
        .where(SharedRuntimeState.key.in_(REPORT_RUNTIME_EXACT_KEYS))
        .order_by(SharedRuntimeState.key)
        .with_for_update()
    )
    return list((await db.execute(query)).scalars().all())


async def repair_current_question_references(
    db: AsyncSession,
    deleted_question_ids: set[str],
    *,
    actor_username: str,
    question_domains: Mapping[str, str | None],
) -> dict[str, object]:
    """Lock and repair relational/current-runtime references in this transaction."""

    if not deleted_question_ids:
        return {
            "relationalPaperIds": [],
            "relationalRecallLibraryIds": [],
            "removedRelationalRecallReferences": 0,
            "runtimeKeys": [],
            "removedRuntimeReferences": 0,
        }

    targeted_links = list(
        (
            await db.execute(
                select(PaperQuestion)
                .where(PaperQuestion.question_id.in_(deleted_question_ids))
                .order_by(PaperQuestion.paper_id, PaperQuestion.order_index)
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    paper_ids = sorted({str(link.paper_id) for link in targeted_links})
    papers: dict[str, ExamPaper] = {}
    all_links_by_paper: dict[str, list[PaperQuestion]] = {}
    if paper_ids:
        paper_rows = list(
            (
                await db.execute(
                    select(ExamPaper)
                    .where(ExamPaper.id.in_(paper_ids))
                    .order_by(ExamPaper.id)
                    .with_for_update()
                )
            )
            .scalars()
            .all()
        )
        papers = {str(row.id): row for row in paper_rows}
        all_links = list(
            (
                await db.execute(
                    select(PaperQuestion)
                    .where(PaperQuestion.paper_id.in_(paper_ids))
                    .order_by(
                        PaperQuestion.paper_id,
                        PaperQuestion.order_index,
                        PaperQuestion.question_id,
                    )
                    .with_for_update()
                )
            )
            .scalars()
            .all()
        )
        for link in all_links:
            all_links_by_paper.setdefault(str(link.paper_id), []).append(link)

    for link in targeted_links:
        await db.delete(link)
    for paper_id in paper_ids:
        remaining = [
            link
            for link in all_links_by_paper.get(paper_id, [])
            if str(link.question_id) not in deleted_question_ids
        ]
        for index, link in enumerate(remaining):
            link.order_index = index
        paper = papers.get(paper_id)
        if paper is None:
            continue
        quotas = Counter(
            str(question_domains.get(str(link.question_id)) or "").strip()
            for link in remaining
        )
        quotas.pop("", None)
        paper.total_count = len(remaining)
        paper.quotas = dict(sorted(quotas.items()))
        paper.revision = int(paper.revision) + 1
        paper.updated_by = actor_username

    changed_recall_library_ids: list[str] = []
    removed_recall_references = 0
    recall_rows = list(
        (
            await db.execute(
                select(RecallAssociationLibrary)
                .order_by(RecallAssociationLibrary.id)
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    for library in recall_rows:
        payload = {
            "nodes": list(library.nodes or []),
            "edges": list(library.edges or []),
            "metadata": dict(library.content_metadata or {}),
        }
        repaired, removed, _ = _repair_json_value(payload, deleted_question_ids)
        if removed <= 0 or not isinstance(repaired, Mapping):
            continue
        library.nodes = list(repaired.get("nodes") or [])
        library.edges = list(repaired.get("edges") or [])
        library.content_metadata = dict(repaired.get("metadata") or {})
        library.updated_by = actor_username
        changed_recall_library_ids.append(str(library.id))
        removed_recall_references += removed

    changed_runtime_keys: list[str] = []
    removed_runtime_references = 0
    published_bank_ids: set[str] = set()
    for row in await _lock_runtime_rows(db):
        key = str(row.key)
        try:
            payload = json.loads(row.value)
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            raise QuestionCleanupReferenceRepairError(
                f"malformed managed runtime JSON prevents cleanup: {key}"
            ) from exc
        if key in PUBLISHED_RUNTIME_KEY_TYPES:
            published_bank_ids.update(_walk_bank_ids(payload))
            continue

        serialized_override: str | None = None
        if key == "kg_learning_tasks_v1" and isinstance(payload, list):
            repaired_tasks: list[object] = []
            serialized_tasks: list[str] = []
            raw_tasks = _raw_top_level_array_items(row.value)
            removed = 0
            for index, task in enumerate(payload):
                if _container_repair_action(
                    key,
                    task,
                    "remove_question_and_recalculate",
                ) == "preserve_historical_snapshot":
                    repaired_tasks.append(task)
                    published_bank_ids.update(_walk_bank_ids(task))
                    if raw_tasks is not None and len(raw_tasks) == len(payload):
                        serialized_tasks.append(raw_tasks[index])
                    else:
                        serialized_tasks.append(
                            json.dumps(
                                task,
                                ensure_ascii=False,
                                separators=(",", ":"),
                            )
                        )
                    continue
                repaired_task, task_removed, _ = _repair_json_value(
                    task,
                    deleted_question_ids,
                )
                repaired_tasks.append(repaired_task)
                serialized_tasks.append(
                    json.dumps(
                        repaired_task,
                        ensure_ascii=False,
                        separators=(",", ":"),
                    )
                )
                removed += task_removed
            repaired_payload: object = repaired_tasks
            serialized_override = f"[{','.join(serialized_tasks)}]"
        else:
            repaired_payload, removed, _ = _repair_json_value(
                payload,
                deleted_question_ids,
            )
        if key == "kg_exam_papers_v1__teacher_shared":
            repaired_payload = _recalculate_runtime_papers(
                repaired_payload,
                question_domains,
            )
        if removed <= 0:
            continue
        row.value = serialized_override or json.dumps(
            repaired_payload,
            ensure_ascii=False,
            separators=(",", ":"),
        )
        row.updated_by = actor_username
        changed_runtime_keys.append(key)
        removed_runtime_references += removed

    return {
        "relationalPaperIds": paper_ids,
        "relationalRecallLibraryIds": sorted(changed_recall_library_ids),
        "removedRelationalRecallReferences": removed_recall_references,
        "runtimeKeys": sorted(changed_runtime_keys),
        "removedRuntimeReferences": removed_runtime_references,
        "publishedBankIds": sorted(published_bank_ids),
    }


__all__ = [
    "CURRENT_RUNTIME_KEY_TYPES",
    "PUBLISHED_RUNTIME_KEY_TYPES",
    "RECALL_ASSOCIATION_PREFIX",
    "REPORT_RUNTIME_EXACT_KEYS",
    "QuestionCleanupReferenceRepairError",
    "inventory_question_references",
    "repair_current_question_references",
]
