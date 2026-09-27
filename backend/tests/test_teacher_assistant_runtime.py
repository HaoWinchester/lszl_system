import asyncio
import pytest
import json
from uuid import uuid4
from fastapi.testclient import TestClient
from app.main import app
from test_teacher_assistant import users,login


def test_runtime_switch_waits_for_exit_and_events_are_owner_private():
    from app.db.session import AsyncSessionLocal
    from app.models.teacher_assistant import TeacherAssistantJob as Job
    from datetime import datetime,timedelta,timezone
    a,b,_=users()
    with TestClient(app) as c:
        login(c,a)
        first=c.post('/api/v1/teacher-assistant/sessions').json()['session']
        sid=first['id'];url='/api/v1/teacher-assistant/sessions/'+sid
        assert first.get('runtime',{}).get('sessionId')
        second=c.post('/api/v1/teacher-assistant/sessions').json()['session'];other='/api/v1/teacher-assistant/sessions/'+second['id']
        job=c.post(url+'/messages',json={'content':'你好','requestId':uuid4().hex}).json()['session']['job']
        async def running():
            async with AsyncSessionLocal() as db:
                j=await db.get(Job,job['id']);j.status='running';j.lease_until=datetime.now(timezone.utc)+timedelta(minutes=5);await db.commit()
        asyncio.run(running())
        assert c.post(other+'/activate').status_code==409
        assert c.post(other+'/messages',json={'content':'第二个','requestId':uuid4().hex}).status_code==409
        assert c.get(url).json()['session']['runtime']['status']=='stopping'
        async def exited():
            async with AsyncSessionLocal() as db:
                j=await db.get(Job,job['id']);j.lease_until=None;await db.commit()
        asyncio.run(exited())
        assert c.post(other+'/activate').status_code==200
        assert c.post(url+'/activate').json()['session']['runtime']['sessionId']==first['runtime']['sessionId']
        login(c,b)
        assert c.get(url+'/events').status_code==404
        assert c.post(url+'/activate').status_code==404


def test_stream_parser_omits_thinking_arguments_and_system_secrets():
    from app.services import teacher_assistant_model as m
    assert hasattr(m,'public_events')
    assert m.public_events({'type':'system','apiKey':'secret'})==[]
    assert m.public_events({'type':'stream_event','event':{'type':'content_block_delta','delta':{'type':'thinking_delta','thinking':'private'}}})==[]
    assert m.public_events({'type':'stream_event','event':{'type':'content_block_delta','delta':{'type':'text_delta','text':'你好'}}})==[('text_delta',{'text':'你好'})]


def test_persistent_command_uses_scoped_mcp_and_same_session_id():
    from app.services import teacher_assistant_model as m
    assert hasattr(m,'stream_command')
    for resume in (False,True):
        cmd=m.stream_command('uuid',resume,{'mcpServers':{}},'system')
        assert cmd[cmd.index('--resume' if resume else '--session-id')+1]=='uuid'
        assert '--no-session-persistence' not in cmd
        assert cmd[cmd.index('--tools')+1]==''
        assert cmd[cmd.index('--model')+1]=='glm-5.3-flash[1m]'
        assert '--include-partial-messages' in cmd
        assert cmd[cmd.index('--output-format')+1]=='stream-json'


