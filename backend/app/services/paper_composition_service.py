"""Deterministic quota allocation and parallel paper composition."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
import hashlib
import json
import math
from typing import Any


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
