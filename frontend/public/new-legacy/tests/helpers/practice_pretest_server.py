"""Serve a full PMP paper on the shared disposable PostgreSQL fixture."""
import argparse
import asyncio
import sys
from copy import deepcopy
import canvas_ink_server as helper
from sqlalchemy import select

sys.path.insert(0, str(helper.ROOT / 'backend/tests'))
from test_practice_sessions import _seed_released_pmp_paper

IDS = {'teacher':'pretest-teacher','student':'pretest-student','other_student':'pretest-other',
       'bank':'pretest-bank','paper':'pretest-paper','release':'pretest-release'}
parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=5197);args=parser.parse_args()
async def seed():
    await _seed_released_pmp_paper(IDS,domains=['people']*60+['process']*60+['business-environment']*60)
    async with helper.AsyncSessionLocal() as db:
        original=await db.get(helper.PaperRelease,IDS['release'])
        rows=list(await db.scalars(select(helper.PaperReleaseQuestion).where(helper.PaperReleaseQuestion.release_id==IDS['release'])))
        for kind in ('multiple_choice','matching'):
            paper_id=f'pretest-{kind}';release_id=f'{paper_id}-release'
            db.add(helper.ExamPaper(id=paper_id,owner_id=IDS['teacher'],name=f'PMP未答回看 {kind}',subject='PMP',status='published'))
            await db.flush()
            db.add(helper.PaperRelease(id=release_id,paper_id=paper_id,version=1,status='published',name=f'PMP未答回看 {kind}',subject='PMP',publisher_id=IDS['teacher'],access_level='free',enabled_modes=['practice_mode'],allowed_roles=['student'],question_count=180,release_metadata=deepcopy(original.release_metadata)))
            await db.flush()
            for row in rows:
                snapshot={**deepcopy(row.snapshot),'type':kind,'correctAnswer':None,'correctAnswerIds':['A'] if kind=='multiple_choice' else []}
                if kind=='matching':
                    snapshot['options']=[]
                    snapshot['matching']={'left':[{'id':'l1','text':'一'},{'id':'l2','text':'二'}],'right':[{'id':'r1','text':'甲'},{'id':'r2','text':'乙'}],'correctPairs':{'l1':'r2','l2':'r1'}}
                db.add(helper.PaperReleaseQuestion(release_id=release_id,order_index=row.order_index,bank_id=row.bank_id,question_id=row.question_id,snapshot=snapshot))
        await db.commit()
asyncio.run(seed())
try:
    helper.DisposableServer(helper.uvicorn.Config(helper.app,host='127.0.0.1',port=args.port,log_level='warning')).run()
finally:
    asyncio.run(helper.fixture.engine.dispose())
    helper.fixture._drop_test_database()