def test_event_snapshot_and_cursor_are_atomic_and_replay_has_no_duplicates():
    from app.services import teacher_assistant_events as events
    from app.db.session import AsyncSessionLocal
    from app.models.teacher_assistant import TeacherAssistantJob as Job
    a,_,_=users()
    with TestClient(app) as c:
        login(c,a);sid=c.post('/api/v1/teacher-assistant/sessions').json()['session']['id'];url='/api/v1/teacher-assistant/sessions/'+sid
        jid=c.post(url+'/messages',json={'content':'hi','requestId':uuid4().hex}).json()['session']['job']['id']
        async def emit():
            await events.emit(sid,jid,'text_delta',{'text':'第一段'})
        asyncio.run(emit())
        snapshot=c.get(url).json()['session']['stream']
        assert snapshot['text']=='第一段'
        async def more():
            await events.emit(sid,jid,'text_delta',{'text':'第二段'})
            async with AsyncSessionLocal() as db:
                j=await db.get(Job,jid);j.status='succeeded';await db.commit()
            await events.emit(sid,jid,'done',{'status':'succeeded'})
        asyncio.run(more())
        data=c.get(url+'/events?after='+str(snapshot['lastEventId'])).text
        rows=[json.loads(line[6:]) for line in data.splitlines() if line.startswith('data: ')]
        assert [r['data']['text'] for r in rows if r['type']=='text_delta']==['第二段']
        assert len({r['id'] for r in rows})==len(rows)


def test_tools_read_full_paginated_json_and_cannot_escape_owner(tmp_path,monkeypatch):
    import pytest
    from app.services import teacher_assistant_tools as tools
    from app.core.config import settings
    from app.db.session import AsyncSessionLocal
    from app.models.teacher_assistant import TeacherAssistantUpload as Upload,TeacherAssistantJob as Job
    monkeypatch.setattr(settings,'TEACHER_ASSISTANT_STORAGE',str(tmp_path))
    a,b,_=users()
    with TestClient(app) as c:
        login(c,a);sid=c.post('/api/v1/teacher-assistant/sessions').json()['session']['id'];url='/api/v1/teacher-assistant/sessions/'+sid
        uid=c.post(url+'/uploads',files={'files':('anything.json',json.dumps({'long':'开头'+'x'*30000+'结尾','nested':{'answer':'真实答案'}}).encode(),'application/json')}).json()['session']['uploads'][0]['id']
        jid=c.post(url+'/messages',json={'content':'文档写了什么','requestId':uuid4().hex}).json()['session']['job']['id']
        async def check():
            async with AsyncSessionLocal() as db:
                upload=await db.get(Upload,uid);upload.status='ready';upload.extracted={'kind':'json','data':{'long':'开头'+'x'*30000+'结尾','nested':{'answer':'真实答案'}},'sections':[]}
                j=await db.get(Job,jid);j.status='running';await db.commit()
            value='';offset=0
            while True:
                result=await tools.call_tool(a,sid,jid,'read_file',{'uploadId':uid,'offset':offset,'limit':8000})
                page=json.loads(result['content'][0]['text']);value+=page['text']
                if page['nextOffset'] is None: break
                offset=page['nextOffset']
            assert json.loads(value)['nested']['answer']=='真实答案'
            assert json.loads(value)['long'].endswith('结尾')
            with pytest.raises(Exception): await tools.call_tool(b,sid,jid,'read_file',{'uploadId':uid})
            with pytest.raises(Exception): await tools.call_tool(a,sid,jid,'read_file',{'uploadId':'../../secrets'})
        asyncio.run(check())


def test_real_image_validation_and_visual_block(tmp_path,monkeypatch):
    import pytest
    from PIL import Image
    from app.services import teacher_assistant_documents as docs
    bad=tmp_path/'fake';bad.write_bytes(b'not image')
    with pytest.raises(docs.DocumentError):docs.extract_document(bad,'fake.png',tmp_path/'out')
    image=tmp_path/'real';Image.new('RGB',(30,20),'red').save(image,format='PNG')
    monkeypatch.setattr(docs,'_run',lambda args,**kw:'eng\nchi_sim' if '--list-langs' in args else 'OCR 文字')
    result=docs.extract_document(image,'photo.png',tmp_path/'image-out')
    assert result['kind']=='image'
    assert result['sections'][0]['images']
    assert 'OCR' in result['sections'][0]['text']
    assert any('视觉' in text for text in result['warnings'])


