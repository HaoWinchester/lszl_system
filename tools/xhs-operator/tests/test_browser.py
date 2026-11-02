import pytest
from operator_app.browser import publish_target

class Session:
    def __init__(self,nodes):self.nodes=nodes
    async def send(self,name,args=None):
        if name=='Accessibility.getFullAXTree':return {'nodes':self.nodes}
        if name=='DOM.getContentQuads':return {'quads':[[10,20,110,20,110,60,10,60]]}
        return {}
    async def detach(self):pass

class Context:
    def __init__(self,nodes):self.nodes=nodes
    async def new_cdp_session(self,page):return Session(self.nodes)

class Page:
    viewport_size={'width':1280,'height':900}

def button(disabled=False):return {'role':{'value':'button'},'name':{'value':'发布'},'backendDOMNodeId':2,'properties':[{'name':'disabled','value':{'value':disabled}}]}

@pytest.mark.asyncio
async def test_accessible_submit_target_is_unique_and_enabled():
    assert await publish_target(Context([button()]),Page())==(60,40)
    with pytest.raises(ValueError):await publish_target(Context([button(True)]),Page())
    with pytest.raises(ValueError):await publish_target(Context([button(),button()]),Page())

def test_receipt_cannot_use_stale_all_tab_data():
    import json
    from operator_app.browser import parse_note_card
    data=json.dumps({'index':{'value':{'channelTabName':'all'}},'noteTarget':{'value':{'noteId':'a'*24}}})
    assert parse_note_card('标题',data,'published') is None
    row=parse_note_card('标题',data,'all')
    assert row['note_id']=='a'*24
