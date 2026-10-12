"""File JSON is never an authorization grant for immutable graph images."""
import asyncio
import base64
from io import BytesIO
from uuid import uuid4
import pytest
from PIL import Image
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select, func
from app.main import app
from app.db.session import AsyncSessionLocal
from app.models.user import User
from app.models.file import FileContent, GraphFile
from app.models.graph_asset import GraphAsset
from app.core.security import hash_password
from app.core.image_validation import validate_image_bytes
from app.services import file_service, graph_asset_service as assets

PASSWORD='graph-assets-test'
def png(fmt='PNG'):
    out=BytesIO();Image.new('RGB',(2,3),'blue').save(out,format=fmt)
    return out.getvalue()
def upload_payload(fmt='PNG'):
    return {'filename':'image','mimeType':{'PNG':'image/png','JPEG':'image/jpeg','WEBP':'image/webp'}[fmt], 'dataBase64':base64.b64encode(png(fmt)).decode(), 'alt':'测试'}
async def users():
    ids=['asset-'+uuid4().hex[:12] for _ in range(2)]
    async with AsyncSessionLocal() as db:
        for id in ids:db.add(User(username=id,role='student',status='active',password_hash=hash_password(PASSWORD)))
        await db.commit()
    return ids
def login(client,id):
    assert client.post('/api/v1/auth/login',json={'username':id,'password':PASSWORD}).status_code==200

def graph(asset):
    return {'nodes':[{'id':'n','content':{'title':'图片','notes':'长备注\n'*2000,'images':[asset,asset]}}], 'links':[]}

def test_formats_mime_size_pixels():
    for fmt,mime in [('PNG','image/png'),('JPEG','image/jpeg'),('WEBP','image/webp')]:
        assert validate_image_bytes(png(fmt),mime)==(2,3)
    for data,mime in [(png(),'image/jpeg'),(b'x'*(5*1024*1024+1),'image/png'),(b'bad','image/png')]:
        with pytest.raises(HTTPException):validate_image_bytes(data,mime)
    oversized=BytesIO();Image.new('1',(8001,5000)).save(oversized,format='PNG')
    with pytest.raises(HTTPException):validate_image_bytes(oversized.getvalue(),'image/png')


def test_api_save_copy_read_and_forged_owned_reference():
    owner,other=asyncio.run(users())
    with TestClient(app) as c:
        login(c,owner)
        asset=c.post('/api/v1/graph-assets',json=upload_payload()).json()['asset']
        created=c.post('/api/v1/files',json={'name':'source','graphData':graph(asset)})
        assert created.status_code==200,created.text
        source=created.json()['file']['id']
        url='/api/v1/graph-assets/'+asset['assetId']
        assert c.get(url,params={'fileId':source}).content==png()
        assert c.get(url).status_code==422
        async def copy_delete():
            async with AsyncSessionLocal() as db:
                copy=await file_service.duplicate_file(db,owner,source)
                id=copy.id
                await file_service.trash_file(db,owner,source)
                await file_service.delete_permanent(db,owner,source)
                return id
        copy=asyncio.run(copy_delete())
        assert c.get(url,params={'fileId':copy}).status_code==200
        assert c.get('/api/v1/files/'+copy).json()['graphData']==graph(asset)
        login(c,other)
        assert c.post('/api/v1/files',json={'name':'forged','graphData':graph(asset)}).status_code==404
        own=c.post('/api/v1/files',json={'name':'owned'}).json()['file']['id']
        response=c.put('/api/v1/files/'+own,json={'graphData':graph(asset)})
        assert response.status_code==404,response.text
        assert c.post('/api/v1/files/import-legacy',json={'files':[{'name':'forged','graphData':graph(asset)}]}).status_code==404
        # Simulate historical/direct tampering: even persisted foreign JSON cannot grant a read.
        async def forge():
            async with AsyncSessionLocal() as db:
                content=await db.get(FileContent,own);content.graph_data=graph(asset);await db.commit()
        asyncio.run(forge())
        assert c.get(url,params={'fileId':own}).status_code==404
        assert c.get(url,params={'fileId':copy}).status_code==404
        assert c.post('/api/v1/question-assets',json=upload_payload()).status_code==403


