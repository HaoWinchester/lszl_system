import hashlib
import pytest
from operator_app.render import render,check_assets,document
from operator_app.sources import TOPICS

def test_card_escapes_user_text():
    doc=document({'title':'<script>x</script>','text':'<img onerror=x>'},0,6,'知习')
    assert '<script>x' not in doc and '&lt;script&gt;' in doc

@pytest.mark.asyncio
async def test_render_detects_overflow_and_hash_tamper(tmp_path):
    c={'cards':[{'title':'标题','text':'短句'} for _ in range(4)],'question':TOPICS[0]['question']}
    d={'id':'test','version':1,'content':c}
    assets=await render(d,tmp_path,'知习')
    check_assets(tmp_path,assets)
    (tmp_path/assets[0]['path']).write_bytes(b'changed')
    with pytest.raises(ValueError,match='变化'):check_assets(tmp_path,assets)
    c['cards'][0]['text']='行\n'*100
    with pytest.raises(ValueError,match='溢出'):await render(d,tmp_path,'知习')
