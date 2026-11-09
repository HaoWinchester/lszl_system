"""Serve real history paging fixtures on the existing disposable PostgreSQL lifecycle."""
import argparse
import asyncio
from copy import deepcopy
from datetime import timedelta
import sys

import canvas_ink_server as helper
from sqlalchemy import select

from app.core.security import now_utc
from app.models.training import LearningEvent, PracticeSession
from app.services import practice_session_service

sys.path.insert(0, str(helper.ROOT / 'backend/tests'))
from test_practice_sessions import _seed_released_pmp_paper

IDS = {'teacher': 'history-teacher', 'student': 'history-desktop',
       'other_student': 'history-mobile', 'bank': 'history-bank',
       'paper': 'history-paper', 'release': 'history-release'}


async def seed():
    await _seed_released_pmp_paper(IDS, domains=['people', 'process', 'business-environment'])
    async with helper.AsyncSessionLocal() as db:
        release = await db.get(helper.PaperRelease, IDS['release'])
        questions = list(await db.scalars(select(helper.PaperReleaseQuestion).where(
            helper.PaperReleaseQuestion.release_id == IDS['release'])))
        db.add(helper.PaperRelease(
            id='history-old-release', paper_id='history-old-paper', version=1,
            status='superseded', name='历史最早旧卷', subject='PMP',
            publisher_id=IDS['teacher'], access_level='free',
            enabled_modes=['practice_mode'], allowed_roles=['student'], question_count=3,
            release_metadata=deepcopy(release.release_metadata)))
        await db.flush()
        for row in questions:
            db.add(helper.PaperReleaseQuestion(
                release_id='history-old-release', order_index=row.order_index,
                bank_id=row.bank_id, question_id=row.question_id, snapshot=deepcopy(row.snapshot)))
        await db.commit()

    for owner in (IDS['student'], IDS['other_student']):
        async with helper.AsyncSessionLocal() as db:
            user = await db.get(helper.User, owner)
            started = await practice_session_service.start_session(db, owner, user, {
                'paperId': IDS['paper'], 'releaseId': IDS['release'],
                'mode': 'practice', 'count': 3, 'order': 'paper'})
            await practice_session_service.complete_session(db, owner, user, started['id'], {
                'revision': started['revision'], 'answers': {}})
            prototype = await db.get(PracticeSession, started['id'])
            base = now_utc()
            for index in range(121):
                session_id = f'{owner}-{index:03d}'
                saved = base - timedelta(days=121-index)
                old = index == 0
                report = {**deepcopy(prototype.report_snapshot), 'reportNumber': session_id,
                          'paperName': '历史最早旧卷' if old else 'PMP 会话模拟卷'}
                db.add(PracticeSession(
                    id=session_id, owner_id=owner, paper_id='history-old-paper' if old else IDS['paper'],
                    release_id='history-old-release' if old else IDS['release'],
                    mode='practice', status='completed', revision=1,
                    question_order=deepcopy(prototype.question_order), answers={},
                    runtime_state={'privateSavedBody': 'private-body-' * 5000},
                    scoring_snapshot=deepcopy(prototype.scoring_snapshot),
                    report_snapshot=report, stats=deepcopy(prototype.stats),
                    started_at=saved, last_saved_at=saved, completed_at=saved))
                if index % 20 == 0:
                    db.add(LearningEvent(
                        id=f'{owner}-duplicate-{index}', owner_id=owner,
                        event_type='PRACTICE_SESSION_COMPLETED', created_at=saved,
                        payload={'sessionId': session_id, 'paperName': '重复旧事件'}))
            db.add(PracticeSession(
                id=f'{owner}-paused', owner_id=owner, paper_id=IDS['paper'],
                release_id=IDS['release'], mode='practice', status='paused', revision=1,
                question_order=deepcopy(prototype.question_order), answers={},
                runtime_state={'currentIndex': 1, 'order': 'paper'},
                scoring_snapshot=deepcopy(prototype.scoring_snapshot),
                stats={'total': 3, 'answered': 0, 'correct': 0},
                started_at=base, last_saved_at=base+timedelta(minutes=1),
                paused_at=base+timedelta(minutes=1)))
            db.add(PracticeSession(
                id=f'{owner}-revenge', owner_id=owner, mode='revenge', status='paused',
                question_order=[], answers={}, stats={'total': 2, 'answered': 0},
                started_at=base, last_saved_at=base+timedelta(seconds=30),
                paused_at=base+timedelta(seconds=30)))
            await db.commit()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=5198)
    args = parser.parse_args()
    try:
        asyncio.run(seed())
        helper.DisposableServer(helper.uvicorn.Config(
            helper.app, host='127.0.0.1', port=args.port, log_level='warning')).run()
    finally:
        asyncio.run(helper.fixture.engine.dispose())
        helper.fixture._drop_test_database()
