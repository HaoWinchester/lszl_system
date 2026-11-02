import asyncio
import fcntl
import json
import re
import secrets
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from urllib.parse import urlparse
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator
from .store import Store
from .content import Pipeline, Model
from .sources import catalog, verify_sources, refresh_library
from .browser import BrowserAdapter
from .worker import Worker, next_slots

STATIC=Path(__file__).parent/'static'

class SettingsPatch(BaseModel):
    model_config=ConfigDict(extra='forbid')
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

class QueueBody(BaseModel):
    due:str

class EditBody(BaseModel):
    title:str=Field(min_length=1,max_length=20)
    body:str=Field(min_length=1,max_length=600)


def create_app(root=None):
    db=Store(root or Path(__file__).parent.parent/'.runtime')
    pipeline=Pipeline(db);adapter=BrowserAdapter(db);worker=Worker(db,pipeline,adapter)
    token=secrets.token_urlsafe(32); tasks=set()

    @asynccontextmanager
    async def lifespan(app):
        lock=open(db.root/'service.lock','a+')
        try:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except OSError:
            lock.close();raise RuntimeError('该运行目录已有服务在执行')
        worker.replies.recover()
        worker.task=asyncio.create_task(worker.loop())
        try: yield
        finally:
            worker.task.cancel()
            with suppress(asyncio.CancelledError):await worker.task
            await worker.close()
            for t in tasks:t.cancel()
            await asyncio.gather(*tasks,return_exceptions=True)
            await adapter.close();lock.close()

    app=FastAPI(title='知习 · 内容工作台',lifespan=lifespan,docs_url=None,redoc_url=None)
    app.state.db=db;app.state.pipeline=pipeline;app.state.adapter=adapter;app.state.worker=worker

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
        if not db.settings()['adapter_verified']:blockers.append('发布适配器尚未完成真实账号联调')
        if not adapter.status.get('identity_verified'):blockers.append('工具专用浏览器的登录与账号 ID 尚未核对')
        source=db.root/'source-check.json'
        return dict(model=model,browser=adapter.status,blockers=blockers,
                    community=adapter.community_status,
                    source_check=json.loads(source.read_text()) if source.exists() else None)

    @app.get('/')
    async def index():return FileResponse(STATIC/'index.html')

    @app.get('/api/state')
    async def state():
        cfg=db.settings()
        sources,topics=catalog(db.root)
        library_report=db.root/'knowledge-refresh.json'
        return {'csrf':token,'settings':{k:v for k,v in cfg.items() if k!='claude_config'},
                'diagnostics':diagnostics(),'drafts':db.drafts(),'jobs':db.jobs(),'events':db.events(),
                'sources':sources,'topics':topics,'busy':pipeline.busy,'usage':db.usage(),
                'research':worker.research.state(),
                'knowledge':json.loads(library_report.read_text()) if library_report.exists() else None,
                'messages':worker.replies.list(),'next_slots':next_slots(cfg['times'])}

    @app.post('/api/pause')
    async def pause():db.set_enabled(False);return {'enabled':False}

    @app.post('/api/enable')
    async def enable():
        blockers=diagnostics()['blockers']
        if blockers:raise ValueError('；'.join(blockers))
        report=await refresh_library(db)
        if not report['available_source_ids']:raise ValueError('没有可用的已核验知识来源')
        await adapter.probe()
        batch=await worker.scan_inbox()
        if set(batch.get('complete_channels',[]))!={'comment','dm'}:raise ValueError('评论和私信尚未全部读通，不能开启完整自动运营')
        try:worker.research.context()
        except ValueError:
            async with adapter.lock:await worker.research.refresh(adapter)
        db.configure(enabled=True,auto_reply=True);return {'enabled':True}

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

    @app.post('/api/drafts/{ident}/queue')
    async def queue(ident:str,body:QueueBody):
        from datetime import datetime,timezone
        try:due=datetime.fromisoformat(body.due)
        except ValueError:raise ValueError('排期格式无效')
        if due.tzinfo is None or due<=datetime.now(timezone.utc):raise ValueError('请选择未来时间，并包含时区')
        db.enqueue(ident,body.due);return {'queued':True}

    @app.post('/api/drafts/{ident}/preview',status_code=202)
    async def preview(ident:str):
        d=db.get_draft(ident)
        if d['status']!='ready': raise ValueError('请先完成审核')
        async def run():
            async with adapter.lock:
                await adapter.prepare(d,preview=True)
                db.notify('preview-'+ident,'六张图片和正文已在创作中心填写并核对，尚未发布。')
        launch(run(),'发布预检');return {'accepted':True}

    @app.post('/api/drafts/{ident}/publish-once',status_code=202)
    async def publish_once(ident:str):
        from .store import utcnow
        if not db.settings().get('adapter_calibrated'):raise ValueError('请先通过真实页面预检')
        d=db.get_draft(ident)
        if d['status']!='ready':raise ValueError('稿件未审核')
        if db.settings()['enabled']:raise ValueError('自动运营中，请使用排期')
        async def run():
            async with adapter.lock:
                previous=db.settings()['adapter_verified']
                try:
                    db.enqueue(ident,utcnow())
                    db.configure(enabled=True,adapter_verified=True)
                    await worker.process(draft_id=ident)
                    job=next(j for j in db.jobs() if j['draft_id']==ident and j['version']==d['version'])
                    if job['status'] in {'published','platform-review'}:
                        db.configure(adapter_verified=True)
                        db.notify('live-publish-'+ident,'真实发布流程已通过，已记录平台笔记 ID。自动运营仍保持暂停。')
                    else:db.configure(adapter_verified=previous)
                finally:db.set_enabled(False)
        launch(run(),'单篇发布联调');return {'accepted':True}

    @app.post('/api/jobs/{ident}/cancel')
    async def cancel(ident:str):
        with db.connect() as c:
            n=c.execute("UPDATE jobs SET status='canceled',reason='用户取消' WHERE id=? AND status='queued'",(ident,)).rowcount
            if n!=1:raise ValueError('仅尚未执行的任务可取消')
        return {'canceled':True}

    @app.post('/api/jobs/{ident}/verify',status_code=202)
    async def verify(ident:str):
        job=next((j for j in db.jobs() if j['id']==ident),None)
        if not job:raise ValueError('任务不存在')
        async def run():
            async with adapter.lock:await worker.reconcile(job)
        launch(run(),'核验发布');return {'accepted':True}

    @app.post('/api/browser/open',status_code=202)
    async def login():launch(adapter.login(),'打开登录浏览器');return {'accepted':True}

    @app.post('/api/browser/check')
    async def check():return await adapter.probe()

    @app.post('/api/browser/community',status_code=202)
    async def community():launch(adapter.open_community(),'打开主站登录');return {'accepted':True}

    @app.post('/api/inbox/scan',status_code=202)
    async def scan():launch(worker.scan_inbox(),'扫描互动');return {'accepted':True}

    @app.post('/api/inbox/pause')
    async def pause_replies():db.configure(auto_reply=False);return {'auto_reply':False}

    @app.post('/api/research/refresh',status_code=202)
    async def research():
        async def run():
            async with adapter.lock:await worker.research.refresh(adapter)
        launch(run(),'竞品分析');return {'accepted':True}

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
