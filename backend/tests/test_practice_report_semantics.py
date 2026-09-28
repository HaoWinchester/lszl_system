"""Report meaning comes from frozen session facts, without database setup."""

import asyncio
from types import SimpleNamespace

from app.services.practice_session_service import _build_report


class FakeDb:
    async def get(self, _model, _id):
        return SimpleNamespace(name="PMP 练习卷")


def report_for(count, total, *, mode="practice", domains=None):
    domains = domains or ["people"] * count
    session = SimpleNamespace(
        id="ps-report", paper_id="paper", release_id="release", owner_id="student",
        mode=mode, question_order=[{"questionId": f"q{index}", "domain": domain, "score": 1}
                                   for index, domain in enumerate(domains)],
        answers={"q0": {"correct": True}, "q1": {"correct": False}},
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
