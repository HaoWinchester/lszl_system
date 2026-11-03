import asyncio
import fcntl
import json
import re
import secrets
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from urllib.parse import urlparse
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator
from .store import Store
from .content import Pipeline, Model
from .sources import catalog, verify_sources, refresh_library
from .drafting import DraftWorker, export_draft
from .research import Research
from .replies import ReplyQueue

STATIC=Path(__file__).parent/'static'

class SettingsPatch(BaseModel):
    model_config=ConfigDict(extra='forbid')
    preparation_enabled:bool|None=None
    times:list[str]|None=None
    daily_calls:int|None=Field(None,ge=1,le=40)
    daily_tokens:int|None=Field(None,ge=6500,le=300000)

    @field_validator('times')
    @classmethod
    def valid_times(cls,v):
        if v is None or len(v)!=2 or len(set(v))!=2 or any(not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d',x) for x in v):
            raise ValueError('设置两个不同的 HH:MM 时间')
        return sorted(v)

class GenerateBody(BaseModel):
    topic_id:str|None=None

class EditBody(BaseModel):
    title:str=Field(min_length=1,max_length=20)
    body:str=Field(min_length=1,max_length=600)


def create_app(root=None):
    db=Store(root or Path(__file__).parent.parent/'.runtime')
    db.configure(enabled=False,auto_reply=False)
    with db.connect() as c:
        c.execute("UPDATE jobs SET status='canceled',reason='已切换本地备稿；由用户在官方客户端发布' WHERE status IN ('queued','claimed') AND submitted IS NULL")
    pipeline=Pipeline(db);worker=DraftWorker(db,pipeline)
    replies=ReplyQueue(db);research=Research(db)
    token=secrets.token_urlsafe(32); tasks=set()

    @asynccontextmanager
    async def lifespan(app):
        lock=open(db.root/'service.lock','a+')
        try:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except OSError:
            lock.close();raise RuntimeError('该运行目录已有服务在执行')
        loop_task=asyncio.create_task(worker.loop())
        try: yield
        finally:
            loop_task.cancel()
            with suppress(asyncio.CancelledError):await loop_task
            await worker.close()
            for t in tasks:t.cancel()
            await asyncio.gather(*tasks,return_exceptions=True)
            lock.close()

    app=FastAPI(title='知习 · 内容工作台',lifespan=lifespan,docs_url=None,redoc_url=None)
    app.state.db=db;app.state.pipeline=pipeline;app.state.worker=worker

    @app.middleware('http')
    async def local_only(request:Request,call_next):
        host=request.headers.get('host','')
        if urlparse('http://'+host).hostname not in {'localhost','127.0.0.1'}:
            return JSONResponse({'detail':'仅允许本机访问'},status_code=403)
        origin=request.headers.get('origin')
        if origin and origin not in {'http://'+host}:
            return JSONResponse({'detail':'来源不匹配'},status_code=403)
        if request.method not in {'GET','HEAD','OPTIONS'}:
            if not secrets.compare_digest(request.headers.get('x-operator-token',''),token):
                return JSONResponse({'detail':'本机操作令牌缺失，请刷新页面'},status_code=403)
        response=await call_next(request)
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers['Cache-Control']='no-store'
        response.headers['Content-Security-Policy']="default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'"
        return response

    @app.exception_handler(ValueError)
    async def value_error(request,exc):return JSONResponse({'detail':str(exc)},status_code=409)

    def launch(coroutine,label):
        async def run():
            try:await coroutine
            except asyncio.CancelledError:raise
            except Exception as e:
                reason=str(e) if isinstance(e,ValueError) else (str(e)[:900] if type(e).__name__=='TimeoutError' else type(e).__name__)
                db.notify(label+'-'+reason,label+'：'+reason)
        task=asyncio.create_task(run());tasks.add(task);task.add_done_callback(tasks.discard)

    def diagnostics():
        blockers=[]
        try: model=Model(db).info()
        except ValueError as e: model={'configured':False};blockers.append(str(e))
        source=db.root/'source-check.json'
        return dict(model=model,blockers=blockers,
                    source_check=json.loads(source.read_text()) if source.exists() else None)

    @app.get('/')
    async def index():return FileResponse(STATIC/'index.html')

    @app.get('/api/state')
    async def state():
        cfg=db.settings()
        sources,topics=catalog(db.root)
        library_report=db.root/'knowledge-refresh.json'
        return {'mode':'draft-only','csrf':token,'settings':{k:v for k,v in cfg.items() if k!='claude_config'},
                'diagnostics':diagnostics(),'drafts':db.drafts(),'jobs':db.jobs(),'events':db.events(),
                'sources':sources,'topics':topics,'busy':pipeline.busy,'usage':db.usage(),
                'research':research.state(),
                'knowledge':json.loads(library_report.read_text()) if library_report.exists() else None,
                'messages':replies.list()}

    @app.post('/api/pause')
    async def pause():db.configure(enabled=False,auto_reply=False,preparation_enabled=False);return {'enabled':False,'preparation_enabled':False}

    @app.put('/api/settings')
    async def settings(body:SettingsPatch):
        values=body.model_dump(exclude_none=True)
        db.configure(**values);return {'saved':True}

    @app.post('/api/generate',status_code=202)
    async def generate(body:GenerateBody):
        if pipeline.busy:raise ValueError('已有生成任务在执行')
        if body.topic_id and body.topic_id not in {t['id'] for t in catalog(db.root)[1]}:raise ValueError('选题不存在')
        launch(pipeline.generate(body.topic_id),'生成内容')
        return {'accepted':True}

    @app.put('/api/drafts/{ident}')
    async def edit(ident:str,body:EditBody):
        d=db.get_draft(ident)
        return db.edit(ident,{**d['content'],**body.model_dump()})

    @app.post('/api/drafts/{ident}/review',status_code=202)
    async def review(ident:str):
        if pipeline.busy:raise ValueError('生成任务正在执行')
        launch(pipeline.audit(db.get_draft(ident)),'审核内容');return {'accepted':True}

    @app.get('/api/drafts/{ident}/export')
    async def export(ident:str):
        data=export_draft(db,ident)
        return Response(data,media_type='application/zip',headers={'Content-Disposition':f'attachment; filename="draft-{ident}.zip"'})

    @app.post('/api/enable')
    @app.post('/api/browser/open')
    @app.post('/api/browser/check')
    @app.post('/api/browser/community')
    @app.post('/api/inbox/scan')
    @app.post('/api/research/refresh')
    @app.post('/api/drafts/{ident}/queue')
    @app.post('/api/drafts/{ident}/preview')
    @app.post('/api/drafts/{ident}/publish-once')
    @app.post('/api/jobs/{ident}/verify')
    async def retired(ident:str=''):
        return JSONResponse({'detail':'已停用平台自动化。请下载发布包，在官方客户端人工发布与互动。'},status_code=410)

    @app.post('/api/inbox/pause')
    async def pause_replies():db.configure(auto_reply=False);return {'auto_reply':False}

    @app.post('/api/knowledge/refresh',status_code=202)
    async def knowledge():
        if pipeline.busy:raise ValueError('已有内容任务在执行')
        async def run():
            async with pipeline.lock:
                pipeline.busy=True
                try:await refresh_library(db,Model(db))
                finally:pipeline.busy=False
        launch(run(),'知识库更新');return {'accepted':True}

    @app.post('/api/sources/check')
    async def source_check():return await verify_sources(db.root)

    (db.root/'assets').mkdir(exist_ok=True)
    app.mount('/assets',StaticFiles(directory=db.root/'assets'),name='assets')
    app.mount('/static',StaticFiles(directory=STATIC),name='static')
    return app
