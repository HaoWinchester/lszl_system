"""Report meaning comes from frozen session facts, without database setup."""

import asyncio
from types import SimpleNamespace

from app.services.practice_session_service import _build_report


class FakeDb:
    async def get(self, _model, _id):
        return SimpleNamespace(name="PMP 练习卷")


def report_for(count, total, *, mode="practice", domains=None, all_correct=False, answered_count=None):
    domains = domains or ["people"] * count
    session = SimpleNamespace(
        id="ps-report", paper_id="paper", release_id="release", owner_id="student",
        mode=mode, question_order=[{"questionId": f"q{index}", "domain": domain, "score": 1}
                                   for index, domain in enumerate(domains)],
        answers=({f"q{index}": {"correct": True} for index in range(count if answered_count is None else answered_count)} if all_correct else {"q0": {"correct": True}, "q1": {"correct": False}}),
        stats={"durationMs": 30000},
        scoring_snapshot={"passPercent": 60, "domainWeights": {"people": 42, "process": 50,
                         "business-environment": 8}, "selectionSummary": {"totalCount": total}},
    )
    return asyncio.run(_build_report(FakeDb(), session))


def test_ten_question_partial_practice_is_summary_without_unsampled_grades():
    report = report_for(10, 60)
    assert report["reportKind"] == "practice"
    assert report["resultLabel"] == "本次练习摘要"
    assert report["passed"] is None
    assert report["accuracyPercent"] == 10
    assert report["domains"]["people"]["total"] == 10
    assert report["domains"]["process"]["performanceBand"] is None
    assert report["domains"]["business-environment"]["performanceBand"] is None
    assert report["wrongQuestionIds"] == ["q1"]


def test_full_sixty_question_paper_retains_simulation_verdict():
    report = report_for(60, 60, mode="challenge")
    assert report["reportKind"] == "simulation"
    assert report["resultLabel"] == "模拟考试结果：FAIL"
    assert report["passed"] is False
    assert report["passPercent"] == 60


def test_sixty_question_slice_of_larger_paper_is_practice():
    assert report_for(60, 180)["reportKind"] == "practice"


def test_ten_question_full_paper_is_still_too_short_for_exam_verdict():
    assert report_for(10, 10)["reportKind"] == "practice"


def test_full_paper_does_not_grade_unsampled_domain():
    report = report_for(60, 60)
    assert report["domains"]["process"]["performanceBand"] is None
    assert report["domains"]["business-environment"]["performanceBand"] is None


def test_revenge_mode_remains_practice_even_with_large_frozen_count():
    assert report_for(60, 60, mode="revenge")["reportKind"] == "practice"

def test_perfect_practice_and_revenge_do_not_recommend_nonexistent_mistakes():
    for mode in ("practice", "revenge", "challenge"):
        report = report_for(10, 60, mode=mode, all_correct=True)
        assert report["counts"]["wrong"] == 0
        assert all("本次错题" not in item for item in report["recommendations"])
        if mode == "revenge":
            assert "待验证或已掌握" in report["recommendations"][0]


def test_unfinished_revenge_without_wrong_answers_recommends_unanswered_items():
    report = report_for(10, 10, mode="revenge", all_correct=True, answered_count=2)
    assert report["counts"]["wrong"] == 0
    assert report["counts"]["unanswered"] == 8
    assert "未答题目" in report["recommendations"][0]
