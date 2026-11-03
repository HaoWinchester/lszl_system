import hashlib
import io
import json
import zipfile
import httpx
import pytest
from operator_app.server import create_app
from operator_app.store import Store

@pytest.mark.asyncio
async def test_startup_disarms_old_queue_and_retires_all_platform_routes(tmp_path,monkeypatch):
    from operator_app import browser
    def forbidden(*args,**kwargs):raise AssertionError('must not construct platform adapter')
    monkeypatch.setattr(browser.BrowserAdapter,'__init__',forbidden)
    db=Store(tmp_path);db.configure(enabled=True,auto_reply=True)
    d=db.create_draft({'title':'旧稿'},'value');db.review(d['id'],1,{'passed':True},[])
    db.enqueue(d['id'],'2026-11-03T12:00:00+00:00')
    app=create_app(tmp_path)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://localhost:8877') as c:
            state=(await c.get('/api/state')).json();h={'X-Operator-Token':state['csrf']}
            assert state['mode']=='draft-only'
            assert not state['settings']['enabled'] and not state['settings']['auto_reply']
            assert state['jobs'][0]['status']=='canceled'
            routes=['enable','browser/open','browser/check','browser/community','inbox/scan','research/refresh',f'drafts/{d["id"]}/queue',f'drafts/{d["id"]}/preview',f'drafts/{d["id"]}/publish-once','jobs/old/verify']
            for path in routes:
                assert (await c.post('/api/'+path,headers=h,json={})).status_code==410,path
            assert (await c.put('/api/settings',headers=h,json={'enabled':True,'auto_reply':True})).status_code==422

@pytest.mark.asyncio
async def test_export_only_current_reviewed_assets_and_no_private_files(tmp_path):
    app=create_app(tmp_path);db=app.state.db
    d=db.create_draft({'title':'测试知识','body':'正文'},'value')
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://localhost:8877') as c:
        assert (await c.get(f'/api/drafts/{d["id"]}/export')).status_code==409
        folder=tmp_path/'assets'/d['id'];folder.mkdir()
        assets=[]
        for i in range(6):
            p=folder/f'{i+1:02}.png';p.write_bytes(b'fixture image'+str(i).encode())
            assets.append({'path':str(p.relative_to(tmp_path)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
        db.review(d['id'],1,{'passed':True},assets)
        r=await c.get(f'/api/drafts/{d["id"]}/export')
        assert r.status_code==200
        with zipfile.ZipFile(io.BytesIO(r.content)) as z:
            assert set(z.namelist())=={'正文.txt','发布说明.txt',*[f'{i:02}.png' for i in range(1,7)]}
            assert '测试知识\n\n正文' in z.read('正文.txt').decode()
            assert '人工' in z.read('发布说明.txt').decode()
        (folder/'01.png').write_bytes(b'changed')
        assert (await c.get(f'/api/drafts/{d["id"]}/export')).status_code==409
        db.edit(d['id'],{'title':'改稿','body':'变更'})
        assert (await c.get(f'/api/drafts/{d["id"]}/export')).status_code==409

@pytest.mark.asyncio
async def test_local_preparation_slot_persists_without_platform_work(tmp_path,monkeypatch):
    from operator_app import drafting
    from datetime import datetime,timezone
    db=Store(tmp_path);db.configure(preparation_enabled=True)
    clock=['2026-11-03T12:00:00+00:00'];monkeypatch.setattr(drafting,'utcnow',lambda:clock[0])
    class Pipeline:
        busy=False
        calls=0
        async def generate(self):self.calls+=1
    p=Pipeline();w=drafting.DraftWorker(db,p)
    await w.tick();await w.task
    assert p.calls==1
    restarted=drafting.DraftWorker(db,p)
    await restarted.tick()
    assert p.calls==1
    clock[0]='2026-11-04T01:00:00+00:00'
    db.configure(preparation_enabled=False)
    await restarted.tick()
    assert p.calls==1
    db.configure(preparation_enabled=True)
    await restarted.tick();await restarted.task
    assert p.calls==2
    assert db.jobs()==[]
    await w.close();await restarted.close()
