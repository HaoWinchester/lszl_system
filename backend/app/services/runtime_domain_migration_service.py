"""Runtime state 全量迁移的账本、状态机和 drop 门禁。"""

from __future__ import annotations

import hashlib
import inspect
import json
import re
from collections.abc import Callable, Iterable, Mapping
from datetime import datetime, timezone
from typing import Any
from urllib.parse import unquote

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.engagement import (
    Announcement,
    AnnouncementAudience,
    Feedback,
    FeedbackReceipt,
    FeedbackReply,
    MessageReceipt,
)
from app.models.paper_release import PaperRelease, PaperReleaseQuestion
from app.models.runtime_migration import RuntimeMigrationItem, RuntimeMigrationRun
from app.models.runtime_state import RuntimeState
from app.models.shared_runtime_state import SharedRuntimeState
from app.models.teaching_content import ContentSubject, ContentTaxonomy, RecallAssociationLibrary, TaxonomyNode
from app.services.engagement_migration import MAPPERS as ENGAGEMENT_MAPPERS, expected_canonical as engagement_expected_canonical
PUBLISHED_PAPERS_KEY = "kg_exam_papers_published_v1"
TEACHING_RECALL_PREFIX = "kg_recall_association_library_v1__subject__"


def _teaching_subject_from_key(source_key: str) -> str:
    raw = unquote(source_key.removeprefix(TEACHING_RECALL_PREFIX)).strip()
    if not raw:
        raise ValueError("teaching content source subject is missing")
    return "subject-pmp" if raw.upper() == "PMP" else raw


def _teaching_canonical(payload: Any, source_key: str) -> dict[str, Any]:
    if source_key == "kg_content_taxonomies_v1":
        entries = payload if isinstance(payload, list) else [payload]
        subject_ids = {str(item.get("subjectId") or "").strip() for item in entries if isinstance(item, Mapping)}
        subject_ids.discard("")
        if len(subject_ids) > 1:
            raise ValueError("taxonomy source contains multiple subjects")
        subject_id = next(iter(subject_ids), "subject-pmp")
        return {"subjectId": subject_id, "taxonomies": entries}
    subject_id = _teaching_subject_from_key(source_key)
    if not isinstance(payload, Mapping):
        raise ValueError("recall source must be an object")
    return {"subjectId": subject_id, "library": dict(payload)}

PUBLISHED_PAPERS_KEY = "kg_exam_papers_published_v1"
PAPER_RELEASE_HISTORY_KEY = "kg_exam_paper_release_history_v1"
PAPER_RELEASE_SOURCE_KEYS = {PUBLISHED_PAPERS_KEY, PAPER_RELEASE_HISTORY_KEY}
ENGAGEMENT_SOURCE_KEYS = {"kg_user_feedback_v1", "kg_announcements_v1"}
ALL_LEARNING_MODES = [
    "practice_mode",
    "deep_recall",
    "multi_question_canvas",
    "single_deep_study",
]
MAX_RELEASE_METADATA_BYTES = 64 * 1024
RELEASE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
Mapper = Callable[[AsyncSession, RuntimeMigrationItem], Any]

# Production migrations register trusted callables here; callers cannot submit payload summaries.
TARGET_MAPPER_REGISTRY: dict[str, Mapper] = {}

DISPOSITION_MIGRATE = "migrate"
DISPOSITION_ALREADY_RELATIONAL_VERIFY = "already-relational-verify"
DISPOSITION_UI_ONLY_DROP = "ui-only-drop"
DISPOSITION_DEPRECATED_DROP = "deprecated-drop"
DISPOSITION_UNKNOWN = "unknown"


def _mapper_for_key(registry: Mapping[str, Mapper], source_key: str) -> Mapper | None:
    mapper = registry.get(source_key)
    if mapper is not None:
        return mapper
    # Engagement receipt mappers intentionally cover owner-scoped key prefixes.
    for key, candidate in registry.items():
        if key.endswith("__") and source_key.startswith(key):
            return candidate
    return None


def _disposition_for_key(source_key: str, mapper: Mapper | None) -> tuple[str, str | None, str | None]:
    if mapper is not None:
        if source_key in ENGAGEMENT_SOURCE_KEYS or source_key.startswith("kg_user_message_reads_v1__") or source_key.startswith("kg_user_feedback_reply_reads_v1__"):
            return DISPOSITION_MIGRATE, "engagement", None
        if source_key in PAPER_RELEASE_SOURCE_KEYS:
            return DISPOSITION_MIGRATE, "paper-release", None
        if source_key == "kg_content_taxonomies_v1" or source_key.startswith(TEACHING_RECALL_PREFIX):
            return DISPOSITION_MIGRATE, "teaching-content", None
    return DISPOSITION_UNKNOWN, None, "no registered relational target or explicit product disposition"


