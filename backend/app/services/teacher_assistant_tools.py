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


def text_result(value):
    return {'content':[{'type':'text','text':json.dumps(value,ensure_ascii=False)}]}


def definitions():
    def tool(name,description,properties,required=()):
        return {'name':name,'description':description,'inputSchema':{'type':'object','properties':properties,'required':list(required),'additionalProperties':False}}
    uid={'type':'string','description':'list_files 中真实的上传 ID'}
    return [tool('list_files','列出此会话实际附件及解析状态；没有附件时明确返回空列表。',{}),
        tool('read_file','分页读取完整 JSON 原结构或文档段落/页；按 nextOffset 继续，不能把一页当全文。',{'uploadId':uid,'page':{'type':'integer','minimum':1},'offset':{'type':'integer','minimum':0},'limit':{'type':'integer','minimum':1,'maximum':8000}},['uploadId']),
        tool('read_image','读取附件页面真实图像。返回视觉 image block；OCR 文本不等于视觉理解。',{'uploadId':uid,'name':{'type':'string'}},['uploadId','name']),
        tool('prepare_import','仅在老师要求导入、整理题库或修改预览时生成可审核预览。不能执行导入/发布。settings/items 使用教师整理协议；文档首次提取 questions 须由你读取原文后忠实提交，最多500题，之后用筛选/patch修改，不能重写原题。',{'intent':{'type':'object'}},['intent'])]


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
            page=args.get('page',1);offset=args.get('offset',0);limit=args.get('limit',8000)
            if any(type(v) is not int for v in (page,offset,limit)) or page<1 or offset<0 or not 1<=limit<=8000: raise ValueError('分页参数无效')
            sections=data.get('sections',[])
            if data.get('kind')=='json':
                if page!=1: raise ValueError('JSON 仅有一页，请用 offset 续读')
                value=json.dumps(data.get('data'),ensure_ascii=False);location='完整 JSON';images=[];pages=1
            else:
                if page>len(sections): raise ValueError('页码不存在')
                section=sections[page-1];value=section.get('text','');location=section.get('location','');images=section.get('images',[]);pages=len(sections)
            return text_result({'uploadId':upload.id,'page':page,'pages':pages,'location':location,'text':value[offset:offset+limit],
                'nextOffset':offset+limit if offset+limit<len(value) else None,'images':images,'warnings':upload.warnings})
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
    return text_result({'revision':revision,'summary':plan.get('summary'),'questionCount':plan.get('questionCount'),
        'blockers':plan.get('blockers',[]),'items':[{'id':i['id'],'name':i.get('name'),'count':len(i.get('questions',[])),'blockers':i.get('blockers',[])} for i in plan.get('items',[])],
        'result':'预览已保存，尚未执行导入或发布。'})