@pytest.mark.parametrize("structured", [False, True])
def test_natural_file_qa_stream_does_not_extract_questions(tmp_path,monkeypatch,structured):
    from app.worker import teacher_assistant as worker
    from app.core.config import settings
    from app.db.session import AsyncSessionLocal
    from app.models.teacher_assistant import TeacherAssistantSession as Session,TeacherAssistantUpload as Upload,TeacherAssistantJob as Job
    monkeypatch.setattr(settings,'TEACHER_ASSISTANT_STORAGE',str(tmp_path))
    a,_,_=users()
    with TestClient(app) as c:
        login(c,a);sid=c.post('/api/v1/teacher-assistant/sessions').json()['session']['id'];url='/api/v1/teacher-assistant/sessions/'+sid
        async def setup():
            async with AsyncSessionLocal() as db:
                db.add(Upload(id='tau_'+uuid4().hex,session_id=sid,name='说明.docx',size=50,digest='a'*64,status='ready',extracted=({'kind':'json','data':{'name':'十三题','questions':[{'id':f'q{i}','title':f'题目{i}','type':'single_choice','analysis':'原解析'*8000} for i in range(13)]},'warnings':[]} if structured else {'kind':'document','sections':[{'location':'段落1','text':'这是一份没有题目的说明书','images':['page-1.png']}],'warnings':[]})));await db.commit()
        asyncio.run(setup())
        seen=[]
        async def streaming(**kw):
            seen.append(kw)
            transcript=kw['cwd']/'config'/'projects'/'test'/(kw['session_id']+'.jsonl')
            transcript.parent.mkdir(parents=True,exist_ok=True);transcript.write_text('{}\n')
            assert '说明.docx' in kw['prompt']
            if structured:
                overview=json.loads(kw['prompt'])['files'][0].get('summary',{})
                assert overview.get('banks',[{}])[0].get('count')==13
                assert len(kw['prompt'])<6000 and '原解析' not in kw['prompt']
            else:
                assert json.loads(kw['prompt'])['files'][0]['images']==[{'name':'page-1.png','location':'段落1'}]
            await kw['on_started']()
            await kw['on_event']('text_delta',{'text':'这是一份说明书。'})
            return '这是一份说明书。'
        async def old_ask(*args,**kw):raise AssertionError('must not invoke stateless extraction')
        monkeypatch.setattr(worker.model,'stream_reply',streaming,raising=False)
        monkeypatch.setattr(worker.model,'ask',old_ask)
        for turn in range(2):
            jid=c.post(url+'/messages',json={'content':'文件讲了什么','requestId':uuid4().hex}).json()['session']['job']['id']
            async def run():
                async with AsyncSessionLocal() as db:
                    j=await db.get(Job,jid);j.status='running';await db.commit()
                await worker.run_job(jid)
            asyncio.run(run())
        state=c.get(url).json()['session']
        assert state['messages'][-1]['content']=='这是一份说明书。'
        assert state['plan']=={}
        assert seen[0]['session_id']==seen[1]['session_id']
        assert [k['resume'] for k in seen]==[False,True]
        assert state['stream']['text']==''


def test_native_stream_cancellation_reaps_process_and_preserves_public_text(tmp_path,monkeypatch):
    import os,sys,pytest
    from app.services import teacher_assistant_model as model
    from app.core.config import settings
    executable=tmp_path/'fake-claude'
    executable.write_text('#!'+sys.executable+'\n'+'''import json,sys,time,os
from pathlib import Path
Path('pid').write_text(str(os.getpid()))
sys.stdin.read()
print(json.dumps({'type':'system','subtype':'init','session_id':'native-id'}),flush=True)
print(json.dumps({'type':'stream_event','event':{'type':'content_block_delta','delta':{'type':'thinking_delta','thinking':'private'}}}),flush=True)
print(json.dumps({'type':'stream_event','event':{'type':'content_block_delta','delta':{'type':'text_delta','text':'实际部分回复'}}}),flush=True)
time.sleep(30)
''');executable.chmod(0o700)
    monkeypatch.setattr(settings,'TEACHER_ASSISTANT_CLAUDE',str(executable));monkeypatch.setenv('ANTHROPIC_AUTH_TOKEN','test-only')
    events=[];started=[]
    async def scenario():
        async def emit(kind,data):events.append((kind,data))
        async def init():started.append(True)
        async def active():return not events
        with pytest.raises(asyncio.CancelledError):
            await model.stream_reply(session_id='native-id',resume=False,cwd=tmp_path/'runtime',mcp_config={},prompt='hello',system_prompt='safe',on_event=emit,on_started=init,is_active=active)
    asyncio.run(scenario())
    assert started==[True] and events==[('text_delta',{'text':'实际部分回复'})]
    pid=int((tmp_path/'runtime'/'pid').read_text())
    with pytest.raises(ProcessLookupError):os.kill(pid,0)


