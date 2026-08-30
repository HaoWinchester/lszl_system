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

from app.models.course_management import CourseDraft, CourseRelease, LearningTask
from app.models.paper_release import PaperRelease, PaperReleaseQuestion
from app.models.question import ExamPaper, PaperQuestion, Question, QuestionBank
from app.models.teaching_content import RecallAssociationLibrary
from app.schemas.question_cleanup import QuestionCleanupReference
from app.services import teaching_content_revision_service


RECALL_ASSOCIATION_PREFIX = None

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


async def complete_relational_reference_snapshot(
    db: AsyncSession,
    *,
    owner_id: str | None = None,
) -> dict[str, list[dict]]:
    """Return every relational question, draft-paper, and release reference.

    This intentionally has no selection or pagination inputs: admin reference
    checks must see unselected containers and immutable historical releases.
    """

    await teaching_content_revision_service.acquire_read_lock(db)
    bank_query = select(QuestionBank)
    if owner_id is not None:
        bank_query = bank_query.where(QuestionBank.owner_id == owner_id)
    banks = list((await db.scalars(bank_query.order_by(QuestionBank.id))).all())
    bank_ids = {bank.id for bank in banks}
    question_query = select(Question)
    if owner_id is not None:
        question_query = question_query.where(Question.bank_id.in_(bank_ids))
    questions = list(
        (await db.scalars(question_query.order_by(Question.bank_id, Question.id))).all()
    )
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

    paper_query = select(ExamPaper, PaperQuestion).outerjoin(
        PaperQuestion, PaperQuestion.paper_id == ExamPaper.id
    )
    if owner_id is not None:
        paper_query = paper_query.where(ExamPaper.owner_id == owner_id)
    paper_rows = (
        await db.execute(
            paper_query.order_by(ExamPaper.id, PaperQuestion.order_index)
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

    release_query = select(PaperRelease, PaperReleaseQuestion).outerjoin(
        PaperReleaseQuestion, PaperReleaseQuestion.release_id == PaperRelease.id
    )
    if owner_id is not None:
        release_query = release_query.where(PaperRelease.publisher_id == owner_id)
    release_rows = (
        await db.execute(
            release_query.order_by(PaperRelease.id, PaperReleaseQuestion.order_index)
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

    course_snapshot: list[dict[str, object]] = []
    course_drafts = list(
        (await db.scalars(select(CourseDraft).order_by(CourseDraft.id))).all()
    )
    for draft in course_drafts:
        payload = dict(draft.structure or {})
        course_snapshot.append(
            {
                "kind": "relationalCourseDraft",
                "id": str(draft.id),
                "ownerId": str(draft.owner_id),
                "revision": int(draft.revision),
                "status": str(draft.status),
                "valueHash": _sha256(payload),
            }
        )
        for question_id, relative_path in _walk_question_references(payload):
            references.append(
                _reference(
                    container_type="course_draft",
                    container_id=str(draft.id),
                    question_id=question_id,
                    repair_action="remove_question_and_recalculate",
                    storage_key=None,
                    reference_path=relative_path or "/",
                )
            )

    course_releases = list(
        (await db.scalars(select(CourseRelease).order_by(CourseRelease.id))).all()
    )
    for release in course_releases:
        payload = dict(release.course_snapshot or {})
        course_snapshot.append(
            {
                "kind": "relationalCourseRelease",
                "id": str(release.id),
                "ownerId": str(release.owner_id),
                "courseId": str(release.course_id),
                "revision": int(release.revision),
                "status": str(release.status),
                "contentHash": str(release.content_hash),
                "valueHash": _sha256(payload),
            }
        )
        for question_id, relative_path in _walk_question_references(payload):
            references.append(
                _reference(
                    container_type="published_course_snapshot",
                    container_id=str(release.id),
                    question_id=question_id,
                    repair_action="preserve_historical_snapshot",
                    storage_key=None,
                    reference_path=relative_path or "/",
                )
            )

    learning_tasks = list(
        (await db.scalars(select(LearningTask).order_by(LearningTask.id))).all()
    )
    for task in learning_tasks:
        payload = dict(task.content or {})
        repair_action = (
            "preserve_historical_snapshot"
            if str(task.status) == "published"
            else "remove_question_and_recalculate"
        )
        course_snapshot.append(
            {
                "kind": "relationalLearningTask",
                "id": str(task.id),
                "ownerId": str(task.owner_id),
                "releaseId": str(task.release_id),
                "revision": int(task.revision),
                "status": str(task.status),
                "valueHash": _sha256(payload),
            }
        )
        for question_id, relative_path in _walk_question_references(payload):
            references.append(
                _reference(
                    container_type="learning_task",
                    container_id=str(task.id),
                    question_id=question_id,
                    repair_action=repair_action,
                    storage_key=None,
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
    ] + course_snapshot
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


async def repair_current_question_references(
    db: AsyncSession,
    deleted_question_ids: set[str],
    *,
    actor_username: str,
    question_domains: Mapping[str, str | None],
) -> dict[str, object]:
    """Lock and repair mutable relational references in this transaction."""

    if not deleted_question_ids:
        return {
            "relationalPaperIds": [],
            "relationalRecallLibraryIds": [],
            "removedRelationalRecallReferences": 0,
            "relationalCourseDraftIds": [],
            "relationalLearningTaskIds": [],
            "removedRelationalCourseReferences": 0,
            "runtimeKeys": [],
            "removedRuntimeReferences": 0,
            "publishedBankIds": [],
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

    changed_course_draft_ids: list[str] = []
    changed_learning_task_ids: list[str] = []
    removed_course_references = 0
    published_bank_ids: set[str] = set()

    course_drafts = list(
        (
            await db.scalars(
                select(CourseDraft).order_by(CourseDraft.id).with_for_update()
            )
        ).all()
    )
    for draft in course_drafts:
        repaired_payload, removed, _ = _repair_json_value(
            dict(draft.structure or {}),
            deleted_question_ids,
        )
        if removed <= 0 or not isinstance(repaired_payload, Mapping):
            continue
        draft.structure = dict(repaired_payload)
        draft.revision = int(draft.revision) + 1
        draft.updated_by = actor_username
        changed_course_draft_ids.append(str(draft.id))
        removed_course_references += removed

    course_releases = list(
        (
            await db.scalars(
                select(CourseRelease).order_by(CourseRelease.id).with_for_update()
            )
        ).all()
    )
    for release in course_releases:
        published_bank_ids.update(_walk_bank_ids(release.course_snapshot or {}))

    learning_tasks = list(
        (
            await db.scalars(
                select(LearningTask).order_by(LearningTask.id).with_for_update()
            )
        ).all()
    )
    for task in learning_tasks:
        payload = dict(task.content or {})
        if str(task.status) == "published":
            published_bank_ids.update(_walk_bank_ids(payload))
            continue
        repaired_payload, removed, _ = _repair_json_value(
            payload,
            deleted_question_ids,
        )
        if removed <= 0:
            continue
        if not isinstance(repaired_payload, Mapping):
            continue
        task.content = dict(repaired_payload)
        task.revision = int(task.revision) + 1
        task.updated_by = actor_username
        changed_learning_task_ids.append(str(task.id))
        removed_course_references += removed

    return {
        "relationalPaperIds": paper_ids,
        "relationalRecallLibraryIds": sorted(changed_recall_library_ids),
        "removedRelationalRecallReferences": removed_recall_references,
        "relationalCourseDraftIds": sorted(changed_course_draft_ids),
        "relationalLearningTaskIds": sorted(changed_learning_task_ids),
        "removedRelationalCourseReferences": removed_course_references,
        "runtimeKeys": [],
        "removedRuntimeReferences": 0,
        "publishedBankIds": sorted(published_bank_ids),
    }


__all__ = [
    "RECALL_ASSOCIATION_PREFIX",
    "QuestionCleanupReferenceRepairError",
    "inventory_question_references",
    "repair_current_question_references",
]
