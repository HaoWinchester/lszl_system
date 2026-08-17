'use strict';

/*
 * PublishedPaperRepository v2
 *
 * 已发布内容的唯一读取边界：
 * - 当前目录：kg_exam_papers_published_v1
 * - 历史发布：kg_exam_paper_release_history_v1
 *
 * 默认列表只返回当前可学习版本；携带 releaseId 的既有学习会话可继续读取
 * 已被新版本替代的历史快照。真正撤回且没有当前版本的试卷会统一返回撤回状态。
 * 题目只从发布时冻结的 questionSnapshots 解析，不回退教师草稿、题库或演示数据。
 */
(function(global){
  const Store=global.KGAppStorage||{};
  const Keys=global.KGStorageKeys||{};
  const STORAGE_KEY=Keys.PUBLISHED_PAPERS||'kg_exam_papers_published_v1';
  const HISTORY_KEY=Keys.PAPER_RELEASE_HISTORY||'kg_exam_paper_release_history_v1';
  const ModePolicy=global.KGPaperLearningModes||{};
  const ALL_MODES=ModePolicy.IDS||Object.freeze(['practice_mode','deep_recall','multi_question_canvas','single_deep_study']);
  const MODE_CONFIG_VERSION=Number(ModePolicy.CONFIG_VERSION||2);
  const PUBLISHED_STATUSES=new Set(ModePolicy.PUBLISHED_STATUSES||['published','active','released']);
  const WITHDRAWN_STATUSES=new Set(ModePolicy.WITHDRAWN_STATUSES||['withdrawn','revoked','unpublished','archived','disabled']);
  let cache={catalogRaw:null,historyRaw:null,catalog:[],history:[],all:[]};

  function clone(value){
    if(value===undefined)return undefined;
    try{return JSON.parse(JSON.stringify(value))}catch(error){return value}
  }
  function text(value){return String(value==null?'':value)}
  function number(value,fallback=0){const result=Number(value);return Number.isFinite(result)?result:fallback}
  function readRaw(key){
    try{return Store.readString?Store.readString(key,''):(global.localStorage?.getItem(key)||'')}catch(error){return ''}
  }
  function parseRows(raw){
    try{const value=JSON.parse(raw||'[]');return Array.isArray(value)?value:[]}catch(error){return []}
  }
  function normalizeModes(value,version=0){
    if(typeof ModePolicy.normalize==='function')return ModePolicy.normalize(value,version);
    const explicit=Array.isArray(value),resolvedVersion=number(version,0);
    const aliases={practice:'practice_mode',recall:'deep_recall','deep-recall':'deep_recall',multi_question:'multi_question_canvas','multi-question':'multi_question_canvas',canvas:'multi_question_canvas',single_deep:'single_deep_study','single-deep':'single_deep_study'};
    const rows=explicit?value.map(text).map(mode=>ALL_MODES.includes(mode)?mode:(aliases[mode]||'')).filter(Boolean):[];
    if(!explicit)return Array.from(ALL_MODES);
    if(!rows.length)return resolvedVersion>=MODE_CONFIG_VERSION?[]:Array.from(ALL_MODES);
    const modes=Array.from(new Set(rows));
    if(resolvedVersion<MODE_CONFIG_VERSION&&!modes.includes('practice_mode'))modes.unshift('practice_mode');
    return modes;
  }
  function normalizeRef(ref,index){
    ref=ref&&typeof ref==='object'?ref:{};
    return {
      bankId:text(ref.bankId||ref.sourceBankId),
      questionId:text(ref.questionId||ref.sourceQuestionId||ref.id),
      order:number(ref.order,index+1),
      score:number(ref.score,1)
    };
  }
  function normalizeRelease(row,index,source='catalog'){
    row=row&&typeof row==='object'?row:{};
    const releaseId=text(row.releaseId||row.id||('release-'+index));
    const paperId=text(row.paperId||row.sourcePaperId||row.id||releaseId);
    const refs=(Array.isArray(row.questions)?row.questions:(Array.isArray(row.questionRefs)?row.questionRefs:[]))
      .map(normalizeRef)
      .filter(ref=>ref.bankId&&ref.questionId)
      .sort((a,b)=>a.order-b.order);
    const status=text(row.status||'published').toLowerCase()||'published';
    return {
      id:paperId,
      paperId,
      releaseId,
      version:number(row.version||row.publishedVersion,0),
      name:text(row.name||row.title||'未命名试卷'),
      title:text(row.title||row.name||'未命名试卷'),
      subject:text(row.subject||'PMP'),
      description:text(row.description),
      categoryId:text(row.categoryId),
      categoryName:text(row.categoryName),
      purpose:text(row.purpose||'learning'),
      status,
      enabledModes:normalizeModes(row.enabledModes,row.modeConfigVersion),
      modeConfigVersion:number(row.modeConfigVersion,0),
      publishedAt:number(row.publishedAt,0),
      publishedBy:text(row.publishedBy),
      withdrawnAt:number(row.withdrawnAt||row.archivedAt,0),
      totalCount:number(row.totalCount||refs.length,refs.length),
      configuredCount:number(row.configuredCount||refs.length,refs.length),
      contentRestricted:row.contentRestricted===true,
      updatedAt:number(row.updatedAt||row.publishedAt,0),
      allowedRoles:Array.isArray(row.allowedRoles)?row.allowedRoles.map(text).filter(Boolean):[],
      visibility:text(row.visibility||'published'),
      accessPolicy:{accessLevel:['member','vip','paid','premium'].includes(text(row?.accessPolicy?.accessLevel||row.accessLevel).toLowerCase())?'member':'free'},
      questions:refs,
      questionSnapshots:Array.isArray(row.questionSnapshots)?row.questionSnapshots.map(clone):[],
      source,
      current:false,
      availability:'unknown'
    };
  }
  function refresh(){
    const catalogRaw=readRaw(STORAGE_KEY),historyRaw=readRaw(HISTORY_KEY);
    if(cache.catalogRaw===catalogRaw&&cache.historyRaw===historyRaw)return cache;
    const catalog=parseRows(catalogRaw).map((row,index)=>normalizeRelease(row,index,'catalog'));
    const currentReleaseIds=new Set(catalog.map(row=>row.releaseId));
    catalog.forEach(row=>{
      row.current=true;
      row.availability=WITHDRAWN_STATUSES.has(row.status)?'withdrawn':(PUBLISHED_STATUSES.has(row.status)?'published':'unavailable');
    });
    const currentPaperIds=new Set(catalog.filter(row=>row.availability==='published').map(row=>row.paperId));
    const history=parseRows(historyRaw).map((row,index)=>normalizeRelease(row,index,'history')).filter(row=>!currentReleaseIds.has(row.releaseId));
    history.forEach(row=>{
      row.current=false;
      row.availability=WITHDRAWN_STATUSES.has(row.status)?'withdrawn':(PUBLISHED_STATUSES.has(row.status)?(currentPaperIds.has(row.paperId)?'superseded':'withdrawn'):'unavailable');
    });
    const deduped=new Map();
    [...catalog,...history].forEach(row=>{if(row.releaseId&&!deduped.has(row.releaseId))deduped.set(row.releaseId,row)});
    cache={catalogRaw,historyRaw,catalog,history,all:[...deduped.values()]};
    return cache;
  }
  function invalidate(){
    cache={catalogRaw:null,historyRaw:null,catalog:[],history:[],all:[]};
    try{
      global.dispatchEvent?.(new CustomEvent('kg:published-papers-changed',{detail:{source:'invalidate'}}));
    }catch(error){}
  }
  function sortNewest(rows){
    return rows.slice().sort((a,b)=>number(b.version)-number(a.version)||number(b.publishedAt)-number(a.publishedAt));
  }
  function listReleases(options={}){
    const data=refresh();
    const includeHistory=!!options.includeHistory;
    const includeUnavailable=!!options.includeUnavailable;
    let rows=includeHistory?data.all:data.catalog;
    if(!includeUnavailable)rows=rows.filter(row=>row.availability==='published'||(includeHistory&&row.availability==='superseded'));
    if(options.paperId)rows=rows.filter(row=>row.paperId===text(options.paperId));
    if(options.releaseId)rows=rows.filter(row=>row.releaseId===text(options.releaseId));
    return sortNewest(rows).map(clone);
  }
  function findRelease(identifier,options={}){
    const data=refresh();
    const input=identifier&&typeof identifier==='object'?identifier:{};
    const explicitRelease=text(input.releaseId||(!Object.keys(input).length?identifier:''));
    const explicitPaper=text(input.paperId||input.id||options.paperId);
    if(explicitRelease){
      const exact=data.all.find(item=>item.releaseId===explicitRelease);
      if(exact)return exact;
      if(!explicitPaper){
        const byPaper=sortNewest(data.catalog.filter(item=>item.paperId===explicitRelease))[0];
        if(byPaper)return byPaper;
      }
    }
    if(explicitPaper){
      const current=sortNewest(data.catalog.filter(item=>item.paperId===explicitPaper))[0];
      if(current)return current;
      if(options.includeHistory!==false)return sortNewest(data.history.filter(item=>item.paperId===explicitPaper))[0]||null;
    }
    return null;
  }
  function currentRole(){
    try{return text(global.KGRolePermissions?.currentRole?.()||global.KGRolePermissions?.currentRoleKey?.()||global.KGAuthCore?.currentUser?.()?.role)}catch(error){return ''}
  }
  function paperAllowed(release,mode,respectRole=true){
    if(respectRole===false)return true;
    const roleApi=global.KGRolePermissions;
    try{
      if(typeof roleApi?.canAccessPublishedPaper==='function')return !!roleApi.canAccessPublishedPaper(release,mode);
      if(typeof roleApi?.canUsePublishedPaper==='function')return !!roleApi.canUsePublishedPaper(release,mode);
      if(release.allowedRoles.length){
        const role=currentRole();
        if(!role||!release.allowedRoles.includes(role))return false;
      }
    }catch(error){return false}
    return true;
  }
  function inspectPaperAccess(release){
    try{
      if(typeof global.KGPaperAccessService?.inspect==='function')return global.KGPaperAccessService.inspect(release);
    }catch(error){}
    return {allowed:true,accessLevel:release?.accessPolicy?.accessLevel||'free',state:'free',code:'FREE_PAPER',message:'免费试卷'};
  }
  function issue(code,message,release=null,extra={}){
    return {ok:false,code,message,release:release?clone(release):null,...extra};
  }
  function inspectRelease(identifier,options={}){
    const release=findRelease(identifier,{includeHistory:true});
    const requested=identifier&&typeof identifier==='object'?identifier:{};
    if(!release){
      return issue(text(requested.releaseId)?'RELEASE_NOT_FOUND':'PAPER_NOT_FOUND',text(requested.releaseId)?'指定的发布版本不存在或历史记录已损坏。':'没有找到这份已发布试卷。');
    }
    const mode=text(options.mode||requested.mode);
    if(release.availability==='withdrawn'&&!options.allowWithdrawn){
      return issue('RELEASE_WITHDRAWN','该发布版本已撤回，不能新建或继续学习会话。',release);
    }
    if(release.availability==='unavailable'){
      return issue('RELEASE_NOT_FOUND','该记录不是可学习的已发布版本。',release);
    }
    if(mode&&!release.enabledModes.includes(mode)){
      return issue('MODE_DISABLED','该试卷未开放当前学习模式。',release,{mode});
    }
    if(!paperAllowed(release,mode,options.respectRole)){
      return issue('PAPER_FORBIDDEN','当前账号没有权限学习这份试卷。',release,{mode});
    }
    const access=inspectPaperAccess(release);
    if(options.respectAccess!==false&&!access.allowed){
      return issue(access.code||'MEMBERSHIP_REQUIRED',access.message||'当前会员权益不能使用这份试卷。',release,{mode,access});
    }
    return {ok:true,code:release.availability==='superseded'?'RELEASE_SUPERSEDED':'READY',message:release.availability==='superseded'?'正在继续已打开的历史发布版本。':'发布版本可用。',release:clone(release),mode,access};
  }
  function snapshotKey(bankId,questionId){return text(bankId)+'::'+text(questionId)}
  function roleAllowed(question,bankId,mode,respectRole){
    if(respectRole===false)return true;
    const roleApi=global.KGRolePermissions;
    if(!roleApi)return true;
    try{
      if(mode==='deep_recall'&&typeof roleApi.canUseDeepRecallQuestion==='function')return !!roleApi.canUseDeepRecallQuestion(question,bankId);
      if(typeof roleApi.canOperateQuestion==='function')return !!roleApi.canOperateQuestion(question,bankId);
    }catch(error){return false}
    return true;
  }
  function snapshotProblem(snapshot,ref){
    if(!snapshot)return {code:'QUESTION_SNAPSHOT_MISSING',message:'发布快照缺失。'};
    if(!snapshot.question||typeof snapshot.question!=='object'||Array.isArray(snapshot.question))return {code:'QUESTION_SNAPSHOT_DAMAGED',message:'发布快照结构损坏。'};
    const id=text(snapshot.question.id||snapshot.questionId);
    if(!id||id!==text(ref.questionId))return {code:'QUESTION_SNAPSHOT_DAMAGED',message:'发布快照题目编号不一致。'};
    if(Object.prototype.hasOwnProperty.call(snapshot.question,'stemParts')&&!Array.isArray(snapshot.question.stemParts))return {code:'QUESTION_SNAPSHOT_DAMAGED',message:'发布快照题干结构损坏。'};
    if(Object.prototype.hasOwnProperty.call(snapshot.question,'options')&&!Array.isArray(snapshot.question.options))return {code:'QUESTION_SNAPSHOT_DAMAGED',message:'发布快照选项结构损坏。'};
    return null;
  }
  function normalizeQuestion(question,meta){
    if(!question||typeof question!=='object')return null;
    const result=clone(question)||{};
    const id=text(result.id||meta.questionId);
    if(!id)return null;
    result.id=id;
    result.sourceQuestionId=id;
    result.sourceBankId=text(meta.bankId);
    result.sourcePaperId=text(meta.paperId);
    result.sourceReleaseId=text(meta.releaseId);
    result.sourcePaperVersion=number(meta.version,0);
    result.subject=result.subject||meta.subject||'';
    if(!Array.isArray(result.stemParts))result.stemParts=[{text:text(result.stem)}];
    if(!Array.isArray(result.options))result.options=[];
    if(!Array.isArray(result.clues))result.clues=[];
    if(!Array.isArray(result.concepts))result.concepts=[];
    if(!Array.isArray(result.tags))result.tags=[];
    return result;
  }
  function resolveInternally(identifier,options={}){
    const inspection=inspectRelease(identifier,options);
    if(!inspection.ok)return {...inspection,items:[],configuredCount:inspection.release?.questions?.length||0,targetCount:inspection.release?.totalCount||0,availableCount:0,missingCount:0,damagedCount:0,blockedCount:0,status:'unavailable',issues:[]};
    const release=inspection.release;
    const mode=text(options.mode);
    const snapshotMap=new Map();
    const bankMeta=new Map();
    (release.questionSnapshots||[]).forEach(snapshot=>{
      const bankId=text(snapshot?.bankId),questionId=text(snapshot?.questionId||snapshot?.question?.id);
      if(!bankId||!questionId)return;
      snapshotMap.set(snapshotKey(bankId,questionId),snapshot);
    });
    const prepared=[],issues=[];
    let missingCount=0,damagedCount=0,blockedCount=0;
    release.questions.forEach((ref,paperIndex)=>{
      const snapshot=snapshotMap.get(snapshotKey(ref.bankId,ref.questionId));
      const problem=snapshotProblem(snapshot,ref);
      if(problem){
        if(problem.code==='QUESTION_SNAPSHOT_MISSING')missingCount+=1;else damagedCount+=1;
        issues.push({...problem,paperId:release.paperId,releaseId:release.releaseId,bankId:ref.bankId,questionId:ref.questionId,paperIndex});
        return;
      }
      const question=normalizeQuestion(snapshot.question,{bankId:ref.bankId,questionId:ref.questionId,paperId:release.paperId,releaseId:release.releaseId,version:release.version,subject:snapshot.bankSubject||release.subject});
      if(!question){
        damagedCount+=1;
        issues.push({code:'QUESTION_SNAPSHOT_DAMAGED',message:'发布快照无法解析。',paperId:release.paperId,releaseId:release.releaseId,bankId:ref.bankId,questionId:ref.questionId,paperIndex});
        return;
      }
      if(!roleAllowed(question,ref.bankId,mode,options.respectRole)){
        blockedCount+=1;
        issues.push({code:'QUESTION_FORBIDDEN',message:'当前账号无权学习这道题。',paperId:release.paperId,releaseId:release.releaseId,bankId:ref.bankId,questionId:ref.questionId,paperIndex});
        return;
      }
      if(!bankMeta.has(ref.bankId))bankMeta.set(ref.bankId,{id:ref.bankId,name:text(snapshot.bankName||release.name||'发布试卷题目'),subject:text(snapshot.bankSubject||release.subject||'PMP'),visibility:'published-paper',releaseId:release.releaseId,paperId:release.paperId,questions:[]});
      const bank=bankMeta.get(ref.bankId);bank.questions.push(question);
      prepared.push({ref,paperIndex,question,bankId:ref.bankId,snapshot});
    });
    const items=prepared.map(row=>{
      const bank=bankMeta.get(row.bankId);
      return {paper:release,release,paperId:release.paperId,releaseId:release.releaseId,version:release.version,paperIndex:row.paperIndex,index:row.paperIndex,bankQuestionIndex:Math.max(0,(bank?.questions||[]).findIndex(item=>text(item.id)===text(row.question.id))),bank,question:row.question,ref:row.ref,context:{paperId:release.paperId,releaseId:release.releaseId,questionId:row.question.id,bankId:row.bankId,mode},source:'published-release'};
    });
    return {ok:true,code:inspection.code,message:inspection.message,paper:release,release,items,configuredCount:release.questions.length,targetCount:number(release.totalCount,release.questions.length),availableCount:items.length,missingCount,damagedCount,blockedCount,issues,status:items.length?'ready':(release.questions.length?'unavailable':'empty')};
  }
  function resolvePublishedPaper(identifier,options={}){
    const external=global.KGPublishedQuestionResolver;
    if(external&&typeof external.resolvePaper==='function'&&!options.__repositoryInternal){
      return external.resolvePaper(identifier,{...options,__repositoryInternal:true});
    }
    return resolveInternally(identifier,options);
  }
  function listCatalogEntries(options={}){
    const mode=text(options.mode);
    return refresh().catalog
      .filter(release=>release.availability==='published'&&(!mode||release.enabledModes.includes(mode)))
      .map(release=>{
        const access=inspectPaperAccess(release);
        const questionCount=release.contentRestricted?number(release.configuredCount||release.totalCount,0):release.questions.length;
        return {paperId:release.paperId,id:release.paperId,releaseId:release.releaseId,version:release.version,name:release.name,title:release.title,subject:release.subject,description:release.description,categoryId:release.categoryId,categoryName:release.categoryName,publishedAt:release.publishedAt,totalCount:questionCount,questionCount,enabledModes:[...release.enabledModes],accessPolicy:clone(release.accessPolicy),access:clone(access)};
      })
      .sort((a,b)=>number(b.publishedAt)-number(a.publishedAt));
  }
  function listPublishedPapers(options={}){
    const mode=text(options.mode);
    return refresh().catalog
      .filter(release=>release.availability==='published'&&(!mode||release.enabledModes.includes(mode)))
      .map(release=>resolvePublishedPaper({paperId:release.paperId,releaseId:release.releaseId},{...options,mode}))
      .filter(entry=>entry&&entry.ok!==false);
  }
  function getPublishedPaper(identifier,options={}){return clone(findRelease(identifier,{includeHistory:options.includeHistory!==false}))}
  function resolvePaperQuestions(identifier,options={}){return resolvePublishedPaper(identifier,options)}
  function findQuestion(input={},options={}){
    if(typeof input==='string')input={questionId:input};
    const identifier={paperId:input.paperId||options.paperId||'',releaseId:input.releaseId||options.releaseId||''};
    const entries=(identifier.paperId||identifier.releaseId)?[resolvePublishedPaper(identifier,{...options,mode:text(input.mode||options.mode)})]:listPublishedPapers({...options,mode:text(input.mode||options.mode)});
    for(const entry of entries){
      const item=(entry?.items||[]).find(row=>text(row.question?.id||row.ref?.questionId)===text(input.questionId||input.sourceQuestionId)&&(!input.bankId||text(row.bank?.id||row.ref?.bankId)===text(input.bankId)));
      if(item)return clone(item);
    }
    return null;
  }
  function listCollections(options={}){
    return listPublishedPapers(options).map(entry=>({
      id:'paper-release:'+entry.paper.releaseId,paperId:entry.paper.paperId,releaseId:entry.paper.releaseId,version:entry.paper.version,name:entry.paper.name,title:entry.paper.title,subject:entry.paper.subject,enabledModes:[...entry.paper.enabledModes],configuredCount:entry.configuredCount,availableCount:entry.availableCount,missingCount:entry.missingCount,damagedCount:entry.damagedCount||0,blockedCount:entry.blockedCount,issues:clone(entry.issues||[]),questions:entry.items.map(item=>({id:text(item.question.id),title:text(item.question.title||'未命名题目'),topic:text(item.question.topic||item.question.domain),difficulty:text(item.question.difficulty),bankId:text(item.bank.id),paperId:entry.paper.paperId,releaseId:entry.paper.releaseId,paperIndex:item.paperIndex,context:clone(item.context),question:clone(item.question)}))
    }));
  }

  try{
    global.addEventListener?.('storage',event=>{if([STORAGE_KEY,HISTORY_KEY].includes(text(event?.key)))invalidate()});
    global.addEventListener?.('kg:published-papers-changed',invalidate);
    global.addEventListener?.('kg-app-storage-change',event=>{if([STORAGE_KEY,HISTORY_KEY].includes(text(event?.detail?.key)))invalidate()});
  }catch(error){}

  const api=Object.freeze({
    storageKey:STORAGE_KEY,historyKey:HISTORY_KEY,modes:ALL_MODES,invalidate,
    listReleases,listCatalogEntries,getPublishedPaper,inspectRelease,inspectPaperAccess,
    resolvePublishedPaper,resolvePaperQuestions,findQuestion,listPublishedPapers,listCollections,
    __resolveInternally:resolveInternally
  });
  global.KGPublishedPaperRepository=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
