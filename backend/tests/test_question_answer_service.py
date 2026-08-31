import pytest

from app.services.question_answer_service import (
    correct_option_ids,
    grade_selection,
    validate_multiple_choice,
)


def multiple_choice_question(**overrides: object) -> dict:
    question = {
        "id": "question-1",
        "type": "multiple_choice",
        "options": [
            {"id": "A", "text": "A"},
            {"id": "B", "text": "B"},
            {"id": "C", "text": "C"},
            {"id": "D", "text": "D"},
        ],
        "correctOptionIds": ["A", "C"],
        "analysis": "A、C 正确。",
    }
    question.update(overrides)
    return question


def test_grade_selection_accepts_only_the_exact_option_set() -> None:
    question = multiple_choice_question()

    assert grade_selection(question, ["C", "A"])["correct"] is True
    assert grade_selection(question, ["A"])["correct"] is False
    assert grade_selection(question, ["A", "B", "C"])["correct"] is False
    assert grade_selection(question, ["B", "D"])["correct"] is False


def test_grade_selection_reports_missed_and_wrong_options() -> None:
    result = grade_selection(multiple_choice_question(), ["A", "B"])

    assert result == {
        "correct": False,
        "correctOptionIds": ["A", "C"],
        "selectedOptionIds": ["A", "B"],
        "missedCorrectIds": ["C"],
        "wrongSelectedIds": ["B"],
    }


def test_timed_out_selection_is_always_wrong() -> None:
    result = grade_selection(
        multiple_choice_question(),
        ["A", "C"],
        timed_out=True,
    )

    assert result["correct"] is False
    assert result["selectedOptionIds"] == []
    assert result["missedCorrectIds"] == ["A", "C"]


def test_explicit_answer_array_wins_and_is_ordered_by_options() -> None:
    question = multiple_choice_question(
        correctOptionIds=["C", "A"],
        correctAnswer="BD",
    )

    assert correct_option_ids(question) == ["A", "C"]


@pytest.mark.parametrize(
    ("question", "expected"),
    [
        (
            multiple_choice_question(
                correctOptionIds=None,
                correctAnswer="AC",
            ),
            ["A", "C"],
        ),
        (
            multiple_choice_question(
                options=[
                    {"id": "AA", "text": "AA"},
                    {"id": "B", "text": "B"},
                    {"id": "C", "text": "C"},
                ],
                correctOptionIds=None,
                correctAnswer="AAC",
            ),
            [],
        ),
    ],
)
def test_legacy_joined_answer_is_read_only_when_unambiguous(
    question: dict,
    expected: list[str],
) -> None:
    assert correct_option_ids(question) == expected


@pytest.mark.parametrize(
    ("overrides", "expected_code"),
    [
        ({"options": [{"id": "A"}, {"id": "B"}]}, "MULTIPLE_CHOICE_OPTIONS_COUNT"),
        ({"correctOptionIds": ["A"]}, "MULTIPLE_CHOICE_CORRECT_COUNT"),
        ({"correctOptionIds": ["A", "B", "C", "D"]}, "MULTIPLE_CHOICE_DISTRACTOR_REQUIRED"),
        ({"correctOptionIds": ["A", "Z"]}, "MULTIPLE_CHOICE_CORRECT_OPTION_INVALID"),
        ({"analysis": ""}, "MULTIPLE_CHOICE_ANALYSIS_REQUIRED"),
    ],
)
def test_multiple_choice_validation_rejects_invalid_release_content(
    overrides: dict,
    expected_code: str,
) -> None:
    issues = validate_multiple_choice(
        multiple_choice_question(**overrides),
        require_analysis=True,
    )

    assert expected_code in [issue["code"] for issue in issues]


def test_multiple_choice_draft_allows_missing_analysis() -> None:
    assert validate_multiple_choice(
        multiple_choice_question(analysis=""),
        require_analysis=False,
    ) == []
