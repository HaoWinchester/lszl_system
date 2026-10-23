import asyncio
import importlib
from copy import deepcopy

import pytest
from sqlalchemy import func, select

from mixed_question_support import mixed_data_cleanup, seed_users, questions, publish
from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.models.paper_release import PaperRelease, PaperReleaseQuestion
from app.models.question_comment import QuestionComment
from app.models.user import User
from app.services import question_service, question_catalog_service
from app.services.question_material_service import save_material
from app.schemas.question_material import MaterialInput

pytestmark = pytest.mark.usefixtures('mixed_data_cleanup')


def test_uat_feedback_guard_and_payload_preserve_frozen_questions(monkeypatch):
    service = importlib.import_module('app.services.uat_learning_feedback_service')
    monkeypatch.setattr(settings, 'ENV', 'production')
    with pytest.raises(ValueError, match='UAT'):
        asyncio.run(service.prepare(None, release_id='r', question_id='q', apply=True))


def test_uat_feedback_opens_only_selected_paper_and_seeds_one_question_idempotently(monkeypatch):
    service = importlib.import_module('app.services.uat_learning_feedback_service')
    monkeypatch.setattr(settings, 'ENV', 'uat')

    async def run():
        ids = await seed_users()
        async with AsyncSessionLocal() as db:
            actor = await db.get(User, ids['teacher'])
            material = await save_material(db, actor, MaterialInput(title='共享案例', text='所有小题必须保留这份案例材料'))
            saved = [question_catalog_service.question_to_payload(await question_service.create_question(db, actor, ids['bank'], q)) for q in questions(ids, material)]
        release_id = await publish(ids, saved)
        async with AsyncSessionLocal() as db:
            rows = list((await db.scalars(select(PaperReleaseQuestion).where(PaperReleaseQuestion.release_id == release_id).order_by(PaperReleaseQuestion.order_index))).all())
            original = [deepcopy(row.snapshot) for row in rows]
            qid, other = rows[0].question_id, rows[1].question_id
            db.add(QuestionComment(id='uat-real-'+ids['paper'], question_id=qid, owner_id=ids['student'], content='已有真实留言'))
            db.add(QuestionComment(id='uat-other-'+ids['paper'], question_id=other, owner_id=ids['student'], content='其他题留言'))
            await db.commit()
            plan = await service.prepare(db, release_id=release_id, question_id=qid, apply=False)
            assert plan['commentsToAdd'] == 199
            assert (await db.get(PaperRelease, release_id)).enabled_modes == ['practice_mode']
            result = await service.prepare(db, release_id=release_id, question_id=qid, apply=True)
            assert result['eligibleComments'] == 200
            new_id = result['releaseId']
            assert new_id != release_id
            active = await db.get(PaperRelease, new_id)
            assert set(active.enabled_modes) == {'practice_mode', 'multi_question_canvas', 'deep_recall'}
            frozen = list((await db.scalars(select(PaperReleaseQuestion).where(PaperReleaseQuestion.release_id == new_id).order_by(PaperReleaseQuestion.order_index))).all())
            assert [row.snapshot for row in frozen] == original
            assert await db.scalar(select(func.count()).select_from(QuestionComment).where(QuestionComment.question_id == other)) == 1
            again = await service.prepare(db, release_id=release_id, question_id=qid, apply=True)
            assert again['releaseId'] == new_id and again['commentsToAdd'] == 0
            assert again['eligibleComments'] == 200
    asyncio.run(run())
