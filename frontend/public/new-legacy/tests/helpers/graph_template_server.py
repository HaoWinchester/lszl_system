"""T15 isolated migrated DB server, never normal dev data."""
import asyncio,base64,json,sys,importlib.util
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
import canvas_ink_server as helper
from app.models.user import User
from app.models.subscription import Subscription
from app.models.question_material import QuestionAsset
from app.core.security import hash_password
from app.schemas.graph_question import BindingInput
from app.services import file_service, graph_asset_service as assets, graph_question_service as questions
spec=importlib.util.spec_from_file_location('template_fixture',helper.ROOT/'backend/tests/test_graph_question_access.py');test=importlib.util.module_from_spec(spec);spec.loader.exec_module(test)
d=test.data.__wrapped__()
async def seed():
    async with helper.AsyncSessionLocal() as db:
        member=d.student+'-member';db.add(User(username=member,role='student',status='active',password_hash=hash_password(test.PASSWORD)));await db.flush();db.add(Subscription(username=member,plan_id='lifetime',status='active'));d.member=member
        asset=await db.get(QuestionAsset,d.asset)
        # Real 2x3 PNG shared with graph media fixture, also used by frozen questions.
        from io import BytesIO
        from PIL import Image
        buf=BytesIO();Image.new('RGB',(2,3),'blue').save(buf,format='PNG');asset.data=buf.getvalue()
        image=await assets.create_asset(db,d.teacher,image_bytes=asset.data,mime_type='image/png',alt='模板图片')
        await db.commit()
        files={}
        for role in ('teacher','admin','student','member','viewer'):
            graph={'meta':{'title':'知识图谱模板测试'},'nodes':[{'id':'n','title':'card','x':200,'y':200,'content':{'title':'card','notes':'模板长备注\n'*700,'images':[image] if role=='teacher' else []}},{'id':'second','title':'独立图谱','x':500,'y':200}],'links':[{'id':'edge','from':'n','to':'second','fromPort':{'side':'right','offset':0.3},'toPort':{'side':'left','offset':0.7},'pathStyle':'orthogonal','waypoints':[{'x':350,'y':200},{'x':350,'y':350}]}]}
            file=await file_service.create_file(db,getattr(d,role),name='T15 '+role,graph_data=graph);files[role]=file.id
        teacher=await db.get(User,d.teacher)
        await questions.set_bindings(db,teacher,files['teacher'],'n',BindingInput(expectedFileRevision=1,questionIds=[d.q]))
        (helper.ROOT/'artifacts/canvas-m2-m5/t15/fixture.json').write_text(json.dumps({'users':vars(d),'files':files,'password':test.PASSWORD}))
asyncio.run(seed())
try:
    helper.DisposableServer(helper.uvicorn.Config(helper.app,host='127.0.0.1',port=5195,log_level='warning')).run()
finally:
    asyncio.run(helper.fixture.engine.dispose());helper.fixture._drop_test_database()