def test_retry_clears_old_partial_snapshot_but_keeps_cursor():
    from app.db.session import AsyncSessionLocal
    from app.models.teacher_assistant import TeacherAssistantJob as Job
    from app.services.teacher_assistant_events import emit
    a,_,_=users()
    with TestClient(app) as c:
        login(c,a);sid=c.post('/api/v1/teacher-assistant/sessions').json()['session']['id'];url='/api/v1/teacher-assistant/sessions/'+sid
        jid=c.post(url+'/messages',json={'content':'hi','requestId':uuid4().hex}).json()['session']['job']['id']
        async def fail():
            await emit(sid,jid,'text_delta',{'text':'上次部分'})
            async with AsyncSessionLocal() as db:
                j=await db.get(Job,jid);j.status='failed';await db.commit()
        asyncio.run(fail());old=c.get(url).json()['session']['stream']
        response=c.post(url+'/retry',json={'requestId':uuid4().hex})
        assert response.status_code==200,response.text
        current=response.json()['session']['stream']
        assert current['text']==''
        assert current['lastEventId']>=old['lastEventId']


def test_natural_chat_never_executes_stale_direct_publish_plan(tmp_path,monkeypatch):
    from app.worker import teacher_assistant as worker
    from app.services import teacher_assistant_import as imports
    from app.core.config import settings
    from app.db.session import AsyncSessionLocal
    from app.models.teacher_assistant import TeacherAssistantSession as Session,TeacherAssistantJob as Job
    monkeypatch.setattr(settings,'TEACHER_ASSISTANT_STORAGE',str(tmp_path))
    a,_,_=users()
    with TestClient(app) as c:
        login(c,a);sid=c.post('/api/v1/teacher-assistant/sessions').json()['session']['id'];url='/api/v1/teacher-assistant/sessions/'+sid
        jid=c.post(url+'/messages',json={'content':'直接发布','requestId':uuid4().hex}).json()['session']['job']['id']
        async def setup():
            async with AsyncSessionLocal() as db:
                s=await db.get(Session,sid);s.plan={'settings':{'directPublish':True},'items':[{'id':'stale','questions':[]}],'blockers':[]}
                j=await db.get(Job,jid);j.status='running';await db.commit()
        asyncio.run(setup())
        async def streaming(**kw):await kw['on_event']('text_delta',{'text':'这是解释。'});return '这是解释。'
        async def execute(*a,**kw):raise AssertionError('stale plan was executed by Q&A')
        monkeypatch.setattr(worker.model,'stream_reply',streaming);monkeypatch.setattr(imports,'execute_plan',execute)
        asyncio.run(worker.run_job(jid))


