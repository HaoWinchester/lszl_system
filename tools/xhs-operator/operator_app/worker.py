import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from .store import utcnow
from .replies import ReplyQueue


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

    async def process(self,now=None,draft_id=None):
        if not self.db.settings()['adapter_verified']: return
        job=self.db.claim(self.owner,now,draft_id=draft_id)
        if job is None:return
        draft=self.db.get_draft(job['draft_id']);submitted=False;baseline={}
        try:
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

    async def loop(self):
        while True:
            try:
                self.db.recover()
                minute=int(datetime.now(timezone.utc).timestamp()//300)
                if self.last_reconcile!=minute:
                    self.last_reconcile=minute
                    for job in [j for j in self.db.jobs() if j['status'] in {'unknown','verifying','platform-review'}][:2]:
                        try:
                            async with self.adapter.lock:await self.reconcile(job)
                        except Exception:
                            self.db.notify('reconcile-'+job['id'],'发布结果暂时无法核验，未重新提交。')
                if self.db.settings()['enabled']:
                    if self.db.settings()['auto_reply'] and self.last_inbox!=minute:
                        self.last_inbox=minute
                        async with self.adapter.lock:await self.replies.run(self.adapter)
                    lock=getattr(self.adapter,'lock',None)
                    if lock:
                        async with lock: await self.process()
                    else: await self.process()
                    await self.fill_queue()
            except asyncio.CancelledError: raise
            except Exception as e:
                self.db.notify('worker-'+type(e).__name__,'执行器异常，自动运营已暂停。')
                self.db.set_enabled(False)
            await asyncio.sleep(15)
