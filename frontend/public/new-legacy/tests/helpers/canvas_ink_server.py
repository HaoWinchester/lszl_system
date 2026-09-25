"""Serve synced pages against a migrated disposable PostgreSQL database only."""
from __future__ import annotations
import argparse
import asyncio
from contextlib import contextmanager
import signal
import importlib.util
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'backend'))
os.environ['LEGAL_CONSENT_REQUIRED'] = 'false'
os.environ['NEW_LEGACY_RELEASE_ROOT'] = str(ROOT / 'artifacts/canvas-ink/no-release')
os.environ['NEW_LEGACY_FALLBACK_SITE'] = str(ROOT / 'frontend/public/new-legacy')
# Reuse the repository's isolation and migration lifecycle. It creates a unique
# kg_pytest_* database before importing app and drops exactly that DB at exit.
spec = importlib.util.spec_from_file_location('ink_disposable_database', ROOT / 'backend/tests/conftest.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.user import User
from app.models.question import QuestionBank, Question, ExamPaper
from app.models.paper_release import PaperRelease, PaperReleaseQuestion
from app.models.training import CanvasWorkspace, RecallProgress
from app.services import deep_recall_service
from app.main import app
import uvicorn

async def seed():
    async with AsyncSessionLocal() as db:
        db.add(User(username='ink-browser', password_hash=hash_password('ink-browser-test'), role='teacher', status='active', subject='PMP'))
        db.add(User(username='ink-viewer', password_hash=hash_password('ink-browser-test'), role='viewer', status='active', subject='PMP'))
        await db.flush()
        db.add(QuestionBank(id='ink-bank', owner_id='ink-browser', name='笔迹浏览器测试题库', subject='PMP', visibility='published'))
        db.add(ExamPaper(id='ink-paper', owner_id='ink-browser', name='笔迹浏览器测试试卷', subject='PMP', status='published'))
        await db.flush()
        db.add(PaperRelease(id='ink-release', paper_id='ink-paper', version=1, status='published', name='笔迹浏览器测试试卷', subject='PMP', publisher_id='ink-browser', access_level='free', enabled_modes=['deep_recall','multi_question_canvas','practice_mode'], allowed_roles=['teacher','student','viewer'], question_count=2))
        await db.flush()
        for i in (1,2):
            qid=f'ink-question-{i}'
            snapshot={'id':qid,'bankId':'ink-bank','title':f'笔迹验证题 {i}：风险发生后应该先做什么？','subject':'PMP','scope':'public','revision':1,'contentHash':str(i)*64,'stemParts':[{'text':'请先分析影响，然后采取措施。'}],'options':[{'id':'A','text':'分析影响','correct':True},{'id':'B','text':'立即变更'}],'correctAnswer':'A','concepts':[{'id':'impact','title':'分析影响','isCore':True}]}
            db.add(Question(id=qid, bank_id='ink-bank', title=snapshot['title'], subject='PMP', scope='public', revision=1, content_hash=str(i)*64, stem_parts=snapshot['stemParts'], options=snapshot['options'], correct_answer='A', concepts=snapshot['concepts']))
            db.add(PaperReleaseQuestion(release_id='ink-release',order_index=i-1,bank_id='ink-bank',question_id=qid,snapshot=snapshot))
        await db.commit()
        viewer=await db.get(User,'ink-viewer')
        session=await deep_recall_service.get_session(db,viewer,'ink-question-1',release_id='ink-release')
        stroke={'id':'viewer-stroke','tool':'pen','color':'#2563eb','width':3,'points':[[50,50],[150,120]]}
        db.add(RecallProgress(owner_id='ink-viewer',question_id='ink-question-1',release_id='ink-release',bank_id='ink-bank',source_question_revision=session['currentQuestion']['revision'],source_content_hash=session['currentQuestion']['contentHash'],recall_library_hash=session['library']['contentHash'],strokes=[stroke]))
        db.add(CanvasWorkspace(id='viewer-workspace',owner_id='ink-viewer',title='只读笔迹',schema_version=10,payload={'id':'viewer-workspace','title':'只读笔迹','schemaVersion':10,'nodes':{},'edges':[],'groups':[],'strokes':[stroke]}))
        await db.commit()

class DisposableServer(uvicorn.Server):
    @contextmanager
    def capture_signals(self):
        # Uvicorn normally re-raises SIGTERM after graceful shutdown, bypassing
        # Python atexit. Keep its graceful handler but return to our cleanup.
        signals=(signal.SIGINT,signal.SIGTERM)
        previous={sig:signal.signal(sig,self.handle_exit) for sig in signals}
        try:
            yield
        finally:
            for sig,handler in previous.items():
                signal.signal(sig,handler)

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=5189)
    args=parser.parse_args()
    asyncio.run(seed())
    try:
        DisposableServer(uvicorn.Config(app,host='127.0.0.1',port=args.port,log_level='warning')).run()
    finally:
        asyncio.run(fixture.engine.dispose())
        fixture._drop_test_database()