def test_trusted_cross_owner_clone_remaps_once_and_transaction_rollback():
    owner,target=asyncio.run(users())
    async def check():
        async with AsyncSessionLocal() as db:
            image=await assets.create_asset(db,owner,image_bytes=png(),mime_type='image/png')
            source=await file_service.create_file(db,owner,name='source',graph_data=graph(image),commit=False)
            source_id=source.id
            await db.commit()
        async with AsyncSessionLocal() as db:
            source=await db.get(FileContent,source_id)
            clone,mapping=await assets.clone_graph_assets(db,owner,target,source.graph_data)
            assert mapping[image['assetId']]!=image['assetId']
            assert len(mapping)==1 and clone['nodes'][0]['content']['images'][0]==clone['nodes'][0]['content']['images'][1]
            file=await file_service.create_file(db,target,name='template copy',graph_data=clone,commit=False)
            target_id=file.id;cloned_id=mapping[image['assetId']]
            await db.commit()
        async with AsyncSessionLocal() as db:
            assert (await assets.authorized_asset(db,target,cloned_id,target_id)).data==png()
            before=await db.scalar(select(func.count()).select_from(GraphAsset))
            try:
                await assets.create_asset(db,target,image_bytes=png(),mime_type='image/png')
                await file_service.create_file(db,target,name='rollback',graph_data={'nodes':[]},commit=False)
                raise ValueError('later import failure')
            except ValueError:await db.rollback()
            assert await db.scalar(select(func.count()).select_from(GraphAsset))==before
            assert await db.scalar(select(GraphFile.id).where(GraphFile.owner_id==target,GraphFile.name=='rollback')) is None
    asyncio.run(check())


def test_invalid_image_dimensions_reject_create_save_import_without_persisting():
    owner,_=asyncio.run(users())
    with TestClient(app) as c:
        login(c,owner)
        asset=c.post('/api/v1/graph-assets',json=upload_payload()).json()['asset']
        original=graph(asset)
        file=c.post('/api/v1/files',json={'name':'dimensions','graphData':original}).json()['file']
        for key in ('width','height'):
            for value in (-1,0,40000001,'NaN','Infinity',{},'invalid'):
                invalid=graph({**asset,key:value})
                before=c.get('/api/v1/files/'+file['id']).json()
                assert c.post('/api/v1/files',json={'name':'invalid-dimensions','graphData':invalid}).status_code==422
                assert c.put('/api/v1/files/'+file['id'],json={'graphData':invalid}).status_code==422
                after=c.get('/api/v1/files/'+file['id']).json()
                assert after['graphData']==before['graphData']==original
                assert after['meta']['revision']==before['meta']['revision']
                assert c.post('/api/v1/files/import-legacy',json={'files':[{'name':'invalid-dimensions','graphData':invalid}],'folders':[{'id':'bad','name':'must-not-create'}]}).status_code==422
        listing=c.get('/api/v1/files').json()['files']
        assert [f['name'] for f in listing]==['dimensions']
        assert not c.get('/api/v1/files/folders').json()['folders']
        accepted=graph({**asset,'width':'2.5','height':40000000})
        assert c.put('/api/v1/files/'+file['id'],json={'graphData':accepted}).status_code==200
        saved=c.get('/api/v1/files/'+file['id']).json()['graphData']
        assert saved['nodes'][0]['content']['images'][0]['width']==2.5
        assert saved['nodes'][0]['content']['images'][0]['height']==40000000
        optional=graph({'assetId':asset['assetId'],'alt':'optional'})
        assert c.post('/api/v1/files',json={'name':'optional','graphData':optional}).status_code==200
