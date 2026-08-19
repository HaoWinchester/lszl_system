'use strict';

/*
 * 本文件由原单文件 HTML 自动拆分而来。
 * 维护建议：继续把本文件中的强耦合函数逐步迁移为显式模块 API。
 */

/* 题库管理 MVP 核心 */
const QB_STORE=window.KGAppStorage||{};
const QB_KEYS=window.KGStorageKeys||{};
const QB_CATALOG=window.KGQuestionCatalogAdapter;
const QUESTION_BANKS_STORAGE_PREFIX=QB_KEYS.PREFIXES?.QUESTION_BANK||'kg_question_banks_v1__';
const QUESTION_CURRENT_STORAGE_PREFIX=QB_KEYS.PREFIXES?.QUESTION_CURRENT||'kg_question_current_v1__';
const QUESTION_PAPERS_STORAGE_PREFIX=QB_KEYS.PREFIXES?.EXAM_PAPER||'kg_exam_papers_v1__';
const QUESTION_CURRENT_PAPER_STORAGE_PREFIX=QB_KEYS.PREFIXES?.EXAM_CURRENT||'kg_exam_current_v1__';
const QUESTION_PUBLISHED_PAPERS_KEY=QB_KEYS.PUBLISHED_PAPERS||'kg_exam_papers_published_v1';
function qbReadJSON(key,fallback=null){try{return QB_STORE.readJSON?QB_STORE.readJSON(key,fallback):JSON.parse(window.localStorage?.getItem(key)||'null')??fallback}catch(e){return fallback}}
function qbWriteJSON(key,value){try{return QB_STORE.writeJSON?QB_STORE.writeJSON(key,value):(window.localStorage?.setItem(key,JSON.stringify(value)),true)}catch(e){return false}}
function qbReadString(key,fallback=''){try{return QB_STORE.readString?QB_STORE.readString(key,fallback):(window.localStorage?.getItem(key)??fallback)}catch(e){return fallback}}
function qbRemoveKey(key){try{return QB_STORE.remove?QB_STORE.remove(key):(window.localStorage?.removeItem(key),true)}catch(e){return false}}
let qBankState={banks:null,papers:null,scope:null,selectedBankId:null,selectedQuestionId:null,currentBankId:null,currentQuestionIndex:0,currentPaperId:null,currentReleaseId:null,currentPaperIndex:0};
function qbCurrentUsername(){
  try{
    const username=window.KGAuthCore?.currentUsername?.();
    if(username)return String(username);
  }catch(e){}
  try{
    if(typeof authCurrentUser!=='undefined'&&authCurrentUser?.username)return String(authCurrentUser.username);
  }catch(e){}
  try{return String(qbReadString(QB_KEYS.AUTH_CURRENT_USER||'kg_local_current_user_v1','')||'')}catch(e){return ''}
}
function qbIsLoggedIn(){return !!qbCurrentUsername()}
function qbScopeKey(){const username=qbCurrentUsername();return username?('user__'+encodeURIComponent(username)):'public'}
function qbBanksKey(){return QUESTION_BANKS_STORAGE_PREFIX+qbScopeKey()}
function qbCurrentKey(){return QUESTION_CURRENT_STORAGE_PREFIX+qbScopeKey()}
function qbPapersKey(){return QUESTION_PAPERS_STORAGE_PREFIX+qbScopeKey()}
function qbCurrentPaperKey(){return QUESTION_CURRENT_PAPER_STORAGE_PREFIX+qbScopeKey()}
function qbEnsureScopeState(){
  const scope=qbScopeKey();
  if(qBankState.scope!==scope)qBankState={banks:null,papers:null,scope,selectedBankId:null,selectedQuestionId:null,currentBankId:null,currentQuestionIndex:0,currentPaperId:null,currentReleaseId:null,currentPaperIndex:0};
  return scope;
}
function qbClone(obj){return JSON.parse(JSON.stringify(obj))}
function qbQuestionLifecycle(q){const raw=q?.lifecycle&&typeof q.lifecycle==='object'?q.lifecycle:{};return {status:raw.status==='deleted'||q?.deletedAt?'deleted':'active',deletedAt:String(raw.deletedAt||q?.deletedAt||'')}}
function qbIsQuestionDeleted(q){return qbQuestionLifecycle(q).status==='deleted'}
function qbActiveQuestions(bank){return (bank?.questions||[]).filter(q=>!qbIsQuestionDeleted(q))}
function qbDefaultBank(){return {id:'bank-pmp-demo',name:'PMP 敏捷场景题示例题库',subject:'PMP',description:'内置演示题库：用于体验“题干线索 → 知识点 → 本题图谱 → 答案复盘”的训练流程。',version:'1.0',visibility:'public-demo',createdAt:Date.now(),updatedAt:Date.now(),questions:[qbNormalizeQuestion(qbClone(PMP_QUESTION_MVP),0)]}}
function qbNormalizeQuestion(q,i=0){
  q=q&&typeof q==='object'?q:{};
  q.id=String(q.id||('q-'+Date.now()+'-'+i));
  q.title=String(q.title||'未命名题目');
  q.difficulty=String(q.difficulty||'');
  q.topic=String(q.topic||'');
  q.domain=String(q.domain||'');
  q.tags=Array.isArray(q.tags)?q.tags:[];
  q.lifecycle=qbQuestionLifecycle(q);
  q.stemParts=Array.isArray(q.stemParts)?q.stemParts:[{text:String(q.stem||'')}];
  q.options=Array.isArray(q.options)?q.options:[];
  q.clues=Array.isArray(q.clues)?q.clues:[];
  q.concepts=Array.isArray(q.concepts)?q.concepts:[];
  const correct=q.options.find(o=>o&&o.correct)||q.options.find(o=>String(o.id)===String(q.correctAnswer));
  q.correctAnswer=String(q.correctAnswer||correct?.id||'');
  q.options=q.options.map((o,idx)=>({id:String(o.id||String.fromCharCode(65+idx)),text:String(o.text||''),trap:String(o.trap||''),correct:!!o.correct||String(o.id)===q.correctAnswer}));
  if(!q.correctAnswer){const c=q.options.find(o=>o.correct);if(c)q.correctAnswer=c.id}
  return q;
}
function qbNormalizeBank(bank,i=0){
  bank=bank&&typeof bank==='object'?bank:{};
  const questions=Array.isArray(bank.questions)?bank.questions:[];
  return {id:String(bank.id||bank.bankId||('bank-'+Date.now()+'-'+i)),name:String(bank.name||bank.bankName||'未命名题库'),subject:String(bank.subject||'PMP'),description:String(bank.description||''),version:String(bank.version||'1.0'),visibility:String(bank.visibility||'private'),createdAt:Number(bank.createdAt||Date.now()),updatedAt:Date.now(),questions:questions.map(qbNormalizeQuestion)};
}

