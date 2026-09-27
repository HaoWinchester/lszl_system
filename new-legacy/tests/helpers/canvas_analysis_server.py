"""Reuse the disposable canvas DB/server; never targets production."""
import asyncio,base64,hashlib,json,sys
from pathlib import Path
import canvas_ink_server as base
from sqlalchemy import select
from app.models.teaching_content import ContentSubject,RecallAssociationLibrary
from app.services import question_material_service
from app.schemas.question_material import AssetInput

async def seed():
 await base.seed()
 async with base.AsyncSessionLocal() as db:
  subject=await db.get(ContentSubject,'subject-pmp')
  if subject is None:
   subject=ContentSubject(id='subject-pmp',code='PMP',name='PMP',content_metadata={});db.add(subject);await db.flush()
  library=RecallAssociationLibrary(id='canvas-analysis-library',subject_id=subject.id,version=999,status='published',nodes=[{'id':'budget','title':'预算估算','hint':'先判断估算层级'}],edges=[],content_metadata={},updated_by='ink-browser')
  db.add(library);subject.content_metadata={**subject.content_metadata,'currentRecallLibraryId':library.id};await db.commit()
  user=await db.get(base.User,'ink-browser')
  for i,filename in [(1,'finance-08.png'),(2,'finance-10.png')]:
   path=base.ROOT/'docs/repairs/2026-09-27-finance-charts'/filename
   asset=await question_material_service.upload_asset(db,user,AssetInput(filename=filename,mimeType='image/png',dataBase64=base64.b64encode(path.read_bytes()).decode(),alt='原题图表 '+str(i)))
   q=await db.get(base.Question,f'ink-question-{i}')
   q.concepts=[];q.clues=[{'id':'budget-clue','text':'分析影响','isCore':True,'recallNodeId':'budget','explain':''}]
   q.content_metadata={'images':[asset]}
   row=(await db.execute(select(base.PaperReleaseQuestion).where(base.PaperReleaseQuestion.release_id=='ink-release',base.PaperReleaseQuestion.question_id==q.id))).scalar_one()
   q.reasoning_steps=[{'title':'逐项排除','content':'A：先分析影响。；B：未经分析不能立即变更。'}] if i==1 else []
   q.revision=2;q.content_hash=hashlib.sha256(path.read_bytes()).hexdigest()
   row.snapshot={**row.snapshot,'revision':2,'contentHash':q.content_hash,'concepts':[],'clues':q.clues,'reasoningSteps':q.reasoning_steps,'images':[asset]}
  await db.commit()

if __name__=='__main__':
 asyncio.run(seed())
 base.DisposableServer(base.uvicorn.Config(base.app,host='127.0.0.1',port=int(sys.argv[1]),log_level='warning')).run()
