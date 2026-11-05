"""Report meaning comes from frozen session facts, without database setup."""

import asyncio
from types import SimpleNamespace
import pytest

from app.services.practice_session_service import _build_report


class FakeDb:
    async def get(self, _model, _id):
        return SimpleNamespace(name="PMP 练习卷")


def report_for(count, total, *, mode="practice", domains=None, all_correct=False, answered_count=None, unscored=None):
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
    if unscored is not None:
        session.scoring_snapshot["pmpPretest"] = {"version": 1, "questionIds": unscored}
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


def test_pretest_excludes_correct_wrong_and_unanswered_from_score_but_keeps_full_review():
    excluded = [f"q{i}" for i in range(10)]
    report = report_for(180, 180, unscored=excluded)
    assert report["maxScore"] == 170
    assert report["rawScore"] == 0
    assert report["scorePercent"] == 0
    assert report["counts"] == {"total": 180, "answered": 2, "correct": 1, "wrong": 1, "unanswered": 178}
    assert report["wrongQuestionIds"] == ["q1"]
    assert report["accuracyPercent"] == .56
    assert report["domains"]["people"]["total"] == 170
    assert report["domains"]["people"]["correct"] == 0
    assert report["domains"]["people"]["unanswered"] == 170
    assert report["unscoredQuestions"] == [{"questionId": qid, "number": i + 1} for i, qid in enumerate(excluded)]


def test_pretest_recalculates_numerator_denominator_and_domain_bands():
    # 106 correct overall, 10 of those unscored => 96/170=56.47%, not 106/180=58.89%.
    report = report_for(180, 180, all_correct=True, answered_count=106,
                        unscored=[f"q{i}" for i in range(10)],
                        domains=["people"] * 60 + ["process"] * 60 + ["business-environment"] * 60)
    assert report["rawScore"] == 96
    assert report["maxScore"] == 170
    assert report["scorePercent"] == 56.47
    assert report["accuracyPercent"] == 58.89
    assert report["domains"]["people"]["correct"] == 50
    assert report["domains"]["people"]["total"] == 50
    assert report["domains"]["people"]["scorePercent"] == 100


def test_pretest_can_change_simulation_verdict_without_changing_full_accuracy():
    # 102/180 is below 60%, but exclude 10 unanswered => 102/170=60%.
    report = report_for(180, 180, all_correct=True, answered_count=102,
                        unscored=[f"q{i}" for i in range(170, 180)])
    assert report["passed"] is True
    assert report["scorePercent"] == 60
    assert report["accuracyPercent"] == 56.67


def test_old_full_pmp_report_does_not_generate_pretest_retroactively():
    report = report_for(180, 180, all_correct=True)
    assert report["maxScore"] == 180
    assert "unscoredQuestions" not in report


def test_new_pretest_freeze_is_private_random_subset_only_for_full_pmp_simulation():
    from app.services import practice_scoring_service as scoring
    assert callable(getattr(scoring, "freeze_pmp_pretest_policy", None))
    refs = [{"questionId": f"q{i}"} for i in range(180)]
    for mode in ("practice", "challenge"):
        policy = scoring.freeze_pmp_pretest_policy("PMP", mode, refs, {"totalCount": 180})
        assert policy["version"] == 1
        assert len(policy["questionIds"]) == len(set(policy["questionIds"])) == 10
        assert set(policy["questionIds"]) <= {ref["questionId"] for ref in refs}
    for subject, mode, rows, total in [("ACP", "practice", refs, 180), ("PMP", "scholar", refs, 180), ("PMP", "revenge", refs, 180), ("PMP", "practice", refs[:60], 60), ("PMP", "practice", refs, 200)]:
        assert scoring.freeze_pmp_pretest_policy(subject, mode, rows, {"totalCount": total}) is None


@pytest.mark.parametrize('ids', [['q0']*10, [f'q{i}' for i in range(9)], [f'q{i}' for i in range(9)]+['foreign']])
def test_invalid_frozen_pretest_does_not_silently_recalculate_another_score(ids):
    from app.services.practice_session_service import PracticeSessionError
    with pytest.raises(PracticeSessionError) as error:
        report_for(180,180,unscored=ids)
    assert error.value.status_code == 409
    assert error.value.code == 'PRACTICE_SCORING_SNAPSHOT_INVALID'


def test_teacher_release_cannot_choose_private_pretest_questions():
    from app.services.practice_session_service import _release_scoring
    _,scoring=_release_scoring(SimpleNamespace(release_metadata={'simulationScoring':{'pmpPretest':{'version':1,'questionIds':['q0']*10}}}))
    assert 'pmpPretest' not in scoring
