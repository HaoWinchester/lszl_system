"""Local preparation only. This module has no platform browser or send adapter."""
import asyncio
import io
import zipfile
from datetime import datetime
from .store import utcnow, due_slot
from .render import check_assets


def export_draft(db, ident):
    draft=db.get_draft(ident);review=draft.get('review') or {}
    if draft['status']!='ready' or not review.get('passed') or review.get('hash')!=draft['hash']:
        raise ValueError('请先完成当前版本审核，再下载发布包')
    check_assets(db.root,draft['assets'])
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('正文.txt',draft['content']['title']+'\n\n'+draft['content']['body']+'\n')
        archive.writestr('发布说明.txt','本包由 AI 辅助整理，请人工检查文案与图片后在官方客户端发布。\n自动审核只核验知识与产品事实，不代表平台合规或效果保证。\n按平台要求声明 AI 辅助内容；检查并移除不合规导流、虚假经历及未经证实的承诺。\n本工具不连接、浏览、发布或回复小红书账号。\n')
        for i,asset in enumerate(draft['assets'],1):
            archive.write(db.root/asset['path'],f'{i:02}.png')
    return output.getvalue()


class DraftWorker:
    def __init__(self,db,pipeline):self.db=db;self.pipeline=pipeline;self.task=None

    async def prepare(self):
        try:await self.pipeline.generate()
        except asyncio.CancelledError:raise
        except Exception as e:
            self.db.notify('preparation-'+utcnow()[:13],str(e) if isinstance(e,ValueError) else '本地备稿失败，未连接任何社交账号。')

    async def tick(self):
        cfg=self.db.settings()
        if not cfg.get('preparation_enabled',False) or self.pipeline.busy or (self.task and not self.task.done()):return
        slot=due_slot(datetime.fromisoformat(utcnow()),cfg['times'])
        if not slot or cfg.get('last_preparation_slot')==slot:return
        self.db.configure(last_preparation_slot=slot)
        self.task=asyncio.create_task(self.prepare())

    async def close(self):
        if self.task:
            self.task.cancel();await asyncio.gather(self.task,return_exceptions=True)

    async def loop(self):
        while True:
            await self.tick()
            await asyncio.sleep(15)