def test_pruned_events_require_snapshot_resync(monkeypatch):
    from app.services import teacher_assistant_events as events
    from app.db.session import AsyncSessionLocal
    from app.models.teacher_assistant import TeacherAssistantJob as Job
    monkeypatch.setattr(events,'MAX_EVENTS',2)
    a,_,_=users()
    with TestClient(app) as c:
        login(c,a);sid=c.post('/api/v1/teacher-assistant/sessions').json()['session']['id'];url='/api/v1/teacher-assistant/sessions/'+sid
        queued=c.post(url+'/messages',json={'content':'hi','requestId':uuid4().hex}).json()['session'];jid=queued['job']['id'];cursor=queued['stream']['lastEventId']
        async def emit():
            for text in ('甲','乙','丙'):await events.emit(sid,jid,'text_delta',{'text':text})
            async with AsyncSessionLocal() as db:
                j=await db.get(Job,jid);j.status='succeeded';await db.commit()
        asyncio.run(emit())
        rows=[json.loads(line[6:]) for line in c.get(url+'/events?after='+str(cursor)).text.splitlines() if line.startswith('data: ')]
        assert rows[0]['type']=='status' and rows[0]['data']['status']=='resync_required'
        assert c.get(url).json()['session']['stream']['text']=='甲乙丙'


def test_scoped_import_tool_preserves_json_answers_and_marks_current_job(tmp_path,monkeypatch):
    from app.services import teacher_assistant_tools as tools
    from app.core.config import settings
    from app.db.session import AsyncSessionLocal
    from app.models.teacher_assistant import TeacherAssistantSession as Session,TeacherAssistantUpload as Upload,TeacherAssistantJob as Job
    from test_teacher_assistant_import import question
    monkeypatch.setattr(settings,'TEACHER_ASSISTANT_STORAGE',str(tmp_path))
    a,_,_=users()
    with TestClient(app) as c:
        login(c,a);sid=c.post('/api/v1/teacher-assistant/sessions').json()['session']['id'];url='/api/v1/teacher-assistant/sessions/'+sid
        uid=c.post(url+'/uploads',files={'files':('题库.json',json.dumps({'id':'bank','questions':[question()]}).encode(),'application/json')}).json()['session']['uploads'][0]['id']
        jid=c.post(url+'/messages',json={'content':'导入私有草稿，保留独立副本','requestId':uuid4().hex}).json()['session']['job']['id']
        async def prepare():
            async with AsyncSessionLocal() as db:
                upload=await db.get(Upload,uid);upload.status='ready';upload.extracted={'kind':'json','data':{'id':'bank','questions':[question()]},'warnings':[]}
                j=await db.get(Job,jid);j.status='running';await db.commit()
            result=await tools.call_tool(a,sid,jid,'prepare_import',{'intent':{'settings':{'duplicatePolicy':'independent'},'items':[{'uploadId':uid,'questions':[question(answer='b')]}]}})
            assert json.loads(result['content'][0]['text'])['questionCount']==1
            assert json.loads(result['content'][0]['text']).get('settings',{}).get('duplicatePolicy')=='independent'
            async with AsyncSessionLocal() as db:
                session=await db.get(Session,sid);job=await db.get(Job,jid)
                assert session.plan['items'][0]['questions'][0]['correctAnswer']=='a'
                assert session.plan['settings']['publish'] is False
                assert job.stream['preparedRevision']==session.revision
                assert session.receipt=={}
        asyncio.run(prepare())


