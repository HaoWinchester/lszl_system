"""Cancelled in-flight jobs keep their lease until their bounded step exits."""
import asyncio
from datetime import datetime,timedelta,timezone
from uuid import uuid4
from fastapi.testclient import TestClient
from app.main import app
from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.user import User
from app.models.teacher_assistant import TeacherAssistantSession as Session,TeacherAssistantJob as Job


def test_any_older_live_lease_blocks_new_work_and_session_deletion():
    token=uuid4().hex;owner='cancel-'+token[:12];sid='tas_'+token;old='taj_'+uuid4().hex
    async def seed():
        async with AsyncSessionLocal() as db:
            db.add(User(username=owner,password_hash=hash_password('cancel-test'),role='teacher',status='active'));await db.flush()
            db.add(Session(id=sid,owner_id=owner,title='取消测试',messages=[],plan={},receipt={},revision=1));await db.flush()
            now=datetime.now(timezone.utc)
            db.add(Job(id=old,session_id=sid,owner_id=owner,request_id=uuid4().hex,kind='message',payload={'content':'旧任务'},status='cancelled',lease_until=now+timedelta(minutes=5),created_at=now-timedelta(minutes=1)))
            db.add(Job(id='taj_'+uuid4().hex,session_id=sid,owner_id=owner,request_id=uuid4().hex,kind='message',payload={'content':'新任务'},status='cancelled',created_at=now))
            await db.commit()
    asyncio.run(seed())
    with TestClient(app) as client:
        assert client.post('/api/v1/auth/login',json={'username':owner,'password':'cancel-test'}).status_code==200
        url=f'/api/v1/teacher-assistant/sessions/{sid}'
        assert client.delete(url).status_code==409
        assert client.post(url+'/messages',json={'content':'继续','requestId':uuid4().hex}).status_code==409
        assert client.post(url+'/uploads',files={'files':('x.json',b'{}','application/json')}).status_code==409
        async def finish():
            async with AsyncSessionLocal() as db:
                job=await db.get(Job,old);job.lease_until=None;await db.commit()
        asyncio.run(finish())
        assert client.delete(url).status_code==204


