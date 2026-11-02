import httpx
import pytest
from operator_app.server import create_app

@pytest.mark.asyncio
async def test_local_api_csrf_and_enable_gate(tmp_path):
    app=create_app(tmp_path)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://127.0.0.1:8877') as c:
        state=(await c.get('/api/state')).json()
        assert state['settings']['enabled'] is False
        assert (await c.post('/api/pause')).status_code==403
        headers={'X-Operator-Token':state['csrf'],'Origin':'http://127.0.0.1:8877'}
        assert (await c.post('/api/pause',headers=headers)).status_code==200
        assert (await c.post('/api/enable',headers=headers)).status_code==409
        assert (await c.get('/api/state',headers={'Host':'evil.example'})).status_code==403
        assert (await c.post('/api/pause',headers={**headers,'Origin':'https://evil.example'})).status_code==403

@pytest.mark.asyncio
async def test_settings_validate_schedule_and_hide_secret(tmp_path):
    app=create_app(tmp_path)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://localhost:8877') as c:
        state=(await c.get('/api/state')).json();h={'X-Operator-Token':state['csrf']}
        r=await c.put('/api/settings',headers=h,json={'times':['99:99']})
        assert r.status_code==422
        r=await c.put('/api/settings',headers=h,json={'times':['08:30','19:30'],'daily_calls':8})
        assert r.status_code==200
        assert (await c.get('/api/state')).json()['settings']['times']==['08:30','19:30']
        assert (await c.put('/api/settings',headers=h,json={'adapter_verified':True})).status_code==422
        assert 'AUTH_TOKEN' not in str(state)
