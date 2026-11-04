"""Isolated DB with enough small published summaries to exercise real catalogue paging."""
import asyncio
import argparse
from datetime import timedelta
import canvas_ink_server as helper
from app.models.subscription import Subscription
from app.models.paper_release import PaperRelease, PaperReleaseQuestion
from app.models.question import ExamPaper
from app.core.security import now_utc
from sqlalchemy import select

async def seed():
    await helper.seed(role_matrix=True)
    async with helper.AsyncSessionLocal() as db:
        original = (await db.execute(select(PaperReleaseQuestion).where(PaperReleaseQuestion.release_id == 'ink-release').order_by(PaperReleaseQuestion.order_index))).scalars().all()
        for i in range(1, 16):
            paper_id = f'lobby-paper-{i:02}'
            db.add(ExamPaper(id=paper_id, owner_id='ink-browser', name=f'分页试卷 {i:02}', subject='PMP', status='published'))
            await db.flush()
            db.add(PaperRelease(id=f'lobby-release-{i:02}',paper_id=paper_id,version=1,status='published',name=f'分页试卷 {i:02}',subject='PMP' if i % 2 else 'PMI-ACP',publisher_id='ink-browser',published_at=now_utc()+timedelta(seconds=i),access_level='member' if i == 15 else 'free',enabled_modes=['practice_mode'],allowed_roles=['teacher','student','viewer'],question_count=2))
            await db.flush()
            for q in original:
                db.add(PaperReleaseQuestion(release_id=f'lobby-release-{i:02}',order_index=q.order_index,bank_id=q.bank_id,question_id=q.question_id,snapshot=q.snapshot))
        db.add(Subscription(username='ink-student',plan_id='lifetime',status='active'))
        await db.commit()
parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=5196);args=parser.parse_args()
asyncio.run(seed())
try:
    helper.DisposableServer(helper.uvicorn.Config(helper.app,host='127.0.0.1',port=args.port,log_level='warning')).run()
finally:
    asyncio.run(helper.fixture.engine.dispose())
    helper.fixture._drop_test_database()
