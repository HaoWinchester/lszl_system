"""Deterministic quota allocation and parallel paper composition."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
import hashlib
import json
import math
import secrets
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import uid
from app.models.paper import PaperGenerationBatch
from app.models.question import ExamPaper, PaperQuestion, Question, QuestionBank
from app.models.user import User
from app.schemas.paper import (
    PaperCompositionBatchRequest,
    PaperCompositionPreflightRequest,
)
from app.services import idempotency_service, paper_service, teaching_content_revision_service


EXAM_DOMAIN = "exam-domain"
PERFORMANCE_DOMAIN = "performance-domain"
_EXAM_ALIASES = {"environment": "business-environment"}
_PERFORMANCE_ALIASES = {
    "financial": "finance",
    "resources": "resource",
    "stakeholders": "stakeholder",
}


@dataclass(frozen=True)
class CompositionCandidate:
    question_id: str
    bank_id: str
    metadata: Mapping[str, Any]


@dataclass(frozen=True)
class CompositionVariant:
    code: str
    name: str
    total_count: int


@dataclass(frozen=True)
class CompositionRequest:
    variants: tuple[CompositionVariant, ...]
    hard_weights: Mapping[str, float]
    soft_weights: Mapping[str, float]
    seed: str


@dataclass(frozen=True)
class CompositionVariantPlan:
    code: str
    name: str
    total_count: int
    question_ids: tuple[str, ...]
    hard_targets: dict[str, int]
    hard_actual: dict[str, int]
    hard_shortages: dict[str, int]
    soft_targets: dict[str, int]
    soft_actual: dict[str, int]
    feasible: bool


@dataclass(frozen=True)
class CompositionPlan:
    variants: tuple[CompositionVariantPlan, ...]
    candidate_count: int
    unclassified_count: int
    plan_hash: str


def allocate_counts(weights: Mapping[str, float], total: int) -> dict[str, int]:
    """Convert positive relative weights into exact integer counts."""

    if isinstance(total, bool) or not isinstance(total, int) or total <= 0:
        raise ValueError("total must be a positive integer")
    if not isinstance(weights, Mapping) or not weights:
        raise ValueError("weights must contain at least one positive value")

    normalized: list[tuple[str, float, int]] = []
    for index, (raw_key, raw_weight) in enumerate(weights.items()):
        key = str(raw_key).strip()
        if not key:
            raise ValueError("weight keys cannot be empty")
        if isinstance(raw_weight, bool):
            raise ValueError("weights must be finite non-negative numbers")
        try:
            weight = float(raw_weight)
        except (TypeError, ValueError) as error:
            raise ValueError("weights must be finite non-negative numbers") from error
        if not math.isfinite(weight) or weight < 0:
            raise ValueError("weights must be finite non-negative numbers")
        if weight > 0:
            normalized.append((key, weight, index))

    weight_sum = sum(weight for _, weight, _ in normalized)
    if not normalized or weight_sum <= 0:
        raise ValueError("weights must contain at least one positive value")

    exact = [
        (key, total * weight / weight_sum, index)
        for key, weight, index in normalized
    ]
    result = {key: math.floor(value) for key, value, _ in exact}
    remaining = total - sum(result.values())
    remainders = sorted(
        exact,
        key=lambda item: (-(item[1] - math.floor(item[1])), item[2]),
    )
    for key, _, _ in remainders[:remaining]:
        result[key] += 1
    return result


def facet_values(metadata: Mapping[str, Any]) -> dict[str, str]:
    """Read the first value for each supported subject-facet dimension."""

    if not isinstance(metadata, Mapping):
        return {}
    raw_facets = metadata.get("subjectFacets")
    if not isinstance(raw_facets, list):
        raw_facets = metadata.get("facets")
    if not isinstance(raw_facets, list):
        return {}

    result: dict[str, str] = {}
    for raw in raw_facets:
        if not isinstance(raw, Mapping):
            continue
        dimension = str(raw.get("dimensionId") or "").strip()
        value = str(raw.get("valueId") or "").strip()
        facet_id = str(raw.get("facetId") or raw.get("id") or raw.get("path") or "").strip()
        parts = [part for part in facet_id.split("/") if part]
        if not dimension and len(parts) >= 4 and parts[0] == "subject":
            dimension = parts[2]
            value = value or "/".join(parts[3:])
        elif not value and parts:
            value = parts[-1]
        if dimension == EXAM_DOMAIN:
            value = _EXAM_ALIASES.get(value, value)
        elif dimension == PERFORMANCE_DOMAIN:
            value = _PERFORMANCE_ALIASES.get(value, value)
        if dimension and value and dimension not in result:
            result[dimension] = value
    return result


@dataclass(frozen=True)
class _PreparedCandidate:
    question_id: str
    bank_id: str
    hard_value: str
    soft_value: str
    stable_key: str


def _prepare_candidates(
    candidates: Sequence[CompositionCandidate],
    seed: str,
) -> tuple[list[_PreparedCandidate], int]:
    prepared: list[_PreparedCandidate] = []
    seen: set[str] = set()
    unclassified = 0
    for candidate in candidates:
        question_id = str(candidate.question_id or "").strip()
        bank_id = str(candidate.bank_id or "").strip()
        if not question_id or not bank_id:
            raise ValueError("candidates require question_id and bank_id")
        if question_id in seen:
            raise ValueError(f"duplicate candidate question_id: {question_id}")
        seen.add(question_id)
        facets = facet_values(candidate.metadata)
        hard_value = facets.get(EXAM_DOMAIN, "")
        if not hard_value:
            unclassified += 1
            continue
        stable_key = hashlib.sha256(
            f"{seed}\0{bank_id}\0{question_id}".encode("utf-8")
        ).hexdigest()
        prepared.append(
            _PreparedCandidate(
                question_id=question_id,
                bank_id=bank_id,
                hard_value=hard_value,
                soft_value=facets.get(PERFORMANCE_DOMAIN, ""),
                stable_key=stable_key,
            )
        )
    prepared.sort(key=lambda item: (item.stable_key, item.bank_id, item.question_id))
    return prepared, unclassified


def _validate_request(request: CompositionRequest) -> None:
    if not request.variants:
        raise ValueError("at least one variant is required")
    codes: set[str] = set()
    for variant in request.variants:
        code = str(variant.code or "").strip()
        if not code or code in codes:
            raise ValueError("variant codes must be non-empty and unique")
        codes.add(code)
        if (
            isinstance(variant.total_count, bool)
            or not isinstance(variant.total_count, int)
            or variant.total_count <= 0
        ):
            raise ValueError("variant total_count must be a positive integer")
    allocate_counts(request.hard_weights, 1)
    if request.soft_weights:
        allocate_counts(request.soft_weights, 1)


def _pick_variant(
    variant: CompositionVariant,
    available: Sequence[_PreparedCandidate],
    hard_weights: Mapping[str, float],
    soft_weights: Mapping[str, float],
) -> CompositionVariantPlan:
    hard_targets = allocate_counts(hard_weights, variant.total_count)
    soft_targets = (
        allocate_counts(soft_weights, variant.total_count) if soft_weights else {}
    )
    hard_actual = {key: 0 for key in hard_targets}
    soft_actual = {key: 0 for key in soft_targets}
    selected: list[_PreparedCandidate] = []
    remaining = list(available)
    exhausted: set[str] = set()

    while len(selected) < variant.total_count:
        bucket = ""
        bucket_deficit = 0
        for hard_value, target in hard_targets.items():
            deficit = target - hard_actual[hard_value]
            if hard_value not in exhausted and deficit > bucket_deficit:
                bucket = hard_value
                bucket_deficit = deficit
        if not bucket:
            break

        matching = [item for item in remaining if item.hard_value == bucket]
        if not matching:
            exhausted.add(bucket)
            continue

        def score(item: _PreparedCandidate) -> tuple[int, str, str]:
            soft_deficit = max(
                0,
                soft_targets.get(item.soft_value, 0)
                - soft_actual.get(item.soft_value, 0),
            )
            return (-soft_deficit, item.stable_key, item.question_id)

        chosen = min(matching, key=score)
        remaining.remove(chosen)
        selected.append(chosen)
        hard_actual[bucket] += 1
        if chosen.soft_value in soft_actual:
            soft_actual[chosen.soft_value] += 1

    hard_shortages = {
        key: target - hard_actual[key]
        for key, target in hard_targets.items()
        if hard_actual[key] < target
    }
    return CompositionVariantPlan(
        code=str(variant.code),
        name=str(variant.name),
        total_count=variant.total_count,
        question_ids=tuple(item.question_id for item in selected),
        hard_targets=hard_targets,
        hard_actual=hard_actual,
        hard_shortages=hard_shortages,
        soft_targets=soft_targets,
        soft_actual=soft_actual,
        feasible=not hard_shortages and len(selected) == variant.total_count,
    )


def build_plan(
    request: CompositionRequest,
    candidates: Sequence[CompositionCandidate],
) -> CompositionPlan:
    """Build reproducible variant plans while excluding batch-used questions."""

    _validate_request(request)
    prepared, unclassified_count = _prepare_candidates(candidates, str(request.seed))
    used: set[str] = set()
    variant_plans: list[CompositionVariantPlan] = []
    for variant in request.variants:
        available = [item for item in prepared if item.question_id not in used]
        plan = _pick_variant(
            variant,
            available,
            request.hard_weights,
            request.soft_weights,
        )
        variant_plans.append(plan)
        used.update(plan.question_ids)

    hash_payload = {
        "seed": str(request.seed),
        "hardWeights": dict(request.hard_weights),
        "softWeights": dict(request.soft_weights),
        "variants": [
            {
                "code": item.code,
                "name": item.name,
                "totalCount": item.total_count,
                "questionIds": list(item.question_ids),
                "hardTargets": item.hard_targets,
                "hardActual": item.hard_actual,
                "hardShortages": item.hard_shortages,
                "softTargets": item.soft_targets,
                "softActual": item.soft_actual,
                "feasible": item.feasible,
            }
            for item in variant_plans
        ],
    }
    plan_hash = hashlib.sha256(
        json.dumps(
            hash_payload,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()
    return CompositionPlan(
        variants=tuple(variant_plans),
        candidate_count=len(candidates),
        unclassified_count=unclassified_count,
        plan_hash=plan_hash,
    )


def _error(status: int, code: str, message: str, **details: Any) -> HTTPException:
    return HTTPException(
        status_code=status,
        detail={"code": code, "message": message, **details},
    )


def _filter_values(filters: Mapping[str, Any], *keys: str) -> set[str]:
    raw: object = None
    for key in keys:
        if key in filters:
            raw = filters[key]
            break
    if raw is None:
        return set()
    values = raw if isinstance(raw, list) else [raw]
    return {str(item).strip() for item in values if str(item).strip()}


async def _load_candidates(
    db: AsyncSession,
    request: PaperCompositionPreflightRequest,
) -> tuple[list[Question], list[CompositionCandidate], dict[str, dict[str, int]]]:
    requested_bank_ids = list(request.bank_ids)
    banks = list(
        (
            await db.execute(
                select(QuestionBank).where(QuestionBank.id.in_(requested_bank_ids))
            )
        ).scalars().all()
    )
    by_id = {item.id: item for item in banks}
    missing = [item for item in requested_bank_ids if item not in by_id]
    if missing:
        raise _error(
            404,
            "COMPOSITION_BANK_NOT_FOUND",
            "候选题库不存在",
            bankIds=missing,
        )
    mismatched = [
        item.id for item in banks if str(item.subject or "") != request.subject
    ]
    if mismatched:
        raise _error(
            422,
            "COMPOSITION_BANK_SUBJECT_MISMATCH",
            "候选题库与组卷科目不一致",
            bankIds=mismatched,
        )

    question_types = _filter_values(request.filters, "types", "type")
    difficulties = _filter_values(
        request.filters,
        "difficulties",
        "difficulty",
    )
    question_ids = _filter_values(request.filters, "questionIds", "question_ids")
    rows = list(
        (
            await db.execute(
                select(Question).where(Question.bank_id.in_(requested_bank_ids))
            )
        ).scalars().all()
    )
    eligible: list[Question] = []
    candidates: list[CompositionCandidate] = []
    hard_inventory: dict[str, int] = {}
    soft_inventory: dict[str, int] = {}
    for question in rows:
        lifecycle = question.lifecycle if isinstance(question.lifecycle, dict) else {}
        if str(lifecycle.get("status") or "").casefold() == "deleted":
            continue
        if question_types and str(question.type or "") not in question_types:
            continue
        if difficulties and str(question.difficulty or "") not in difficulties:
            continue
        if question_ids and question.id not in question_ids:
            continue
        metadata = (
            question.content_metadata
            if isinstance(question.content_metadata, dict)
            else {}
        )
        eligible.append(question)
        candidates.append(
            CompositionCandidate(
                question_id=question.id,
                bank_id=question.bank_id,
                metadata=metadata,
            )
        )
        facets = facet_values(metadata)
        hard_value = facets.get(EXAM_DOMAIN, "")
        soft_value = facets.get(PERFORMANCE_DOMAIN, "")
        if hard_value:
            hard_inventory[hard_value] = hard_inventory.get(hard_value, 0) + 1
        if soft_value:
            soft_inventory[soft_value] = soft_inventory.get(soft_value, 0) + 1
    return eligible, candidates, {"hard": hard_inventory, "soft": soft_inventory}


async def preflight_composition(
    db: AsyncSession,
    actor: User,
    request: PaperCompositionPreflightRequest,
) -> dict:
    del actor  # Shared paper management permission is enforced by the route.
    questions, candidates, inventory = await _load_candidates(db, request)
    seed = request.random_seed or secrets.token_hex(16)
    planner_request = CompositionRequest(
        variants=tuple(
            CompositionVariant(
                code=item.code,
                name=item.name,
                total_count=item.total_count,
            )
            for item in request.variants
        ),
        hard_weights=request.hard_quota.weights,
        soft_weights=(
            request.soft_quota.weights if request.soft_quota is not None else {}
        ),
        seed=seed,
    )
    try:
        plan = build_plan(planner_request, candidates)
    except ValueError as error:
        raise _error(
            422,
            "COMPOSITION_REQUEST_INVALID",
            str(error),
        ) from error
    question_banks = {item.id: item.bank_id for item in questions}
    variants = [
        {
            "code": item.code,
            "name": item.name,
            "totalCount": item.total_count,
            "questionIds": list(item.question_ids),
            "references": [
                {
                    "bankId": question_banks[question_id],
                    "questionId": question_id,
                    "order": index + 1,
                    "score": 1,
                }
                for index, question_id in enumerate(item.question_ids)
            ],
            "hardTargets": item.hard_targets,
            "hardActual": item.hard_actual,
            "hardShortages": item.hard_shortages,
            "softTargets": item.soft_targets,
            "softActual": item.soft_actual,
            "softDeviation": {
                key: item.soft_actual.get(key, 0) - target
                for key, target in item.soft_targets.items()
            },
            "feasible": item.feasible,
        }
        for item in plan.variants
    ]
    normalized_request = request.model_dump(by_alias=True, exclude_none=True)
    normalized_request["randomSeed"] = seed
    feasible_codes = [item["code"] for item in variants if item["feasible"]]
    selected_ids = [
        question_id
        for item in variants
        for question_id in item["questionIds"]
    ]
    duplicates: set[str] = set()
    seen: set[str] = set()
    for question_id in selected_ids:
        if question_id in seen:
            duplicates.add(question_id)
        seen.add(question_id)
    return {
        "normalizedRequest": normalized_request,
        "candidateCount": plan.candidate_count,
        "unclassifiedCount": plan.unclassified_count,
        "inventory": inventory,
        "variants": variants,
        "feasible": all(item["feasible"] for item in variants),
        "feasibleVariantCodes": feasible_codes,
        "duplicateQuestionIds": sorted(duplicates),
        "planHash": plan.plan_hash,
    }


def _batch_request_hash(request: PaperCompositionBatchRequest) -> str:
    payload = request.model_dump(
        by_alias=True,
        exclude={"idempotency_key"},
        exclude_none=True,
    )
    return hashlib.sha256(
        json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


async def _serialize_batch(
    db: AsyncSession,
    actor: User,
    batch: PaperGenerationBatch,
    *,
    replayed: bool,
) -> dict:
    papers: list[dict] = []
    for paper_id in batch.created_paper_ids or []:
        paper = await paper_service.get_paper(db, actor, str(paper_id))
        if paper is not None:
            papers.append(paper)
    config = batch.filter_config if isinstance(batch.filter_config, dict) else {}
    return {
        "batchId": batch.id,
        "status": batch.status,
        "randomSeed": batch.random_seed,
        "planHash": str(config.get("planHash") or ""),
        "papers": papers,
        "replayed": replayed,
    }


async def create_composition_batch(
    db: AsyncSession,
    actor: User,
    request: PaperCompositionBatchRequest,
) -> dict:
    request_hash = _batch_request_hash(request)
    await teaching_content_revision_service.acquire_lock(db)
    await idempotency_service.lock(db, actor.username, request.idempotency_key)
    existing = (
        await db.execute(
            select(PaperGenerationBatch)
            .where(
                PaperGenerationBatch.actor_username == actor.username,
                PaperGenerationBatch.idempotency_key == request.idempotency_key,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if existing is not None:
        config = existing.filter_config if isinstance(existing.filter_config, dict) else {}
        if config.get("requestHash") != request_hash:
            raise _error(
                409,
                "IDEMPOTENCY_PAYLOAD_CONFLICT",
                "相同幂等键不能用于不同组卷请求",
            )
        return await _serialize_batch(db, actor, existing, replayed=True)

    preflight_request = PaperCompositionPreflightRequest.model_validate(
        request.model_dump(
            exclude={"plan_hash", "idempotency_key"},
            exclude_none=True,
        )
    )
    preflight = await preflight_composition(db, actor, preflight_request)
    if preflight["planHash"] != request.plan_hash:
        raise _error(
            409,
            "COMPOSITION_PLAN_CHANGED",
            "候选题状态已变化，请重新预检",
            currentPlanHash=preflight["planHash"],
        )
    if not preflight["feasible"]:
        raise _error(
            422,
            "COMPOSITION_SHORTAGE",
            "当前所选试卷存在硬配额库存不足，请取消全部或重新预检可行集合",
            variants=preflight["variants"],
        )

    batch = PaperGenerationBatch(
        id=uid("pgb_"),
        owner_id=actor.username,
        actor_username=actor.username,
        idempotency_key=request.idempotency_key,
        subject=request.subject,
        bank_ids=list(request.bank_ids),
        filter_config={
            "filters": request.filters,
            "requestHash": request_hash,
            "planHash": preflight["planHash"],
        },
        quota_config={
            "hardQuota": request.hard_quota.model_dump(by_alias=True),
            "softQuota": (
                request.soft_quota.model_dump(by_alias=True)
                if request.soft_quota is not None
                else None
            ),
        },
        random_seed=str(preflight["normalizedRequest"]["randomSeed"]),
        requested_variants=[
            item.model_dump(by_alias=True) for item in request.variants
        ],
        created_paper_ids=[],
        status="creating",
    )
    db.add(batch)
    await db.flush()

    created_papers: list[ExamPaper] = []
    for variant in preflight["variants"]:
        paper = ExamPaper(
            id=uid("p_"),
            owner_id=actor.username,
            revision=1,
            created_by=actor.username,
            updated_by=actor.username,
            name=variant["name"],
            subject=request.subject,
            total_count=variant["totalCount"],
            status="draft",
            quotas=variant["hardTargets"],
            generation_batch_id=batch.id,
            variant_code=variant["code"],
            generation_config={
                "planHash": preflight["planHash"],
                "randomSeed": batch.random_seed,
                "filters": request.filters,
                "hardQuota": request.hard_quota.model_dump(by_alias=True),
                "softQuota": (
                    request.soft_quota.model_dump(by_alias=True)
                    if request.soft_quota is not None
                    else None
                ),
                "hardActual": variant["hardActual"],
                "softTargets": variant["softTargets"],
                "softActual": variant["softActual"],
            },
        )
        db.add(paper)
        created_papers.append(paper)
    await db.flush()

    for paper, variant in zip(created_papers, preflight["variants"], strict=True):
        for reference in variant["references"]:
            db.add(
                PaperQuestion(
                    paper_id=paper.id,
                    question_id=reference["questionId"],
                    order_index=reference["order"] - 1,
                    score=reference["score"],
                )
            )
    await db.flush()
    batch.created_paper_ids = [paper.id for paper in created_papers]
    batch.status = "created"
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "paperBatch", "entityId": batch.id, "action": "created"}],
    )
    result = await _serialize_batch(db, actor, batch, replayed=False)
    await db.commit()
    return result
