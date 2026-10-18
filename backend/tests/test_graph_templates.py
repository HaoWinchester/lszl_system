"""Real authenticated template authority/immutable-copy/atomicity regressions."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import uuid4
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select, func, delete
from app.main import app
from app.db.session import AsyncSessionLocal
from app.core.security import now_utc
from app.models.subscription import Subscription
from app.models.file import GraphFile, FileContent
from app.models.graph_asset import GraphAsset
from app.models.graph_template import GraphTemplateVersion, GraphTemplateLoad
from app.models.graph_question import GraphQuestionBinding
from app.services import graph_template_service as service
from test_graph_question_access import data as source_fixture, login, create_card, bind, path, PASSWORD
from test_graph_assets import upload_payload, png


@pytest.fixture
def data():
    value=source_fixture.__wrapped__()
    async def isolate_search_names():
        from app.models.question import Question
        async with AsyncSessionLocal() as db:
            for row in (await db.scalars(select(Question).where(Question.bank_id.in_([value.bank,value.public_bank])))).all():
                row.title='template-case '+row.id.rsplit('-',1)[-1]
            await db.commit()
    asyncio.run(isolate_search_names())
    return value


def publication(file, revision=1, member=False):
    return {'sourceFileId':file,'expectedFileRevision':revision,'name':'模板测试','description':'安全预览描述','memberOnly':member}


def publish(c, body):
    r=c.post('/api/v1/graph-templates',json=body)
    assert r.status_code==201,r.text
    return r.json()['template']


def load(c, template, request=None, version=None):
    return c.post(f"/api/v1/graph-templates/{template['id']}/loads",json={'requestId':request or uuid4().hex,'version':version or template['version']})


def set_subscription(username, plan, status='active', expires=None):
    async def run():
        async with AsyncSessionLocal() as db:
            old=await db.get(Subscription,username)
            if old:await db.delete(old);await db.flush()
            db.add(Subscription(username=username,plan_id=plan,status=status,expires_at=expires))
            await db.commit()
    asyncio.run(run())


def test_permission_subscription_and_preview_matrix(data):
    with TestClient(app) as c:
        login(c,data,'teacher');source=create_card(c)
        free=publish(c,publication(source));paid=publish(c,publication(source,member=True))
        assert load(c,paid).status_code==201
        preview=c.get('/api/v1/graph-templates/'+paid['id']).json()
        assert set(preview)=={'template','preview'}
        assert 'graphData' not in str(preview) and 'SECRET' not in str(preview)
        login(c,data,'admin');assert load(c,paid).status_code==201
        assert c.patch('/api/v1/graph-templates/'+paid['id'],json={'listed':False}).status_code==200
        login(c,data,'student');assert paid['id'] not in [t['id'] for t in c.get('/api/v1/graph-templates').json()['templates']]
        login(c,data,'admin');assert c.patch('/api/v1/graph-templates/'+paid['id'],json={'listed':True}).status_code==200
        own=create_card(c);assert publish(c,publication(own))['canMaintain']
        login(c,data,'other')
        assert c.post('/api/v1/graph-templates/'+paid['id']+'/versions',json=publication(source)).status_code==404
        assert c.patch('/api/v1/graph-templates/'+paid['id'],json={'listed':False}).status_code==404
        assert c.post('/api/v1/graph-templates',json=publication(source)).status_code==404
        login(c,data,'student')
        assert c.post('/api/v1/graph-templates',json=publication(source)).status_code==403
        assert c.post('/api/v1/graph-templates/'+paid['id']+'/versions',json=publication(source)).status_code==403
        assert c.patch('/api/v1/graph-templates/'+paid['id'],json={'listed':False}).status_code==403
        assert load(c,free).status_code==201
        for plan,status,expiry,allowed in [
            ('free','active',None,False),('monthly','active',now_utc()+timedelta(days=1),True),
            ('quarterly','active',now_utc()+timedelta(days=1),True),('half_year','active',now_utc()+timedelta(days=1),True),
            ('lifetime','active',None,True),('monthly','active',now_utc()-timedelta(days=1),False),
            ('monthly','active',None,False),('lifetime','paused',None,False),('lifetime','expired',None,False)]:
            set_subscription(data.student,plan,status,expiry)
            assert load(c,paid).status_code==(201 if allowed else 403)
        assert c.post('/api/v1/graph-templates',json=publication(source)|{'graphData':{}}).status_code==422
        for role in ('viewer',):
            login(c,data,role)
            assert c.get('/api/v1/graph-templates').status_code==403
            assert load(c,free).status_code==403
        c.post('/api/v1/auth/logout');assert c.get('/api/v1/graph-templates').status_code==401


def test_frozen_versions_assets_grants_no_retroactive_revocation(data):
    with TestClient(app) as c:
        login(c,data,'teacher');image=c.post('/api/v1/graph-assets',json=upload_payload()).json()['asset']
        graph={'meta':{'title':'version one'},'viewport':{'x':900,'y':10,'scale':2},'flashReviews':{'n':{'reviewCount':3}},'importedFlashcards':[{'id':'secret'}],
               'mindmap':{'rootIds':['n'],'themeId':'mint'},'nodes':[{'id':'n','title':'card','x':200,'y':200,'content':{'title':'card','notes':'保持完整\n'*3000,'images':[image]},'questionIds':[data.unused]}],
               'links':[{'id':'l','from':'n','to':'','toPoint':{'x':800,'y':500},'fromPort':{'side':'right','offset':0.25},'curveControls':[{'x':200,'y':30},{'x':800,'y':400}]}],
               'elements':[{'id':'e','text':'文字','x':12,'y':32}], 'tables':[{'id':'t','schemaVersion':1,'x':0,'y':0,'rows':2,'cols':2,'columnWidths':[140.0,140.0],'rowHeights':[40.0,40.0],'cells':{'0,0':'cell'},'merges':[]}]}
        source=c.post('/api/v1/files',json={'name':'frozen','graphData':graph}).json()['file']['id']
        bind(c,source,[data.q]);template=publish(c,publication(source,2));tid=template['id']
        assert c.post('/api/v1/graph-templates/'+tid+'/versions',json=publication(source,1)).status_code==409
        login(c,data,'student');request=uuid4().hex;r=load(c,template,request);assert r.status_code==201,r.text;loaded=r.json();fid=loaded['fileId'];nid=loaded['idMap']['n']
        assert fid!=source and nid!='n'
        copy=c.get('/api/v1/files/'+fid).json()['graphData'];assert copy['nodes'][0]['content']['notes']==graph['nodes'][0]['content']['notes']
        assert all(k not in copy for k in ('flashReviews','viewport','importedFlashcards'))
        assert 'questionIds' not in copy['nodes'][0]
        assert copy['mindmap']['rootIds']==[nid] and copy['links'][0]['from']==nid and copy['links'][0]['toPoint']==graph['links'][0]['toPoint']
        assert copy['links'][0]['curveControls']==graph['links'][0]['curveControls'] and copy['tables'][0]['id']!='t'
        asset=copy['nodes'][0]['content']['images'][0]['assetId'];assert asset!=image['assetId']
        assert c.get('/api/v1/graph-assets/'+asset,params={'fileId':fid}).content==png()
        bpath=f'/api/v1/graph-questions/files/{fid}/nodes/{nid}/bindings';bindings=c.get(bpath).json()['bindings'];assert len(bindings)==1
        b=bindings[0];assert b['question']['title']=='template-case q'
        attempt=c.post(bpath+'/'+b['id']+'/attempts',json={'sourceVersion':b['sourceVersion'],'requestId':uuid4().hex,'selectedOptionIds':['A']});assert attempt.status_code==200,attempt.text
        assert c.get('/api/v1/graph-questions/attempts/'+attempt.json()['attempt']['id']+'/analysis').json()['analysis']=='SECRET ANALYSIS'
        copy['nodes'][0]['title']='copy change';assert c.put('/api/v1/files/'+fid,json={'graphData':copy,'expectedRevision':1}).status_code==200
        login(c,data,'teacher');assert c.get('/api/v1/files/'+source).json()['graphData']==graph
        updated=publication(source,2,True)|{'name':'版本二'};t2=c.post('/api/v1/graph-templates/'+tid+'/versions',json=updated).json()['template'];assert t2['version']==2
        c.patch('/api/v1/graph-templates/'+tid,json={'listed':False})
        # Source removal and binding deletion leave the immutable publication usable.
        async def remove():
            async with AsyncSessionLocal() as db:
                await db.execute(delete(GraphQuestionBinding).where(GraphQuestionBinding.file_id==source));await db.commit()
        asyncio.run(remove())
        login(c,data,'student');assert load(c,template,request).json()==loaded
        assert load(c,template).status_code==404
        assert load(c,t2,request).status_code==409
        assert c.get('/api/v1/files/'+fid).status_code==200
        assert c.get(bpath).status_code==200
        login(c,data,'teacher');c.patch('/api/v1/graph-templates/'+tid,json={'listed':True})
        login(c,data,'student');assert load(c,t2).status_code==403
        set_subscription(data.student,'lifetime');old=load(c,template,version=1);assert old.status_code==201
        oldgraph=c.get('/api/v1/files/'+old.json()['fileId']).json()['graphData'];assert oldgraph['nodes'][0]['title']=='card'


def test_free_template_node_quota(data):
    with TestClient(app) as c:
        login(c,data,'teacher')
        graph={'meta':{'title':'配额'},'nodes':[{'id':f'n{i}','title':f'k{i}','x':i*10,'y':0,'content':{'title':f'k{i}'}} for i in range(51)]}
        source=c.post('/api/v1/files',json={'name':'quota','graphData':graph}).json()['file']['id']
        big=publish(c,publication(source))
        login(c,data,'student')
        assert load(c,big).status_code==422
        assert load(c,big,request=uuid4().hex).json()['detail']['code']=='TEMPLATE_NODE_QUOTA_EXCEEDED'
        graph['nodes']=graph['nodes'][:50]
        login(c,data,'teacher')
        assert c.put('/api/v1/files/'+source,json={'graphData':graph,'expectedRevision':1}).status_code==200
        small=publish(c,publication(source,2))
        login(c,data,'student');assert load(c,small).status_code==201


def test_update_keeps_listing_state(data):
    with TestClient(app) as c:
        login(c,data,'teacher');source=create_card(c)
        template=publish(c,publication(source))
        c.patch('/api/v1/graph-templates/'+template['id'],json={'listed':False})
        updated=c.post('/api/v1/graph-templates/'+template['id']+'/versions',json=publication(source)|{'name':'静默上架检查'}).json()['template']
        assert updated['version']==2
        login(c,data,'student');assert template['id'] not in [t['id'] for t in c.get('/api/v1/graph-templates').json()['templates']]
        login(c,data,'teacher');assert c.patch('/api/v1/graph-templates/'+template['id'],json={'listed':True}).status_code==200
        login(c,data,'student');assert load(c,updated).status_code==201


def test_atomic_rollback_and_concurrent_request_receipt(data,monkeypatch):
    with TestClient(app) as c:
        login(c,data,'teacher');source=create_card(c);bind(c,source,[data.q]);template=publish(c,publication(source,2))
        login(c,data,'student')
        async def counts():
            async with AsyncSessionLocal() as db:
                return tuple([await db.scalar(select(func.count()).select_from(model)) for model in (GraphFile,GraphAsset,GraphTemplateLoad,GraphQuestionBinding)])
        before=asyncio.run(counts());original=service.questions.clone_card_bindings
        async def fail_after_clone(*args,**kwargs):
            await original(*args,**kwargs);raise HTTPException(409,'forced binding failure')
        monkeypatch.setattr(service.questions,'clone_card_bindings',fail_after_clone)
        assert load(c,template).status_code==409
        assert asyncio.run(counts())==before
        monkeypatch.setattr(service.questions,'clone_card_bindings',original)
        cookies=dict(c.cookies);request=uuid4().hex
        def send(_):
            with TestClient(app) as other:
                other.cookies.update(cookies);r=load(other,template,request);assert r.status_code==201,r.text;return r.json()['fileId']
        with ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(send,range(4)))
        assert len(set(results))==1
        after=asyncio.run(counts());assert after[0]==before[0]+1 and after[2]==before[2]+1 and after[3]==before[3]+1


def test_template_only_frozen_material_and_cleanup_inventory(data):
    from app.models.question import Question
    from app.models.paper_release import PaperReleaseQuestion
    from app.services import question_cleanup_reference_service as inventory
    with TestClient(app) as c:
        login(c,data,'teacher');source=create_card(c);bind(c,source,[data.q]);template=publish(c,publication(source,2))
        async def remove_other_references():
            async with AsyncSessionLocal() as db:
                await db.execute(delete(GraphQuestionBinding).where(GraphQuestionBinding.file_id==source))
                await db.execute(delete(PaperReleaseQuestion).where(PaperReleaseQuestion.release_id==data.release))
                for q in (await db.scalars(select(Question).where(Question.bank_id.in_([data.bank,data.public_bank])))).all():
                    q.content_metadata={}
                await db.commit()
                result=await inventory.inventory_question_references(db)
                assert any(r.container_type=='graph_template_version' and r.question_id==data.q for r in result[0])
        asyncio.run(remove_other_references())
        login(c,data,'other');result=c.delete('/api/v1/question-materials/'+data.material,params={'revision':1})
        assert result.status_code==409,result.text
        assert result.json()['detail']['code']=='MATERIAL_REFERENCED'
        login(c,data,'student');r=load(c,template);assert r.status_code==201,r.text
        fid=r.json()['fileId'];nid=r.json()['idMap']['n'];bp=f'/api/v1/graph-questions/files/{fid}/nodes/{nid}/bindings';b=c.get(bp).json()['bindings'][0]
        assert b['question']['material']['text']=='version one'
        assert c.get(b['question']['material']['images'][0]['url']).content==b'frozen-test-bytes'


def test_preview_is_bounded_public_projection_and_does_not_create_files(data):
    with TestClient(app) as c:
        login(c,data,'teacher')
        graph={'nodes':[{'id':'n','title':'<b>知识点</b>','x':10,'y':20,'width':240,'height':80,'style':{'bg':'#eff6ff','color':'url(SECRET)'},'content':{'notes':'SECRET NOTES','images':[]},'questions':['SECRET ANSWER']}], 'links':[{'id':'l','from':'n','to':'n','label':'关系','style':{'color':'#123456'},'question':'SECRET'}]}
        created=c.post('/api/v1/files',json={'name':'preview','graphData':graph})
        assert created.status_code==200,created.text
        source=created.json()['file']['id']
        template=publish(c,publication(source))
        before=c.get('/api/v1/files').json()
        login(c,data,'student')
        result=c.get('/api/v1/graph-templates/'+template['id'])
        assert result.status_code==200,result.text
        preview=result.json()['preview']
        assert set(preview)=={'version','nodes','links'}
        assert preview['version']==1 and len(preview['nodes'])==1
        assert set(preview['nodes'][0])=={'id','title','x','y','width','height','fill','color','appearance'}
        assert preview['nodes'][0]['color']=='#243247'
        assert 'SECRET' not in str(preview) and 'notes' not in str(preview) and 'images' not in str(preview)
        login(c,data,'teacher')
        assert c.get('/api/v1/files').json()==before
        assert c.patch('/api/v1/graph-templates/'+template['id'],json={'listed':False}).status_code==200
        assert c.get('/api/v1/graph-templates/'+template['id']).status_code==200
        login(c,data,'student')
        assert c.get('/api/v1/graph-templates/'+template['id']).status_code==404
        c.post('/api/v1/auth/logout')
        assert c.get('/api/v1/graph-templates/'+template['id']).status_code==401


def test_preview_projection_rejects_untrusted_styles_and_nonfinite_geometry():
    graph={'nodes':[{'id':'n','title':'<script>text only</script>','x':float('nan'),'y':True,'w':float('inf'),'h':-100,'fillColor':'url(https://external)','textColor':'#123abc','content':{'notes':'SECRET'}}],
           'links':[{'from':'n','to':'missing'},{'from':'n','to':'n','color':'var(--SECRET)','label':'<b>relation</b>'}]}
    preview=service.preview_projection(graph,3)
    assert preview['nodes']==[{'id':'n','title':'text only','x':0,'y':0,'width':128,'height':40,'fill':'#ffffff','color':'#123abc','appearance':{'textColor':'#123abc'}}]
    assert preview['links']==[{'id':'preview-link-1','from':'n','to':'n','label':'relation','color':'#2563eb','pathStyle':'curve','lineStyle':'solid','strokeWidth':4,'width':4,'arrowStyle':'none','fromPort':'auto','toPort':'auto'}]
    assert 'SECRET' not in str(preview)
    huge=service.preview_projection({'nodes':[{'id':'huge','x':10**500,'y':-(10**500)}]},1)['nodes'][0]
    assert huge['x']==100000 and huge['y']==-100000


def test_preview_uses_canonical_card_geometry_and_appearance_before_legacy_aliases():
    node={'id':'resized','title':'stale','x':999,'y':999,'w':136,'h':142,
          'content':{'title':'知识归纳'},'geometry':{'x':10,'y':20,'width':600,'height':80},
          'appearance':{'fillColor':'#eff6ff','textColor':'#123456'}}
    projected=service.preview_projection({'nodes':[node]},1)['nodes'][0]
    assert projected=={'id':'resized','title':'知识归纳','x':10,'y':20,'width':600,'height':80,'fill':'#eff6ff','color':'#123456','appearance':{'fillColor':'#eff6ff','textColor':'#123456'}}


def test_preview_preserves_safe_card_appearance_and_model_size_defaults():
    style = {'cardStyle':'rounded','size':'small','color':'#aabbcc','headerIconColor':'#123456',
             'headerFillColor':'#234567','bodyFillColor':'#345678','headerTextColor':'#456789','bodyTextColor':'#56789a',
             'regionColorsCustomized':True,'fillColor':'#6789ab','fillOpacity':0.4,'borderVisible':False,
             'borderColor':'#789abc','borderWidth':2.5,'borderStyle':'dotted','borderOpacity':0.6,
             'textColor':'#89abcd','textBackgroundColor':'#9abcde','textBackgroundOpacity':0.2,
             'textAlign':'right','fontSize':36,'fontFamily':'kai','fontWeight':'bold','fontStyle':'italic',
             'underline':True,'strikeThrough':False,'lineHeight':1.8,'surfaceCustomized':True}
    graph={'nodes':[{'id':'rich','title':'x','appearance':style,'cardStyle':'circle','fontSize':12,
                     'mindmapTheme':{'id':'capsule','baseline':{'notes':'SECRET'}}}]}
    node=service.preview_projection(graph,1)['nodes'][0]
    assert node['appearance']==style
    assert (node['width'],node['height'])==(104,110)
    assert node['mindmapTheme']=={'id':'capsule'}
    for card_style in ('standard','sticky','rounded','rectangle','circle','triangle'):
        for size,dims in [('',(128,132)),('small',(104,110)),('big',(160,166))]:
            legacy={'id':'shape','cardStyle':card_style,'size':size,'fontSize':'large','fillColor':'#abc'}
            projected=service.preview_projection({'nodes':[legacy]},1)['nodes'][0]
            assert projected['appearance']['cardStyle']==card_style
            assert projected['appearance']['fontSize']==20
            assert projected['appearance']['fillColor']=='#aabbcc'
            assert (projected['width'],projected['height'])==dims
    assert service.preview_projection({'nodes':[{'id':'old','cardStyle':'text'}]},1)['nodes'][0]['appearance']['cardStyle']=='rounded'


def test_preview_preserves_manual_routes_and_safe_free_endpoints():
    ports=[{'side':'right','offset':0.25},'bottom']
    graph={'nodes':[{'id':'a'},{'id':'b'}], 'links':[
        {'id':'curve','from':'a','to':'b','type':'<b>因果</b>','color':'#123456','pathStyle':'curve','lineStyle':'dashed','strokeWidth':6,'arrowStyle':'both',
         'fromPort':ports[0],'toPort':ports[1],'curveControls':[{'x':-40,'y':20,'notes':'SECRET'},{'x':300,'y':-200}]},
        {'id':'elbow','from':'a','to':'','toPoint':{'x':400,'y':80},'pathStyle':'elbow','waypoints':[{'x':100,'y':10},{'x':100,'y':80}],'hierarchy':True},
        {'id':'free','from':'','to':'','fromPoint':{'x':-100,'y':-100},'toPoint':{'x':150,'y':150},'pathStyle':'straight','width':2},
        {'id':'broken','from':'a','to':'missing','toPoint':{'x':200,'y':200}},
        {'id':'invalid-free','from':'','to':'b','fromPoint':{'x':True,'y':2}},
    ]}
    links=service.preview_projection(graph,2)['links']
    assert [link['id'] for link in links]==['curve','elbow','free']
    assert links[0]['label']=='因果' and links[0]['fromPort']==ports[0] and links[0]['toPort']==ports[1]
    assert links[0]['curveControls']==[{'x':-40,'y':20},{'x':300,'y':-200}]
    assert links[0]['strokeWidth']==links[0]['width']==6 and links[0]['arrowStyle']=='both'
    assert links[1]['waypoints']==[{'x':100,'y':10},{'x':100,'y':80}]
    assert links[1]['toPoint']=={'x':400,'y':80} and links[1]['hierarchy'] is True
    assert links[2]['fromPoint']=={'x':-100,'y':-100} and links[2]['width']==2
    assert 'SECRET' not in str(links)


def test_preview_visual_projection_rejects_unsafe_styles_and_bounds_routes():
    graph={'nodes':[{'id':'safe','geometry':{'x':-10**500,'y':10**500,'width':10**500,'height':1},
        'appearance':{'cardStyle':'url(SECRET)','size':'SECRET','fontFamily':'url(SECRET)','textAlign':'SECRET',
                      'fontSize':10**500,'borderWidth':-99,'fillOpacity':5,'lineHeight':0,
                      'borderVisible':'false','underline':1,'textColor':'var(--SECRET)','stroke':'SECRET',
                      'notes':'SECRET','images':[{'url':'https://SECRET'}]},'mindmapTheme':{'id':'SECRET'}}],
        'links':[{'id':'safe-link','from':'safe','to':'','toPoint':{'x':10**500,'y':-10**500},
            'pathStyle':'url(SECRET)','lineStyle':'url(SECRET)','arrowStyle':'SECRET','fromPort':{'side':'left','offset':10},
            'toPort':'SECRET','strokeWidth':99,'color':'url(SECRET)','curveControls':[{'x':float('inf'),'y':0},{'x':0,'y':1}],
            'waypoints':[{'x':float('nan'),'y':0}]+[{'x':i,'y':i} for i in range(90)],'notes':'SECRET'}]}
    preview=service.preview_projection(graph,1);node=preview['nodes'][0];link=preview['links'][0]
    assert (node['x'],node['y'],node['width'],node['height'])==(-100000,100000,1000,40)
    assert node['appearance']=={'fontSize':288,'borderWidth':0,'fillOpacity':1,'lineHeight':0.8}
    assert 'mindmapTheme' not in node
    assert link['pathStyle']=='curve' and link['lineStyle']=='solid' and link['arrowStyle']=='none'
    assert link['fromPort']=={'side':'left','offset':1} and link['toPort']=='auto'
    assert link['strokeWidth']==8 and link['color']=='#2563eb'
    assert link['toPoint']=={'x':100000,'y':-100000} and 'curveControls' not in link
    assert len(link['waypoints'])==63
    assert 'SECRET' not in str(preview)
    assert 'https://' not in str(preview)
    assert len(service.preview_projection({'nodes':[{'id':str(i)} for i in range(600)]},1)['nodes'])==500
    assert len(service.preview_projection({'nodes':[{'id':'n'}],'links':[{'from':'n','to':'n'} for _ in range(1100)]},1)['links'])==1000


def test_preview_projects_only_visible_text_elements_and_bounded_ink():
    element={'id':'caption','elementType':'text','text':'stale','content':{'text':'<b>可见文字</b>\n'+'字'*4000,'notes':'SECRET'},
             'geometry':{'x':10,'y':20,'width':800,'height':120,'manualSize':True},
             'appearance':{'fontSize':42,'fontFamily':'serif','fontWeight':'normal','textColor':'#123456','textAlign':'left','lineHeight':1.5,'textBackgroundOpacity':0.3,'notes':'SECRET'},
             'notes':'SECRET','questions':['SECRET'],'images':[{'url':'https://SECRET'}]}
    strokes=[{'id':'pen','tool':'pen','width':3,'color':'#123456','points':[[10,20],[30,40]],'opacity':0.6,'notes':'SECRET'},
             {'id':'text','tool':'text','width':24,'color':'#234567','points':[[50,60]],'text':'可见笔迹文字','bold':True,'boxWidth':180,'boxHeight':80},
             {'id':'bad','tool':'image','width':10,'color':'#000000','points':[[0,0]],'url':'https://SECRET'},
             {'id':'nan','tool':'pen','width':3,'color':'#123456','points':[[float('nan'),0]]}]
    preview=service.preview_projection({'nodes':[],'elements':[element,{'id':'bad-element','type':'image','text':'SECRET'}],'strokes':strokes},1)
    projected=preview['elements'][0]
    assert len(preview['elements'])==1
    assert set(projected)=={'id','type','elementType','text','x','y','width','height','geometry','appearance'}
    assert projected['text']=='可见文字\n'+'字'*2995 and len(projected['text'])==3000
    assert projected['geometry']==element['geometry']
    assert projected['appearance']=={key:value for key,value in element['appearance'].items() if key!='notes'}
    assert [stroke['id'] for stroke in preview['strokes']]==['pen','text']
    assert preview['strokes'][0]=={key:value for key,value in strokes[0].items() if key!='notes'}
    assert preview['strokes'][1]==strokes[1]
    assert 'SECRET' not in str(preview) and 'https://' not in str(preview)
    assert set(service.preview_projection({'nodes':[],'elements':[{'id':'x','type':'image'}],'strokes':[strokes[2]]},1))=={'version','nodes','links'}
    bad=service.preview_projection({'elements':[{'id':'bad','elementType':'text','text':'ok','x':10**500,'width':-10,'height':10**500,'appearance':{'fontSize':float('inf'),'textColor':'url(SECRET)','underline':'yes'}}]},1)['elements'][0]
    assert (bad['x'],bad['width'],bad['height'])==(100000,24,10000) and bad['appearance']=={}


def test_template_publication_preserves_ink_and_loads_independent_stroke_ids(data):
    graph={'nodes':[{'id':'shared','title':'card'}],'links':[],
           'strokes':[{'id':'shared','tool':'pen','color':'#123456','width':3,'points':[[10,20],[20,30]],'opacity':0.5},
                      {'id':'caption','tool':'text','color':'#345678','width':36,'points':[[50,60]],'text':'发布与加载文字','boxWidth':220,'boxHeight':80,'bold':True}],
           'elements':[{'id':'label','elementType':'text','text':'独立文字','x':20,'y':30}]}
    with TestClient(app) as c:
        login(c,data,'teacher')
        response=c.post('/api/v1/files',json={'name':'template-ink','graphData':graph});assert response.status_code==200,response.text
        source=response.json()['file']['id'];template=publish(c,publication(source))
        preview=c.get('/api/v1/graph-templates/'+template['id']).json()['preview']
        assert preview['strokes']==graph['strokes'] and preview['elements'][0]['text']=='独立文字'
        login(c,data,'student');response=load(c,template);assert response.status_code==201,response.text
        receipt=response.json();copied=c.get('/api/v1/files/'+receipt['fileId']).json()['graphData']
        assert len(copied['strokes'])==2
        assert copied['nodes'][0]['id']==receipt['idMap']['shared']
        assert copied['strokes'][0]['id']!=copied['nodes'][0]['id']
        assert 'caption' not in receipt['idMap'], 'stroke ids must never masquerade as question-node grants'
        for original,clone in zip(graph['strokes'],copied['strokes']):
            assert clone['id']!=original['id']
            assert {key:value for key,value in clone.items() if key!='id'}=={key:value for key,value in original.items() if key!='id'}
        assert c.put('/api/v1/files/'+receipt['fileId'],json={'expectedRevision':1,'graphData':copied}).status_code==200
        login(c,data,'teacher');assert c.get('/api/v1/files/'+source).json()['graphData']==graph


def test_preview_caps_ink_collections_and_rejects_invalid_tool_values():
    stroke={'id':'s','tool':'pen','color':'#123456','width':3,'points':[[0,0]]}
    many=service.preview_projection({'strokes':[dict(stroke,id=str(i)) for i in range(2100)]},1)
    assert len(many['strokes'])==2000
    points=[[0,0]]*5000
    limited=service.preview_projection({'strokes':[dict(stroke,id=str(i),points=points) for i in range(21)]},1)
    assert sum(len(item['points']) for item in limited['strokes'])==100000
    malformed=[dict(stroke,tool=[]),dict(stroke,tool={}),dict(stroke,width=True),dict(stroke,opacity=float('inf')),
               dict(stroke,points=[[True,0]]),dict(stroke,points=[[10000001,0]])]
    assert 'strokes' not in service.preview_projection({'strokes':malformed},1)


def test_template_rejects_corrupted_ink_before_publication_or_copy_creation(data):
    from app.models.graph_template import GraphTemplate
    graph={'nodes':[],'links':[],'strokes':[{'id':'pen','tool':'pen','width':3,'color':'#123456','points':[[0,0],[10,10]]}]}
    with TestClient(app) as c:
        login(c,data,'teacher')
        created=c.post('/api/v1/files',json={'name':'corruption-guard','graphData':graph});assert created.status_code==200
        source=created.json()['file']['id'];template=publish(c,publication(source))
        async def corrupt():
            async with AsyncSessionLocal() as db:
                source_content=await db.get(FileContent,source)
                bad=deepcopy(graph);bad['strokes'][0]['width']=0
                source_content.graph_data=bad
                version=await db.scalar(select(GraphTemplateVersion).where(GraphTemplateVersion.template_id==template['id']))
                version.graph_data=bad
                await db.commit()
        from copy import deepcopy
        asyncio.run(corrupt())
        before=c.get('/api/v1/files').json()
        response=c.post('/api/v1/graph-templates',json=publication(source))
        assert response.status_code==422 and response.json()['detail']['code']=='GRAPH_STROKES_INVALID'
        login(c,data,'student');own_before=c.get('/api/v1/files').json()
        response=load(c,template)
        assert response.status_code==422 and response.json()['detail']['code']=='GRAPH_STROKES_INVALID'
        assert c.get('/api/v1/files').json()==own_before
        login(c,data,'teacher');assert c.get('/api/v1/files').json()==before
        async def assert_no_partial_publication():
            async with AsyncSessionLocal() as db:
                assert await db.scalar(select(func.count()).select_from(GraphTemplate).where(GraphTemplate.owner_id==data.teacher))==1
        asyncio.run(assert_no_partial_publication())
