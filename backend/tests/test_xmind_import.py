"""Native desktop archive, zero-write preview and transactional security contract."""
import asyncio
import json
from io import BytesIO
from pathlib import Path
import zipfile
import warnings
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, func
from app.main import app
from app.db.session import AsyncSessionLocal
from app.models.user import User
from app.models.file import GraphFile
from app.models.graph_asset import GraphAsset
from app.core.security import hash_password

FIX=Path(__file__).parent/'fixtures/xmind'
async def actor(role='teacher'):
    username='xmind-'+uuid4().hex[:12]
    async with AsyncSessionLocal() as db:
        db.add(User(username=username,role=role,status='active',password_hash=hash_password('xmind-test')))
        await db.commit()
    return username
async def counts(owner):
    async with AsyncSessionLocal() as db:
        return tuple([int(await db.scalar(select(func.count()).select_from(m).where(m.owner_id==owner))) for m in (GraphFile,GraphAsset)])
def login(c,owner):
    assert c.post('/api/v1/auth/login',json={'username':owner,'password':'xmind-test'}).status_code==200
def request(c,action,data,selection=None,warnings=None,name='sample.xmind'):
    fields={}
    if selection is not None:fields['sheetIds']=json.dumps(selection)
    if warnings is not None:fields['acceptedWarnings']=json.dumps(warnings)
    return c.post('/api/v1/graph-imports/xmind/'+action,files={'file':(name,data,'application/octet-stream')},data=fields)
def archive(entries):
    out=BytesIO()
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
        with warnings.catch_warnings():
            warnings.simplefilter('ignore',UserWarning)
            for name,value in entries:z.writestr(name,value)
    return out.getvalue()
def simple(count=1,**extra):
    root={'id':'r','title':'根','children':{'attached':[{'id':str(i),'title':'主题'} for i in range(count-1)]},**extra}
    return archive([('content.json',json.dumps([{'id':'s','title':'Sheet','rootTopic':root}]))])

def test_native_preview_exact_and_editable_transaction():
    owner=asyncio.run(actor());data=(FIX/'xmind-24.04-desktop-rich.xmind').read_bytes();expected=json.loads((FIX/'expected.json').read_text())
    with TestClient(app) as c:
        login(c,owner);p=request(c,'preview',data);assert p.status_code==200,p.text
        preview=p.json();assert preview['format']=='json';assert [s['nodeCount'] for s in preview['sheets']]==[9,5]
        assert asyncio.run(counts(owner))==(0,0)
        assert preview['warnings'] and any(w['code']=='font-family' for w in preview['warnings'])
        selection=[s['id'] for s in preview['sheets']]
        rejected=request(c,'import',data,selection,[]);assert rejected.status_code==422
        assert asyncio.run(counts(owner))==(0,0)
        result=request(c,'import',data,selection,[w['id'] for w in preview['warnings']]);assert result.status_code==201,result.text
        assert asyncio.run(counts(owner))==(2,1)
        for result_sheet,expected_sheet in zip(result.json()['files'],expected['sheets']):
            file_id=result_sheet['file']['id'];g=c.get('/api/v1/files/'+file_id).json()['graphData']
            assert len(g['nodes'])==len(expected_sheet['nodes']);node_map={n['id']:n for n in g['nodes']}
            for n in expected_sheet['nodes']:
                actual=node_map[n['id']];assert actual['content']['title']==n['title'];assert actual['content']['notes']==n['notes']
                if n['parentId']:assert any(l['from']==n['parentId'] and l['to']==n['id'] and l['hierarchy'] is True for l in g['links'])
                if n['image']:
                    ref=actual['content']['images'][0];resp=c.get('/api/v1/graph-assets/'+ref['assetId'],params={'fileId':file_id});assert resp.status_code==200;assert resp.content.startswith(b'\x89PNG')
            g['nodes'][0]['content']['title']='已编辑'
            assert c.put('/api/v1/files/'+file_id,json={'graphData':g}).status_code==200
            assert c.get('/api/v1/files/'+file_id).json()['graphData']['nodes'][0]['content']['title']=='已编辑'