function qbNormalizePaper(paper,i=0){
  paper=paper&&typeof paper==='object'?paper:{};
  const questions=Array.isArray(paper.questions)?paper.questions:(Array.isArray(paper.questionRefs)?paper.questionRefs:[]);
  return {
    id:String(paper.paperId||paper.id||('paper-'+Date.now()+'-'+i)),
    releaseId:String(paper.releaseId||paper.id||''),
    version:Number(paper.version||paper.publishedVersion||0),
    name:String(paper.name||paper.title||'未命名试卷'),
    subject:String(paper.subject||'PMP'),
    description:String(paper.description||''),
    totalCount:Number(paper.totalCount||paper.targetCount||questions.length||180),
    status:String(paper.status||'draft'),
    publishedAt:Number(paper.publishedAt||0),
    updatedAt:Number(paper.updatedAt||paper.publishedAt||Date.now()),
    enabledModes:(window.KGPaperLearningModes?.normalizePaper?.(paper)||(()=>{const all=['practice_mode','deep_recall','multi_question_canvas'],explicit=Array.isArray(paper.enabledModes),version=Number(paper.modeConfigVersion||0);const aliases={practice:'practice_mode',recall:'deep_recall','deep-recall':'deep_recall',multi_question:'multi_question_canvas','multi-question':'multi_question_canvas',canvas:'multi_question_canvas'};const rows=explicit?paper.enabledModes.map(String).map(mode=>all.includes(mode)?mode:(aliases[mode]||'')).filter(Boolean):[];if(!explicit)return all;if(!rows.length)return version>=2?[]:all;if(version<2&&!rows.includes('practice_mode'))rows.unshift('practice_mode');return [...new Set(rows)]})()),
    modeConfigVersion:Number(paper.modeConfigVersion||0),
    availability:String(paper.availability||'published'),
    current:paper.current!==false,
    source:String(paper.source||''),
    questionSnapshots:Array.isArray(paper.questionSnapshots)?paper.questionSnapshots.map(qbClone):[],
    questions:questions.map((ref,idx)=>({bankId:String(ref.bankId||ref.sourceBankId||''),questionId:String(ref.questionId||ref.id||''),order:Number(ref.order||idx+1),score:Number(ref.score||1)})).filter(ref=>ref.bankId&&ref.questionId).sort((a,b)=>a.order-b.order)
  };
}
function qbInvalidateCaches(){qBankState.banks=null;qBankState.papers=null}
try{window.addEventListener('storage',event=>{if([QUESTION_PUBLISHED_PAPERS_KEY,qbPapersKey()].includes(String(event.key||'')))qbInvalidateCaches()});window.addEventListener('kg:published-papers-changed',qbInvalidateCaches);window.addEventListener('kg:question-catalog-changed',qbInvalidateCaches)}catch(e){}
function qbLoadPapers(){
  qbEnsureScopeState();
  if(qBankState.papers)return qBankState.papers;
  let own=[],published=[];
  try{own=qbReadJSON(qbPapersKey(),[])}catch(e){own=[]}
  try{
    const repository=window.KGPublishedPaperRepository;
    published=repository?.listReleases?.({includeHistory:true})||qbReadJSON(QUESTION_PUBLISHED_PAPERS_KEY,[]);
  }catch(e){published=[]}
  const publicRows=(Array.isArray(published)?published:[]).map(qbNormalizePaper).filter(p=>p.status==='published'&&p.availability!=='withdrawn');
  const ids=new Set(publicRows.map(p=>p.id+'::'+p.releaseId));
  const ownRows=(Array.isArray(own)?own:[]).map(qbNormalizePaper).filter(p=>!ids.has(p.id+'::'+p.releaseId));
  qBankState.papers=[...publicRows,...ownRows];
  try{
    const cur=qbReadJSON(qbCurrentPaperKey(),null);
    const matched=cur&&qBankState.papers.find(p=>p.id===cur.paperId&&p.status==='published'&&(!cur.releaseId||p.releaseId===cur.releaseId));
    if(matched){qBankState.currentPaperId=matched.id;qBankState.currentReleaseId=matched.releaseId;qBankState.currentPaperIndex=Number(cur.index||0)}
  }catch(e){}
  return qBankState.papers;
}
function qbPublishedPapers(){return qbLoadPapers().filter(p=>p.status==='published'&&p.availability!=='withdrawn')}
function qbCurrentPaper(){const rows=qbPublishedPapers().filter(p=>p.id===qBankState.currentPaperId);return rows.find(p=>!qBankState.currentReleaseId||p.releaseId===qBankState.currentReleaseId)||rows.sort((a,b)=>Number(b.version||0)-Number(a.version||0)||Number(b.publishedAt||0)-Number(a.publishedAt||0))[0]||null}
function qbPaperQuestionByRef(ref,paper=null){
  const published=paper&&paper.status==='published';
  if(published&&window.KGPublishedPaperRepository){
    const repository=window.KGPublishedPaperRepository;
    // 细粒度 API 后解析是异步的：先读同步缓存；未命中触发后台预取，缓存落地后事件驱动重渲染
    const item=repository.findQuestionCached?.({
      releaseId:paper.releaseId,
      paperId:paper.id,
      bankId:ref?.bankId,
      questionId:ref?.questionId
    });
    if(item)return {bank:qbNormalizeBank(item.bank),question:qbNormalizeQuestion(item.question)};
    if(!item&&typeof repository.resolvePublishedPaper==='function'&&paper.releaseId){
      repository.resolvePublishedPaper({paperId:paper.id,releaseId:paper.releaseId},{respectRole:false}).catch(()=>{});
    }
    return {bank:null,question:null};
  }
  const banks=qbLoadBanks();let bank=banks.find(b=>b.id===ref.bankId);let question=bank&&(bank.questions||[]).find(q=>q.id===ref.questionId);
  if(!question&&paper){const snapshot=(paper.questionSnapshots||[]).find(item=>String(item.bankId)===String(ref.bankId)&&String(item.questionId)===String(ref.questionId));if(snapshot?.question){question=qbNormalizeQuestion(qbClone(snapshot.question));bank=bank||qbNormalizeBank({id:snapshot.bankId,name:snapshot.bankName,subject:snapshot.bankSubject||paper.subject,visibility:'published-paper',questions:[question]})}}
  return {bank,question};
}
function qbQuestionAllowedForRole(question,bankId=''){
  const roleApi=window.KGRolePermissions;
  if(!question)return false;
  if(!roleApi||typeof roleApi.canOperateQuestion!=='function')return true;
  return !!roleApi.canOperateQuestion(question,bankId);
}
function qbResolvePublishedPaper(paper,options={}){
  const repository=window.KGPublishedPaperRepository;
  if(repository&&paper?.status==='published'){
    // 同步缓存优先；未命中触发异步解析（P4.6 细粒度 API）
    const cached=repository.peekResolved?.(paper.releaseId||paper.id);
    if(cached)return cached;
    if(paper.releaseId)repository.resolvePublishedPaper({paperId:paper.id,releaseId:paper.releaseId},options).catch(()=>{});
  }
  const respectRole=options.respectRole!==false;
  const refs=Array.isArray(paper?.questions)?paper.questions:[];
  const items=[];
  let missingCount=0;
  let blockedCount=0;
  refs.forEach((ref,paperIndex)=>{
    const found=qbPaperQuestionByRef(ref,paper);
    if(!found.bank||!found.question){missingCount+=1;return}
    if(respectRole&&!qbQuestionAllowedForRole(found.question,found.bank.id||ref.bankId)){blockedCount+=1;return}
    const bankQuestionIndex=(found.bank.questions||[]).findIndex(question=>String(question.id)===String(found.question.id));
    items.push({paper,paperIndex,index:paperIndex,bankQuestionIndex,bank:found.bank,question:found.question,ref});
  });
  return {paper,items,configuredCount:refs.length,targetCount:Number(paper?.totalCount||refs.length||0),availableCount:items.length,missingCount,blockedCount};
}
function qbPublishedPaperCatalog(options={}){
  const repository=window.KGPublishedPaperRepository;
  if(repository){
    const mode=String(options.mode||'');
    const entries=(repository.listCatalogEntries(options)||[]).map(catalog=>{
      const cached=repository.peekResolved?.(catalog.releaseId);
      if(cached)return cached;
      return {ok:true,paper:{...catalog,id:catalog.paperId,availability:'published',questionSnapshots:[]},items:[],configuredCount:catalog.totalCount,targetCount:catalog.totalCount,availableCount:0,missingCount:0,damagedCount:0,blockedCount:0,issues:[]};
    });
    // 有未解析的 release 时后台预取，落地后经 kg:published-papers-changed 重渲染
    void repository.prefetchMissing?.();
    return entries;
  }
  const mode=String(options.mode||'');
  return qbPublishedPapers().filter(paper=>!mode||(paper.enabledModes||[]).includes(mode)).map(paper=>qbResolvePublishedPaper(paper,options));
}
function qbSelectPublishedPaper(paperId,index=0,options={}){
  qbLoadPapers();
  const identifier=paperId&&typeof paperId==='object'?paperId:{paperId,releaseId:options.releaseId||''};
  const candidates=qbPublishedPapers().filter(item=>String(item.id)===String(identifier.paperId||identifier.id||''));
  const paper=candidates.find(item=>identifier.releaseId&&String(item.releaseId)===String(identifier.releaseId))||candidates.sort((a,b)=>Number(b.version||0)-Number(a.version||0)||Number(b.publishedAt||0)-Number(a.publishedAt||0))[0]||null;
  if(!paper){
    qBankState.currentPaperId=null;qBankState.currentReleaseId=null;qBankState.currentPaperIndex=0;qbSaveCurrentPaper();return null;
  }
  qBankState.currentPaperId=paper.id;qBankState.currentReleaseId=paper.releaseId;
  qBankState.currentPaperIndex=Math.max(0,Math.min(Number(index||0),Math.max(0,(paper.questions||[]).length-1)));
  qbSaveCurrentPaper();
  if(options.applyQuestion){qbApplyPaperContext();qbApplyCurrentQuestion(options.reset!==false)}
  const currentRef=paper.questions?.[qBankState.currentPaperIndex]||null;
  const context={paperId:paper.id,releaseId:paper.releaseId,questionId:String(currentRef?.questionId||''),bankId:String(currentRef?.bankId||''),mode:String(options.mode||'single_deep_study')};
  if(options.activateContext!==false&&context.questionId)window.KGLearningProgress?.activate?.(context,{mode:context.mode,clearTransient:options.clearTransient!==false});
  try{window.dispatchEvent(new CustomEvent('kg:published-paper-selection-changed',{detail:{paperId:paper.id,releaseId:paper.releaseId,index:qBankState.currentPaperIndex,context}}))}catch(e){}
  return paper;
}
function qbEnsurePublishedPaperSelection(options={}){
  const papers=qbPublishedPapers();
  const current=qbCurrentPaper();
  if(current)return current;
  if(!papers.length)return null;
  return qbSelectPublishedPaper(papers[0].id,0,options);
}
function qbSaveCurrentPaper(){
  try{
    if(qBankState.currentPaperId){const paper=qbCurrentPaper();qbWriteJSON(qbCurrentPaperKey(),{paperId:qBankState.currentPaperId,releaseId:String(qBankState.currentReleaseId||paper?.releaseId||''),index:qBankState.currentPaperIndex||0,savedAt:Date.now()});}
    else qbRemoveKey(qbCurrentPaperKey());
  }catch(e){}
}
function qbPaperCurrentRef(){
  const paper=qbCurrentPaper();
  if(!paper||!paper.questions.length)return null;
  qBankState.currentPaperIndex=Math.max(0,Math.min(qBankState.currentPaperIndex||0,paper.questions.length-1));
  return paper.questions[qBankState.currentPaperIndex];
}
function qbApplyPaperContext(){
  let ref=qbPaperCurrentRef();
  if(!ref)return null;
  let {bank,question}=qbPaperQuestionByRef(ref,qbCurrentPaper());
  if(!bank||!question||!qbQuestionAllowedForRole(question,bank.id||ref.bankId)){
    const paper=qbCurrentPaper();
    const first=paper?qbResolvePublishedPaper(paper,{respectRole:true}).items[0]:null;
    if(!first)return null;
    qBankState.currentPaperIndex=first.paperIndex;
    qbSaveCurrentPaper();
    ref=first.ref;
    bank=first.bank;
    question=first.question;
  }
  if(bank&&question){
    qBankState.currentBankId=bank.id;
    qBankState.currentQuestionIndex=Math.max(0,(bank.questions||[]).findIndex(q=>q.id===question.id));
    qBankState.selectedBankId=bank.id;
    qBankState.selectedQuestionId=question.id;
    return question;
  }
  return null;
}

