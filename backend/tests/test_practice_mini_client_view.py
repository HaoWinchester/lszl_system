"""Response-projection tests for native mini-program practice clients."""

from app.services.practice_client_view_service import project_practice_payload


def test_bearer_challenge_payload_has_no_answer_markers() -> None:
    source = {
        "session": {"mode": "challenge", "status": "active"},
        "correctAnswer": "A",
        "correctOptionIds": ["A"],
        "options": [
            {"id": "A", "text": "甲", "correct": True},
            {"id": "B", "text": "乙", "correct": False},
        ],
        "analysis": "解释",
        "nested": {"explanation": "说明", "reasoningSteps": ["一"]},
    }

    result = project_practice_payload(source, transport="bearer")

    assert result == {
        "session": {"mode": "challenge", "status": "active"},
        "options": [{"id": "A", "text": "甲"}, {"id": "B", "text": "乙"}],
        "nested": {},
    }
    assert source["correctAnswer"] == "A"
    assert source["options"][0]["correct"] is True


def test_cookie_payload_is_returned_unchanged() -> None:
    source = {"correctAnswer": "A", "options": [{"correct": True}]}
    assert project_practice_payload(source, transport="cookie") is source


def test_normal_answer_can_reveal_only_when_route_allows_it() -> None:
    source = {
        "session": {"mode": "practice", "status": "active"},
        "answer": {"correctAnswer": "A", "analysis": "解释"},
    }
    hidden = project_practice_payload(source, transport="bearer")
    revealed = project_practice_payload(source, transport="bearer", allow_current_reveal=True)
    assert hidden["answer"] == {}
    assert revealed == source
    assert revealed is not source


def test_normal_answer_reveals_only_the_submitted_question() -> None:
    source = {
        "session": {
            "mode": "practice",
            "status": "active",
            "questions": [
                {"questionId": "q1", "question": {"analysis": "第一题", "correctAnswer": "A"}},
                {"questionId": "q2", "question": {"analysis": "第二题", "correctAnswer": "B"}},
            ],
        },
        "answer": {"questionId": "q1", "correctAnswer": "A", "correct": True},
    }
    result = project_practice_payload(source, transport="bearer", allow_current_reveal=True)
    assert result["answer"] == source["answer"]
    assert result["session"]["questions"][0]["question"] == {
        "analysis": "第一题",
        "correctAnswer": "A",
    }
    assert result["session"]["questions"][1]["question"] == {}


def test_completed_session_can_reveal_for_every_mode() -> None:
    source = {
        "session": {"mode": "scholar", "status": "completed"},
        "report": {"correctOptionIds": ["B"], "explanation": "完成后可看"},
    }
    assert project_practice_payload(source, transport="bearer") == source


def test_reveal_flag_never_leaks_competitive_answer() -> None:
    source = {
        "session": {"mode": "challenge", "status": "active"},
        "answer": {"correctAnswer": "C", "correct": True},
    }
    result = project_practice_payload(source, transport="bearer", allow_current_reveal=True)
    assert result["answer"] == {}


def test_completed_report_route_can_explicitly_reveal() -> None:
    source = {"report": {"correctAnswer": "D", "analysis": "已交卷解析"}}
    assert project_practice_payload(
        source, transport="bearer", force_completed_reveal=True
    ) == source