def test_scoped_image_tool_returns_real_image_block(tmp_path,monkeypatch):
    import base64,io
    from PIL import Image
    from app.services import teacher_assistant_tools as tools
    from app.core.config import settings
    from app.db.session import AsyncSessionLocal
    from app.models.teacher_assistant import TeacherAssistantUpload as Upload,TeacherAssistantJob as Job
    monkeypatch.setattr(settings,'TEACHER_ASSISTANT_STORAGE',str(tmp_path))
    a,_,_=users()
    with TestClient(app) as c:
        login(c,a);sid=c.post('/api/v1/teacher-assistant/sessions').json()['session']['id'];url='/api/v1/teacher-assistant/sessions/'+sid
        raw=io.BytesIO();Image.new('RGB',(40,30),'blue').save(raw,format='PNG')
        uid=c.post(url+'/uploads',files={'files':('图片.png',raw.getvalue(),'image/png')}).json()['session']['uploads'][0]['id']
        jid=c.post(url+'/messages',json={'content':'查看图形','requestId':uuid4().hex}).json()['session']['job']['id']
        directory=tmp_path/sid/uid/'extracted';directory.mkdir();(directory/'image-1.png').write_bytes(raw.getvalue())
        async def read():
            async with AsyncSessionLocal() as db:
                upload=await db.get(Upload,uid);upload.status='ready';upload.extracted={'kind':'image','sections':[{'location':'图片1','text':'OCR','images':['image-1.png']}]}
                j=await db.get(Job,jid);j.status='running';await db.commit()
            result=await tools.call_tool(a,sid,jid,'read_image',{'uploadId':uid,'name':'image-1.png'})
            block=result['content'][1];assert block['type']=='image' and block['mimeType']=='image/jpeg'
            with Image.open(io.BytesIO(base64.b64decode(block['data']))) as image: assert image.size==(40,30)
        asyncio.run(read())


def test_native_mcp_inherits_effective_dotenv_database_and_storage(tmp_path,monkeypatch):
    """The CLI and its real MCP child run away from the directory owning .env."""
    import sys
    from pathlib import Path
    from PIL import Image
    from app.core.config import Settings,settings
    from app.services import teacher_assistant_model as model
    from app.db.session import AsyncSessionLocal
    from app.models.teacher_assistant import TeacherAssistantUpload as Upload,TeacherAssistantJob as Job
    a,_,_=users();uid='tau_'+uuid4().hex
    with TestClient(app) as c:
        login(c,a);sid=c.post('/api/v1/teacher-assistant/sessions').json()['session']['id'];url='/api/v1/teacher-assistant/sessions/'+sid
        jid=c.post(url+'/messages',json={'content':'读取附件','requestId':uuid4().hex}).json()['session']['job']['id']
    directory=tmp_path/'private-uploads'/sid/uid/'extracted';directory.mkdir(parents=True)
    Image.new('RGB',(27,19),'green').save(directory/'image.png')
    async def seed():
        async with AsyncSessionLocal() as db:
            db.add(Upload(id=uid,session_id=sid,name='dotenv.png',size=99,digest='d'*64,status='ready',extracted={'kind':'image','sections':[{'text':'','images':['image.png']}]}))
            job=await db.get(Job,jid);job.status='running';await db.commit()
    asyncio.run(seed())
    cli=tmp_path/'fake-claude'
    cli.write_text('#!'+sys.executable+'\n'+'''import json,os,subprocess,sys
sys.stdin.read()
config=json.loads(sys.argv[sys.argv.index('--mcp-config')+1])
assert 'DATABASE_URL' not in json.dumps(config)
server=config['mcpServers']['teacher']
child=subprocess.Popen([server['command'],*server['args']],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,env={**os.environ,**server['env']})
try:
    def call(method,params={}):
        child.stdin.write(json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':params})+'\\n');child.stdin.flush()
        return json.loads(child.stdout.readline())['result']
    call('initialize')
    names=['mcp__teacher__'+tool['name'] for tool in call('tools/list')['tools']]
    print(json.dumps({'type':'system','subtype':'init','session_id':sys.argv[sys.argv.index('--session-id')+1],'tools':names,'mcp_servers':[{'name':'teacher','status':'connected'}]}),flush=True)
    listed=call('tools/call',{'name':'list_files','arguments':{}})
    files=json.loads(listed['content'][0]['text'])['files'];assert files[0]['name']=='dotenv.png'
    picture=call('tools/call',{'name':'read_image','arguments':{'uploadId':files[0]['uploadId'],'name':'image.png'}})
    assert picture['content'][1]['type']=='image'
    print(json.dumps({'type':'result','result':'真实 MCP 已读取 dotenv 附件'}),flush=True)
finally:
    child.terminate();child.wait()
''');cli.chmod(0o700)
    dotenv=tmp_path/'.env'
    dotenv.write_text('DATABASE_URL='+settings.DATABASE_URL+'\nTEACHER_ASSISTANT_STORAGE='+str(tmp_path/'private-uploads')+'\nTEACHER_ASSISTANT_CLAUDE='+str(cli)+'\n')
    for key in ('DATABASE_URL','TEACHER_ASSISTANT_STORAGE','TEACHER_ASSISTANT_CLAUDE'):monkeypatch.delenv(key,raising=False)
    effective=Settings(_env_file=dotenv)
    monkeypatch.setattr(model,'settings',effective);monkeypatch.setenv('ANTHROPIC_AUTH_TOKEN','test-only')
    config={'mcpServers':{'teacher':{'command':sys.executable,'args':['-m','app.services.teacher_assistant_mcp'],'env':{'PYTHONPATH':str(Path(__file__).resolve().parents[1]),'TEACHER_TOOL_OWNER':a,'TEACHER_TOOL_SESSION':sid,'TEACHER_TOOL_JOB':jid}}}}
    output=[]
    async def run():
        async def event(kind,data):output.append(data)
        async def started():pass
        async def active():return True
        await model.stream_reply(session_id=str(uuid4()),resume=False,cwd=tmp_path/'unrelated-runtime',mcp_config=config,prompt='文件',system_prompt='safe',on_event=event,on_started=started,is_active=active)
    asyncio.run(run())
    assert output==[{'text':'真实 MCP 已读取 dotenv 附件'}]