function qbValidateBank(bank){
  const errors=[];
  if(!bank||typeof bank!=='object')errors.push('题库必须是 JSON 对象。');
  if(!Array.isArray(bank.questions))errors.push('缺少 questions 数组。');
  (bank.questions||[]).forEach((q,i)=>{if(!q.title)errors.push(`第 ${i+1} 题缺少 title。`);if(!Array.isArray(q.options)||q.options.length<2)errors.push(`第 ${i+1} 题选项不足。`);const hasCorrect=(q.options||[]).some(o=>o.correct)||q.correctAnswer;if(!hasCorrect)errors.push(`第 ${i+1} 题缺少正确答案。`);});
  return errors;
}
function qbLoadLegacyBanksForMigrationPreview(){
  if(typeof document==='undefined'||document.body?.dataset?.questionCatalogMigrationPreview!=='true')return [];
  const rows=qbReadJSON(qbBanksKey(),[]);
  return Array.isArray(rows)?rows.map(qbNormalizeBank):[];
}
function qbCatalogQuestionAllowed(question){return String(question?.scope||'')==='public'&&!qbIsQuestionDeleted(question)}
function qbCatalogBankAllowed(bank){return String(bank?.visibility||'')==='published'&&String(bank?.accessMode||'')!=='private'}
function qbLoadBanks(){
  qbEnsureScopeState();if(qBankState.banks)return qBankState.banks;
  const snapshot=QB_CATALOG.snapshot();
  const allowedQuestions=(Array.isArray(snapshot?.questions)?snapshot.questions:[]).filter(qbCatalogQuestionAllowed);
  const questionsByBank=new Map();
  allowedQuestions.forEach(question=>{const bankId=String(question?.bankId||'');if(!bankId)return;if(!questionsByBank.has(bankId))questionsByBank.set(bankId,[]);questionsByBank.get(bankId).push(question)});
  qBankState.banks=(Array.isArray(snapshot?.banks)?snapshot.banks:[]).filter(qbCatalogBankAllowed).map(bank=>qbNormalizeBank({...bank,questions:questionsByBank.get(String(bank.id))||[]})).filter(bank=>bank.questions.length);
  try{const cur=qbReadJSON(qbCurrentKey(),null);if(cur){qBankState.currentBankId=cur.bankId;qBankState.currentQuestionIndex=Number(cur.index||0)}}catch(e){}
  qbLoadPapers();qbApplyPaperContext();
  const firstBank=qBankState.banks[0]||null;
  if(!firstBank){qBankState.currentBankId=null;qBankState.selectedBankId=null;qBankState.selectedQuestionId=null;qBankState.currentQuestionIndex=0;return qBankState.banks}
  if(!qBankState.banks.some(bank=>bank.id===qBankState.currentBankId))qBankState.currentBankId=firstBank.id;
  const bank=qbCurrentBank()||firstBank;qBankState.currentBankId=bank.id;const pointed=bank.questions?.[Math.max(0,Math.min(qBankState.currentQuestionIndex,(bank.questions||[]).length-1))];const fallback=qbActiveQuestions(bank)[0]||null;const selected=!qBankState.currentPaperId&&qbIsQuestionDeleted(pointed)?fallback:pointed||fallback;qBankState.currentQuestionIndex=selected?Math.max(0,bank.questions.findIndex(item=>item.id===selected.id)):0;qBankState.selectedBankId=qBankState.selectedBankId&&qBankState.banks.some(item=>item.id===qBankState.selectedBankId)?qBankState.selectedBankId:qBankState.currentBankId;qBankState.selectedQuestionId=qBankState.selectedQuestionId||selected?.id||fallback?.id||null;qbEnsureAllowedCurrentForRole();return qBankState.banks;
}
function qbSaveBanks(){void qbBanksKey();showStatus('正式题库由服务器统一管理，请在题库管理页完成修改。');return false}
function qbSaveCurrent(){try{qbWriteJSON(qbCurrentKey(),{bankId:qBankState.currentBankId,index:qBankState.currentQuestionIndex})}catch(e){}}
function qbCurrentBank(){const banks=qbLoadBanks();return banks.find(b=>b.id===qBankState.currentBankId)||banks[0]||null}
function qbSelectedBank(){return qbLoadBanks().find(b=>b.id===qBankState.selectedBankId)||qbCurrentBank()}
function qbCurrentQuestion(){const paperQuestion=qbApplyPaperContext();if(paperQuestion)return paperQuestion;const b=qbCurrentBank();const pointed=b?.questions?.[qBankState.currentQuestionIndex];if(pointed&&!qbIsQuestionDeleted(pointed))return pointed;const fallback=qbActiveQuestions(b)[0]||null;if(b&&fallback){qBankState.currentQuestionIndex=Math.max(0,b.questions.findIndex(item=>item.id===fallback.id))}return fallback}
function qbSelectedQuestion(){const b=qbSelectedBank(),selected=b&&(b.questions||[]).find(q=>q.id===qBankState.selectedQuestionId);return selected&&!qbIsQuestionDeleted(selected)?selected:qbActiveQuestions(b)[0]||null}
function qbApplyCurrentQuestion(reset=true){
  const sourceQuestion=qbCurrentQuestion();
  const sourceBank=qbCurrentBank();
  if(!sourceQuestion){PMP_QUESTION_MVP=null;if(reset)qMvpState=qNewMvpState();return null}
  const cloned=qbNormalizeQuestion(qbClone(sourceQuestion));
  cloned.sourceBankId=String(sourceBank?.id||qBankState.currentBankId||cloned.sourceBankId||'');
  cloned.sourceQuestionId=String(sourceQuestion?.id||cloned.id||'');
  PMP_QUESTION_MVP=cloned;
  if(reset)qMvpState=qNewMvpState();
}
function qCurrentQuestionBankId(){return String(PMP_QUESTION_MVP?.sourceBankId||qBankState.currentBankId||qbCurrentBank()?.id||'')}
function qCanOperateCurrentQuestion(message){
  const roleApi=window.KGRolePermissions;
  if(roleApi&&typeof roleApi.canOperateQuestion==='function'&&!roleApi.canOperateQuestion(PMP_QUESTION_MVP,qCurrentQuestionBankId())){
    showStatus(message||roleApi.questionDeniedMessage?.()||'当前角色无权操作这道题。');
    return false;
  }
  return authRequire(message||'登录后才能进行考题训练。','useTraining');
}
function qCanUseDeepRecallCurrentQuestion(){
  const roleApi=window.KGRolePermissions;
  if(roleApi&&typeof roleApi.canUseDeepRecallQuestion==='function'&&!roleApi.canUseDeepRecallQuestion(PMP_QUESTION_MVP,qCurrentQuestionBankId())){
    showStatus(roleApi.questionDeniedMessage?.()||'当前角色无权进入这道题的深度回忆。');
    return false;
  }
  return authRequire('登录后才能进入深度回忆。','useDeepRecall');
}
function qbFindDemoBankQuestion(){
  const roleApi=window.KGRolePermissions;
  const banks=qBankState.banks||[];
  for(const bank of banks){
    for(let i=0;i<(bank.questions||[]).length;i++){
      if(!qbIsQuestionDeleted(bank.questions[i])&&roleApi&&typeof roleApi.isDemoQuestion==='function'&&roleApi.isDemoQuestion(bank.questions[i],bank.id))return {bank,index:i,question:bank.questions[i]};
    }
  }
  return null;
}
function qbEnsureAllowedCurrentForRole(){
  const roleApi=window.KGRolePermissions;
  if(!roleApi||typeof roleApi.canOperateQuestion!=='function')return;
  const bank=(qBankState.banks||[]).find(b=>b.id===qBankState.currentBankId)||(qBankState.banks||[])[0];
  const question=bank?.questions?.[qBankState.currentQuestionIndex];
  if(!question||(!qbIsQuestionDeleted(question)&&roleApi.canOperateQuestion(question,bank.id)))return;
  const demo=qbFindDemoBankQuestion();
  if(demo){
    qBankState.currentPaperId=null;
    qBankState.currentReleaseId=null;
    qBankState.currentPaperIndex=0;
    qBankState.currentBankId=demo.bank.id;
    qBankState.currentQuestionIndex=demo.index;
    qBankState.selectedBankId=demo.bank.id;
    qBankState.selectedQuestionId=demo.question.id;
  }
}
function qbSetCurrent(bankId,index=0){
  if(!authRequire('登录后才能设置当前训练题库。'))return;
  const bank=qbLoadBanks().find(b=>b.id===bankId),active=qbActiveQuestions(bank);if(!bank||!active.length){showStatus('该题库没有可训练题目。');return}
  qBankState.currentPaperId=null;qBankState.currentReleaseId=null;qBankState.currentPaperIndex=0;qbSaveCurrentPaper();
  const requested=bank.questions[Math.max(0,Math.min(index,bank.questions.length-1))],question=requested&&!qbIsQuestionDeleted(requested)?requested:active[0];
  qBankState.currentBankId=bank.id;qBankState.currentQuestionIndex=Math.max(0,bank.questions.findIndex(item=>item.id===question.id));qBankState.selectedBankId=bank.id;qBankState.selectedQuestionId=question.id;qbSaveCurrent();qbApplyCurrentQuestion(true);renderQuestionBankManager();if($('questionModal')?.classList.contains('show')||document.body.classList.contains('question-training-page'))renderQuestionTrainer();showStatus(`当前训练题库已切换为：${bank.name}`);
}
function qbNext(delta){
  if(!authRequire(delta>0?'登录后才能切换下一题。':'登录后才能切换上一题。','useTraining'))return;
  const roleApi=window.KGRolePermissions;
  const paper=qbCurrentPaper();
  if(paper){
    const resolved=qbResolvePublishedPaper(paper,{respectRole:true});
    if(!resolved.items.length){showStatus('当前发布试卷没有前端可用题目。');return}
    let currentPosition=resolved.items.findIndex(item=>item.paperIndex===qBankState.currentPaperIndex);
    if(currentPosition<0)currentPosition=0;
    const nextPosition=(currentPosition+delta+resolved.items.length)%resolved.items.length;
    qBankState.currentPaperIndex=resolved.items[nextPosition].paperIndex;
    qbSaveCurrentPaper();
    qbApplyPaperContext();
    qbApplyCurrentQuestion(true);
    renderQuestionTrainer();renderQuestionBankManager();
    showStatus(`${paper.name}：第 ${nextPosition+1} / ${resolved.items.length} 题`);
    return;
  }
  const bank=qbCurrentBank(),active=qbActiveQuestions(bank);if(!bank||!active.length)return;
  let currentPosition=active.findIndex(question=>bank.questions[qBankState.currentQuestionIndex]?.id===question.id);if(currentPosition<0)currentPosition=0;
  const nextPosition=(currentPosition+delta+active.length)%active.length,nextQuestion=active[nextPosition],nextIndex=bank.questions.findIndex(question=>question.id===nextQuestion.id);
  if(roleApi&&typeof roleApi.canOperateQuestion==='function'&&!roleApi.canOperateQuestion(nextQuestion,bank.id)){
    showStatus(roleApi.questionDeniedMessage?.()||'当前角色无权切换到这道题。');
    return;
  }
  qBankState.currentQuestionIndex=nextIndex;
  qBankState.selectedBankId=bank.id;qBankState.selectedQuestionId=nextQuestion.id;qbSaveCurrent();qbApplyCurrentQuestion(true);renderQuestionTrainer();renderQuestionBankManager();showStatus(`第 ${nextPosition+1} / ${active.length} 题`);
}
function openQuestionBankManager(){qbLoadBanks();renderQuestionBankManager();$('questionBankModal')?.classList.add('show')}
function closeQuestionBankManager(){$('questionBankModal')?.classList.remove('show')}
function renderQuestionBankManager(){
  const banks=qbLoadBanks(),bank=qbSelectedBank(),active=qbActiveQuestions(bank),q=qbSelectedQuestion();
  const bl=$('qbBankList'),ql=$('qbQuestionList'),detail=$('qbDetail');
  if(bl)bl.innerHTML=banks.map(b=>`<button class="qb-item ${b.id===qBankState.selectedBankId?'active':''}" data-bank-id="${escapeHTML(b.id)}"><strong>${escapeHTML(b.name)}</strong><span>${escapeHTML(b.subject||'')} · ${qbActiveQuestions(b).length} 题</span><span>${b.id===qBankState.currentBankId?'<span class="qb-badge current">当前训练</span>':''}<span class="qb-badge">${escapeHTML(b.visibility||'private')}</span></span></button>`).join('');
  if(ql)ql.innerHTML=bank&&active.length?active.map((qq,i)=>{const originalIndex=bank.questions.findIndex(item=>item.id===qq.id);return `<button class="qb-item ${qq.id===qBankState.selectedQuestionId?'active':''}" data-question-id="${escapeHTML(qq.id)}" data-question-index="${originalIndex}"><strong>${i+1}. ${escapeHTML(qq.title)}</strong><span>${escapeHTML(qq.topic||qq.domain||'未分类')} · ${escapeHTML(qq.difficulty||'')}</span><span><span class="qb-badge">线索 ${qq.clues.length}</span><span class="qb-badge">知识点 ${qq.concepts.length}</span>${bank.id===qBankState.currentBankId&&originalIndex===qBankState.currentQuestionIndex?'<span class="qb-badge current">当前题</span>':''}</span></button>`}).join(''):'<div class="qb-empty">当前题库没有可训练题目。</div>';
  if(detail)detail.innerHTML=q?qbDetailHtml(bank,q):'<div class="qb-empty">请选择一道题目查看详情。</div>';
  bl&&bl.querySelectorAll('[data-bank-id]').forEach(btn=>btn.onclick=()=>{qBankState.selectedBankId=btn.dataset.bankId;const b=qbSelectedBank();qBankState.selectedQuestionId=qbActiveQuestions(b)[0]?.id||null;renderQuestionBankManager()});
  ql&&ql.querySelectorAll('[data-question-id]').forEach(btn=>btn.onclick=()=>{qBankState.selectedQuestionId=btn.dataset.questionId;renderQuestionBankManager()});
}
function qbDetailHtml(bank,q){return `<h4>${escapeHTML(q.title)}</h4><div class="qb-meta"><span class="qb-badge">${escapeHTML(bank.name)}</span><span class="qb-badge">${escapeHTML(q.difficulty||'难度未设')}</span><span class="qb-badge">线索 ${q.clues.length}</span><span class="qb-badge">知识点 ${q.concepts.length}</span><span class="qb-badge current">答案 ${escapeHTML(q.correctAnswer||'未设')}</span></div><div class="qb-detail-section"><h5>题干</h5><p>${escapeHTML((q.stemParts||[]).map(p=>p.text||'').join(''))}</p></div><div class="qb-detail-section"><h5>选项</h5>${(q.options||[]).map(o=>`<span class="qb-option-line ${o.correct?'correct':''}"><strong>${escapeHTML(o.id)}.</strong> ${escapeHTML(o.text)} ${o.correct?'（正确）':''}</span>`).join('')}</div><div class="qb-detail-section"><h5>关键词线索</h5>${q.clues.length?'<ul>'+q.clues.map(c=>`<li><strong>${escapeHTML(c.text)}</strong> → ${escapeHTML((c.conceptIds||[]).join('、'))}<br>${escapeHTML(c.explain||'')}</li>`).join('')+'</ul>':'<p>暂无线索配置。</p>'}</div><div class="qb-detail-section"><h5>知识点</h5>${q.concepts.length?'<ul>'+q.concepts.map(c=>`<li><strong>${escapeHTML(c.title)}</strong>：${escapeHTML(c.summary||'')}</li>`).join('')+'</ul>':'<p>暂无知识点配置。</p>'}</div>`}
function qbImportJsonFile(file){
  if(!authRequire('登录后才能导入题库。'))return;
  if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{try{const raw=String(reader.result||'').replace(/^\ufeff/,'');const data=JSON.parse(raw);const bankData=Array.isArray(data.questions)?data:(data.bankName||data.name?data:null);if(!bankData)throw new Error('JSON 中未找到 questions 数组。');const errors=qbValidateBank(bankData);if(errors.length)throw new Error(errors.slice(0,5).join('\n'));const bank=qbNormalizeBank(bankData);const banks=qbLoadBanks();const oldIndex=banks.findIndex(b=>b.id===bank.id);if(oldIndex>=0)bank.id=bank.id+'-'+Date.now().toString(36);banks.push(bank);qBankState.selectedBankId=bank.id;qBankState.selectedQuestionId=qbActiveQuestions(bank)[0]?.id||null;qbSaveBanks();renderQuestionBankManager();showStatus(`已导入题库：${bank.name}，共 ${bank.questions.length} 题。`)}catch(err){alert('导入失败：\n'+(err.message||err))}};
  reader.readAsText(file,'utf-8');
}
function qbDownloadJson(filename,obj){const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},100)}
function qbExportSelectedBank(){const b=qbSelectedBank();if(!b){showStatus('请先选择题库。');return}qbDownloadJson((b.name||'题库')+'.json',b)}
function qbDownloadTemplate(){qbDownloadJson('PMP考题破案题库模板.json',qbDefaultBank())}
function bindQuestionBankManager(){
  const open=$('questionBankBtn'),close=$('closeQuestionBankBtn'),modal=$('questionBankModal'),importBtn=$('qbImportBtn'),file=$('qbImportFile'),exportBtn=$('qbExportBtn'),templateBtn=$('qbTemplateBtn');
  if(open)open.onclick=e=>{e.preventDefault();e.stopPropagation();const roleApi=window.KGRolePermissions;if(roleApi&&!authIsLoggedIn()){authOpen('请先以管理员或教师/教研账号登录后进入教师内容工作台。');return}if(roleApi&&authIsLoggedIn()&&!roleApi.can('accessQuestionBank')){showStatus('当前角色无内容工作台权限。');return}window.open('teacher-workbench.html','_blank')};if(close)close.onclick=closeQuestionBankManager;if(modal&&!modal.dataset.qbBound){modal.dataset.qbBound='1';modal.addEventListener('click',e=>{if(e.target===modal)closeQuestionBankManager()})}
  if(importBtn)importBtn.onclick=()=>{if(!authRequire('登录后才能导入题库。'))return;file&&file.click()};
  if(file)file.onchange=()=>{qbImportJsonFile(file.files&&file.files[0]);file.value=''};
  if(exportBtn)exportBtn.onclick=qbExportSelectedBank;if(templateBtn)templateBtn.onclick=qbDownloadTemplate;
  const prev=$('qPrevQuestionBtn'),next=$('qNextQuestionBtn');if(prev)prev.onclick=()=>qbNext(-1);if(next)next.onclick=()=>qbNext(1);
  const startPaper=$('qStartPaperBtn'),exitPaper=$('qExitPaperBtn'),paperSelect=$('qPaperSelect');
  if(startPaper)startPaper.onclick=()=>{const id=paperSelect&&paperSelect.value;if(id)qbStartPaper(id);else qbExitPaper()};
  if(exitPaper)exitPaper.onclick=qbExitPaper;
  if(paperSelect)paperSelect.onchange=()=>renderPaperControls();
}


