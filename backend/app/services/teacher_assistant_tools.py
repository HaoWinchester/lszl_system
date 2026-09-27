"""Four owner/session-scoped MCP tools. No shell, paths, model calls or execution tool."""
import base64
from copy import deepcopy
import io
import json
from pathlib import Path
from sqlalchemy import select
from sqlalchemy.orm import undefer
from app.db.session import AsyncSessionLocal
from app.models.teacher_assistant import TeacherAssistantSession as Session,TeacherAssistantUpload as Upload,TeacherAssistantJob as Job
from app.models.user import User
from app.services.teacher_assistant_service import storage
from app.services.teacher_assistant_tool_catalog import definitions


def text_result(value):
    return {'content':[{'type':'text','text':json.dumps(value,ensure_ascii=False)}]}


def document_chunk(sections,offset,limit):
    """Read across paragraph/page boundaries without joining the full document."""
    cursor=0;parts=[];images=[]
    for index,section in enumerate(sections):
        start=cursor
        for piece in (('\n' if index else '')+'['+section.get('location','')+']\n',section.get('text','')):
            end=cursor+len(piece)
            if cursor<offset+limit and end>offset:
                parts.append(piece[max(0,offset-cursor):max(0,min(len(piece),offset+limit-cursor))])
            cursor=end
        if start<offset+limit and cursor>offset:
            images.extend(section.get('images',[]))
    return ''.join(parts),list(dict.fromkeys(images)),cursor




async def call_tool(owner,sid,jid,name,args):
    if name not in {t['name'] for t in definitions()} or not isinstance(args,dict): raise ValueError('工具或参数无效')
    async with AsyncSessionLocal() as db:
        user=await db.get(User,owner)
        session=(await db.execute(select(Session).where(Session.id==sid,Session.owner_id==owner))).scalar_one_or_none()
        job=(await db.execute(select(Job).where(Job.id==jid,Job.owner_id==owner,Job.session_id==sid,Job.status=='running'))).scalar_one_or_none()
        if not session or not job or not user or user.status!='active' or user.role not in ('teacher','admin'): raise ValueError('会话不存在或任务已停止')
        if name=='list_files':
            uploads=(await db.execute(select(Upload).where(Upload.session_id==sid).order_by(Upload.created_at))).scalars().all()
            return text_result({'files':[{'uploadId':u.id,'name':u.name,'status':u.status,'warnings':u.warnings} for u in uploads]})
        if name=='prepare_import':
            return await prepare(db,user,session,job,args.get('intent'))
        upload=(await db.execute(select(Upload).where(Upload.session_id==sid,Upload.id==args.get('uploadId')).options(undefer(Upload.extracted)))).scalar_one_or_none()
        if not upload or upload.status!='ready': raise ValueError('附件不存在、已过期或未能解析')
        data=upload.extracted
        if name=='read_file':
            page=args.get('page');offset=args.get('offset',0);limit=args.get('limit',8000)
            if any(type(v) is not int for v in (offset,limit)) or (page is not None and (type(page) is not int or page<1)) or offset<0 or not 1<=limit<=8000: raise ValueError('分页参数无效')
            sections=data.get('sections',[])
            scope='document'
            if data.get('kind')=='json':
                if page not in (None,1): raise ValueError('JSON 仅有一页，请用 offset 续读')
                value=json.dumps(data.get('data'),ensure_ascii=False);location='完整 JSON';images=[];pages=1
                total=len(value);chunk=value[offset:offset+limit]
            elif page is None:
                chunk,images,total=document_chunk(sections,offset,limit)
                location='全文（来源按段落/页标注）';pages=len(sections)
            else:
                if page>len(sections): raise ValueError('页码不存在')
                section=sections[page-1];value=section.get('text','');location=section.get('location','');images=section.get('images',[]);pages=len(sections)
                scope='section';total=len(value);chunk=value[offset:offset+limit]
            next_offset=offset+limit if offset+limit<total else None
            next_read={'uploadId':upload.id,'offset':next_offset,**({'page':page} if page is not None else {})} if next_offset is not None else None
            if next_read is None and scope=='section' and page<pages:
                next_read={'uploadId':upload.id,'page':page+1,'offset':0}
            return text_result({'uploadId':upload.id,'scope':scope,'page':page,'pages':pages,'location':location,'text':chunk,
                'nextOffset':next_offset,'nextRead':next_read,'images':images,'warnings':upload.warnings})
        filename=args.get('name','')
        allowed={image for section in data.get('sections',[]) for image in section.get('images',[])}
        if filename not in allowed or Path(filename).name!=filename: raise ValueError('图片不存在')
        base=(storage(sid,upload.id)/'extracted').resolve();path=(base/filename).resolve()
        if path.parent!=base or not path.is_file() or path.stat().st_size>20*1024*1024: raise ValueError('图片不存在或过大')
        from PIL import Image
        try:
            with Image.open(path) as image:
                if image.width*image.height>25000000: raise ValueError('图片像素超限')
                image.thumbnail((1600,1600));image=image.convert('RGB');output=io.BytesIO();image.save(output,format='JPEG',quality=85)
        except (OSError,Image.DecompressionBombError) as exc: raise ValueError('图片无法读取') from exc
        return {'content':[{'type':'text','text':json.dumps({'uploadId':upload.id,'name':filename,'source':'实际图片，非 OCR 文字'},ensure_ascii=False)},
            {'type':'image','data':base64.b64encode(output.getvalue()).decode(),'mimeType':'image/jpeg'}]}


