'use strict';

/*
 * LearningSession v3
 *
 * 以 paperId + releaseId + questionId 固定学习会话，同时兼容 v2 仅按 questionId
 * 保存的历史记录。存储前缀保持不变，旧页面仍可通过 KGLearningSessionStore 使用。
 */
(function(global){
  const Store=global.KGAppStorage||{};
  const STORAGE_PREFIX=global.KGStorageKeys?.PREFIXES?.LEARNING_SESSION||'kg_learning_sessions_v2__';
  const ACTIVE_PREFIX='kg_learning_active_context_v1__';
  const MAX_SESSIONS_PER_USER=160;

  function now(){return Date.now()}
  function clone(value){if(value===undefined)return undefined;try{return JSON.parse(JSON.stringify(value))}catch(e){return value}}
  function text(value){return String(value==null?'':value)}
  function currentUserId(){
    try{if(typeof authCurrentUser!=='undefined'&&authCurrentUser?.username)return text(authCurrentUser.username)}catch(e){}
    try{const runtime=global.KGAuthRuntime;if(runtime&&typeof runtime.currentUsername==='function')return text(runtime.currentUsername()||'guest')}catch(e){}
    try{return text(global.KGAuthCore?.currentUsername?.()||global.KGAuthCore?.currentUser?.()?.username||'guest')}catch(e){return 'guest'}
  }
  function normalizeContext(input={},defaults={}){
    if(typeof input==='string'||typeof input==='number')input={questionId:text(input)};
    const route=global.KGLearningRouteContext;
    if(route?.normalize)return route.normalize(input,defaults);
    const context={paperId:text(input.paperId||input.sourcePaperId||defaults.paperId),releaseId:text(input.releaseId||input.sourceReleaseId||defaults.releaseId),questionId:text(input.questionId||input.sourceQuestionId||input.id||defaults.questionId||'current'),bankId:text(input.bankId||input.sourceBankId||defaults.bankId),mode:text(input.mode||defaults.mode||'guided'),source:text(input.source||defaults.source),workspaceId:text(input.workspaceId||input.workspace||defaults.workspaceId),returnUrl:text(input.returnUrl||input.return||defaults.returnUrl)};
    context.key=[context.paperId,context.releaseId,context.questionId].map(encodeURIComponent).join('::');
    context.complete=!!(context.paperId&&context.releaseId&&context.questionId);
    return context;
  }
  function contextKey(input={}){
    const context=normalizeContext(input);
    if(context.paperId||context.releaseId)return context.key;
    return context.questionId||'current';
  }
  function key(userId=currentUserId()){return STORAGE_PREFIX+encodeURIComponent(text(userId||'guest'))}
  function activeKey(mode='guided',userId=currentUserId()){return ACTIVE_PREFIX+encodeURIComponent(text(userId||'guest'))+'__'+encodeURIComponent(text(mode||'guided'))}
  function readBucket(userId=currentUserId()){
    try{
      const value=Store.readJSON?Store.readJSON(key(userId),null):JSON.parse(global.localStorage?.getItem(key(userId))||'null');
      if(value&&typeof value==='object'&&!Array.isArray(value)){
        value.sessions=value.sessions&&typeof value.sessions==='object'?value.sessions:{};
        return value;
      }
    }catch(e){console.warn('学习会话读取失败',e)}
    return {version:3,userId:text(userId||'guest'),sessions:{},updatedAt:0};
  }
  function writeBucket(bucket,userId=currentUserId()){
    bucket=clone(bucket)||{};
    bucket.version=3;
    bucket.userId=text(userId||bucket.userId||'guest');
    bucket.updatedAt=now();
    bucket.sessions=bucket.sessions&&typeof bucket.sessions==='object'?bucket.sessions:{};
    const entries=Object.entries(bucket.sessions).sort((a,b)=>Number(b[1]?.updatedAt||0)-Number(a[1]?.updatedAt||0));
    bucket.sessions=Object.fromEntries(entries.slice(0,MAX_SESSIONS_PER_USER));
    const saved=Store.writeJSON?Store.writeJSON(key(bucket.userId),bucket):(global.localStorage?.setItem(key(bucket.userId),JSON.stringify(bucket)),true);
    if(!saved)console.warn('学习会话保存失败：浏览器存储不可用或空间不足。');
    return clone(bucket);
  }
  function createSession(context={},options={}){
    const startedAt=now(),normalizedContext=normalizeContext(context,{mode:options.mode||'guided'});
    const userId=text(options.userId||context.userId||currentUserId());
    const questionId=text(normalizedContext.questionId||context.questionId||context.id||'current');
    return {
      schemaVersion:3,
      id:'session-'+startedAt.toString(36)+'-'+Math.random().toString(36).slice(2,8),
      attempt:Number(options.attempt||1),userId,
      context:{...normalizedContext,questionId},contextKey:contextKey({...normalizedContext,questionId}),
      paperId:text(normalizedContext.paperId),releaseId:text(normalizedContext.releaseId),questionId,
      bankId:text(normalizedContext.bankId||context.bankId),
      questionRevision:text(context.questionRevision||context.revision||'1'),questionTitle:text(context.questionTitle||context.title||''),
      mode:text(options.mode||normalizedContext.mode||'guided'),status:'active',currentStep:1,maxVisited:1,confidence:'',startedAt,updatedAt:startedAt,completedAt:null,durationSeconds:0,
      answer:{selectedOptionId:'',correctAnswerId:text(context.correctAnswerId||''),submitted:false,isCorrect:null},
      activation:{selectedKeywordIds:[],restoredKnowledgeIds:[]},
      network:{graphVisible:false,recallDone:{},ruleDone:{},trapDone:{},answerUnlocked:false,lockedAnswer:''},
      conclusion:{learnerSummary:'',savedPrincipleId:''},
      canvas:{viewport:{x:0,y:0,zoom:1},cards:{}},
      transient:{active:false,activatedAt:0,deactivatedAt:0}
    };
  }
  function normalize(session,context={}){
    if(!session||typeof session!=='object')return createSession(context);
    const mergedContext=normalizeContext({...context,...session.context,paperId:session.paperId||session.context?.paperId||context.paperId,releaseId:session.releaseId||session.context?.releaseId||context.releaseId,questionId:session.questionId||session.context?.questionId||context.questionId,bankId:session.bankId||session.context?.bankId||context.bankId,mode:session.mode||session.context?.mode||context.mode});
    const base=createSession({...context,...mergedContext,questionTitle:session.questionTitle||context.questionTitle,questionRevision:session.questionRevision||context.questionRevision,correctAnswerId:session.answer?.correctAnswerId||context.correctAnswerId},{userId:session.userId,attempt:session.attempt,mode:session.mode||mergedContext.mode});
    const result={...base,...clone(session),schemaVersion:3,context:mergedContext,contextKey:contextKey(mergedContext),paperId:mergedContext.paperId,releaseId:mergedContext.releaseId,questionId:mergedContext.questionId,bankId:mergedContext.bankId,answer:{...base.answer,...clone(session.answer||{})},activation:{...base.activation,...clone(session.activation||{})},network:{...base.network,...clone(session.network||{})},conclusion:{...base.conclusion,...clone(session.conclusion||{})},canvas:{...base.canvas,...clone(session.canvas||{}),viewport:{...base.canvas.viewport,...clone(session.canvas?.viewport||{})},cards:{...clone(session.canvas?.cards||{})}},transient:{...base.transient,...clone(session.transient||{})},currentStep:Math.max(1,Math.min(5,Number(session.currentStep||1))),maxVisited:Math.max(1,Math.min(5,Number(session.maxVisited||session.currentStep||1))),updatedAt:Number(session.updatedAt||base.updatedAt)};
    return result;
  }
  function locate(bucket,input){
    const context=normalizeContext(input);
    const exact=contextKey(context);
    if(bucket.sessions[exact])return {storageId:exact,session:bucket.sessions[exact],legacy:false};
    const legacyId=context.questionId||text(input)||'current';
    if(bucket.sessions[legacyId])return {storageId:legacyId,session:bucket.sessions[legacyId],legacy:true};
    const candidates=Object.entries(bucket.sessions).filter(([,session])=>text(session?.questionId||session?.context?.questionId)===legacyId);
    if(context.releaseId){
      const matched=candidates.find(([,session])=>text(session?.releaseId||session?.context?.releaseId)===context.releaseId&&(!context.paperId||text(session?.paperId||session?.context?.paperId)===context.paperId));
      if(matched)return {storageId:matched[0],session:matched[1],legacy:false};
      const legacy=candidates.find(([,session])=>!text(session?.releaseId||session?.context?.releaseId)&&!text(session?.paperId||session?.context?.paperId));
      if(legacy)return {storageId:legacy[0],session:legacy[1],legacy:true};
      return null;
    }
    const newest=candidates.sort((a,b)=>Number(b[1]?.updatedAt||0)-Number(a[1]?.updatedAt||0))[0];
    return newest?{storageId:newest[0],session:newest[1],legacy:false}:null;
  }
  function get(input,userId=currentUserId()){
    const bucket=readBucket(userId),located=locate(bucket,input);
    if(!located)return null;
    const normalized=normalize(located.session,normalizeContext(input));
    if(located.legacy&&normalized.context.complete){
      bucket.sessions[normalized.contextKey]=normalized;
      delete bucket.sessions[located.storageId];
      writeBucket(bucket,userId);
    }
    return clone(normalized);
  }
  function save(session){
    const normalized=normalize({...clone(session),updatedAt:now()});
    const bucket=readBucket(normalized.userId);
    bucket.sessions[normalized.contextKey||contextKey(normalized.context||normalized)]=normalized;
    writeBucket(bucket,normalized.userId);
    return clone(normalized);
  }
  function ensure(context={},options={}){
    const normalizedContext=normalizeContext(context,{mode:options.mode});
    const userId=text(options.userId||context.userId||currentUserId());
    const existing=get(normalizedContext,userId);
    if(existing&&!(options.restartCompleted&&existing.status==='completed'))return existing;
    const attempt=existing?Number(existing.attempt||1)+1:1;
    return save(createSession(context,{...options,userId,attempt,mode:normalizedContext.mode||options.mode}));
  }
  function update(input,updater,userId=currentUserId()){
    const current=get(input,userId);if(!current)return null;
    const draft=clone(current);let next;
    if(typeof updater==='function')next=updater(draft)||draft;else next={...draft,...clone(updater||{})};
    next.updatedAt=now();return save(next);
  }
  function restart(context={},options={}){
    const normalizedContext=normalizeContext(context,{mode:options.mode});
    const userId=text(options.userId||context.userId||currentUserId());
    const existing=get(normalizedContext,userId);
    return save(createSession(context,{...options,userId,attempt:Number(existing?.attempt||0)+1,mode:normalizedContext.mode||options.mode}));
  }
  function remove(input,userId=currentUserId()){
    const bucket=readBucket(userId),located=locate(bucket,input);if(!located)return false;
    delete bucket.sessions[located.storageId];writeBucket(bucket,userId);return true;
  }
  function list(userId=currentUserId()){
    const bucket=readBucket(userId);
    return Object.values(bucket.sessions).map(session=>normalize(session)).sort((a,b)=>Number(b.updatedAt)-Number(a.updatedAt));
  }
  function readActive(mode='guided',userId=currentUserId()){
    try{const raw=global.sessionStorage?.getItem(activeKey(mode,userId));return raw?normalizeContext(JSON.parse(raw),{mode}):null}catch(error){return null}
  }
  function writeActive(context,userId=currentUserId()){
    const normalized=normalizeContext(context);try{global.sessionStorage?.setItem(activeKey(normalized.mode,userId),JSON.stringify({...normalized,activatedAt:now()}))}catch(error){}return normalized
  }
  function activate(context={},options={}){
    const normalized=normalizeContext(context,{mode:options.mode});
    const userId=text(options.userId||currentUserId());
    const previous=readActive(normalized.mode,userId);
    const changed=!previous||previous.key!==normalized.key;
    const session=ensure(normalized,{userId,mode:normalized.mode});
    if(changed&&previous){
      update(previous,draft=>{draft.transient={...draft.transient,active:false,deactivatedAt:now()};return draft},userId);
    }
    const active=update(normalized,draft=>{draft.transient={...draft.transient,active:true,activatedAt:now(),deactivatedAt:0};return draft},userId)||session;
    writeActive(normalized,userId);
    if(changed){
      try{global.dispatchEvent?.(new CustomEvent('kg:learning-session-context-changed',{detail:{previous:clone(previous),current:clone(normalized),mode:normalized.mode,userId,clearTransient:options.clearTransient!==false}}))}catch(error){}
    }
    return {changed,previous,current:normalized,session:active};
  }
  function clearActive(mode='guided',userId=currentUserId()){
    const previous=readActive(mode,userId);try{global.sessionStorage?.removeItem(activeKey(mode,userId))}catch(error){}return previous
  }

  const api=Object.freeze({STORAGE_PREFIX,ACTIVE_PREFIX,currentUserId,normalizeContext,contextKey,create:createSession,normalize,get,save,ensure,update,restart,remove,list,activate,active:readActive,clearActive});
  global.KGLearningSession=api;
  global.KGLearningSessionStore=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