def test_two_worker_processes_fence_cli_stop_switch_and_restart(tmp_path,monkeypatch):
    """A nested pytest owns an empty migrated DB, so unrelated queued jobs stay untouched."""
    import json,os,subprocess,sys,time
    from pathlib import Path
    if os.environ.get('TEACHER_LIFECYCLE_TEST_CHILD')!='1':
        result=subprocess.run([sys.executable,'-m','pytest',__file__+'::test_two_worker_processes_fence_cli_stop_switch_and_restart','-q'],
            cwd=Path(__file__).resolve().parents[1],env={**os.environ,'TEACHER_LIFECYCLE_TEST_CHILD':'1'},capture_output=True,text=True,timeout=80)
        assert result.returncode==0,result.stdout+result.stderr
        return
    cli=tmp_path/'fake-claude';audit=tmp_path/'processes.jsonl'
    cli.write_text('#!'+sys.executable+'\n'+'''import fcntl,json,os,sys,time
from pathlib import Path
sys.stdin.read()
flag='--resume' if '--resume' in sys.argv else '--session-id'
native=sys.argv[sys.argv.index(flag)+1]
audit=Path(os.environ['TEACHER_TEST_AUDIT'])
with audit.open('a+') as log:
    fcntl.flock(log,fcntl.LOCK_EX);log.seek(0)
    prior=[json.loads(line) for line in log if line.strip()]
    alive=0
    for row in prior:
        try:os.kill(row['pid'],0);alive+=1
        except ProcessLookupError:pass
    log.write(json.dumps({'pid':os.getpid(),'parent':os.getppid(),'sessionId':native,'flag':flag,'active':alive+1})+'\\n');log.flush()
transcript=Path(os.environ['CLAUDE_CONFIG_DIR'])/'projects'/'test'/(native+'.jsonl')
transcript.parent.mkdir(parents=True,exist_ok=True);transcript.write_text('{}')
print(json.dumps({'type':'system','subtype':'init','session_id':native,'tools':['mcp__teacher__'+n for n in ('list_files','read_file','read_image','prepare_import')],'mcp_servers':[{'name':'teacher','status':'connected'}]}),flush=True)
print(json.dumps({'type':'stream_event','event':{'type':'content_block_delta','delta':{'type':'text_delta','text':'可恢复的真实部分回复'}}}),flush=True)
while not audit.with_name('finish-'+str(os.getpid())).exists():time.sleep(.02)
print(json.dumps({'type':'result','result':'可恢复的真实部分回复'}),flush=True)
''');cli.chmod(0o700)
    env={**os.environ,'TEACHER_ASSISTANT_CLAUDE':str(cli),'TEACHER_ASSISTANT_STORAGE':str(tmp_path/'private'),
        'TEACHER_TEST_AUDIT':str(audit),'ANTHROPIC_AUTH_TOKEN':'test-only'}
    workers=[]
    def start_worker():
        process=subprocess.Popen([sys.executable,'-m','app.worker.teacher_assistant'],cwd=Path(__file__).resolve().parents[1],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        workers.append(process);return process
    def rows():return [json.loads(line) for line in audit.read_text().splitlines()] if audit.exists() else []
    def until(predicate):
        deadline=time.monotonic()+12
        while time.monotonic()<deadline:
            value=predicate()
            if value:return value
            time.sleep(.05)
        raise AssertionError('timed out waiting for actual worker/process transition')
    def dead(pid):
        try:os.kill(pid,0);return False
        except ProcessLookupError:return True
    from test_teacher_assistant import users,login
    a,_,_=users()
    try:
        start_worker();start_worker()
        with TestClient(app) as c:
            login(c,a)
            sa=c.post('/api/v1/teacher-assistant/sessions').json()['session'];sb=c.post('/api/v1/teacher-assistant/sessions').json()['session']
            ua='/api/v1/teacher-assistant/sessions/'+sa['id'];ub='/api/v1/teacher-assistant/sessions/'+sb['id']
            def send(url):
                response=c.post(url+'/messages',json={'content':'继续对话','requestId':uuid4().hex});assert response.status_code==200,response.text
            def idle(url):return c.get(url).json()['session']['runtime']['status']=='idle'
            send(ua);first=until(lambda:rows()[0] if len(rows())>=1 else None)
            assert c.post(ub+'/messages',json={'content':'第二会话','requestId':uuid4().hex}).status_code==409
            assert c.post(ub+'/activate').status_code==409
            until(lambda:dead(first['pid']) and idle(ua))
            assert c.post(ub+'/activate').status_code==200
            send(ub);second=until(lambda:rows()[1] if len(rows())>=2 else None)
            audit.with_name('finish-'+str(second['pid'])).touch()
            until(lambda:dead(second['pid']) and idle(ub))
            assert c.post(ua+'/activate').status_code==200
            send(ua);third=until(lambda:rows()[2] if len(rows())>=3 else None)
            assert third['sessionId']==first['sessionId']==sa['runtime']['sessionId']
            assert second['sessionId']==sb['runtime']['sessionId']!=first['sessionId']
            assert third['flag']=='--resume'
            # Stop the worker owning the live CLI, not merely the API job. Its
            # SIGTERM handler must await group exit before DB lock handoff.
            processing=next(worker for worker in workers if worker.pid==third['parent'])
            processing.terminate();processing.wait(timeout=12)
            until(lambda:dead(third['pid']) and idle(ua))
            start_worker()
            assert c.post(ua+'/activate').status_code==200
            send(ua);fourth=until(lambda:rows()[3] if len(rows())>=4 else None)
            assert fourth['sessionId']==first['sessionId'] and fourth['flag']=='--resume'
            audit.with_name('finish-'+str(fourth['pid'])).touch()
            until(lambda:dead(fourth['pid']) and idle(ua))
            assert max(row['active'] for row in rows())==1,rows()
            assert len(rows())==4
    finally:
        for worker in workers:
            if worker.poll() is None:worker.terminate()
        for worker in workers:
            try:worker.wait(timeout=12)
            except subprocess.TimeoutExpired:worker.kill();worker.wait()
