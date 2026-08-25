from __future__ import annotations

import pytest

from app.services.paper_composition_service import (
    CompositionCandidate,
    CompositionRequest,
    CompositionVariant,
    allocate_counts,
    build_plan,
    facet_values,
)


HARD_WEIGHTS = {"people": 42, "process": 50, "business-environment": 8}
SOFT_WEIGHTS = {
    "governance": 1,
    "scope": 1,
    "schedule": 1,
    "finance": 1,
    "stakeholder": 1,
    "resource": 1,
    "risk": 1,
}


def candidate(index: int, hard: str, soft: str = "governance") -> CompositionCandidate:
    return CompositionCandidate(
        question_id=f"q-{index:04d}",
        bank_id=f"bank-{index % 4}",
        metadata={
            "subjectFacets": [
                {"dimensionId": "exam-domain", "valueId": hard},
                {"dimensionId": "performance-domain", "valueId": soft},
            ]
        },
    )


def balanced_candidates() -> list[CompositionCandidate]:
    rows: list[CompositionCandidate] = []
    index = 0
    for hard, count in (("people", 90), ("process", 100), ("business-environment", 30)):
        for _ in range(count):
            soft = tuple(SOFT_WEIGHTS)[index % len(SOFT_WEIGHTS)]
            rows.append(candidate(index, hard, soft))
            index += 1
    return rows


def test_allocate_counts_uses_largest_remainder_and_exact_total() -> None:
    assert allocate_counts(
        {"people": 42, "process": 50, "business-environment": 8},
        60,
    ) == {
        "people": 25,
        "process": 30,
        "business-environment": 5,
    }
    assert allocate_counts({"a": 1, "b": 1, "c": 1}, 5) == {
        "a": 2,
        "b": 2,
        "c": 1,
    }


@pytest.mark.parametrize(
    ("weights", "total"),
    [
        ({}, 10),
        ({"people": 0, "process": 0}, 10),
        ({"people": -1, "process": 2}, 10),
        ({"people": 1}, 0),
    ],
)
def test_allocate_counts_rejects_invalid_weight_requests(
    weights: dict[str, float],
    total: int,
) -> None:
    with pytest.raises(ValueError):
        allocate_counts(weights, total)


def test_facet_values_normalizes_supported_aliases_and_standard_paths() -> None:
    assert facet_values(
        {
            "subjectFacets": [
                {"dimensionId": "exam-domain", "valueId": "environment"},
                {"facetId": "subject/PMP/performance-domain/financial"},
            ]
        }
    ) == {
        "exam-domain": "business-environment",
        "performance-domain": "finance",
    }


def test_build_plan_supports_unequal_variants_without_cross_paper_duplicates() -> None:
    request = CompositionRequest(
        variants=(
            CompositionVariant(code="A", name="模拟卷 A", total_count=60),
            CompositionVariant(code="B", name="模拟卷 B", total_count=50),
            CompositionVariant(code="C", name="模拟卷 C", total_count=40),
        ),
        hard_weights=HARD_WEIGHTS,
        soft_weights=SOFT_WEIGHTS,
        seed="parallel-seed",
    )

    plan = build_plan(request, balanced_candidates())

    assert [len(item.question_ids) for item in plan.variants] == [60, 50, 40]
    all_ids = [question_id for item in plan.variants for question_id in item.question_ids]
    assert len(all_ids) == len(set(all_ids))
    assert all(item.feasible for item in plan.variants)
    assert all(item.hard_actual == item.hard_targets for item in plan.variants)
    assert all(item.soft_actual == item.soft_targets for item in plan.variants)
    assert plan.plan_hash == build_plan(request, balanced_candidates()).plan_hash


def test_build_plan_is_input_order_independent_and_seed_sensitive() -> None:
    candidates = balanced_candidates()
    request = CompositionRequest(
        variants=(CompositionVariant(code="A", name="模拟卷 A", total_count=60),),
        hard_weights=HARD_WEIGHTS,
        soft_weights=SOFT_WEIGHTS,
        seed="seed-one",
    )
    reordered = build_plan(request, list(reversed(candidates)))
    original = build_plan(request, candidates)
    changed_seed = build_plan(
        CompositionRequest(
            variants=request.variants,
            hard_weights=request.hard_weights,
            soft_weights=request.soft_weights,
            seed="seed-two",
        ),
        candidates,
    )

    assert reordered.plan_hash == original.plan_hash
    assert reordered.variants[0].question_ids == original.variants[0].question_ids
    assert changed_seed.variants[0].question_ids != original.variants[0].question_ids
    assert changed_seed.variants[0].hard_actual == original.variants[0].hard_actual


def test_build_plan_reports_hard_shortage_without_stealing_or_using_unclassified() -> None:
    rows = [candidate(index, "people") for index in range(30)]
    rows.extend(candidate(100 + index, "process") for index in range(30))
    rows.extend(candidate(200 + index, "business-environment") for index in range(2))
    rows.extend(candidate(300 + index, "") for index in range(10))
    request = CompositionRequest(
        variants=(CompositionVariant(code="A", name="模拟卷 A", total_count=60),),
        hard_weights=HARD_WEIGHTS,
        soft_weights={},
        seed="shortage-seed",
    )

    plan = build_plan(request, rows)

    assert plan.unclassified_count == 10
    assert plan.variants[0].feasible is False
    assert plan.variants[0].hard_shortages == {"business-environment": 3}
    assert len(plan.variants[0].question_ids) == 57
