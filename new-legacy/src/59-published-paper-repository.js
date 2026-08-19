'use strict';

/*
 * PublishedPaperRepository v3（P4.6 第 1 轮性能优化）
 *
 * 已发布内容的唯一读取边界，数据源从 runtime 整包 localStorage 键
 * （kg_exam_papers_published_v1 / kg_exam_paper_release_history_v1，约 7.65MB）
 * 切换为 KGPaperReleaseApi 细粒度 API：
 * - 目录：同步接口，读 adapter 预取的内存缓存（载入前为空，载入后广播事件触发页面重渲染）。
 * - 题目：resolvePublishedPaper / listPublishedPapers / findQuestion / listCollections
 *   返回 Promise，按 release 分页（单响应 ≤1MB）拉取发布时冻结的 questionSnapshots。
 *
 * 旧 runtime 键不再读取；题目只从发布时冻结的快照解析，不回退教师草稿或题库。
 * 访问控制（模式/角色/会员）仍在前端按 release 字段检查，与服务端一致。
 */
(function(global){
  const ReleaseApi=global.KGPaperReleaseApi||null;
  const ModePolicy=global.KGPaperLearningModes||{};
  const ALL_MODES=ModePolicy.IDS||Object.freeze(['practice_mode','deep_recall','multi_question_canvas','single_deep_study']);
  const WITHDRAWN_STATUSES=new Set(ModePolicy.WITHDRAWN_STATUSES||['withdrawn','revoked','unpublished','archived','disabled']);

  function clone(value){
    if(value===undefined)return undefined;
    try{return JSON.parse(JSON.stringify(value))}catch(error){return value}
  }
  function text(value){return String(value==null?'':value)}
  function number(value,fallback=0){const result=Number(value);return Number.isFinite(result)?result:fallback}

  function catalogRows(){
    const rows=ReleaseApi?.catalog?.()||[];
    return Array.isArray(rows)?rows:[];
  }
  async function ensureReady(){
    if(!ReleaseApi)return;
    try{await ReleaseApi.ready()}catch(error){}
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

  /* ---------- 目录层（同步，读 adapter 缓存） ---------- */

  function listReleases(options={}){
    let rows=catalogRows();
    const includeUnavailable=!!options.includeUnavailable;
    if(!includeUnavailable)rows=rows.filter(row=>row.availability==='published');
    if(options.paperId)rows=rows.filter(row=>row.paperId===text(options.paperId));
    if(options.releaseId)rows=rows.filter(row=>row.releaseId===text(options.releaseId));
    // includeHistory 的历史版本需要按 release 详情获取，目录层只给当前版本；
    // 既有学习会话携带 releaseId 时由 resolvePublishedPaper 异步解析。
    return rows
      .slice()
      .sort((a,b)=>number(b.version)-number(a.version)||number(b.publishedAt)-number(a.publishedAt))
      .map(clone);
  }
  function findRelease(identifier,options={}){
    const input=identifier&&typeof identifier==='object'?identifier:{};
    const explicitRelease=text(input.releaseId||(!Object.keys(input).length?identifier:''));
    const explicitPaper=text(input.paperId||input.id||options.paperId);
    const rows=catalogRows();
    const newest=items=>items.slice().sort((a,b)=>number(b.publishedAt)-number(a.publishedAt))[0]||null;
    if(explicitRelease){
      const exact=rows.find(item=>item.releaseId===explicitRelease);
      if(exact)return clone(exact);
      const byPaper=newest(rows.filter(item=>item.paperId===explicitRelease));
      if(byPaper)return clone(byPaper);
    }
    if(explicitPaper){
      const current=newest(rows.filter(item=>item.paperId===explicitPaper));
      if(current)return clone(current);
    }
    return null;
  }
  function getPublishedPaper(identifier,options={}){return findRelease(identifier,options)}
  function inspectRelease(identifier,options={}){
    const requested=identifier&&typeof identifier==='object'?identifier:{};
    const release=findRelease(identifier,{});
    if(!release){
      return issue(text(requested.releaseId)?'RELEASE_NOT_FOUND':'PAPER_NOT_FOUND',text(requested.releaseId)?'指定的发布版本不存在或历史记录已损坏。':'没有找到这份已发布试卷。');
    }
    const mode=text(options.mode||requested.mode);
    if(WITHDRAWN_STATUSES.has(release.status)&&!options.allowWithdrawn){
      return issue('RELEASE_WITHDRAWN','该发布版本已撤回，不能新建或继续学习会话。',release);
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
    return {ok:true,code:'READY',message:'发布版本可用。',release:clone(release),mode,access};
  }
  function listCatalogEntries(options={}){
    const mode=text(options.mode);
    return catalogRows()
      .filter(release=>release.availability==='published'&&(!mode||release.enabledModes.includes(mode)))
      .map(release=>{
        const access=inspectPaperAccess(release);
        const questionCount=release.contentRestricted?number(release.configuredCount||release.totalCount,0):number(release.totalCount,0);
        return {paperId:release.paperId,id:release.paperId,releaseId:release.releaseId,version:release.version,name:release.name,title:release.title,subject:release.subject,description:release.description,categoryId:release.categoryId,categoryName:release.categoryName,publishedAt:release.publishedAt,totalCount:questionCount,questionCount,enabledModes:[...release.enabledModes],accessPolicy:clone(release.accessPolicy),access:clone(access)};
      })
      .sort((a,b)=>number(b.publishedAt)-number(a.publishedAt));
  }

  /* ---------- 解析层（异步，按 release 拉取冻结快照） ---------- */

  function snapshotProblem(snapshot,ref){
    if(!snapshot||!snapshot.question||typeof snapshot.question!=='object'||Array.isArray(snapshot.question))return {code:'QUESTION_SNAPSHOT_DAMAGED',message:'发布快照结构损坏。'};
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
  async function fetchReleaseForResolve(identifier,options){
    // 目录命中直接用；未命中（历史会话 releaseId）走详情接口（superseded 可读）
    const cached=findRelease(identifier,{});
    if(cached&&cached.availability!=='withdrawn')return cached;
    const releaseId=text(identifier?.releaseId);
    if(releaseId&&ReleaseApi?.detail){
      try{
        const remote=await ReleaseApi.detail(releaseId);
        if(remote)return clone(remote);
      }catch(error){
        if(error?.status===403||error?.status===404)return null;
        throw error;
      }
    }
    return null;
  }
  function buildResolveResult(release,questionRows,mode,options){
    const prepared=[],issues=[];
    const bankMeta=new Map();
    let missingCount=0,damagedCount=0,blockedCount=0;
    questionRows.forEach((row,paperIndex)=>{
      const ref={bankId:row.bankId,questionId:row.questionId,order:number(row.order,paperIndex+1),score:1};
      const problem=snapshotProblem(row.snapshot,ref);
      if(problem||!row.snapshot?.question){
        const code=problem?.code||'QUESTION_SNAPSHOT_MISSING';
        if(code==='QUESTION_SNAPSHOT_MISSING')missingCount+=1;else damagedCount+=1;
        issues.push({code,message:problem?.message||'发布快照缺失。',paperId:release.paperId,releaseId:release.releaseId,bankId:ref.bankId,questionId:ref.questionId,paperIndex});
        return;
      }
      const question=normalizeQuestion(row.snapshot.question,{bankId:ref.bankId,questionId:ref.questionId,paperId:release.paperId,releaseId:release.releaseId,version:release.version,subject:release.subject});
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
      if(!bankMeta.has(ref.bankId))bankMeta.set(ref.bankId,{id:ref.bankId,name:text(release.name||'发布试卷题目'),subject:text(release.subject||'PMP'),visibility:'published-paper',releaseId:release.releaseId,paperId:release.paperId,questions:[]});
      const bank=bankMeta.get(ref.bankId);bank.questions.push(question);
      prepared.push({ref,paperIndex,question,bankId:ref.bankId});
    });
    const items=prepared.map(row=>{
      const bank=bankMeta.get(row.bankId);
      return {paper:release,release,paperId:release.paperId,releaseId:release.releaseId,version:release.version,paperIndex:row.paperIndex,index:row.paperIndex,bankQuestionIndex:Math.max(0,(bank?.questions||[]).findIndex(item=>text(item.id)===text(row.question.id))),bank,question:row.question,ref:row.ref,context:{paperId:release.paperId,releaseId:release.releaseId,questionId:row.question.id,bankId:row.bankId,mode},source:'published-release'};
    });
    const configuredCount=number(release.totalCount,questionRows.length);
    return {ok:true,code:'READY',message:'发布版本可用。',paper:release,release,items,configuredCount,targetCount:configuredCount,availableCount:items.length,missingCount,damagedCount,blockedCount,issues,status:items.length?'ready':(configuredCount?'unavailable':'empty')};
  }
  async function resolveInternally(identifier,options={}){
    await ensureReady();
    const requested=identifier&&typeof identifier==='object'?identifier:{};
    let release;
    try{
      release=await fetchReleaseForResolve({paperId:text(requested.paperId),releaseId:text(requested.releaseId)},options);
    }catch(error){
      return issue('RELEASE_UNAVAILABLE',text(error?.message||'发布内容暂时无法读取。'),null,{items:[],configuredCount:0,targetCount:0,availableCount:0,missingCount:0,damagedCount:0,blockedCount:0,status:'unavailable',issues:[]});
    }
    if(!release){
      const result=inspectRelease(requested,options);
      if(!result.ok)return {...result,items:[],configuredCount:result.release?.totalCount||0,targetCount:result.release?.totalCount||0,availableCount:0,missingCount:0,damagedCount:0,blockedCount:0,status:'unavailable',issues:[]};
      release=result.release;
    }
    const mode=text(options.mode||requested.mode);
    if(WITHDRAWN_STATUSES.has(release.status)&&!options.allowWithdrawn){
      return {...issue('RELEASE_WITHDRAWN','该发布版本已撤回，不能新建或继续学习会话。',release),items:[],configuredCount:number(release.totalCount,0),targetCount:number(release.totalCount,0),availableCount:0,missingCount:0,damagedCount:0,blockedCount:0,status:'unavailable',issues:[]};
    }
    if(mode&&!release.enabledModes.includes(mode)){
      return {...issue('MODE_DISABLED','该试卷未开放当前学习模式。',release,{mode}),items:[],configuredCount:number(release.totalCount,0),targetCount:number(release.totalCount,0),availableCount:0,missingCount:0,damagedCount:0,blockedCount:0,status:'unavailable',issues:[]};
    }
    if(!paperAllowed(release,mode,options.respectRole)){
      return {...issue('PAPER_FORBIDDEN','当前账号没有权限学习这份试卷。',release,{mode}),items:[],configuredCount:number(release.totalCount,0),targetCount:number(release.totalCount,0),availableCount:0,missingCount:0,damagedCount:0,blockedCount:0,status:'unavailable',issues:[]};
    }
    const access=inspectPaperAccess(release);
    if(options.respectAccess!==false&&!access.allowed){
      return {...issue(access.code||'MEMBERSHIP_REQUIRED',access.message||'当前会员权益不能使用这份试卷。',release,{mode,access}),items:[],configuredCount:number(release.totalCount,0),targetCount:number(release.totalCount,0),availableCount:0,missingCount:0,damagedCount:0,blockedCount:0,status:'unavailable',issues:[]};
    }
    let questionRows=[];
    try{
      const fetched=await ReleaseApi.fetchQuestions(release.releaseId,{});
      questionRows=fetched.items||[];
      if(fetched.release)release=fetched.release;
    }catch(error){
      return {...issue('RELEASE_UNAVAILABLE',text(error?.message||'发布题目暂时无法读取。'),release),items:[],configuredCount:number(release.totalCount,0),targetCount:number(release.totalCount,0),availableCount:0,missingCount:0,damagedCount:0,blockedCount:0,status:'unavailable',issues:[]};
    }
    const result=buildResolveResult(release,questionRows,mode,options);
    if(result.ok)rememberResolved(release,result);
    return result;
  }
  async function resolvePublishedPaper(identifier,options={}){
    const external=global.KGPublishedQuestionResolver;
    if(external&&typeof external.resolvePaper==='function'&&!options.__repositoryInternal){
      return external.resolvePaper(identifier,{...options,__repositoryInternal:true});
    }
    return resolveInternally(identifier,options);
  }
  async function listPublishedPapers(options={}){
    await ensureReady();
    const mode=text(options.mode);
    const releases=catalogRows().filter(release=>release.availability==='published'&&(!mode||release.enabledModes.includes(mode)));
    // 不同 release 并发解析（每个 release 内部分页串行、单响应 ≤1MB）
    const entries=await Promise.all(releases.map(async release=>{
      try{
        return await resolveInternally({paperId:release.paperId,releaseId:release.releaseId},{...options,mode});
      }catch(error){return null}
    }));
    return entries.filter(entry=>entry&&entry.ok!==false);
  }
  async function resolvePaperQuestions(identifier,options={}){return resolvePublishedPaper(identifier,options)}
  async function findQuestion(input={},options={}){
    if(typeof input==='string')input={questionId:input};
    const identifier={paperId:input.paperId||options.paperId||'',releaseId:input.releaseId||options.releaseId||''};
    const entries=(identifier.paperId||identifier.releaseId)?[await resolvePublishedPaper(identifier,{...options,mode:text(input.mode||options.mode)})]:await listPublishedPapers({...options,mode:text(input.mode||options.mode)});
    for(const entry of entries){
      const item=(entry?.items||[]).find(row=>text(row.question?.id||row.ref?.questionId)===text(input.questionId||input.sourceQuestionId)&&(!input.bankId||text(row.bank?.id||row.ref?.bankId)===text(input.bankId)));
      if(item)return clone(item);
    }
    return null;
  }
  async function listCollections(options={}){
    return (await listPublishedPapers(options)).map(entry=>({
      id:'paper-release:'+entry.paper.releaseId,paperId:entry.paper.paperId,releaseId:entry.paper.releaseId,version:entry.paper.version,name:entry.paper.name,title:entry.paper.title,subject:entry.paper.subject,enabledModes:[...entry.paper.enabledModes],configuredCount:entry.configuredCount,availableCount:entry.availableCount,missingCount:entry.missingCount,damagedCount:entry.damagedCount||0,blockedCount:entry.blockedCount,issues:clone(entry.issues||[]),questions:entry.items.map(item=>({id:text(item.question.id),title:text(item.question.title||'未命名题目'),topic:text(item.question.topic||item.question.domain),difficulty:text(item.question.difficulty),bankId:text(item.bank.id),paperId:entry.paper.paperId,releaseId:entry.paper.releaseId,paperIndex:item.paperIndex,context:clone(item.context),question:clone(item.question)}))
    }));
  }
  function invalidate(){
    resolvedCache.clear();
    try{ReleaseApi?.invalidate?.({keepCatalog:false})}catch(error){}
    try{
      global.dispatchEvent?.(new CustomEvent('kg:published-papers-changed',{detail:{source:'invalidate'}}));
    }catch(error){}
  }
  async function ready(){return ensureReady()}

  /* ---------- 同步缓存读取（供深度同步的旧消费者，如 60-question-bank） ----------
   * 解析结果在 resolveInternally 成功后进入内存缓存；未命中时调用方应触发
   * 异步预取（listPublishedPapers / resolvePublishedPaper），缓存落地后通过
   * kg:published-papers-changed 事件驱动重渲染。 */
  const resolvedCache=new Map();
  function rememberResolved(release,result){
    if(release?.releaseId&&result?.ok)resolvedCache.set(text(release.releaseId),clone(result));
  }
  function peekResolved(releaseId){
    const cached=resolvedCache.get(text(releaseId));
    return cached?clone(cached):null;
  }
  function findQuestionCached(input={}){
    if(typeof input==='string')input={questionId:input};
    const questionId=text(input.questionId||input.sourceQuestionId);
    if(!questionId)return null;
    for(const entry of resolvedCache.values()){
      const item=(entry.items||[]).find(row=>text(row.question?.id||row.ref?.questionId)===questionId&&(!input.bankId||text(row.bank?.id||row.ref?.bankId)===text(input.bankId)));
      if(item)return clone(item);
    }
    return null;
  }
  function prefetchMissing(){
    // 目录中尚未解析的 release 后台预取一次；完成后触发既有事件
    const missing=catalogRows().filter(row=>row.availability==='published'&&!resolvedCache.has(row.releaseId));
    if(!missing.length)return Promise.resolve([]);
    return listPublishedPapers().then(entries=>{
      if(entries.length)try{global.dispatchEvent?.(new CustomEvent('kg:published-papers-changed',{detail:{source:'paper-release-prefetch'}}))}catch(error){}
      return entries;
    }).catch(()=>[]);
  }

  const api=Object.freeze({
    storageKey:'kg_exam_papers_published_v1',historyKey:'kg_exam_paper_release_history_v1',modes:ALL_MODES,invalidate,ready,
    listReleases,listCatalogEntries,getPublishedPaper,inspectRelease,inspectPaperAccess,
    resolvePublishedPaper,resolvePaperQuestions,findQuestion,listPublishedPapers,listCollections,
    peekResolved,findQuestionCached,prefetchMissing,
    __resolveInternally:resolveInternally
  });
  global.KGPublishedPaperRepository=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
