from types import SimpleNamespace
import pytest
from app.services import question_answer_service as answers, paper_service, practice_session_service
from mixed_question_support import MATCHING, mixed_data_cleanup
pytestmark = pytest.mark.usefixtures('mixed_data_cleanup')
def test_mixed_whitelist():
    assert paper_service.question_matches_paper_type('mixed', 'matching')
    assert paper_service.question_matches_paper_type('mixed', 'multiple_choice')
    assert not paper_service.question_matches_paper_type('mixed', 'essay')
    assert not paper_service.question_matches_paper_type('standard', 'matching')
def test_matching_grading_and_validation():
    assert answers.grade_matching(MATCHING, {'l1': 'r2', 'l2': 'r1'})['correct']
    assert not answers.grade_matching(MATCHING, {'l1': 'r2', 'l2': 'r2'})['correct']
    assert not answers.grade_matching(MATCHING, {}, timed_out=True)['correct']
    for pairs in ({'l1': 'r2'}, {'foreign': 'r1'}, {'l1': 'r2', 'l2': 'r2'}):
        with pytest.raises(ValueError): answers.validate_selected_pairs(MATCHING, pairs)
    assert answers.validate_selected_pairs(MATCHING, {'l1': 'r2'}, partial=True) == {'l1': 'r2'}
def test_group_selection_is_exact_and_stable():
    rows = [SimpleNamespace(release_id='r', question_id=f'q{i}', bank_id='b', order_index=i, snapshot={'caseGroup': {'id': f'm{i//3}', 'order': i%3+1, 'total': 3}}) for i in range(6)]
    with pytest.raises(practice_session_service.PracticeSessionError) as error:
        practice_session_service._select_questions(rows, count=4, order='random', seed='x', weights={})
    assert error.value.code == 'PRACTICE_GROUP_COUNT_UNSATISFIABLE'
    selected = practice_session_service._select_questions(rows, count=3, order='random', seed='x', weights={})[0]
    assert [x['orderIndex'] % 3 for x in selected] == [0, 1, 2]


def test_grouped_composition_keeps_all_children_and_quotas():
    from app.services.paper_composition_service import CompositionCandidate, CompositionVariant, CompositionRequest, build_plan
    candidates = [CompositionCandidate(f'q{i}', 'b', {'subjectFacets':[{'dimensionId':'exam-domain','valueId':'people'}], '_mixedContent':{'caseGroup':{'id':f'm{i//3}','order':i%3+1,'total':3}}}) for i in range(6)]
    plan = build_plan(CompositionRequest((CompositionVariant('A','A',3),), {'people':100}, {}, 'seed'), candidates)
    assert plan.variants[0].feasible
    assert [int(qid[1:])%3 for qid in plan.variants[0].question_ids] == [0,1,2]
    assert not build_plan(CompositionRequest((CompositionVariant('A','A',4),), {'people':100}, {}, 'seed'), candidates).variants[0].feasible


def test_matching_catalog_normalization_and_import_are_lossless():
    import asyncio
    from copy import deepcopy
    from mixed_question_support import seed_users
    from app.db.session import AsyncSessionLocal
    from app.models.user import User
    from app.services import question_service, question_catalog_service, published_paper_access_service
    ids = asyncio.run(seed_users())
    async def scenario():
        async with AsyncSessionLocal() as db:
            user = await db.get(User, ids['teacher'])
            q = await question_service.create_question(db, user, ids['bank'], deepcopy(MATCHING))
            payload = await question_catalog_service.get_catalog_question(db, user, q.id)
            assert payload['matching'] == MATCHING['matching']
            assert '_mixedContent' not in payload['metadata']
            projected = published_paper_access_service.question_from_snapshot(payload)
            assert question_catalog_service.question_to_payload(projected)['matching'] == MATCHING['matching']
            q = await question_service.update_question(db, user, q.id, {'title':'更新标题'})
            assert question_catalog_service.question_to_payload(q)['matching'] == MATCHING['matching']
    asyncio.run(scenario())


def test_release_import_infers_mixed_without_losing_matching_content():
    from app.services.runtime_domain_migration_service import normalize_release_payload
    refs = [{'bankId':'bank','questionId':MATCHING['id'],'question':MATCHING}]
    payload = {'releaseId':'rel-mixed-infer','paperId':'paper','publishedBy':'teacher','questions':refs,'questionSnapshots':refs,'enabledModes':['practice_mode']}
    normalized = normalize_release_payload(payload)
    assert normalized['paperType'] == 'mixed'
    assert normalized['questions'][0]['question']['matching'] == MATCHING['matching']


def test_matching_normalization_discards_stale_option_answers():
    from app.services.question_content_service import normalize_question_payload
    payload = normalize_question_payload({**MATCHING, 'options':[{'id':'A','correct':True}], 'correctAnswer':'A', 'correctOptionIds':['A']}, subject='PMP')
    assert payload['options'] == [] and payload['correctAnswer'] is None and payload['correctOptionIds'] == []
    assert payload['matching'] == MATCHING['matching']