def _release_id(row: Mapping[str, Any]) -> str:
    return str(row.get("releaseId") or row.get("id") or "").strip()


def _publisher_id(row: Mapping[str, Any], fallback: str | None) -> str:
    publisher = row.get("publishedBy")
    if isinstance(publisher, Mapping):
        publisher = publisher.get("username") or publisher.get("id")
    return str(publisher or fallback or "").strip()


def _release_metadata(row: Mapping[str, Any]) -> dict[str, Any]:
    metadata = dict(row.get("metadata") or {}) if isinstance(row.get("metadata"), Mapping) else {}
    for key in ("categoryId", "categoryName", "purpose", "modeConfigVersion", "totalCount"):
        if key in row:
            metadata[key] = row[key]
    if len(json.dumps(metadata, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > MAX_RELEASE_METADATA_BYTES:
        raise ValueError("paper release metadata exceeds 64KB")
    return metadata


def _release_questions(row: Mapping[str, Any]) -> list[Any]:
    references = row.get("questions")
    if not isinstance(references, list):
        references = row.get("questionRefs")
    if not isinstance(references, list):
        raise ValueError("paper release questions are missing")
    if not references:
        raise ValueError("paper release contains no questions")
    return references


def _release_canonical(
    raw: Mapping[str, Any], source_key: str, seen_ids: set[str]
) -> dict[str, Any]:
    release_id = _release_id(raw)
    if not release_id or not RELEASE_ID_PATTERN.fullmatch(release_id):
        raise ValueError("paper release id is invalid")
    paper_id = str(raw.get("paperId") or raw.get("sourcePaperId") or "").strip()
    publisher_id = _publisher_id(raw, None)
    if not release_id or not paper_id or not publisher_id:
        raise ValueError("paper release source is missing a critical field")
    if release_id in seen_ids:
        raise ValueError(f"duplicate paper release id: {release_id}")
    seen_ids.add(release_id)
    references = _release_questions(raw)
    snapshots = raw.get("questionSnapshots")
    if not isinstance(snapshots, list):
        raise ValueError("paper release questionSnapshots are missing")
    snapshot_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for item_snapshot in snapshots:
        question = item_snapshot.get("question") if isinstance(item_snapshot, Mapping) else None
        if not isinstance(question, Mapping):
            continue
        bank_id = str(item_snapshot.get("bankId") or question.get("bankId") or "").strip()
        question_id = str(item_snapshot.get("questionId") or question.get("id") or "").strip()
        if bank_id and question_id:
            snapshot_by_key[(bank_id, question_id)] = dict(question)
    questions = []
    seen_questions: set[tuple[str, str]] = set()
    for index, reference in enumerate(references):
        if not isinstance(reference, Mapping):
            raise ValueError("paper release contains invalid question references")
        bank_id = str(reference.get("bankId") or "").strip()
        question_id = str(reference.get("questionId") or reference.get("id") or "").strip()
        identity = (bank_id, question_id)
        snapshot = snapshot_by_key.get(identity)
        if not bank_id or not question_id or snapshot is None:
            raise ValueError("paper release source is incomplete or missing snapshots")
        if identity in seen_questions:
            raise ValueError("paper release contains duplicate question ids")
        seen_questions.add(identity)
        questions.append({
            "bankId": bank_id,
            "questionId": question_id,
            "order": index + 1,
            "question": snapshot,
        })
    status = str(raw.get("status") or "published").strip().lower()
    if source_key == PAPER_RELEASE_HISTORY_KEY and status == "published":
        status = "superseded"
    access_policy = raw.get("accessPolicy") if isinstance(raw.get("accessPolicy"), Mapping) else {}
    published_at = raw.get("publishedAt")
    if isinstance(published_at, (int, float)):
        published_at_value = datetime.fromtimestamp(float(published_at) / 1000, tz=timezone.utc).isoformat()
    elif isinstance(published_at, str) and published_at.strip():
        published_at_value = published_at.strip()
    else:
        published_at_value = "1970-01-01T00:00:00+00:00"
    modes = raw.get("enabledModes")
    enabled_modes = [str(mode) for mode in modes] if isinstance(modes, list) else list(ALL_LEARNING_MODES)
    if not enabled_modes:
        raise ValueError("paper release enabledModes is empty")
    roles = raw.get("allowedRoles")
    allowed_roles = [str(role) for role in roles] if isinstance(roles, list) else []
    return {
        "releaseId": release_id,
        "paperId": paper_id,
        "version": max(1, int(raw.get("version") or raw.get("publishedVersion") or 1)),
        "status": status,
        "name": str(raw.get("name") or raw.get("title") or "未命名试卷")[:200],
        "subject": str(raw.get("subject") or "PMP")[:32],
        "description": str(raw.get("description") or "") or None,
        "publisherId": publisher_id,
        "accessLevel": str(access_policy.get("accessLevel") or raw.get("accessLevel") or "free"),
        "enabledModes": enabled_modes,
        "allowedRoles": allowed_roles,
        "metadata": _release_metadata(raw),
        "publishedAt": published_at_value,
        "questions": questions,
    }


def _normalize_release_source(payload: Any, source_key: str) -> list[dict[str, Any]]:
    if not isinstance(payload, list):
        raise ValueError("paper release source must be a list")
    seen_ids: set[str] = set()
    return [_release_canonical(raw, source_key, seen_ids) if isinstance(raw, Mapping)
            else (_ for _ in ()).throw(ValueError("paper release source contains invalid entries"))
            for raw in payload]


def _domain_verification_payload(payload: Any, source_key: str) -> list[dict[str, Any]]:
    return _normalize_release_source(payload, source_key)


async def _paper_release_mapper(db: AsyncSession, item: RuntimeMigrationItem) -> Mapping[str, Any]:
    if canonical_json_hash(item.source_payload) != item.source_hash:
        raise ValueError("frozen migration source hash mismatch")
    canonical = _normalize_release_source(item.source_payload, item.source_key)
    result: list[dict[str, Any]] = []
    for raw, source in zip(item.source_payload, canonical, strict=True):
        release_id = source["releaseId"]
        existing = await db.get(PaperRelease, release_id)
        if existing is not None:
            if item.source_key != PAPER_RELEASE_HISTORY_KEY:
                raise ValueError(f"paper release target already exists: {release_id}")
        else:
            published_at = datetime.fromisoformat(source["publishedAt"].replace("Z", "+00:00"))
            existing = PaperRelease(
                id=release_id,
                paper_id=source["paperId"],
                version=source["version"],
                status=source["status"],
                name=source["name"],
                subject=source["subject"],
                description=source["description"],
                publisher_id=source["publisherId"],
                access_level=source["accessLevel"],
                enabled_modes=source["enabledModes"],
                allowed_roles=source["allowedRoles"],
                release_metadata=source["metadata"],
                source_payload=dict(raw),
                question_count=len(source["questions"]),
                published_at=published_at,
            )
            db.add(existing)
            await db.flush()
            for question in source["questions"]:
                db.add(PaperReleaseQuestion(
                    release_id=release_id,
                    order_index=question["order"] - 1,
                    bank_id=question["bankId"],
                    question_id=question["questionId"],
                    snapshot=question["question"],
                ))
            await db.flush()
        result.append(await _read_one_paper_release_canonical(db, existing))
    return {"canonical_payload": result}


async def _teaching_content_mapper(db: AsyncSession, item: RuntimeMigrationItem) -> Mapping[str, Any]:
    canonical = _teaching_canonical(item.source_payload, item.source_key)
    subject_id = str(canonical["subjectId"])
    subject = await db.get(ContentSubject, subject_id)
    if subject is None:
        subject = ContentSubject(id=subject_id, code="PMP", name="PMP", content_metadata={})
        db.add(subject)
        await db.flush()
    if item.source_key == "kg_content_taxonomies_v1":
        entries = item.source_payload if isinstance(item.source_payload, list) else [item.source_payload]
        count = 0
        for raw in entries:
            if not isinstance(raw, Mapping):
                continue
            taxonomy_id = str(raw.get("id") or "").strip()
            if not taxonomy_id:
                continue
            row = await db.get(ContentTaxonomy, taxonomy_id)
            if row is None:
                row = ContentTaxonomy(id=taxonomy_id, subject_id=str(raw.get("subjectId") or subject_id), version=int(raw.get("version") or 1), status=str(raw.get("status") or "draft"), title=str(raw.get("title") or raw.get("name") or ""), content_metadata=dict(raw), updated_by=None if item.owner_scope in {"shared", ""} else item.owner_scope)
                db.add(row)
                await db.flush()
            for position, node in enumerate(raw.get("nodes") or []):
                if not isinstance(node, Mapping) or not node.get("id"):
                    continue
                node_id = str(node["id"])
                existing = await db.get(TaxonomyNode, f"{taxonomy_id}:{node_id}")
                if existing is None:
                    db.add(TaxonomyNode(id=f"{taxonomy_id}:{node_id}", taxonomy_id=taxonomy_id, node_id=node_id, parent_node_id=node.get("parentId"), title=str(node.get("title") or ""), record=dict(node), position=position))
                    count += 1
        return {"canonical_payload": _teaching_canonical(item.source_payload, item.source_key)}
    if item.source_key.startswith("kg_recall_association_library_v1__subject__"):
        raw = canonical["library"]
        row = (await db.execute(select(RecallAssociationLibrary).where(RecallAssociationLibrary.subject_id == subject_id, RecallAssociationLibrary.version == 1))).scalar_one_or_none()
        if row is None:
            db.add(RecallAssociationLibrary(id=f"recall-{subject_id}", subject_id=subject_id, version=1, nodes=list(raw.get("nodes") or []), edges=list(raw.get("edges") or []), content_metadata=dict(raw), updated_by=None if item.owner_scope in {"shared", ""} else item.owner_scope))
        else:
            row.nodes, row.edges, row.content_metadata = list(raw.get("nodes") or []), list(raw.get("edges") or []), dict(raw)
        return {"canonical_payload": _teaching_canonical(item.source_payload, item.source_key)}
    raise ValueError("unsupported teaching content source")


TEACHING_CONTENT_SOURCE_KEYS = {"kg_content_taxonomies_v1"}
TARGET_MAPPER_REGISTRY.update({
    "kg_content_taxonomies_v1": _teaching_content_mapper,
    "kg_recall_association_library_v1__subject__subject-pmp": _teaching_content_mapper,
    PUBLISHED_PAPERS_KEY: _paper_release_mapper,
    PAPER_RELEASE_HISTORY_KEY: _paper_release_mapper,
    **ENGAGEMENT_MAPPERS,
})


def canonical_json_hash(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _payload_count(payload: Any) -> int:
    if isinstance(payload, (list, dict)):
        return len(payload)
    return 0 if payload is None else 1


async def _require_run(db: AsyncSession, run_id: str) -> RuntimeMigrationRun:
    run = await db.get(RuntimeMigrationRun, run_id)
    if run is not None:
        return run
    statement = (
        insert(RuntimeMigrationRun)
        .values(id=run_id, status="scanning", report={})
        .on_conflict_do_nothing(index_elements=[RuntimeMigrationRun.id])
    )
    await db.execute(statement)
    await db.flush()
    return await db.get(RuntimeMigrationRun, run_id)


async def _runtime_sources(db: AsyncSession) -> list[Mapping[str, Any]]:
    sources: list[Mapping[str, Any]] = []
    runtime_rows = (
        await db.execute(select(RuntimeState.owner_id, RuntimeState.storage))
    ).all()
    for owner_id, storage in runtime_rows:
        for key, payload in dict(storage or {}).items():
            sources.append({
                "source_type": "runtime",
                "source_key": str(key),
                "owner_id": str(owner_id),
                "payload": payload,
                "required": True,
            })
    shared_rows = (
        await db.execute(select(SharedRuntimeState.key, SharedRuntimeState.value))
    ).all()
    for key, raw_value in shared_rows:
        try:
            payload = json.loads(str(raw_value))
            parse_error = None
        except (TypeError, ValueError, json.JSONDecodeError) as error:
            payload = str(raw_value)
            parse_error = f"shared runtime JSON parse failed: {error}"
        sources.append({
            "source_type": "shared_runtime",
            "source_key": str(key),
            "owner_scope": "shared",
            "payload": payload,
            "parse_error": parse_error,
            "required": True,
        })
    return sources


def _source_snapshot_payload(sources: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    payload = [
        {
            "source_type": str(source.get("source_type") or "runtime"),
            "source_key": str(source.get("source_key") or ""),
            "owner_scope": str(source.get("owner_id") or source.get("owner_scope") or ""),
            "payload": source.get("payload"),
            "required": bool(source.get("required", True)),
        }
        for source in sources
    ]
    return sorted(payload, key=lambda row: (row["source_type"], row["source_key"], row["owner_scope"], canonical_json_hash(row["payload"])))


async def plan(db: AsyncSession) -> dict[str, Any]:
    """Build a read-only migration plan without creating a run or ledger rows."""
    sources = await _runtime_sources(db)
    items = []
    for source in sources:
        source_key = str(source.get("source_key") or "")
        disposition, target_domain, discard_reason = _disposition_for_key(
            source_key, _mapper_for_key(TARGET_MAPPER_REGISTRY, source_key)
        )
        if source.get("parse_error"):
            disposition, target_domain, discard_reason = DISPOSITION_UNKNOWN, None, str(source["parse_error"])
        items.append({
            "source_type": str(source.get("source_type") or "runtime"),
            "source_key": source_key,
            "owner_scope": str(source.get("owner_id") or source.get("owner_scope") or ""),
            "required": bool(source.get("required", True)),
            "disposition": disposition,
            "target_domain": target_domain,
            "discard_reason": discard_reason,
            "source_hash": canonical_json_hash(source.get("payload")),
            "source_count": _payload_count(source.get("payload")),
        })
    return {
        "status": "planned",
        "items": len(items),
        "unknown": sum(item["disposition"] == DISPOSITION_UNKNOWN for item in items),
        "source_snapshot_hash": canonical_json_hash(_source_snapshot_payload(sources)),
        "plan": items,
    }


async def scan(
    db: AsyncSession,
    run_id: str | None = None,
    sources: Iterable[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    run_id = run_id or "runtime-domain-migration"
    run = await _require_run(db, run_id)
    run.status = "scanning"
    created = 0
    deduplicated = 0

    source_rows = list(sources) if sources is not None else await _runtime_sources(db)
    snapshot_payload = _source_snapshot_payload(source_rows)
    snapshot_hash = canonical_json_hash(snapshot_payload)
    run.source_snapshot_hash = snapshot_hash
    run.source_snapshot_count = len(snapshot_payload)
    run.snapshot_created_at = datetime.now(timezone.utc)
    run.backup_reference = run.backup_reference or f"runtime-migration:{run_id}:{snapshot_hash}"

    for source in source_rows:
        source_type = str(source.get("source_type") or "runtime")
        source_key = str(source.get("source_key") or "")
        owner_scope = str(source.get("owner_id") or source.get("owner_scope") or "")
        payload = source.get("payload")
        source_hash = canonical_json_hash(payload)
        mapper = _mapper_for_key(TARGET_MAPPER_REGISTRY, source_key)
        disposition, target_domain, discard_reason = _disposition_for_key(source_key, mapper)
        parse_error = source.get("parse_error")
        try:
            is_teaching_source = source_key == "kg_content_taxonomies_v1" or source_key.startswith(TEACHING_RECALL_PREFIX)
            is_domain_source = source_key in {PUBLISHED_PAPERS_KEY, PAPER_RELEASE_HISTORY_KEY} or source_key in ENGAGEMENT_SOURCE_KEYS or is_teaching_source
            expected_payload = (_domain_verification_payload(payload, source_key) if source_key in {PUBLISHED_PAPERS_KEY, PAPER_RELEASE_HISTORY_KEY} else engagement_expected_canonical(payload, source_key) if source_key in ENGAGEMENT_SOURCE_KEYS else _teaching_canonical(payload, source_key)) if is_domain_source else None
            expected_error = None
        except ValueError as error:
            is_domain_source = True
            expected_payload = None
            expected_error = str(error)
        if disposition == DISPOSITION_UNKNOWN:
            # Unknown keys stay pending: the ledger must await an explicit
            # disposition decision before migrate/verify can act on them.
            expected_error = None
        if parse_error:
            expected_error = parse_error
            disposition = DISPOSITION_UNKNOWN
            target_domain = None
            discard_reason = parse_error
        statement = (
            insert(RuntimeMigrationItem)
            .values(
                id=hashlib.sha256(
                    f"{run_id}\0{source_type}\0{source_key}\0{owner_scope}\0{source_hash}".encode()
                ).hexdigest()[:32],
                run_id=run_id,
                source_type=source_type,
                source_key=source_key,
                owner_scope=owner_scope,
                source_hash=source_hash,
                source_payload=payload,
                required=bool(source.get("required", True)),
                disposition=disposition,
                target_domain=target_domain,
                discard_reason=discard_reason,
                verification_metadata={
                    "source_hash": source_hash,
                    "source_count": int(source.get("source_count") or _payload_count(payload)),
                    "expected_hash": canonical_json_hash(expected_payload) if expected_payload is not None else None,
                    "expected_count": _payload_count(expected_payload) if expected_payload is not None else None,
                },
                source_count=int(source.get("source_count") or _payload_count(payload)),
                expected_count=_payload_count(expected_payload) if expected_payload is not None else None,
                expected_hash=canonical_json_hash(expected_payload) if expected_payload is not None else None,
                target_count=0,
                status="failed" if expected_error else "pending",
                error=expected_error,
            )
            .on_conflict_do_nothing(constraint="uq_runtime_migration_item_source_hash")
            .returning(RuntimeMigrationItem.id)
        )
        inserted_id = await db.scalar(statement)
        if inserted_id is None:
            deduplicated += 1
        else:
            created += 1

    total_items = await db.scalar(
        select(func.count()).select_from(RuntimeMigrationItem).where(
            RuntimeMigrationItem.run_id == run_id
        )
    )
    run.status = "scanned" if total_items else "empty"
    report = {
        "run_id": run_id,
        "status": run.status,
        "created": created,
        "deduplicated": deduplicated,
        "items": int(total_items or 0),
        "source_snapshot_hash": snapshot_hash,
        "source_snapshot_payload": snapshot_payload,
    }
    run.report = report
    await db.commit()
    return report


async def migrate(
    db: AsyncSession,
    run_id: str,
    target_mappers: Mapping[str, Mapper] | None = None,
    *,
    target_results: Mapping[str, Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    if target_results is not None:
        raise TypeError("target_results is not accepted; use registered target_mappers")
    registry = TARGET_MAPPER_REGISTRY if target_mappers is None else target_mappers
    run = await _require_run(db, run_id)
    run.status = "applying"
    items = list(
        (await db.scalars(
            select(RuntimeMigrationItem)
            .where(RuntimeMigrationItem.run_id == run_id)
            .order_by(
                (RuntimeMigrationItem.source_key != PUBLISHED_PAPERS_KEY),
                RuntimeMigrationItem.created_at,
            )
        )).all()
    )
    migrated = 0
    for index, item in enumerate(items):
        # rollback 会把所有已加载 ORM 对象标记过期；异步会话下过期属性只能
        # 经 await refresh 恢复，因此先记录 id，失败分支内全部重新加载。
        item_id = item.id
        if item.status != "pending":
            continue
        mapper = _mapper_for_key(registry, item.source_key)
        if mapper is None:
            continue
        try:
            result = mapper(db, item)
            if inspect.isawaitable(result):
                result = await result
        except (IntegrityError, ValueError) as error:
            error_message = str(error)
            await db.rollback()
            run = await _require_run(db, run_id)
            item = await db.get(RuntimeMigrationItem, item_id)
            item.status = "failed"
            item.error = error_message
            await db.commit()
            run = await _require_run(db, run_id)
            # rollback 使其余条目过期：重新查询本批剩余条目，避免同步路径触发懒加载
            remaining = list((await db.scalars(
                select(RuntimeMigrationItem)
                .where(RuntimeMigrationItem.run_id == run_id)
                .order_by(
                    (RuntimeMigrationItem.source_key != PUBLISHED_PAPERS_KEY),
                    RuntimeMigrationItem.created_at,
                )
            )).all())
            items[index:] = remaining[index:] if len(remaining) > index else []
            continue
        if not isinstance(result, Mapping) or "canonical_payload" not in result:
            item.error = "target mapper must return a mapping with canonical_payload"
            continue
        canonical_payload = result["canonical_payload"]
        item.status = "migrated"
        item.target_count = _payload_count(canonical_payload)
        item.target_hash = canonical_json_hash(canonical_payload)
        item.error = None
        migrated += 1
    pending = sum(1 for item in items if item.required and item.status == "pending")
    run.status = "applied" if pending == 0 else "verification_failed"
    report = {
        "run_id": run_id,
        "status": run.status,
        "items": len(items),
        "migrated": migrated,
        "pending": pending,
        # Carry the frozen scan snapshot forward; every stage must keep it so
        # the drop gate can re-verify after the live tables are emptied.
        "source_snapshot_payload": (run.report or {}).get("source_snapshot_payload"),
    }
    run.report = report
    await db.commit()
    return report


async def _read_one_paper_release_canonical(
    db: AsyncSession, release: PaperRelease
) -> dict[str, Any]:
    questions = list((await db.scalars(
        select(PaperReleaseQuestion)
        .where(PaperReleaseQuestion.release_id == release.id)
        .order_by(PaperReleaseQuestion.order_index)
    )).all())
    return {
        "releaseId": release.id,
        "paperId": release.paper_id,
        "version": release.version,
        "status": release.status,
        "name": release.name,
        "subject": release.subject,
        "description": release.description,
        "publisherId": release.publisher_id,
        "accessLevel": release.access_level,
        "enabledModes": release.enabled_modes or [],
        "allowedRoles": release.allowed_roles or [],
        "metadata": release.release_metadata or {},
        "publishedAt": release.published_at.isoformat(),
        "questions": [{
            "bankId": question.bank_id,
            "questionId": question.question_id,
            "order": question.order_index + 1,
            "question": question.snapshot,
        } for question in questions],
    }


async def _read_paper_release_canonical(
    db: AsyncSession, item: RuntimeMigrationItem
) -> list[dict[str, Any]]:
    expected = _domain_verification_payload(item.source_payload, item.source_key)
    canonical: list[dict[str, Any]] = []
    for source in expected:
        release = await db.get(PaperRelease, source["releaseId"])
        if release is not None:
            canonical.append(await _read_one_paper_release_canonical(db, release))
    return canonical


async def _read_engagement_canonical(db: AsyncSession, item: RuntimeMigrationItem) -> list[dict[str, Any]]:
    """Read canonical values from relational tables; never derive verification from source JSON."""
    source_key = item.source_key
    source_ids = [str(row.get("id") or "") for row in (item.source_payload if isinstance(item.source_payload, list) else []) if isinstance(row, Mapping) and row.get("id")]
    if source_key == "kg_announcements_v1":
        rows_by_id = {row.id: row for row in (await db.scalars(select(Announcement).where(Announcement.id.in_(source_ids)))).all()}
        result = []
        for identifier in source_ids:
            row = rows_by_id.get(identifier)
            if row is None:
                continue
            audiences = list((await db.scalars(select(AnnouncementAudience).where(AnnouncementAudience.announcement_id == row.id))).all())
            audience_type = audiences[0].audience_type if audiences else "all"
            result.append({
                "id": row.id, "title": row.title, "body": row.body, "link": row.link,
                "status": row.status, "publishAt": row.publish_at, "expiresAt": row.expires_at,
                "publishedAt": row.published_at, "withdrawnAt": row.withdrawn_at,
                "createdBy": row.created_by,
                "audience": {"type": audience_type,
                             "roles": [x.audience_value for x in audiences if x.audience_type == "roles"],
                             "users": [x.audience_value for x in audiences if x.audience_type == "users"]},
            })
        return result
    if source_key == "kg_user_feedback_v1":
        rows_by_id = {row.id: row for row in (await db.scalars(select(Feedback).where(Feedback.id.in_(source_ids)))).all()}
        result = []
        for identifier in source_ids:
            row = rows_by_id.get(identifier)
            if row is None:
                continue
            replies = list((await db.scalars(select(FeedbackReply).where(FeedbackReply.feedback_id == row.id))).all())
            result.append({
                "id": row.id, "type": row.type, "title": row.title, "detail": row.detail,
                "page": row.page, "appVersion": row.app_version, "contact": row.contact,
                "attachment": row.attachment, "status": row.status,
                "submittedBy": {"username": row.submitted_by},
                "replies": [{"id": x.id, "message": x.message, "actor": x.actor,
                             "actorUsername": x.actor_username, "createdAt": x.created_at} for x in replies],
            })
        return result
    if source_key.startswith("kg_user_message_reads_v1__"):
        rows = list((await db.scalars(select(MessageReceipt))).all())
        return sorted([{"id": x.id, "announcement_id": x.announcement_id, "username": x.username, "read_at": x.read_at} for x in rows], key=lambda x: (x["announcement_id"], x["username"]))
    if source_key.startswith("kg_user_feedback_reply_reads_v1__"):
        rows = list((await db.scalars(select(FeedbackReceipt))).all())
        return sorted([{"id": x.id, "feedback_id": x.feedback_id, "username": x.username, "read_at": x.read_at} for x in rows], key=lambda x: (x["feedback_id"], x["username"]))
    raise ValueError("unsupported engagement source")


async def _read_teaching_canonical(db: AsyncSession, item: RuntimeMigrationItem) -> dict[str, Any]:
    expected = _teaching_canonical(item.source_payload, item.source_key)
    subject_id = str(expected["subjectId"])
    if item.source_key == "kg_content_taxonomies_v1":
        target = []
        for source in expected["taxonomies"]:
            taxonomy_id = str(source.get("id") or "") if isinstance(source, Mapping) else ""
            row = await db.get(ContentTaxonomy, taxonomy_id) if taxonomy_id else None
            if row is not None:
                target.append(dict(row.content_metadata or {}))
        return {"subjectId": subject_id, "taxonomies": target}
    row = (await db.execute(select(RecallAssociationLibrary).where(
        RecallAssociationLibrary.subject_id == subject_id,
        RecallAssociationLibrary.version == 1,
    ))).scalar_one_or_none()
    return {"subjectId": subject_id, "library": dict(row.content_metadata or {}) if row else {}}


async def verify(db: AsyncSession, run_id: str) -> dict[str, Any]:
    run = await _require_run(db, run_id)
    items = list(
        (await db.scalars(select(RuntimeMigrationItem).where(RuntimeMigrationItem.run_id == run_id))).all()
    )
    current_target_by_release: dict[str, tuple[int, str]] = {}
    for candidate in items:
        if candidate.source_key != PUBLISHED_PAPERS_KEY or candidate.status not in {"migrated", "verified"}:
            continue
        try:
            current_sources = _normalize_release_source(candidate.source_payload, candidate.source_key)
        except ValueError:
            continue
        current_target_by_release.update({
            str(source["releaseId"]): (candidate.target_count, candidate.target_hash or "")
            for source in current_sources
        })
    for item in items:
        if item.status in {"migrated", "verified"}:
            if item.source_key in ENGAGEMENT_SOURCE_KEYS or item.source_key.startswith("kg_user_message_reads_v1__") or item.source_key.startswith("kg_user_feedback_reply_reads_v1__"):
                target_payload = await _read_engagement_canonical(db, item)
                item.target_count = _payload_count(target_payload)
                item.target_hash = canonical_json_hash(target_payload)
            elif item.source_key == "kg_content_taxonomies_v1" or item.source_key.startswith(TEACHING_RECALL_PREFIX):
                target_payload = await _read_teaching_canonical(db, item)
                item.target_count = _payload_count(target_payload)
                item.target_hash = canonical_json_hash(target_payload)
            elif item.source_key in {PUBLISHED_PAPERS_KEY, PAPER_RELEASE_HISTORY_KEY}:
                target_payload = await _read_paper_release_canonical(db, item)
                item.target_count = _payload_count(target_payload)
                item.target_hash = canonical_json_hash(target_payload)
                if item.source_key == PAPER_RELEASE_HISTORY_KEY:
                    try:
                        history_sources = _normalize_release_source(item.source_payload, item.source_key)
                    except ValueError:
                        history_sources = []
                    for source in history_sources:
                        current = current_target_by_release.get(str(source["releaseId"]))
                        if current is not None:
                            item.status = "failed"
                            item.error = "current release source must remain authoritative"
                            break
            expected_count = item.expected_count if item.expected_count is not None else item.source_count
            expected_hash = item.expected_hash or item.source_hash
            counts_match = expected_count == item.target_count
            hashes_match = bool(item.target_hash) and expected_hash == item.target_hash
            item.status = "verified" if counts_match and hashes_match else "failed"
            if not counts_match:
                item.error = "source and target counts differ"
            elif not hashes_match:
                item.error = "source and target hashes differ"
            else:
                item.error = None
    unknown = sum(1 for item in items if item.disposition == DISPOSITION_UNKNOWN)
    required_failures = sum(
        1 for item in items if item.required and item.status != "verified"
    )
    empty_failure = 1 if not items else 0
    required_failures += empty_failure
    run.status = "verified" if required_failures == 0 else "verification_failed"
    report = {
        "run_id": run_id,
        "status": run.status,
        "items": len(items),
        "required_failures": required_failures,
        "unknown": unknown,
        "source_snapshot_hash": run.source_snapshot_hash,
        "backup_reference": run.backup_reference,
        # Preserve the frozen scan snapshot so drop gates can re-verify even
        # after the live runtime tables have been emptied.
        "source_snapshot_payload": (run.report or {}).get("source_snapshot_payload"),
    }
    run.report = report
    await db.commit()
    return report


async def can_drop_runtime(db: AsyncSession, run_id: str) -> bool:
    run = await db.get(RuntimeMigrationRun, run_id)
    if run is None or run.status != "verified":
        return False
    # A drop is only safe when the immutable source snapshot and its backup marker exist.
    if not run.source_snapshot_hash or run.source_snapshot_count <= 0 or not run.backup_reference:
        return False
    current_sources = await _runtime_sources(db)
    current_snapshot = _source_snapshot_payload(current_sources)
    if not current_snapshot:
        stored_snapshot = (run.report or {}).get("source_snapshot_payload")
        if not isinstance(stored_snapshot, list):
            return False
        current_snapshot = stored_snapshot
    if len(current_snapshot) != run.source_snapshot_count:
        return False
    if canonical_json_hash(current_snapshot) != run.source_snapshot_hash:
        return False
    required_items = list(
        (
            await db.scalars(
                select(RuntimeMigrationItem).where(
                    RuntimeMigrationItem.run_id == run_id,
                    RuntimeMigrationItem.required.is_(True),
                )
            )
        ).all()
    )
    if not required_items:
        return False
    if any(item.disposition == DISPOSITION_UNKNOWN for item in required_items):
        return False
    if any(item.status != "verified" for item in required_items):
        return False
    source_keys = {item.source_key for item in required_items}
    paper_items_present = bool(source_keys & PAPER_RELEASE_SOURCE_KEYS)
    if paper_items_present and not PAPER_RELEASE_SOURCE_KEYS.issubset(source_keys):
        return False
    return all(
        (item.expected_count if item.expected_count is not None else item.source_count) == item.target_count
        and bool(item.target_hash)
        and (item.expected_hash or item.source_hash) == item.target_hash
        for item in required_items
    )


async def drop_check(db: AsyncSession, run_id: str) -> dict[str, Any]:
    """Read-only drop gate report; this function never executes DDL."""
    run = await db.get(RuntimeMigrationRun, run_id)
    allowed = await can_drop_runtime(db, run_id)
    items = list((await db.scalars(select(RuntimeMigrationItem).where(RuntimeMigrationItem.run_id == run_id))).all()) if run else []
    return {
        "run_id": run_id,
        "status": "drop_allowed" if allowed else "drop_blocked",
        "can_drop": allowed,
        "unknown": sum(item.disposition == DISPOSITION_UNKNOWN for item in items),
        "required_failures": sum(item.required and item.status != "verified" for item in items),
        "source_snapshot_hash": run.source_snapshot_hash if run else None,
        "backup_reference": run.backup_reference if run else None,
        "ddl_executed": False,
    }