async def prepare(db,user,session,job,intent):
    from app.services.teacher_assistant_import import build_plan
    from app.worker.teacher_assistant import latest_user_instruction,extracted_questions,restoration_missed
    if not isinstance(intent,dict) or len(json.dumps(intent,ensure_ascii=False).encode())>400000: raise ValueError('导入计划无效或过大')
    intent=deepcopy(intent);intent['userInstruction']=latest_user_instruction(session.messages)
    uploads=(await db.execute(select(Upload).where(Upload.session_id==session.id,Upload.status!='expired').options(undefer(Upload.extracted)))).scalars().all()
    by_id={u.id:u for u in uploads};items=intent.get('items',[])
    if not isinstance(items,list) or any(not isinstance(i,dict) or i.get('uploadId') not in by_id for i in items): raise ValueError('计划引用不存在的附件')
    if any(u.status!='ready' for u in uploads): raise ValueError('部分附件尚未读取成功')
    by_item={i['uploadId']:i for i in items};sources=[]
    for upload in uploads:
        data=deepcopy(upload.extracted);item=by_item.setdefault(upload.id,{'uploadId':upload.id})
        if data.get('kind')!='json':
            cache=data.get('questionCache')
            if cache is None and item.get('questions'):
                questions=extracted_questions({'questions':item['questions']})
                if len(questions)>500: raise ValueError('超过 500 题，请拆分文件')
                for index,q in enumerate(questions,1):
                    q['id']=str(q.get('id') or f'{upload.id[-10:]}-{index}')
                    meta=q.setdefault('metadata',{});meta['aiExtracted']=True;meta['needsReview']=True
                    meta.setdefault('sourceLocation',data['sections'][0]['location'] if data.get('sections') else '原文件')
                    q['source']={'uploadId':upload.id,'location':meta['sourceLocation']};q['needsReview']=True
                cache={'questions':questions};data['questionCache']=cache;upload.extracted=data
            if cache: item['questions']=deepcopy(cache['questions'])
        sources.append({'id':upload.id,'name':upload.name,'extracted':data})
    intent['items']=list(by_item.values())
    plan=await build_plan(db,user,sources,intent,session_id=session.id,previous_plan=session.plan)
    if restoration_missed(intent['userInstruction'],sources,session.plan,plan):
        plan.setdefault('blockers',[]).append('恢复题目尚未落实，请在 selectedQuestionIds 中明确完整保留列表。')
    # Serialize against stop/switch and validate the job again after plan work.
    await db.refresh(session,with_for_update=True);await db.refresh(job,with_for_update=True)
    await db.refresh(user)
    if job.status!='running' or user.status!='active' or user.role not in ('teacher','admin'): raise ValueError('任务已停止')
    session.plan=plan;session.revision+=1
    job.stream={**(job.stream or {}),"preparedRevision":session.revision}
    revision=session.revision
    await db.commit()
    return text_result({'revision':revision,'summary':plan.get('summary'),'questionCount':plan.get('questionCount'),'settings':plan.get('settings',{}),
        'blockers':plan.get('blockers',[]),'items':[{'id':i['id'],'name':i.get('name'),'count':len(i.get('questions',[])),'blockers':i.get('blockers',[])} for i in plan.get('items',[])],
        'result':'预览已保存，尚未执行导入或发布。'})