def test_document_reader_defaults_to_bounded_full_document_and_explicit_page_continuation(tmp_path,monkeypatch):
    from app.services import teacher_assistant_tools as tools
    from app.core.config import settings
    from app.db.session import AsyncSessionLocal
    from app.models.teacher_assistant import TeacherAssistantUpload as Upload,TeacherAssistantJob as Job
    monkeypatch.setattr(settings,'TEACHER_ASSISTANT_STORAGE',str(tmp_path))
    a,_,_=users();uid='tau_'+uuid4().hex
    with TestClient(app) as c:
        login(c,a);sid=c.post('/api/v1/teacher-assistant/sessions').json()['session']['id'];url='/api/v1/teacher-assistant/sessions/'+sid
        jid=c.post(url+'/messages',json={'content':'最后的地点和代号是什么','requestId':uuid4().hex}).json()['session']['job']['id']
    sections=[{'location':'标题','text':'研修说明','images':[]},
        {'location':'正文','text':'学习记录。'*2000,'images':['page.png']},
        {'location':'最终安排','text':'地点：青禾会议室；代号：海棠73。','images':[]}]
    async def read():
        async with AsyncSessionLocal() as db:
            db.add(Upload(id=uid,session_id=sid,name='活动.docx',size=99,digest='d'*64,status='ready',extracted={'kind':'document','sections':sections}))
            job=await db.get(Job,jid);job.status='running';await db.commit()
        offset=0;texts=[];images=set()
        while True:
            r=await tools.call_tool(a,sid,jid,'read_file',{'uploadId':uid,'offset':offset,'limit':8000})
            value=json.loads(r['content'][0]['text'])
            assert value['scope']=='document' and len(value['text'])<=8000
            texts.append(value['text']);images.update(value['images'])
            if value['nextOffset'] is None:break
            assert value['nextOffset']>offset
            offset=value['nextOffset']
        content=''.join(texts)
        assert content=='\n'.join(f"[{s['location']}]\n{s['text']}" for s in sections)
        assert '青禾会议室' in content and '海棠73' in content
        assert images=={'page.png'}
        r=await tools.call_tool(a,sid,jid,'read_file',{'uploadId':uid,'page':1})
        value=json.loads(r['content'][0]['text'])
        assert value['nextOffset'] is None and value['nextRead']=={'uploadId':uid,'page':2,'offset':0}
        assert value['scope']=='section'
    asyncio.run(read())