def test_xml_multisheet_styles_notes_image_and_selection():
    owner=asyncio.run(actor());data=(FIX/'xml-only-synthetic.xmind').read_bytes()
    with TestClient(app) as c:
        login(c,owner);p=request(c,'preview',data);assert p.status_code==200,p.text
        preview=p.json();assert preview['format']=='xml';assert [s['nodeCount'] for s in preview['sheets']]==[3,1]
        r=request(c,'import',data,['xml-one'],[w['id'] for w in preview['warnings']]);assert r.status_code==201,r.text
        assert asyncio.run(counts(owner))==(1,1)
        g=c.get('/api/v1/files/'+r.json()['files'][0]['file']['id']).json()['graphData'];root=g['nodes'][0]
        assert root['content']['notes']=='XML 中文备注\n完整保留。';assert root['appearance']['fontSize']==pytest.approx(26.67)
        assert root['appearance']['fontWeight']=='bold';assert root['appearance']['fillColor']=='#ffeecc';assert root['appearance']['textColor']=='#112233'
        assert g['links'][0]['lineStyle']=='dashed';assert all(l['hierarchy'] for l in g['links'])

@pytest.mark.parametrize('data,name',[(b'bad','bad.xmind'),(simple(),'bad.zip'),(archive([('../content.json','[]')]),'escape.xmind'),(archive([('content.xml','<!DOCTYPE a [<!ENTITY x "boom">]><a>&x;</a>')]),'entity.xmind'),(archive([('content.json','[]'),('content.json','[]')]),'duplicate.xmind'),(simple(2501),'large.xmind'),(simple(image={'src':'https://example.com/a.png'}),'external.xmind'),(simple(image={'src':'xap:missing.png'}),'missing.xmind')])
def test_invalid_packages_zero_writes(data,name):
    owner=asyncio.run(actor())
    with TestClient(app) as c:
        login(c,owner)
        for action in ('preview','import'):
            r=request(c,action,data,['s'],[],name=name);assert r.status_code in (413,422),r.text
        assert asyncio.run(counts(owner))==(0,0)

def test_quota_permissions_and_atomic_failure(monkeypatch):
    owner=asyncio.run(actor('student'))
    with TestClient(app) as c:
        login(c,owner);assert request(c,'preview',simple(51)).status_code==422
        assert asyncio.run(counts(owner))==(0,0)
    owner=asyncio.run(actor())
    from app.services import file_service
    original=file_service.create_file
    calls=0
    async def failure(*args,**kwargs):
        nonlocal calls
        calls+=1
        if calls==2:raise RuntimeError('injected second-sheet failure')
        return await original(*args,**kwargs)
    monkeypatch.setattr(file_service,'create_file',failure)
    with TestClient(app,raise_server_exceptions=False) as c:
        login(c,owner);data=(FIX/'xmind-24.04-desktop-rich.xmind').read_bytes();p=request(c,'preview',data).json()
        assert request(c,'import',data,[s['id'] for s in p['sheets']],[w['id'] for w in p['warnings']]).status_code==500
        assert asyncio.run(counts(owner))==(0,0)
    viewer=asyncio.run(actor('viewer'))
    with TestClient(app) as c:
        login(c,viewer);assert request(c,'preview',simple()).status_code==403

def test_official_dual_archives_and_unsupported_real_resources():
    owner=asyncio.run(actor())
    with TestClient(app) as c:
        login(c,owner)
        p=request(c,'preview',(FIX/'official-embed-test-1.xmind').read_bytes());assert p.status_code==200,p.text
        assert p.json()['format']=='json';assert p.json()['sheets'][0]['sample'][0]['title']=='test-1.xmind'
        for name,detail in [('official-swift-example0.xmind','图片格式'),('official-swift-example1.xmind','加密')]:
            r=request(c,'preview',(FIX/name).read_bytes());assert r.status_code==422,r.text;assert detail in r.json()['detail']
        assert asyncio.run(counts(owner))==(0,0)

