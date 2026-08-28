"""Selecting from an already published paper must not recompose its domains."""

import pytest

from app.models.paper_release import PaperReleaseQuestion
from app.services.practice_session_service import PracticeSessionError, _select_questions


WEIGHTS = {"people": 42, "process": 50, "business-environment": 8}


def rows_for(domains):
    return [PaperReleaseQuestion(
        release_id="published-paper", question_id=f"q-{index}", bank_id="bank",
        order_index=index,
        snapshot={"metadata": {"subjectFacets": [
            {"dimensionId": "exam-domain", "valueId": domain},
        ]}, "releaseScore": 2 if index == 0 else 1},
    ) for index, domain in enumerate(domains)]


@pytest.mark.parametrize("count", [10, 20, 60, 180])
def test_published_paper_order_is_preserved_even_when_inventory_meets_default_ratio(count):
    rows = rows_for(["people"] * 78 + ["process"] * 92 + ["business-environment"] * 15)
    refs, targets, complete = _select_questions(rows, count=count, order="paper", seed="test", weights=WEIGHTS)
    assert [ref["questionId"] for ref in refs] == [f"q-{index}" for index in range(count)]
    assert sum(targets.values()) == count
    assert refs[0]["score"] == 2
    assert complete is True


def test_published_random_selection_is_unique_seeded_and_not_blocked_by_missing_domain():
    rows = rows_for(["process"] * 101 + ["people"] * 84)
    first = _select_questions(rows, count=180, order="random", seed="same", weights=WEIGHTS)
    again = _select_questions(rows, count=180, order="random", seed="same", weights=WEIGHTS)
    different = _select_questions(rows, count=180, order="random", seed="different", weights=WEIGHTS)
    assert first == again
    assert first != different
    ids = [ref["questionId"] for ref in first[0]]
    assert len(set(ids)) == 180
    assert set(ids) <= {f"q-{index}" for index in range(185)}
    assert ids != [f"q-{index}" for index in range(180)]
    assert first[1]["business-environment"] == 0


def test_total_inventory_shortage_still_fails_without_repeating_questions():
    with pytest.raises(PracticeSessionError) as caught:
        _select_questions(rows_for(["people"] * 3), count=4, order="paper", seed="test", weights=WEIGHTS)
    assert caught.value.status_code == 422
    assert caught.value.code == "PRACTICE_QUESTION_SHORTAGE"
    assert caught.value.context == {"available": 3, "requested": 4}
