import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from .store import utcnow
from .replies import ReplyQueue
from .research import Research


def next_slots(times, now=None, count=4):
    now=now or datetime.now(timezone.utc)
    local=now.astimezone(ZoneInfo('Asia/Shanghai'));slots=[]
    for day in range(7):
        for t in sorted(times):
            h,m=map(int,t.split(':'))
            slot=(local+timedelta(days=day)).replace(hour=h,minute=m,second=0,microsecond=0)
            if slot>local: slots.append(slot.astimezone(timezone.utc).isoformat(timespec='seconds'))
    return slots[:count]


class Worker:
    def __init__(self,db,pipeline,adapter):
        self.db=db;self.pipeline=pipeline;self.adapter=adapter
        self.owner=uuid.uuid4().hex;self.task=None;self.last_generation=None
        self.replies=ReplyQueue(db);self.last_reconcile=None;self.last_inbox=None
        self.research=Research(db);self.background=None;self.last_research_attempt=None;self.last_knowledge=None

    async def scan_inbox(self):
        async with self.adapter.lock:
            batch=await self.adapter.read_messages()
            self.replies.scan(batch)
            return batch

    async def refresh_knowledge(self):
        from .sources import refresh_library
        from .content import Model
        day=utcnow()[:10]
        if self.last_knowledge==day:return
        if self.pipeline.lock.locked():return
        self.last_knowledge=day
        async with self.pipeline.lock:
            self.pipeline.busy=True
            try:await refresh_library(self.db,Model(self.db))
            except Exception as e:self.db.notify('knowledge-'+day,str(e) if isinstance(e,ValueError) else '知识库刷新失败，保留已核验资料。')
            finally:self.pipeline.busy=False

    async def produce(self):
        try:
            await self.refresh_knowledge()
            if self.db.settings()['enabled']:await self.fill_queue()
        except asyncio.CancelledError:raise
        except Exception as e:self.db.notify('produce-'+utcnow()[:13],str(e) if isinstance(e,ValueError) else '内容生产失败')

    async def close(self):
        if self.background:
            self.background.cancel()
            await asyncio.gather(self.background,return_exceptions=True)

    async def process(self,now=None,draft_id=None):
        if not self.db.settings()['adapter_verified']: return
        job=self.db.claim(self.owner,now,draft_id=draft_id)
        if job is None:return
        draft=self.db.get_draft(job['draft_id']);submitted=False;baseline={}
        try:
            draft=await self.pipeline.ensure_ready(draft)
            # Adapter may upload/fill fields, but not click submit here.
            baseline=await self.adapter.prepare(draft)
            with self.db.connect() as c:
                import json
                c.execute('UPDATE jobs SET receipt=? WHERE id=?',(json.dumps(baseline),job['id']))
            if not self.db.begin_send(job['id'],self.owner):
                self.db.finish(job['id'],'canceled',reason='暂停或稿件状态变化，未提交');return
            submitted=True
            await self.adapter.submit()
            self.db.finish(job['id'],'verifying',baseline)
            receipt=await self.adapter.verify(draft,baseline)
            self.db.finish(job['id'],receipt['status'],receipt)
            if receipt['status']=='unknown': self.db.notify('unknown-'+job['id'],'发布结果不明，已冻结该项，等待核验。')
        except Exception as e:
            status='unknown' if submitted else 'blocked'
            reason=str(e) if isinstance(e,ValueError) else f'浏览器执行异常：{type(e).__name__}'
            self.db.finish(job['id'],status,baseline,reason)
            self.db.notify(status+'-'+job['id'],reason)
            self.db.set_enabled(False)

    async def reconcile(self,job):
        if job['status'] not in {'unknown','verifying','platform-review','published'}: raise ValueError('该任务无需核验')
        receipt=job.get('receipt') or {}
        baseline=receipt.get('baseline',receipt)
        if 'before_ids' not in baseline: raise ValueError('缺少提交前笔记记录，不能自动判定')
        result=await self.adapter.verify(self.db.get_draft(job['draft_id']),baseline)
        self.db.finish(job['id'],result['status'],result)
        if result['status'] in {'published','platform-review'}:
            self.db.configure(adapter_verified=True)
            self.db.notify('verified-'+job['id'],'已取得平台笔记 ID 并核验当前状态，自动运营保持原开关状态。')
        return result

    async def fill_queue(self):
        if not self.db.settings()['enabled']:return
        self.research.context()
        jobs=self.db.jobs();used={j['draft_id'] for j in jobs};occupied={j['due'] for j in jobs}
        drafts=[d for d in self.db.drafts() if d['status']=='ready' and d['id'] not in used]
        pending=sum(j['status'] in {'queued','claimed'} for j in jobs)
        if pending+len(drafts)<2 and not self.pipeline.busy:
            # At most one automatic generation attempt per hour; failures do not spin.
            hour=utcnow()[:13]
            if self.last_generation!=hour:
                self.last_generation=hour
                try: drafts.append(await self.pipeline.generate())
                except Exception as e:
                    self.db.notify('generation-'+hour,str(e) if isinstance(e,ValueError) else '生成失败，请查看资料或连接');return
        if not self.db.settings()['enabled']:return
        slots=[s for s in next_slots(self.db.settings()['times'],count=14) if s not in occupied]
        for d,slot in zip([d for d in drafts if d['status']=='ready'],slots):
            if pending>=2:break
            self.db.enqueue(d['id'],slot);pending+=1

    async def tick(self):
        self.db.recover()
        minute=int(datetime.now(timezone.utc).timestamp()//300)
        if self.last_reconcile!=minute:
            self.last_reconcile=minute
            for job in [j for j in self.db.jobs() if j['status'] in {'unknown','verifying','platform-review'}][:2]:
                try:
                    async with self.adapter.lock:await self.reconcile(job)
                except Exception:self.db.notify('reconcile-'+job['id'],'发布结果暂时无法核验，未重新提交。')
            async with self.adapter.lock:await self.replies.reconcile(self.adapter)
        if not self.db.settings()['enabled']:return
        async with self.adapter.lock:await self.process()
        if self.db.settings()['auto_reply'] and self.last_inbox!=minute:
            self.last_inbox=minute
            try:
                async with self.adapter.lock:await self.replies.run(self.adapter)
            except Exception as e:
                self.db.notify('inbox-'+utcnow()[:10],str(e) if isinstance(e,ValueError) else '互动页面读取失败；未发送新的回复。')
        if not self.db.settings()['enabled']:return
        try:self.research.context()
        except ValueError:
            hour=utcnow()[:13]
            if self.last_research_attempt!=hour:
                self.last_research_attempt=hour
                try:
                    async with self.adapter.lock:await self.research.refresh(self.adapter)
                except Exception:
                    self.db.notify('research-'+hour,'竞品样本不可用，停止新稿生产，稍后重试。');return
            else:return
        if self.background is None or self.background.done():
            self.background=asyncio.create_task(self.produce())

    async def loop(self):
        while True:
            try:await self.tick()
            except asyncio.CancelledError: raise
            except Exception as e:
                self.db.notify('worker-'+type(e).__name__,'执行器异常，自动运营已暂停。')
                self.db.set_enabled(False)
            await asyncio.sleep(15)