def test_zip_real_limits_crc_symlink_and_damaged_resource():
    from app.services import xmind_import_service as service
    from fastapi import HTTPException
    import stat
    out=BytesIO()
    with zipfile.ZipFile(out,'w') as z:
        info=zipfile.ZipInfo('link');info.create_system=3;info.external_attr=(stat.S_IFLNK|0o777)<<16;z.writestr(info,'content.json')
    bad_crc=BytesIO()
    with zipfile.ZipFile(bad_crc,'w',zipfile.ZIP_STORED) as z:z.writestr('content.json','original-marker')
    bad_crc=bad_crc.getvalue().replace(b'original-marker',b'corrupt!-marker')
    image_doc=json.dumps([{'id':'s','title':'bad image','rootTopic':{'id':'r','title':'bad','image':{'src':'xap:resources/bad.png'}}}])
    cases=[b'0'*(service.MAX_UPLOAD+1),archive([('big',b'0'*(service.MAX_EXPANDED+1))]),archive([(f'e{i}','') for i in range(1001)]),out.getvalue(),bad_crc,archive([('content.json',image_doc),('resources/bad.png',b'not a PNG')]),archive([('content.xml','<!DOCTYPE root><root/>'.encode('utf-16'))])]
    for data in cases:
        with pytest.raises(HTTPException) as error:service.parse(data,'security.xmind')
        assert error.value.status_code in (413,422)

@pytest.mark.parametrize('document',[
    {'id':'s','rootTopic':None},
    {'id':'s','rootTopic':{'id':'r','title':'ok','children':[]}},
    {'id':'s','rootTopic':{'id':'r','title':'ok','notes':{'plain':7}}},
    {'id':'s','rootTopic':{'id':'r','title':'ok','style':{'properties':[]}}},
    {'id':'s','rootTopic':{'id':'r','title':'ok'},'theme':{'map':7}},
    {'id':'s','rootTopic':{'id':'r','title':'ok','notes':{'plain':{'content':'n'*100001}}}},
    {'id':'s','rootTopic':{'id':'r','title':'n'*81}},
])
def test_malformed_shapes_and_unrepresentable_text_rejected(document):
    from app.services import xmind_import_service as service
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as error:service.parse(archive([('content.json',json.dumps([document]))]),'bad.xmind')
    assert error.value.status_code==422

def test_special_object_warnings_require_matching_document():
    owner=asyncio.run(actor());data=simple(markers=[{'markerId':'priority-1'}],boundaries=[{'title':'boundary'}],children={'attached':[{'id':'c','title':'child'}],'detached':[{'id':'d','title':'floating'}]})
    with TestClient(app) as c:
        login(c,owner);p=request(c,'preview',data).json()
        assert p['sheets'][0]['nodeCount']==3;assert any(w['code']=='special-objects' for w in p['warnings']);assert any(w['code']=='special-topics' for w in p['warnings'])
        assert request(c,'import',data,['s','s'],[w['id'] for w in p['warnings']]).status_code==422
        assert request(c,'import',simple(2),['s'],[w['id'] for w in p['warnings']]).status_code==422
        plain=request(c,'preview',simple()).json()
        assert request(c,'import',simple(2),['s'],[w['id'] for w in plain['warnings']]).status_code==422
        assert asyncio.run(counts(owner))==(0,0)

def test_native_readable_media_geometry_and_human_warning_labels():
    from app.services import xmind_import_service as service
    parsed=service.parse((FIX/'xmind-24.04-desktop-rich.xmind').read_bytes(),'native.xmind')
    root=parsed['sheets'][0]['graph']['nodes'][0]
    assert root['appearance']['textColor']=='#ffffff'
    assert root['geometry']['width']>=320 and root['geometry']['height']>=300
    assert all(w['sheetTitle'] and w['objectTitle'] for w in parsed['warnings'])