def test_mcp_handshake_does_not_wait_for_business_database_imports():
    import os,subprocess,sys
    script='''import importlib.abc,runpy,sys
class BlockBusiness(importlib.abc.MetaPathFinder):
 def find_spec(self,fullname,path=None,target=None):
  if fullname=='sqlalchemy' or fullname.startswith(('app.models','app.db','app.core','app.services.teacher_assistant_service','app.services.teacher_assistant_tools','app.services.teacher_assistant_events')):
   raise ImportError('business dependencies must load only after MCP handshake')
sys.meta_path.insert(0,BlockBusiness())
runpy.run_module('app.services.teacher_assistant_mcp',run_name='__main__')
'''
    requests='\n'.join(json.dumps({'jsonrpc':'2.0','id':i,'method':m}) for i,m in [(1,'initialize'),(2,'tools/list')])+'\n'
    process=subprocess.run([sys.executable,'-c',script],input=requests,text=True,capture_output=True,timeout=10,
        env={**os.environ,'TEACHER_TOOL_OWNER':'test','TEACHER_TOOL_SESSION':'session','TEACHER_TOOL_JOB':'job'})
    assert process.returncode==0,process.stderr
    messages=[json.loads(line) for line in process.stdout.splitlines()]
    assert messages[0]['result']['capabilities']=={'tools':{}}
    assert {v['name'] for v in messages[1]['result']['tools']}=={'list_files','read_file','read_image','prepare_import'}


def test_pending_native_mcp_fails_before_public_answer(tmp_path,monkeypatch):
    import sys,pytest
    from app.core.config import settings
    from app.services import teacher_assistant_model as model
    cli=tmp_path/'pending-claude'
    cli.write_text('#!'+sys.executable+'\n'+'''import json,sys
sys.stdin.read()
print(json.dumps({'type':'system','subtype':'init','session_id':'native-id','tools':[],'mcp_servers':[{'name':'teacher','status':'pending'}]}),flush=True)
print(json.dumps({'type':'result','result':'我先读取文件内容。'}),flush=True)
''');cli.chmod(0o700)
    monkeypatch.setattr(settings,'TEACHER_ASSISTANT_CLAUDE',str(cli));monkeypatch.setenv('ANTHROPIC_AUTH_TOKEN','test-only')
    output=[];started=[]
    async def run():
        async def event(kind,data):output.append(data)
        async def init():started.append(True)
        async def active():return True
        with pytest.raises(model.ModelError,match='工具'):
            await model.stream_reply(session_id='native-id',resume=False,cwd=tmp_path/'runtime',mcp_config={'mcpServers':{'teacher':{}}},prompt='请读取',system_prompt='safe',on_event=event,on_started=init,is_active=active)
    asyncio.run(run())
    assert started==[] and output==[]


def test_native_resume_requires_saved_transcript_even_if_database_says_started(tmp_path):
    from app.services.teacher_assistant_model import native_session_exists
    sid=str(uuid4())
    assert not native_session_exists(tmp_path,sid)
    transcript=tmp_path/'config'/'projects'/'private-cwd'/(sid+'.jsonl')
    transcript.parent.mkdir(parents=True);transcript.touch()
    assert not native_session_exists(tmp_path,sid)
    transcript.write_text('{}\n')
    assert native_session_exists(tmp_path,sid)
    assert not native_session_exists(tmp_path,str(uuid4()))


def test_import_tool_schema_distinguishes_exact_names_suffix_and_explicit_roles():
    from app.services.teacher_assistant_tool_catalog import definitions
    tool=next(t for t in definitions() if t['name']=='prepare_import')
    settings=tool['inputSchema']['properties']['intent'].get('properties',{}).get('settings',{}).get('properties',{})
    assert 'names' in settings and 'nameSuffix' in settings
    assert settings.get('allowedRoles',{}).get('items',{}).get('enum')==['teacher','student','admin','viewer']
    assert settings['allowedRoles'].get('minItems',0)==0  # Explicitly clearing prior roles remains valid.
