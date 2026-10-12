"""T14 uses the existing disposable DB lifecycle and trusted frozen-fixture cloning."""
import asyncio,base64,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
import canvas_ink_server as helper
from app.models.question_material import QuestionAsset
from app.models.user import User
from app.models.subscription import Subscription
from app.models.question import Question
from app.core.security import hash_password
from app.services import graph_question_service as service, file_service, teaching_content_revision_service
from app.schemas.graph_question import BindingInput
import importlib.util
spec=importlib.util.spec_from_file_location('gq_fixture',helper.ROOT/'backend/tests/test_graph_question_access.py');test=importlib.util.module_from_spec(spec);spec.loader.exec_module(test)
d=test.data.__wrapped__()
async def seed():
    async with helper.AsyncSessionLocal() as db:
        asset=await db.get(QuestionAsset,d.asset);asset.data=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAPAAAABgCAIAAACsUWiGAAABcElEQVR4nO3bsW3CUBRAURNlgaySEVx7BC/BJFkiI6TOCFkFUVDQZQGQAFvCXJ3T23rF1Wue/u54Og9Q8fbsAWBNgiZF0KQImhRBkyJoUgRNiqBJETQpgiZF0KQsCnqc5nGa1xsGlrKhSRE0KYImRdCkCJqU92cPwB0+vv7W+tVh/zkU2dCkCJoUQZMiaFIETYqgSRE0KYImRdCkCJoUQZMiaFIETYqgSRE0KYImRdCkeLFylechr8iGJkXQpAiaFEGTImhSBE2KoEkRNCmCJsWlkNQ91YYmRdCkCJoUQZMiaFIETYqgSRE0KYImZSuXwq0dnHhRNjQpgiZF0KQImhRBkyJoUgRNiqBJETQpgiZF0KQImhRBkyJoUgRNiqBJETQpgiZF0KQImhRBk7I7ns4PfzxO86rDwAW/P9/DzWxoUhZtaNgaG5oUQZMiaFIETYqgSRE0KYImRdCkCJoUQZMiaFIETYqgSRE0KYJmKPkHRRkaN4iqgkMAAAAASUVORK5CYII=');await db.commit()
        teacher=await db.get(User,d.teacher)
        member=d.student+'-member';db.add(User(username=member,role='student',status='active',password_hash=hash_password(test.PASSWORD)));await db.flush();db.add(Subscription(username=member,plan_id='lifetime',status='active'));d.member=member
        for i in range(23):
            db.add(Question(id=f't14-extra-{i:02}',bank_id=d.public_bank,title=f'card extra {i:02}',subject='PMP',scope='public',stem_parts=[{'text':'分页题干'}],options=[{'id':'A','text':'正确','correct':True},{'id':'B','text':'错误'}],correct_answer='A',analysis='分页解析'))
        await db.commit()
        graph={'meta':{'title':'卡片做题测试'},'nodes':[{'id':'n','title':'card','keywords':'visible','x':200,'y':200},{'id':'empty','title':'空卡片','x':550,'y':200}],'links':[]}
        files={}
        for role in ('teacher','admin','student','viewer','member'):
            file=await file_service.create_file(db,getattr(d,role),name='T14 '+role,graph_data=graph);files[role]=file.id
        await service.set_bindings(db,teacher,files['teacher'],'n',BindingInput(expectedFileRevision=1,questionIds=[d.q,d.multi,d.match]))
        await teaching_content_revision_service.acquire_lock(db)
        frozen=await service.export_card_bindings(db,teacher,files['teacher'],'n')
        for role in ('student','admin','member'):
            await service.clone_card_bindings(db,getattr(d,role),files[role],'n',frozen)
        await db.commit()
        (helper.ROOT/'artifacts/canvas-m2-m5/t14/fixture.json').write_text(json.dumps({'users':vars(d),'files':files,'password':test.PASSWORD}))
asyncio.run(seed())
try:
    helper.DisposableServer(helper.uvicorn.Config(helper.app,host='127.0.0.1',port=5194,log_level='warning')).run()
finally:
    asyncio.run(helper.fixture.engine.dispose());helper.fixture._drop_test_database()