function qbStartPaper(identifier){
  if(!authRequire('登录后才能开始综合试卷训练。'))return;
  qbLoadPapers();
  const token=String(identifier||'');
  const candidates=qbPublishedPapers();
  const paper=candidates.find(item=>String(item.releaseId)===token)||candidates.filter(item=>String(item.id)===token).sort((a,b)=>Number(b.version||0)-Number(a.version||0)||Number(b.publishedAt||0)-Number(a.publishedAt||0))[0]||null;
  if(!paper){showStatus('没有找到已发布试卷。');return}
  const resolved=qbResolvePublishedPaper(paper,{respectRole:true,mode:'single_deep_study'});
  if(!resolved.items.length){showStatus('这套已发布试卷没有前端可用题目，请检查题目快照、学习模式和角色权限。');return}
  qBankState.currentPaperId=paper.id;
  qBankState.currentReleaseId=paper.releaseId;
  qBankState.currentPaperIndex=resolved.items[0].paperIndex;
  qbSaveCurrentPaper();
  qbApplyPaperContext();
  qbApplyCurrentQuestion(true);
  const first=resolved.items[0];
  window.KGLearningProgress?.activate?.({paperId:paper.id,releaseId:paper.releaseId,questionId:first.question?.id||first.ref?.questionId,bankId:first.bank?.id||first.ref?.bankId,mode:'single_deep_study'},{clearTransient:true});
  renderQuestionTrainer();
  showStatus(`已开始试卷：${paper.name}${paper.availability==='superseded'?'（历史发布版本）':''}`);
}
function qbOpenPaperQuestion(paperId,questionId,bankId='',releaseId=''){
  if(!authRequire('登录后才能打开试卷中的题目。','useTraining'))return false;
  qbLoadPapers();
  const paper=qbPublishedPapers().find(item=>String(item.id)===String(paperId||'')&&(!releaseId||String(item.releaseId)===String(releaseId)));
  if(!paper){showStatus('没有找到已发布试卷。');return false}
  const index=(paper.questions||[]).findIndex(ref=>
    String(ref.questionId)===String(questionId||'')&&(!bankId||String(ref.bankId)===String(bankId))
  );
  if(index<0){showStatus('这道题已不在所选发布试卷中。');return false}
  const ref=paper.questions[index];
  const found=qbPaperQuestionByRef(ref,paper);
  if(!found.bank||!found.question){showStatus('试卷引用的题目已不存在，请重新组卷后发布。');return false}
  const roleApi=window.KGRolePermissions;
  if(roleApi&&typeof roleApi.canOperateQuestion==='function'&&!roleApi.canOperateQuestion(found.question,found.bank?.id||ref.bankId)){
    showStatus(roleApi.questionDeniedMessage?.()||'当前角色无权打开这道题。');
    return false;
  }
  qBankState.currentPaperId=paper.id;
  qBankState.currentReleaseId=paper.releaseId;
  qBankState.currentPaperIndex=index;
  qbSaveCurrentPaper();
  qbApplyPaperContext();
  qbApplyCurrentQuestion(true);
  if(typeof renderQuestionTrainer==='function'&&(document.body.classList.contains('question-training-page')||$('questionModal')?.classList.contains('show')))renderQuestionTrainer();
  showStatus(`${paper.name}：第 ${index+1} / ${paper.questions.length} 题`);
  return true;
}

function qbExitPaper(){
  if(!qBankState.currentPaperId)return;
  qBankState.currentPaperId=null;
  qBankState.currentReleaseId=null;
  qBankState.currentPaperIndex=0;
  qbSaveCurrentPaper();
  qbApplyCurrentQuestion(true);
  renderQuestionTrainer();
  showStatus('已退出综合试卷，恢复当前题库训练。');
}
function renderPaperControls(){
  const select=$('qPaperSelect'),progress=$('qPaperProgress'),exit=$('qExitPaperBtn');
  if(!select||!progress)return;
  let catalog=qbPublishedPaperCatalog({respectRole:true,mode:'single_deep_study'});
  const rawCurrent=qbCurrentPaper();
  if(rawCurrent&&rawCurrent.availability==='superseded'&&!catalog.some(entry=>String(entry.paper?.releaseId)===String(rawCurrent.releaseId))){
    const historical=qbResolvePublishedPaper(rawCurrent,{respectRole:true,mode:'single_deep_study'});
    if(historical?.paper)catalog=[historical,...catalog];
  }
  const usable=catalog.filter(entry=>entry.availableCount>0);
  const currentEntry=rawCurrent?usable.find(entry=>String(entry.paper?.id)===String(rawCurrent.id)&&String(entry.paper?.releaseId)===String(rawCurrent.releaseId)):null;
  const current=currentEntry?.paper||null;
  if(rawCurrent&&!current&&rawCurrent.availability!=='superseded'){
    qBankState.currentPaperId=null;qBankState.currentReleaseId=null;qBankState.currentPaperIndex=0;qbSaveCurrentPaper();
  }
  const selectedBefore=String(select.value||'');
  select.innerHTML='<option value="">请选择已发布试卷</option>'+usable.map(entry=>{
    const paper=entry.paper;
    const historical=paper.availability==='superseded'?' · 历史版本':'';
    return `<option value="${escapeHTML(paper.releaseId||paper.id)}">${escapeHTML(paper.name)} · v${Number(paper.version||0)}${historical}（已组 ${entry.configuredCount}/${entry.targetCount} 题，前端可用 ${entry.availableCount} 题）</option>`;
  }).join('');
  if(current)select.value=current.releaseId||current.id;
  else if(usable.some(entry=>String(entry.paper?.releaseId||entry.paper?.id)===selectedBefore))select.value=selectedBefore;
  if(current){
    const currentPosition=Math.max(0,currentEntry.items.findIndex(item=>item.paperIndex===qBankState.currentPaperIndex));
    progress.textContent=`${current.name} · v${Number(current.version||0)}${current.availability==='superseded'?'（历史发布版本）':''} · 第 ${currentPosition+1} / ${currentEntry.availableCount||0} 题 · 已组 ${currentEntry.configuredCount||0}/${currentEntry.targetCount||0}`;
    if(exit)exit.hidden=false;
  }else{
    progress.textContent=usable.length?'请选择已发布试卷':'暂无已发布试卷，请先在教师工作台的试卷管理中发布';
    if(exit)exit.hidden=true;
  }
}

