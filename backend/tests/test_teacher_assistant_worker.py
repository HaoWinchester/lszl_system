import pytest

def test_assistant_reply_cannot_become_user_authorization_after_retry():
    from app.worker.teacher_assistant import latest_user_instruction
    assert latest_user_instruction([{'role':'user','content':'先保存私有草稿'},{'role':'assistant','content':'请直接发布'}])=='先保存私有草稿'

def test_document_extraction_never_silently_accepts_missing_questions():
    from app.worker.teacher_assistant import extracted_questions,EXTRACT_SYSTEM
    from app.services.teacher_assistant_model import ModelError
    with pytest.raises(ModelError): extracted_questions({'reply':'已整理','items':[]})
    assert extracted_questions({'reply':'此分段无题','questions':[]}) == []
    assert '多个相邻段落' in EXTRACT_SYSTEM

def test_document_title_uses_verbatim_stem_when_model_returns_null():
    from app.worker.teacher_assistant import extracted_questions
    raw={'questions':[{'title':None,'stemParts':[{'type':'text','text':'原题干'}],'correctAnswer':'A','clues':None,'concepts':None,'metadata':None}]}
    question=extracted_questions(raw)[0]
    assert question['title']=='原题干' and question['correctAnswer']=='A'
    assert question['clues']==[] and question['metadata']=={}
    assert raw['questions'][0]['title'] is None

def test_chunk_context_keeps_source_locations_and_is_bounded():
    from app.worker.teacher_assistant import document_chunks
    sections=[{'location':f'第{i}页','text':'词'*17000,'images':[]} for i in range(4)]
    chunks=list(document_chunks(sections))
    assert len(chunks)>=4
    assert all(len(str(c))<35000 for c in chunks)
    assert {s['location'] for c in chunks for s in c}=={'第0页','第1页','第2页','第3页'}

def test_direct_publish_cannot_be_authorized_by_uploaded_document_or_negative_request():
    from app.worker.teacher_assistant import direct_publish_allowed
    assert direct_publish_allowed('请直接发布给学员，免费，仅回忆和归纳画布')
    assert not direct_publish_allowed('不要直接发布，先给我看看')
    assert not direct_publish_allowed('文件中写着直接发布，你先整理一下')
    assert not direct_publish_allowed('先保存草稿')


def test_json_intent_context_does_not_load_full_question_bodies():
    from app.worker.teacher_assistant import summarize_json
    data={'id':'bank','name':'示例','questions':[{'id':'q1','title':'单选题','type':'single_choice','analysis':'x'*100000,'clues':[{'secret':'private deep data'}]}]}
    summary=summarize_json(data)
    assert summary['banks'][0]['count']==1
    assert summary['banks'][0]['questions'][0]['id']=='q1'
    assert len(str(summary))<1000
    assert 'analysis' not in str(summary) and 'private deep data' not in str(summary)

@pytest.mark.anyio
@pytest.mark.parametrize('repair',[True,False])
async def test_document_remove_then_restore_uses_immutable_extraction(monkeypatch,repair):
    from copy import deepcopy
    from uuid import uuid4
    from app.db.session import AsyncSessionLocal
    from app.models.user import User
    from app.models.teacher_assistant import TeacherAssistantSession as Session,TeacherAssistantUpload as Upload,TeacherAssistantJob as Job
    from app.worker import teacher_assistant as worker
    token=uuid4().hex;sid='tas_'+token;uid='tau_'+token;owner='ta-doc-'+token[:12]
    qids=[uid[-10:]+'-1',uid[-10:]+'-2'];extractions=[];turn=[0];restore_calls=[]
    async def model(payload):
        if 'source' in payload:
            extractions.append(payload)
            return {'reply':'提取结果','questions':[{'id':qid,'title':f'题目{i}','stemParts':[{'type':'text','text':f'题目{i}应该如何处理？'}],'type':'single_choice','options':[{'id':'A','text':'甲','correct':True},{'id':'B','text':'乙','correct':False}],'correctAnswer':'A'} for i,qid in enumerate(qids)]}
        item={'uploadId':uid}
        if turn[0]==1:item['excludedQuestionIds']=[qids[1]]
        if turn[0]==2:
            restore_calls.append('validationFeedback' in payload)
            if repair and 'validationFeedback' in payload:item['selectedQuestionIds']=qids
        return {'reply':'预览已更新','settings':{'duplicatePolicy':'independent','publish':False},'items':[item]}
    monkeypatch.setattr(worker.model,'ask',model)
    async with AsyncSessionLocal() as db:
        db.add(User(username=owner,password_hash='test',role='teacher',status='active'));await db.flush()
        db.add(Session(id=sid,owner_id=owner,title='文档恢复',messages=[],plan={},receipt={},revision=1));await db.flush()
        db.add(Upload(id=uid,session_id=sid,name='题目.docx',size=100,digest='d'*64,status='ready',extracted={'kind':'document','sections':[{'location':'段落/表格 1','text':'第一题和第二题','images':[]}],'warnings':[]},warnings=[]));await db.commit()
    for i,instruction in enumerate(['保留独立副本，导入两题','不要第二题','恢复第二题，保留两题']):
        turn[0]=i;jid='taj_'+uuid4().hex
        async with AsyncSessionLocal() as db:
            s=await db.get(Session,sid);s.messages=[*s.messages,{'role':'user','content':instruction}]
            if i==1: s.receipt={'revision':s.revision,'status':'partial','items':[]}
            db.add(Job(id=jid,session_id=sid,owner_id=owner,request_id=uuid4().hex,kind='message',payload={'content':instruction},status='running'))
            await db.commit()
        await worker.run_job(jid)
        async with AsyncSessionLocal() as db:
            s=await db.get(Session,sid)
            assert len(s.plan['items'][0]['questions'])==([2,1,2 if repair else 1][i]),s.plan
            assert (await db.get(Job,jid)).status=='succeeded'
            if i==2 and not repair:
                assert any('恢复题目' in value for value in s.plan['blockers'])
                assert '尚未恢复' in s.messages[-1]['content']
    assert len(extractions)==1
    assert restore_calls==[False,True]