function qNewMvpState(){return {found:new Set(),selected:null,submitted:false,graph:false,reasoning:{recallDone:{},ruleDone:{},trapDone:{},answerUnlocked:false,lockedAnswer:''}}}
function qEnsureReasoningState(){
  if(!qMvpState||typeof qMvpState!=='object')qMvpState=qNewMvpState();
  if(!(qMvpState.found instanceof Set))qMvpState.found=new Set(Array.isArray(qMvpState.found)?qMvpState.found:[]);
  const r=qMvpState.reasoning&&typeof qMvpState.reasoning==='object'?qMvpState.reasoning:{};
  r.recallDone=r.recallDone&&typeof r.recallDone==='object'?r.recallDone:{};
  r.ruleDone=r.ruleDone&&typeof r.ruleDone==='object'?r.ruleDone:{};
  r.trapDone=r.trapDone&&typeof r.trapDone==='object'?r.trapDone:{};
  r.answerUnlocked=!!r.answerUnlocked;
  r.lockedAnswer=String(r.lockedAnswer||'');
  qMvpState.reasoning=r;
  return r;
}
function qClueById(id){return (PMP_QUESTION_MVP.clues||[]).find(c=>String(c.id)===String(id))}
function qConceptById(id){return (PMP_QUESTION_MVP.concepts||[]).find(c=>String(c.id)===String(id))}
function qCorrectOption(){return (PMP_QUESTION_MVP.options||[]).find(o=>o.correct||String(o.id)===String(PMP_QUESTION_MVP.correctAnswer))}
function qWrongOptions(){return (PMP_QUESTION_MVP.options||[]).filter(o=>!(o.correct||String(o.id)===String(PMP_QUESTION_MVP.correctAnswer)))}
function qClueRole(clue){
  const role=String(clue?.clueRole||clue?.role||'').toLowerCase();
  if(role==='decoy'||role==='fake'||role==='trap'||role==='false')return 'decoy';
  if(role==='neutral')return 'neutral';
  const text=String(clue?.text||'');
  if(/立即|马上|直接|必须|全部|任何|不能接受/.test(text)&&String(clue?.type||'')==='action')return 'decoy';
  return 'true';
}
function qKeyPathConfig(){
  const kp=PMP_QUESTION_MVP&&PMP_QUESTION_MVP.keyPath&&typeof PMP_QUESTION_MVP.keyPath==='object'?PMP_QUESTION_MVP.keyPath:null;
  if(!kp)return null;
  const answerId=String(kp.answerId||PMP_QUESTION_MVP.correctAnswer||qCorrectOption()?.id||'');
  const conceptIds=Array.isArray(kp.conceptIds)?kp.conceptIds.map(String).filter(Boolean):[];
  return {
    label:String(kp.label||'本题最短关键路径'),
    clueIds:Array.isArray(kp.clueIds)?kp.clueIds.map(String).filter(Boolean):[],
    conceptIds,
    primaryConceptId:String(kp.primaryConceptId||conceptIds[0]||''),
    ruleConceptId:String(kp.ruleConceptId||conceptIds[conceptIds.length-1]||''),
    answerId,
    ruleText:String(kp.ruleText||'')
  };
}
function qIsKeyPathClue(id){
  const kp=qKeyPathConfig();
  return !!kp&&kp.clueIds.includes(String(id));
}
function qIsKeyPathConcept(id){
  const kp=qKeyPathConfig();
  return !!kp&&kp.conceptIds.includes(String(id));
}
function qIsKeyPathRule(id){
  const kp=qKeyPathConfig();
  return !!kp&&String(kp.ruleConceptId)===String(id);
}
function qRuleText(concept){
  const kp=qKeyPathConfig();
  if(concept&&kp&&qIsKeyPathRule(concept.id)&&kp.ruleText)return kp.ruleText;
  return String(concept?.rule||concept?.judgementRule||concept?.notes||concept?.summary||'先判断场景、时间点、角色责任，再选择最符合题意的下一步动作。');
}
function qFoundConceptIds(){
  const ids=new Set();
  qEnsureReasoningState();
  qMvpState.found.forEach(cid=>{
    const clue=qClueById(cid);
    if(clue)(clue.conceptIds||[]).forEach(id=>ids.add(id));
  });
  return[...ids];
}
function qUnlockedConceptIds(){
  const r=qEnsureReasoningState(),ids=new Set();
  (PMP_QUESTION_MVP.clues||[]).forEach(clue=>{
    if(r.recallDone[clue.id])(clue.conceptIds||[]).forEach(id=>ids.add(id));
  });
  return[...ids];
}
function qIsConceptUnlocked(id){return qUnlockedConceptIds().includes(id)}
function qRuleDoneCount(){const r=qEnsureReasoningState();return Object.keys(r.ruleDone).filter(k=>r.ruleDone[k]).length}
function qCanStartTraps(){
  const r=qEnsureReasoningState();
  const kp=qKeyPathConfig();
  if(kp&&kp.ruleConceptId)return !!r.ruleDone[kp.ruleConceptId];
  return qRuleDoneCount()>0;
}
function qAllTrapsDone(){
  const r=qEnsureReasoningState(),wrong=qWrongOptions();
  return wrong.length>0&&wrong.every(o=>r.trapDone[o.id]);
}
function qAnswerRevealed(){const r=qEnsureReasoningState();return !!r.answerUnlocked||qAllTrapsDone()}
function qCloseReasoningFloat(){const old=document.getElementById('qReasoningFloat');if(old)old.remove()}
function qPlaceReasoningFloat(box,anchor){
  const rect=anchor&&anchor.getBoundingClientRect?anchor.getBoundingClientRect():null;
  const vw=window.innerWidth||document.documentElement.clientWidth||1024;
  const vh=window.innerHeight||document.documentElement.clientHeight||768;
  const margin=24;
  const gap=14;
  const maxW=Math.max(280,vw-margin*2);
  const w=Math.min(390,Math.max(300,Math.round(vw*.82)),maxW);
  box.style.width=w+'px';
  box.style.maxWidth=maxW+'px';
  box.style.maxHeight=Math.max(260,vh-margin*2)+'px';

  let left=rect?rect.right+gap:Math.max(margin,(vw-w)/2);
  if(rect&&left+w+margin>vw){
    const leftSide=rect.left-w-gap;
    left=leftSide>=margin?leftSide:Math.max(margin,Math.min(vw-w-margin,(vw-w)/2));
  }
  if(left+w+margin>vw)left=vw-w-margin;
  if(left<margin)left=margin;

  let top=rect?rect.top:Math.max(margin,(vh-360)/2);
  box.style.left=left+'px';
  box.style.top=top+'px';
  const measured=box.getBoundingClientRect();
  const h=Math.min(measured.height,Math.max(260,vh-margin*2));
  if(top+h+margin>vh)top=vh-h-margin;
  if(top<margin)top=margin;
  box.style.left=Math.round(left)+'px';
  box.style.top=Math.round(top)+'px';
}
function qRenderReasoningFloat(anchor,config){
  const anchorKey=anchor&&anchor.dataset?`${anchor.dataset.kind||''}:${anchor.dataset.id||''}`:'';
  const current=document.getElementById('qReasoningFloat');
  if(current&&anchorKey&&current.dataset.anchorKey===anchorKey){current.remove();return}
  qCloseReasoningFloat();
  const box=document.createElement('div');
  box.id='qReasoningFloat';
  box.className='q-reason-float';
  if(anchorKey)box.dataset.anchorKey=anchorKey;
  const choices=Array.isArray(config.choices)?config.choices:[];
  box.innerHTML=`<div class="q-reason-head"><div><strong>${escapeHTML(config.title||'破案引导')}</strong>${config.subtitle?`<span>${escapeHTML(config.subtitle)}</span>`:''}</div><button type="button" class="q-reason-close" title="关闭" aria-label="关闭"><span aria-hidden="true"></span></button></div><div class="q-reason-body">${config.body||''}</div>${choices.length?`<div class="q-reason-choices">${choices.map((c,i)=>`<button type="button" data-choice="${i}">${escapeHTML(c.text||c)}</button>`).join('')}</div>`:''}<div class="q-reason-feedback" aria-live="polite"></div>`;
  document.body.appendChild(box);
  qPlaceReasoningFloat(box,anchor);
  box.querySelector('.q-reason-close').onclick=qCloseReasoningFloat;
  choices.forEach((choice,i)=>{
    const btn=box.querySelector(`[data-choice="${i}"]`);
    if(!btn)return;
    btn.onclick=()=>{
      if(choice.correct){
        if(typeof config.onCorrect==='function')config.onCorrect(choice,i);
      }else{
        btn.classList.add('wrong');
        const fb=box.querySelector('.q-reason-feedback');
        if(fb)fb.textContent=choice.feedback||'这一步还没有抓住题干约束，再换一个角度想想。';
      }
    };
  });
}
function qGuideBodyLead(text){return `<p class="q-guide-lead">${escapeHTML(text)}</p>`}
function qGoQuestionButton(){return `<button type="button" class="q-guide-inline-btn" id="qGuideGoQuestionBtn">回到题目栏寻找</button>`}
function qOpenKeywordGuide(clue,anchor){
  const r=qEnsureReasoningState();
  if(!qMvpState.found.has(clue.id)){
    qRenderReasoningFloat(anchor,{title:'还没发现这个关键词',subtitle:'问号节点',body:qGuideBodyLead('这个信息按钮当前还是隐藏状态。请先在“题目”栏点击对应关键词，图谱中才会显示内容。')+qGoQuestionButton()});
    const go=document.getElementById('qGuideGoQuestionBtn');if(go)go.onclick=()=>{qCloseReasoningFloat();qSetCaseTab('question')};
    return;
  }
  const related=(clue.conceptIds||[]).map(qConceptById).filter(Boolean);
  const role=qClueRole(clue);
  if(r.recallDone[clue.id]){
    const label=role==='decoy'?'已识别为可疑诱导信息':'已完成知识点回忆';
    qRenderReasoningFloat(anchor,{title:clue.text,subtitle:label,body:qGuideBodyLead(clue.explain||'这条关键词已经完成第一步判断。')+(related.length?`<div class="q-guide-mini"><strong>已连接：</strong>${related.map(c=>escapeHTML(c.title)).join('、')}</div>`:'')});
    return;
  }
  if(role==='decoy'){
    qRenderReasoningFloat(anchor,{title:'识别假线索 / 诱导动作',subtitle:clue.text,body:qGuideBodyLead(`“${clue.text}”看起来像行动线索，但它可能在诱导你跳过关键判断。它最可疑的地方是什么？`),choices:[
      {text:'它跳过了价值评估、优先级排序或当前迭代承诺保护。',correct:true},
      {text:'客户没有权利提出任何新需求。',feedback:'敏捷并不是拒绝变化，关键是变化如何进入排序与协作机制。'},
      {text:'敏捷项目必须全部走变更控制委员会。',feedback:'这是预测型流程的常见误用，要先看题目环境。'},
      {text:'团队只要加班就能解决。',feedback:'PMP 题目通常不鼓励把系统性冲突简化成加班。'}
    ],onCorrect:()=>{r.recallDone[clue.id]=true;qCloseReasoningFloat();renderQuestionTrainer();qSetCaseTab('graph');showStatus('已识别一条可疑线索，相关知识点已解锁。')}});
    return;
  }
  const correctText=related.length?related.map(c=>c.title).join(' / '):'题干约束对应的核心知识点';
  const otherConcepts=(PMP_QUESTION_MVP.concepts||[]).filter(c=>!related.some(x=>x.id===c.id)).slice(0,2).map(c=>({text:c.title,feedback:'这个知识点可能相关，但不是这条关键词最直接指向的内容。'}));
  qRenderReasoningFloat(anchor,{title:'回忆知识点',subtitle:clue.text,body:qGuideBodyLead(`看到“${clue.text}”，你应该优先回忆哪个知识点或原则？`),choices:[
    {text:correctText,correct:true},
    ...otherConcepts,
    {text:'立即执行客户提出的动作',feedback:'先别急着执行动作，PMP 更看重场景约束和角色责任。'},
    {text:'无条件拒绝所有变更',feedback:'敏捷欢迎变化，但要通过合适机制管理变化。'}
  ].slice(0,4),onCorrect:()=>{r.recallDone[clue.id]=true;qCloseReasoningFloat();renderQuestionTrainer();qSetCaseTab('graph');showStatus('知识点已回忆成功，下一步可以点击知识点提炼判断规则。')}});
}
function qOpenConceptGuide(concept,anchor){
  const r=qEnsureReasoningState();
  const kp=qKeyPathConfig();
  const isKeyRule=qIsKeyPathRule(concept.id);
  if(!qIsConceptUnlocked(concept.id)){
    qRenderReasoningFloat(anchor,{title:'知识点尚未解锁',subtitle:'问号节点',body:qGuideBodyLead('先点击已发现的关键词，并完成“回忆知识点”引导，这个知识点才会显示出来。')});
    return;
  }
  if(r.ruleDone[concept.id]){
    qRenderReasoningFloat(anchor,{title:concept.title,subtitle:isKeyRule?'关键判断规则已提炼':'辅助判断规则已提炼',body:qGuideBodyLead(qRuleText(concept))+(isKeyRule?'<div class="q-guide-mini"><strong>提示：</strong>这条规则就是本题最短锁定路径，可以直接到“锁定答案”行判断选项。</div>':'<div class="q-guide-mini"><strong>提示：</strong>这条规则有助于理解题干，但不是本题最短锁定路径；真正能直达答案的规则会在锁定后高亮。</div>')});
    return;
  }
  qRenderReasoningFloat(anchor,{title:'提炼判断规则',subtitle:concept.title,body:qGuideBodyLead(`基于“${concept.title}”，这道题更应该提炼出哪条判断规则？`),choices:[
    {text:qRuleText(concept),correct:true},
    {text:'只要客户提出高价值需求，就应立即加入当前迭代。',feedback:'高价值不等于立即插入，还要看迭代承诺、排序与角色责任。'},
    {text:'敏捷项目不能接受任何变化。',feedback:'敏捷欢迎变化，但变化需要被管理，而不是被简单拒绝。'},
    {text:'所有新需求都必须提交变更控制委员会审批。',feedback:'题目是敏捷场景，不能机械套用 CCB。'}
  ],onCorrect:()=>{
    r.ruleDone[concept.id]=true;
    qCloseReasoningFloat();
    renderQuestionTrainer();
    qSetCaseTab('graph');
    showStatus(isKeyRule?'关键判断规律已提炼：现在可以直接尝试锁定答案。':'辅助判断规律已记录；继续寻找能直接指向答案角色或行动的关键路径。');
  }});
}
function qLockAnswer(option,anchor){
  const r=qEnsureReasoningState();
  r.answerUnlocked=true;
  r.lockedAnswer=String(option?.id||qCorrectOption()?.id||PMP_QUESTION_MVP.correctAnswer||'');
  if(option?.correct||String(option?.id)===String(PMP_QUESTION_MVP.correctAnswer))qMvpState.selected=option.id;
  qCloseReasoningFloat();
  renderQuestionTrainer();
  qSetCaseTab('graph');
  const correct=qCorrectOption();
  const nextAnchor=document.querySelector(`#qGraph .q-map-node[data-kind="answer"][data-id="${qCssAttrValue(r.lockedAnswer)}"]`)||anchor;
  qRenderReasoningFloat(nextAnchor,{title:'已锁定答案',subtitle:correct?`答案 ${correct.id}`:'最终判断',body:correct?`<div class="q-option-reminder correct"><strong>${escapeHTML(correct.id)}.</strong><span>${escapeHTML(correct.text)}</span></div>`+qGuideBodyLead('关键路径已经高亮：从核心关键词到知识点，再到判断规则，最后连接到答案。'):qGuideBodyLead('答案已锁定，关键路径已经高亮。')});
  showStatus('答案已锁定，关键推理路径已高亮显示。');
}
function qOpenTrapGuide(option,anchor){
  const r=qEnsureReasoningState();
  const correct=option?.correct||String(option?.id)===String(PMP_QUESTION_MVP.correctAnswer);
  const optionHtml=`<div class="q-option-reminder"><strong>${escapeHTML(option.id)}.</strong><span>${escapeHTML(option.text)}</span></div>`;
  if(!qCanStartTraps()){
    qRenderReasoningFloat(anchor,{title:'答案锁定尚未开始',subtitle:`选项 ${option.id}`,body:optionHtml+qGuideBodyLead(qKeyPathConfig()?'请先找到本题最短关键路径上的判断规则，再用这条规则判断选项。辅助规则可以帮你理解题干，但还不能直接锁定答案。':'请先完成至少一个“提炼判断规则”节点，再用这条规则判断选项。')});
    return;
  }
  if(r.answerUnlocked){
    const locked=String(r.lockedAnswer||qCorrectOption()?.id||PMP_QUESTION_MVP.correctAnswer||'');
    const isLocked=String(option.id)===locked;
    qRenderReasoningFloat(anchor,{title:isLocked?'已锁定的答案':'已完成判断',subtitle:`选项 ${option.id}`,body:optionHtml+qGuideBodyLead(isLocked?'这就是当前关键路径锁定的答案。图谱中的高亮线展示了从关键词到答案的主线。':(r.trapDone[option.id]?(option.trap||'这个选项已经被排除。'):'答案已锁定；这不是当前关键路径的终点。'))});
    return;
  }
  if(r.trapDone[option.id]){
    qRenderReasoningFloat(anchor,{title:`已排除 ${option.id} 项`,subtitle:'锁定答案行',body:optionHtml+qGuideBodyLead(option.trap||'这个选项已经完成排除；你可以继续点击其他选项，尝试直接锁定答案。')});
    return;
  }
  const lockText='锁定它：它承接了核心关键词和判断规则，是最合理的下一步。';
  const rejectText=`排除它：${option.trap||'它没有匹配题干关键约束，容易把人带向表面动作。'}`;
  const choices=correct?[
    {text:lockText,correct:true},
    {text:rejectText,feedback:'再对照刚才提炼的判断规则：这个选项是否正好体现了应该采取的下一步？'},
    {text:'先回到题目重新找关键词。',feedback:'可以回看题目，但现在已经有判断规则，可以尝试用规则直接判断。'}
  ]:[
    {text:lockText,feedback:'它看起来像可行动作，但没有真正承接刚才的判断规则。再看选项原文和陷阱点。'},
    {text:rejectText,correct:true},
    {text:'仅凭选项文字长短判断。',feedback:'选项长短不是依据，要用关键词和判断规则。'}
  ];
  qRenderReasoningFloat(anchor,{title:'判断选项',subtitle:`选项 ${option.id}`,body:optionHtml+qGuideBodyLead('不要先猜答案。请把这项放回刚才提炼出的判断规则里，判断它应该被锁定，还是被排除。'),choices,onCorrect:()=>{
    if(correct)qLockAnswer(option,anchor);
    else{r.trapDone[option.id]=true;if(qAllTrapsDone()){const co=qCorrectOption();r.answerUnlocked=true;r.lockedAnswer=String(co?.id||PMP_QUESTION_MVP.correctAnswer||'')}qCloseReasoningFloat();renderQuestionTrainer();qSetCaseTab('graph');showStatus(qAnswerRevealed()?'干扰项已排除完毕，答案已自动锁定并高亮关键路径。':`已排除 ${option.id} 项；如果主线已经清晰，可以直接尝试锁定答案。`)}
  }});
}
function qOpenAnswerGuide(anchor){
  const r=qEnsureReasoningState();
  const correct=qCorrectOption();
  if(!qCanStartTraps()){
    qRenderReasoningFloat(anchor,{title:'答案仍被锁定',subtitle:'最后一步',body:qGuideBodyLead(qKeyPathConfig()?'请先找到本题最短关键路径上的判断规则，再点击 A/B/C/D 判断。不是所有规则都能直接锁定答案。':'请先完成至少一个“提炼判断规则”节点，再点击 A/B/C/D 进行判断。')});
    return;
  }
  if(r.answerUnlocked){
    qRenderReasoningFloat(anchor,{title:'已锁定答案',subtitle:correct?`答案 ${correct.id}`:'最终判断',body:correct?`<div class="q-option-reminder correct"><strong>${escapeHTML(correct.id)}.</strong><span>${escapeHTML(correct.text)}</span></div>`+qGuideBodyLead('关键路径已经高亮显示。'):qGuideBodyLead('答案已锁定，关键路径已经高亮显示。')});
    return;
  }
  qRenderReasoningFloat(anchor,{title:'选择一个选项节点',subtitle:'锁定答案行',body:qGuideBodyLead('请直接点击下方 A/B/C/D 按钮，用你提炼出的判断规则判断：这个选项应该锁定，还是排除。')});
}
let qActiveCaseTab='question';
function qSetCaseTab(tab){
  const valid=new Set(['question','graph','notes']);
  qActiveCaseTab=valid.has(tab)?tab:'question';
  if(qActiveCaseTab!=='graph')qCloseReasoningFloat();
  document.querySelectorAll('#questionModal .q-tab').forEach(btn=>{
    const active=btn.dataset.qTab===qActiveCaseTab;
    btn.classList.toggle('active',active);
    btn.setAttribute('aria-selected',active?'true':'false');
    btn.tabIndex=active?0:-1;
  });
  document.querySelectorAll('#questionModal .q-tab-panel').forEach(panel=>{
    const active=panel.dataset.qTabPanel===qActiveCaseTab;
    panel.classList.toggle('active',active);
    panel.hidden=!active;
  });
}
function bindQuestionCaseTabs(){
  document.querySelectorAll('#questionModal .q-tab').forEach(btn=>{
    if(btn.dataset.qTabBound)return;
    btn.dataset.qTabBound='1';
    btn.addEventListener('click',()=>qSetCaseTab(btn.dataset.qTab));
    btn.addEventListener('keydown',e=>{
      if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight'&&e.key!=='Home'&&e.key!=='End')return;
      const tabs=[...document.querySelectorAll('#questionModal .q-tab')];
      const cur=tabs.indexOf(btn);
      let next=cur;
      if(e.key==='ArrowRight')next=(cur+1)%tabs.length;
      if(e.key==='ArrowLeft')next=(cur-1+tabs.length)%tabs.length;
      if(e.key==='Home')next=0;
      if(e.key==='End')next=tabs.length-1;
      e.preventDefault();
      tabs[next].focus();
      qSetCaseTab(tabs[next].dataset.qTab);
    });
  });
  qSetCaseTab(qActiveCaseTab);
}
function openQuestionTrainer(){
  if(!document.body.classList.contains('question-training-page')){window.open('practice-mode.html','_blank');return}
  if(typeof qbLoadBanks==='function')qbLoadBanks();if(typeof qbLoadPapers==='function'){qBankState.papers=null;qbLoadPapers();}if(typeof qbApplyCurrentQuestion==='function')qbApplyCurrentQuestion(false);
  const m=$('questionModal');
  if(!m)return;
  m.classList.add('show');
  qEnsureReasoningState();
  if(typeof initQuestionFontSize==='function')initQuestionFontSize();
  if(typeof ensureQuestionFontScale==='function')ensureQuestionFontScale();
  bindQuestionCaseTabs();
  renderQuestionTrainer();
  qSetCaseTab(qActiveCaseTab||'question');
}
function closeQuestionTrainer(){
  qCloseReasoningFloat();
  if(document.body.classList.contains('question-training-page')){window.location.href='learning-path.html';return}
  const m=$('questionModal');
  if(m)m.classList.remove('show');
}
function resetQuestionTrainer(){
  if(!qCanOperateCurrentQuestion('当前角色不能重置这道题。'))return;
  qCloseReasoningFloat();
  qMvpState=qNewMvpState();
  if(window.KGFlowOrchestrator&&typeof window.KGFlowOrchestrator.resetCurrentSession==='function'){
    window.KGFlowOrchestrator.resetCurrentSession();
  }
  qActiveCaseTab='question';
  renderQuestionTrainer();
  qSetCaseTab('question');
}
function qDisplayView(){
  try{return window.KGFreeModeLanguage?.questionView?.(PMP_QUESTION_MVP,window.KGFreeModeLanguage?.mode?.()||'zh')||null}catch(e){return null}
}
function qEnglishLine(pair){return window.KGFreeModeLanguage?.mode?.()==='bilingual'&&pair?.hasEnglish?`<span class="qt-bilingual-en">${escapeHTML(pair.en)}</span>`:''}
function renderQuestionTrainer(){
  qEnsureReasoningState();
  const answerCardMounted=!!(window.KGCardRuntime&&window.KGCardRuntime.isMounted&&window.KGCardRuntime.isMounted('answer-card'));
  if(answerCardMounted){
    window.KGCardRuntime.update('answer-card','legacy-render');
  }else{
    const head=$('qQuestionHeading');if(head){const view=qDisplayView();head.innerHTML=`题目：${escapeHTML(view?.title?.zh||PMP_QUESTION_MVP.title||'未命名题目')}${qEnglishLine(view?.title)}`;}
    renderQStem();
    renderQOptions();
  }
  renderQClues();
  renderQConcepts();
  renderQScore();
  renderQGraph();
  renderQDetectiveNotes();
  renderQReview();
  if(typeof renderPaperControls==='function')renderPaperControls();
  qSetCaseTab(qActiveCaseTab||'question');
}
function renderQStem(){
  const el=$('qStem');if(!el)return;
  qEnsureReasoningState();
  const view=qDisplayView();
  el.innerHTML=(PMP_QUESTION_MVP.stemParts||[]).map(p=>{
    if(!p.clue)return escapeHTML(p.text);
    return `<span class="q-clue${qMvpState.found.has(p.clue)?' found':''}" data-clue-id="${escapeHTML(p.clue)}" title="点击高亮 / 再次点击取消">${escapeHTML(p.text)}</span>`;
  }).join('')+qEnglishLine(view?.stem);
  el.querySelectorAll('.q-clue').forEach(s=>s.onclick=()=>{
    if(!qCanOperateCurrentQuestion('当前角色不能操作这道题的关键词。'))return;
    const id=s.dataset.clueId;
    if(qMvpState.found.has(id))qMvpState.found.delete(id);
    else qMvpState.found.add(id);
    renderQuestionTrainer();
  });
}
function renderQOptions(){
  const el=$('qOptions');if(!el)return;
  const view=qDisplayView(),displayById=new Map((view?.options||[]).map(item=>[String(item.id),item.display]));
  el.innerHTML=(PMP_QUESTION_MVP.options||[]).map(o=>{
    let cls='q-option';
    if(qMvpState.selected===o.id)cls+=' selected';
    if(qMvpState.submitted){
      if(o.correct)cls+=' correct';
      else if(qMvpState.selected===o.id)cls+=' wrong';
    }
    const pair=displayById.get(String(o.id));
    return `<button class="${cls}" data-option-id="${escapeHTML(o.id)}"><strong>${escapeHTML(o.id)}.</strong> ${escapeHTML(pair?.zh||o.text)}${qEnglishLine(pair)}</button>`;
  }).join('');
  el.querySelectorAll('.q-option').forEach(b=>b.onclick=()=>{
    if(!qCanOperateCurrentQuestion('当前角色不能选择这道题的答案。'))return;
    if(qMvpState.submitted)return;
    qMvpState.selected=b.dataset.optionId;
    renderQuestionTrainer();
  });
}
function renderQClues(){
  const el=$('qClues');if(!el)return;
  qEnsureReasoningState();
  const total=(PMP_QUESTION_MVP.clues||[]).length||1;
  const found=[...qMvpState.found].map(qClueById).filter(Boolean);
  const pct=Math.round(found.length/total*100);
  const decoys=found.filter(c=>qClueRole(c)==='decoy').length;
  if(!found.length){
    el.innerHTML=`<div class="q-evidence-empty"><strong>尚未锁定关键词</strong><span>线索进度 0/${total}</span></div>`;
    return;
  }
  el.innerHTML=`<div class="q-evidence-progress"><span>线索进度</span><strong>${found.length}/${total}</strong><em style="--q-progress:${pct}%"></em>${decoys?`<small>可疑线索 ${decoys}</small>`:''}</div><div class="q-evidence-keywords">${found.map(c=>`<span class="q-chip ${escapeHTML(c.type)}">${escapeHTML(c.text)}</span>`).join('')}</div>`;
}
function renderQConcepts(){
  const el=$('qConcepts');if(!el)return;
  const cs=qUnlockedConceptIds().map(qConceptById).filter(Boolean);
  el.innerHTML=`<h4 class="q-notes-title">关联知识点</h4>`+(cs.length?cs.map(c=>`<div class="q-concept"><strong>${escapeHTML(c.title)}</strong><p>${escapeHTML(c.summary)}</p>${c.notes?`<p class="q-concept-note">破案提醒：${escapeHTML(c.notes)}</p>`:''}</div>`).join(''):'<div class="q-concept"><strong>等待线索</strong><p>完成推理图谱中的关键词回忆后，这里会显示对应知识点和破案提醒。</p></div>');
}
function renderQScore(){
  const el=$('qScore');if(!el)return;
  qEnsureReasoningState();
  const f=qMvpState.found.size,t=(PMP_QUESTION_MVP.clues||[]).length||1,c=qUnlockedConceptIds().length,ct=(PMP_QUESTION_MVP.concepts||[]).length||1;
  const a=qMvpState.submitted?(qMvpState.selected===PMP_QUESTION_MVP.correctAnswer?'正确':'待修正'):(qMvpState.selected?`已选 ${qMvpState.selected}`:'未作答');
  const steps=Object.keys(qMvpState.reasoning.ruleDone).filter(k=>qMvpState.reasoning.ruleDone[k]).length+Object.keys(qMvpState.reasoning.trapDone).filter(k=>qMvpState.reasoning.trapDone[k]).length+(qAnswerRevealed()?1:0);
  const m=Math.max(0,Math.min(100,Math.round((f/t*.35+c/ct*.25+Math.min(1,steps/6)*.40)*100)));
  el.innerHTML=`<div>关键词<strong>${f}/${t}</strong></div><div>解锁<strong>${c}/${ct}</strong></div><div>答案<strong>${escapeHTML(a)}</strong></div><div>掌握度<strong>${m}%</strong></div>`;
}
function qStrongPathConceptIds(){
  const kp=qKeyPathConfig();
  if(kp&&kp.conceptIds.length)return kp.conceptIds.slice();
  const r=qEnsureReasoningState();
  const ids=new Set(Object.keys(r.ruleDone).filter(k=>r.ruleDone[k]));
  if(!ids.size){
    (PMP_QUESTION_MVP.clues||[]).forEach(clue=>{
      if(r.recallDone[clue.id]&&qClueRole(clue)!=='decoy')(clue.conceptIds||[]).forEach(id=>ids.add(id));
    });
  }
  return[...ids];
}
function qStrongPathRuleConceptId(){
  const kp=qKeyPathConfig();
  if(kp&&kp.ruleConceptId)return kp.ruleConceptId;
  const ids=qStrongPathConceptIds();
  return ids[ids.length-1]||'';
}
function qIsStrongPathClue(clue){
  if(!qAnswerRevealed()||qClueRole(clue)==='decoy')return false;
  const kp=qKeyPathConfig();
  const r=qEnsureReasoningState();
  if(kp&&kp.clueIds.length)return kp.clueIds.includes(String(clue.id))&&!!r.recallDone[clue.id];
  const conceptIds=qStrongPathConceptIds();
  return !!r.recallDone[clue.id]&&(clue.conceptIds||[]).some(id=>conceptIds.includes(id));
}
function qIsStrongPathConcept(id){return qAnswerRevealed()&&qStrongPathConceptIds().includes(String(id))}
function qIsStrongPathRule(id){return qAnswerRevealed()&&String(qStrongPathRuleConceptId())===String(id)}
function qGraphNode(kind,id,label,revealed,done,extra=''){
  const text=revealed?label:'?';
  return `<button type="button" class="q-map-node ${escapeHTML(kind)} ${revealed?'revealed':'locked'} ${done?'done':''} ${extra}" data-kind="${escapeHTML(kind)}" data-id="${escapeHTML(id)}" title="${revealed?escapeHTML(label):'尚未解锁'}"><span>${escapeHTML(text)}</span>${done?'<em>✓</em>':''}</button>`;
}
function qAnswerOptionNode(option){
  const r=qEnsureReasoningState();
  const canJudge=qCanStartTraps();
  const locked=qAnswerRevealed();
  const lockedId=String(r.lockedAnswer||qCorrectOption()?.id||PMP_QUESTION_MVP.correctAnswer||'');
  const isLocked=locked&&String(option.id)===lockedId;
  const rejected=!isLocked&&!!r.trapDone[option.id];
  const revealed=canJudge||locked||rejected;
  const label=!revealed?'?':(isLocked?`锁定 ${option.id}`:(rejected?`排除 ${option.id}`:`选项 ${option.id}`));
  const extra=[
    'answer-choice',
    isLocked?'path-node path-final':'',
    rejected?'rejected':'',
    locked&&!isLocked&&!rejected?'muted-after-lock':''
  ].filter(Boolean).join(' ');
  return `<button type="button" class="q-map-node answer ${revealed?'revealed':'locked'} ${isLocked||rejected?'done':''} ${extra}" data-kind="answer" data-id="${escapeHTML(option.id)}" title="${revealed?escapeHTML(label):'先提炼判断规则'}"><span>${escapeHTML(label)}</span>${isLocked?'<em>✓</em>':(rejected?'<em>×</em>':'')}</button>`;
}
function qCssAttrValue(value){return (window.CSS&&window.CSS.escape)?window.CSS.escape(String(value)):String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"')}
function qDrawKeyPathLines(){
  const board=document.querySelector('#qGraph .q-logic-board');
  if(!board||!qAnswerRevealed())return;
  const svg=board.querySelector('.q-path-svg');
  if(!svg)return;
  const r=qEnsureReasoningState();
  const kp=qKeyPathConfig();
  const answerId=String((kp&&kp.answerId)||r.lockedAnswer||qCorrectOption()?.id||PMP_QUESTION_MVP.correctAnswer||'');
  const answerNode=board.querySelector(`.q-map-node[data-kind="answer"][data-id="${qCssAttrValue(answerId)}"]`);
  const boardRect=board.getBoundingClientRect();
  const center=(node)=>{const rect=node.getBoundingClientRect();return{x:rect.left-boardRect.left+rect.width/2,y:rect.top-boardRect.top+rect.height/2}};
  const line=(a,b)=>{
    if(!a||!b)return '';
    const p1=center(a),p2=center(b),mid=(p1.y+p2.y)/2;
    return `<path class="q-path-line" d="M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} C ${p1.x.toFixed(1)} ${mid.toFixed(1)}, ${p2.x.toFixed(1)} ${mid.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}" />`;
  };
  let lines='';
  if(kp&&kp.clueIds.length&&kp.conceptIds.length){
    const clueNode=board.querySelector(`.q-map-node[data-kind="keyword"][data-id="${qCssAttrValue(kp.clueIds[0])}"]`);
    let prev=clueNode;
    kp.conceptIds.forEach(cid=>{
      const conceptNode=board.querySelector(`.q-map-node[data-kind="concept"][data-id="${qCssAttrValue(cid)}"]`);
      lines+=line(prev,conceptNode);
      if(conceptNode)prev=conceptNode;
    });
    const ruleNode=board.querySelector(`.q-map-node[data-kind="rule"][data-id="${qCssAttrValue(kp.ruleConceptId||kp.conceptIds[kp.conceptIds.length-1])}"]`);
    lines+=line(prev,ruleNode);
    lines+=line(ruleNode,answerNode);
  }else{
    const conceptIds=qStrongPathConceptIds();
    (PMP_QUESTION_MVP.clues||[]).forEach(clue=>{
      if(!qIsStrongPathClue(clue))return;
      const clueNode=board.querySelector(`.q-map-node[data-kind="keyword"][data-id="${qCssAttrValue(clue.id)}"]`);
      (clue.conceptIds||[]).filter(id=>conceptIds.includes(id)).forEach(cid=>{
        const conceptNode=board.querySelector(`.q-map-node[data-kind="concept"][data-id="${qCssAttrValue(cid)}"]`);
        const ruleNode=board.querySelector(`.q-map-node[data-kind="rule"][data-id="${qCssAttrValue(cid)}"]`);
        lines+=line(clueNode,conceptNode);
        lines+=line(conceptNode,ruleNode);
        lines+=line(ruleNode,answerNode);
      });
    });
  }
  svg.setAttribute('viewBox',`0 0 ${Math.max(1,board.scrollWidth)} ${Math.max(1,board.scrollHeight)}`);
  svg.innerHTML=`<defs><marker id="qPathArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" class="q-path-arrow-head"></path></marker></defs>${lines}`;
}
function renderQGraph(){
  const el=$('qGraph');if(!el)return;
  qEnsureReasoningState();
  if(!qMvpState.graph){
    el.innerHTML='<div class="q-graph-placeholder">进入第 3 步后，这里会以“关键词 → 回忆知识点 → 提炼判断规则 → 锁定答案”的顺序逐步解锁。</div>';
    return;
  }
  const r=qMvpState.reasoning;
  const clues=(PMP_QUESTION_MVP.clues||[]);
  const concepts=(PMP_QUESTION_MVP.concepts||[]);
  const options=(PMP_QUESTION_MVP.options||[]);
  const keywordNodes=clues.map(c=>qGraphNode('keyword',c.id,c.text,qMvpState.found.has(c.id),!!r.recallDone[c.id],`${r.recallDone[c.id]&&qClueRole(c)==='decoy'?'decoy-done':''} ${qIsStrongPathClue(c)?'path-node':''}`)).join('');
  const conceptNodes=concepts.map(c=>qGraphNode('concept',c.id,c.title,qIsConceptUnlocked(c.id),!!r.ruleDone[c.id],qIsStrongPathConcept(c.id)?'path-node':'')).join('');
  const ruleNodes=concepts.map(c=>qGraphNode('rule',c.id,qRuleText(c),qIsConceptUnlocked(c.id)&&!!r.ruleDone[c.id],!!r.ruleDone[c.id],qIsStrongPathRule(c.id)?'path-node':'')).join('');
  const answerNodes=options.length?options.map(qAnswerOptionNode).join(''):qGraphNode('answer','answer',PMP_QUESTION_MVP.correctAnswer||'最终答案',qAnswerRevealed(),qAnswerRevealed(),qAnswerRevealed()?'path-node path-final':'');
  el.innerHTML=`<div class="q-logic-board ${qAnswerRevealed()?'path-active':''}"><svg class="q-path-svg" aria-hidden="true"></svg><section class="q-logic-stage"><div class="q-stage-title"><b>1</b><span>关键词</span><em>从题干中发现信息；未发现前显示问号。</em></div><div class="q-stage-nodes">${keywordNodes||'<div class="q-empty">暂无关键词配置</div>'}</div></section><div class="q-stage-arrow">↓</div><section class="q-logic-stage"><div class="q-stage-title"><b>2</b><span>回忆知识点</span><em>点击关键词，通过提问把知识点想起来。</em></div><div class="q-stage-nodes">${conceptNodes||'<div class="q-empty">暂无知识点配置</div>'}</div></section><div class="q-stage-arrow">↓</div><section class="q-logic-stage"><div class="q-stage-title"><b>3</b><span>提炼判断规则</span><em>不是直接给规则，而是用问题引导你自己判断。</em></div><div class="q-stage-nodes">${ruleNodes||'<div class="q-empty">暂无规则配置</div>'}</div></section><div class="q-stage-arrow">↓</div><section class="q-logic-stage q-answer-stage"><div class="q-stage-title"><b>4</b><span>锁定答案</span><em>不单独暴露干扰项；点击 A/B/C/D，用判断规则锁定或排除。</em></div><div class="q-stage-nodes q-answer-nodes">${answerNodes}</div></section></div>`;
  el.querySelectorAll('.q-map-node').forEach(btn=>btn.onclick=e=>{
    e.preventDefault();e.stopPropagation();
    if(!qCanOperateCurrentQuestion('当前角色不能操作这道题的推理节点。'))return;
    const kind=btn.dataset.kind,id=btn.dataset.id;
    if(kind==='keyword'){const clue=qClueById(id);if(clue)qOpenKeywordGuide(clue,btn)}
    if(kind==='concept'||kind==='rule'){const concept=qConceptById(id);if(concept)qOpenConceptGuide(concept,btn)}
    if(kind==='answer'){
      const option=(PMP_QUESTION_MVP.options||[]).find(o=>String(o.id)===String(id));
      if(option)qOpenTrapGuide(option,btn);else qOpenAnswerGuide(btn);
    }
  });
  if(qAnswerRevealed())setTimeout(qDrawKeyPathLines,30);
}
function renderQDetectiveNotes(){
  const el=$('qDetectiveNotes');if(!el)return;
  const found=[...qMvpState.found].map(qClueById).filter(Boolean);
  const missed=(PMP_QUESTION_MVP.clues||[]).filter(c=>!qMvpState.found.has(c.id));
  const concepts=qFoundConceptIds().map(qConceptById).filter(Boolean);
  const correct=(PMP_QUESTION_MVP.options||[]).find(o=>o.correct||String(o.id)===String(PMP_QUESTION_MVP.correctAnswer));
  const selected=(PMP_QUESTION_MVP.options||[]).find(o=>String(o.id)===String(qMvpState.selected));
  const chain=found.map(c=>{
    const targets=(c.conceptIds||[]).map(qConceptById).filter(Boolean).map(x=>x.title);
    return `<li><strong>${escapeHTML(c.text)}</strong><span>${escapeHTML(c.explain||'')}</span><em>关联：${targets.length?targets.map(escapeHTML).join('、'):'待补充知识点'}</em></li>`;
  }).join('');
  const trapRows=(PMP_QUESTION_MVP.options||[]).map(o=>{
    const cls=o.correct?'correct':(qMvpState.selected===o.id&&!o.correct?'selected wrong':'');
    const reason=o.correct?'正确答案路径':(o.trap||'需要结合题干关键词排除');
    return `<li class="${cls}"><strong>${escapeHTML(o.id)}.</strong><span>${escapeHTML(reason)}</span></li>`;
  }).join('');
  el.innerHTML=`<div class="q-notes-grid"><article class="q-note-card"><h4>案情进度</h4><p>已锁定 <strong>${found.length}</strong> / ${(PMP_QUESTION_MVP.clues||[]).length} 个关键词，连接 <strong>${concepts.length}</strong> 个知识点。</p><p>当前答案：<strong>${escapeHTML(qMvpState.selected||'未选择')}</strong>${qMvpState.submitted?` · ${qMvpState.selected===PMP_QUESTION_MVP.correctAnswer?'判断正确':'需要复盘'}`:''}</p></article><article class="q-note-card"><h4>破案策略</h4><ol><li>先识别场景与方法论。</li><li>再找时间点、角色、约束和诱导动作。</li><li>最后用知识点排除绝对化或流程误用选项。</li></ol></article></div><div class="q-note-card wide"><h4>线索链</h4>${found.length?`<ul class="q-clue-chain">${chain}</ul>`:`<p class="q-empty">还没有线索。回到“题目”页，点击你认为关键的词句。</p>`}${missed.length?`<p class="q-missed">待寻找：${missed.map(c=>escapeHTML(c.text)).join('、')}</p>`:''}</div><div class="q-note-card wide"><h4>选项排除</h4><ul class="q-trap-list">${trapRows}</ul>${correct?`<p class="q-answer-hint">最终答案路径：<strong>${escapeHTML(correct.id)}.</strong> ${escapeHTML(correct.text)}</p>`:''}${selected&&!selected.correct?`<p class="q-missed">你选择的 ${escapeHTML(selected.id)} 可能被“${escapeHTML(selected.trap||'表面动作')}”诱导。</p>`:''}</div>`;
}
function renderQReview(){
  const el=$('qReview');if(!el)return;
  if(!qMvpState.submitted){el.classList.remove('show');el.innerHTML='';return}
  const right=qMvpState.selected===PMP_QUESTION_MVP.correctAnswer;
  const missed=(PMP_QUESTION_MVP.clues||[]).filter(c=>!qMvpState.found.has(c.id));
  const selected=(PMP_QUESTION_MVP.options||[]).find(o=>String(o.id)===String(qMvpState.selected));
  const correct=(PMP_QUESTION_MVP.options||[]).find(o=>o.correct||String(o.id)===String(PMP_QUESTION_MVP.correctAnswer));
  el.classList.add('show');
  el.innerHTML=`<h4>${right?'答案正确：继续检查推理链是否完整。':'答案需要修正：重点看干扰项诱导。'}</h4><p>正确答案是 <strong>${escapeHTML(correct?.id||PMP_QUESTION_MVP.correctAnswer||'')}</strong>${correct?`：${escapeHTML(correct.text)}`:''}</p>${selected&&!selected.correct?`<p><strong>你选择的 ${escapeHTML(selected.id)} 诱骗点：</strong>${escapeHTML(selected.trap||'该选项看似可行动，但没有匹配题干关键约束。')}</p>`:''}${missed.length?`<p><strong>你漏掉的关键词：</strong>${missed.map(c=>escapeHTML(c.text)).join('、')}</p>`:''}<p>复盘建议：回到“题目”页补全关键词，再到“推理图谱”页生成路径，最后用本页笔记复核每个选项为什么被保留或排除。</p>`;
}
function submitQuestionAnswer(){
  if(!qCanOperateCurrentQuestion('当前角色不能提交这道题。'))return;
  if(!qMvpState.selected){showStatus('请先选择一个答案。');return}
  qMvpState.submitted=true;
  qMvpState.graph=true;
  qActiveCaseTab='notes';
  renderQuestionTrainer();
  qSetCaseTab('notes');
  showStatus(qMvpState.selected===PMP_QUESTION_MVP.correctAnswer?'答案正确，已生成侦探笔记复盘。':'答案不正确，请查看侦探笔记中的错项陷阱和解题路径。');
}
function generateQuestionGraph(){
  if(!qCanOperateCurrentQuestion('当前角色不能生成这道题的推理图谱。'))return;
  qMvpState.graph=true;
  qActiveCaseTab='graph';
  renderQuestionTrainer();
  qSetCaseTab('graph');
  showStatus('已生成本题推理图谱。');
}
function addQuestionGraphToCanvas(){
  if(!qCanOperateCurrentQuestion('当前角色不能把这道题加入总图谱。'))return;
  if(!authRequire('登录后才能加入总图谱。','editGraph'))return;
  if(typeof stage==='undefined'||!stage||typeof screenToWorld!=='function'||typeof state==='undefined'||!state||!Array.isArray(state.nodes)){showStatus('独立考题训练页暂不直接加入总图谱，请回到知识图谱首页使用此功能。');return}
  const concepts=qFoundConceptIds().map(qConceptById).filter(Boolean);
  if(!concepts.length){showStatus('请先发现至少一个题干线索，再加入总图谱。');return}
  const r=stage.getBoundingClientRect(),center=screenToWorld(r.left+r.width/2,r.top+r.height/2),startX=center.x-260,startY=center.y-140,gapX=190,gapY=170;
  const created=[],existing=new Map(state.nodes.map(n=>[String(n.title).trim().toLowerCase(),n]));
  const clueNodes=[...qMvpState.found].map((id,i)=>{
    const clue=qClueById(id);if(!clue)return null;
    const key=clue.text.trim().toLowerCase();
    if(existing.has(key))return existing.get(key);
    const n=makeNode(clue.text,startX+(i%3)*gapX,startY+Math.floor(i/3)*gapY,'#8b5cf6','题干线索','重点',clue.type,clue.explain,'由 PMP 考题破案模式生成的题干线索。','small');
    state.nodes.push(n);created.push(n.id);existing.set(key,n);return n;
  }).filter(Boolean);
  const conceptNodes=concepts.map((c,i)=>{
    const key=c.title.trim().toLowerCase();
    if(existing.has(key))return existing.get(key);
    const n=makeNode(c.title,startX+70+(i%3)*gapX,startY+260+Math.floor(i/3)*gapY,c.color,c.category,c.level,c.keywords,c.summary,c.notes,'');
    n.highlightTerms=c.keywords||'';
    state.nodes.push(n);created.push(n.id);existing.set(key,n);return n;
  });
  [...qMvpState.found].map(qClueById).filter(Boolean).forEach(clue=>{
    const cn=clueNodes.find(n=>n.title===clue.text);
    clue.conceptIds.forEach(cid=>{
      const concept=qConceptById(cid),kn=conceptNodes.find(n=>concept&&n.title===concept.title);
      if(cn&&kn&&!relationExists(cn.id,kn.id))state.links.push(makeLink(cn.id,kn.id,'题干线索',clue.explain,'dashed','#7c3aed'));
    });
  });
  if(created.length){
    if(typeof clearMultiSelection==='function')clearMultiSelection();
    try{selectedNodeIds=new Set(created)}catch{}
    state.selectedNodeId=created[0];state.selectedLinkId=null;state.linkSourceId=null;
    closeQuestionTrainer();render({persist:true});showStatus(`已将本题 ${created.length} 个线索/知识点加入总图谱。`);
  }else showStatus('本题相关知识点已在总图谱中。');
}
function addQuestionFlashcards(){
  if(!qCanOperateCurrentQuestion('当前角色不能为这道题生成闪卡。'))return;
  if(!authRequire('登录后才能生成个人闪卡。','editGraph'))return;
  if(typeof state==='undefined'||!state||!Array.isArray(state.importedFlashcards)||typeof normalizeState!=='function'){showStatus('独立考题训练页暂不直接生成个人闪卡，请回到知识图谱首页使用此功能。');return}
  normalizeState();
  const concepts=qFoundConceptIds().map(qConceptById).filter(Boolean);
  if(!concepts.length){showStatus('请先发现线索，再生成闪卡。');return}
  const before=state.importedFlashcards.length,exists=new Set(state.importedFlashcards.map(c=>String(c.title||'').trim().toLowerCase()));
  concepts.forEach(c=>{
    const title=c.title.trim(),key=title.toLowerCase();
    if(exists.has(key))return;
    state.importedFlashcards.push({id:uid('f'),source:'PMP考题破案',subject:'PMP',category:c.category||'考题知识点',title,explanation:c.summary,mnemonic:c.notes||'看到题干线索时，先判断环境、时间点、角色和下一步动作。',level:c.level||'重点',keywords:c.keywords||'',highlightTerms:c.keywords||title,color:c.color||'#7c3aed'});
  });
  save();
  const added=state.importedFlashcards.length-before;
  showStatus(added?`已生成 ${added} 张本题知识点闪卡。`:'本题闪卡已存在，无需重复生成。');
}

function qOpenDeepRecallPage(){
  if(!qCanUseDeepRecallCurrentQuestion())return;
  try{
    const question=qbClone(PMP_QUESTION_MVP);
    question.sourceBankId=qCurrentQuestionBankId();
    question.sourceQuestionId=String(PMP_QUESTION_MVP.sourceQuestionId||PMP_QUESTION_MVP.id||'');
    const userId=window.KGAuthCore?.currentUsername?.()||qbReadString(QB_KEYS.AUTH_CURRENT_USER||'kg_local_current_user_v1','')||'guest';
    const paper=qbCurrentPaper();
    const payload={question,savedAt:Date.now(),source:'question-trainer',sourceBankId:qCurrentQuestionBankId(),sourceQuestionId:question.sourceQuestionId,sourcePaperId:String(paper?.id||question.sourcePaperId||''),sourceReleaseId:String(paper?.releaseId||question.sourceReleaseId||''),userId};
    qbWriteJSON(QB_KEYS.DEEP_RECALL_CURRENT||'kg_deep_recall_current_question_v1',payload);
  }catch(e){}
  const qid=encodeURIComponent(String(PMP_QUESTION_MVP.id||'current'));
  const bankId=encodeURIComponent(String(qCurrentQuestionBankId()||''));
  const paper=qbCurrentPaper();
  const params=new URLSearchParams({bankId:String(qCurrentQuestionBankId()||''),questionId:String(PMP_QUESTION_MVP.id||'current')});
  if(paper?.id)params.set('paperId',String(paper.id));
  if(paper?.releaseId)params.set('releaseId',String(paper.releaseId));
  window.open(`knowledge-recall.html?${params.toString()}`,'_blank');
}

function bindQuestionTrainer(){
  bindQuestionCaseTabs();
  const close=$('closeQuestionBtn'),modal=$('questionModal');
  if(close)close.onclick=closeQuestionTrainer;
  if(modal&&!modal.dataset.questionClickBound){
    modal.dataset.questionClickBound='1';
    modal.addEventListener('click',e=>{if(e.target===modal)closeQuestionTrainer()});
  }
  const submit=$('qSubmitBtn'),reset=$('qResetBtn'),graph=$('qGraphBtn'),add=$('qAddToCanvasBtn'),flash=$('qFlashBtn'),deep=$('qDeepRecallBtn');
  if(submit)submit.onclick=submitQuestionAnswer;
  if(reset)reset.onclick=resetQuestionTrainer;
  if(graph)graph.onclick=generateQuestionGraph;
  if(add)add.onclick=addQuestionGraphToCanvas;
  if(flash)flash.onclick=addQuestionFlashcards;
  if(deep)deep.onclick=qOpenDeepRecallPage;
}
