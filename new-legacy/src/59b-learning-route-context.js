'use strict';

/*
 * LearningRouteContext
 * 集中管理三个学习页面的 URL 参数、固定发布上下文、页面跳转与返回地址。
 */
(function(global){
  const SESSION_PREFIX='kg_learning_route_context_v1__';
  const MODE_PAGES=Object.freeze({
    deep_recall:'knowledge-recall.html',
    multi_question_canvas:'question-workspace.html',
    single_deep_study:'question-training.html'
  });
  function text(value){return String(value==null?'':value)}
  function clone(value){try{return JSON.parse(JSON.stringify(value))}catch(error){return value}}
  function safeUrl(value,base){try{return new URL(text(value),base||global.location?.href||'http://localhost/')}catch(error){return null}}
  function normalizeReturnUrl(value,fallback='index.html'){
    const url=safeUrl(value,global.location?.href);
    if(!url)return text(fallback||'index.html');
    const current=safeUrl(global.location?.href);
    if(current&&url.origin!==current.origin)return text(fallback||'index.html');
    return url.pathname.split('/').pop()+(url.search||'')+(url.hash||'');
  }
  function normalize(input={},defaults={}){
    const resolver=global.KGPublishedQuestionResolver;
    const base=resolver?.normalizeContext?resolver.normalizeContext(input,defaults):{
      paperId:text(input.paperId||input.sourcePaperId||defaults.paperId),
      releaseId:text(input.releaseId||input.sourceReleaseId||defaults.releaseId),
      questionId:text(input.questionId||input.sourceQuestionId||input.id||defaults.questionId),
      bankId:text(input.bankId||input.sourceBankId||defaults.bankId),
      mode:text(input.mode||defaults.mode),
      source:text(input.source||defaults.source),
      workspaceId:text(input.workspaceId||input.workspace||defaults.workspaceId),
      returnUrl:text(input.returnUrl||input.return||defaults.returnUrl)
    };
    const next={...base};
    next.returnUrl=normalizeReturnUrl(next.returnUrl||defaults.returnUrl||'index.html');
    next.page=text(input.page||defaults.page||MODE_PAGES[next.mode]||'');
    next.key=[next.paperId,next.releaseId,next.questionId].map(encodeURIComponent).join('::');
    next.complete=!!(next.paperId&&next.releaseId&&next.questionId);
    return next;
  }
  function paramsFrom(search){
    try{return new URLSearchParams(search==null?(global.location?.search||''):text(search))}catch(error){return new URLSearchParams()}
  }
  function parse(options={}){
    const params=paramsFrom(options.search);
    return normalize({
      paperId:params.get('paperId')||params.get('paper')||'',
      releaseId:params.get('releaseId')||params.get('release')||'',
      questionId:params.get('questionId')||params.get('question')||'',
      bankId:params.get('bankId')||params.get('bank')||'',
      mode:params.get('mode')||options.mode||'',
      source:params.get('source')||'',
      workspaceId:params.get('workspace')||params.get('workspaceId')||'',
      returnUrl:params.get('return')||params.get('returnUrl')||options.returnUrl||''
    },options);
  }
  function sessionKey(mode=''){return SESSION_PREFIX+encodeURIComponent(text(mode||'learning'))}
  function remember(context,options={}){
    const normalized=normalize(context,options);
    const payload={...normalized,savedAt:Date.now()};
    try{global.sessionStorage?.setItem(sessionKey(normalized.mode),JSON.stringify(payload))}catch(error){}
    return payload;
  }
  function read(mode='',maxAge=12*60*60*1000){
    try{
      const payload=JSON.parse(global.sessionStorage?.getItem(sessionKey(mode))||'null');
      if(!payload||typeof payload!=='object')return null;
      if(maxAge>0&&Date.now()-Number(payload.savedAt||0)>maxAge)return null;
      return normalize(payload,{mode});
    }catch(error){return null}
  }
  function clear(mode=''){try{global.sessionStorage?.removeItem(sessionKey(mode))}catch(error){}}
  function applyParams(url,context,options={}){
    const normalized=normalize(context,options);
    const set=(key,value)=>{if(value)url.searchParams.set(key,value);else if(options.removeEmpty!==false)url.searchParams.delete(key)};
    set('paperId',normalized.paperId);
    set('releaseId',normalized.releaseId);
    set('questionId',normalized.questionId);
    set('bankId',normalized.bankId);
    if(options.includeMode)set('mode',normalized.mode);
    set('source',normalized.source);
    set('workspace',normalized.workspaceId);
    if(normalized.returnUrl&&normalized.returnUrl!=='index.html')set('return',normalized.returnUrl);else if(options.removeEmpty!==false)url.searchParams.delete('return');
    ['paper','release','question','bank','workspaceId','returnUrl','collectionId'].forEach(key=>url.searchParams.delete(key));
    return url;
  }
  function buildHref(target,context={},options={}){
    const normalized=normalize(context,options);
    const page=text(target||normalized.page||MODE_PAGES[normalized.mode]||global.location?.pathname?.split('/').pop()||'index.html');
    const url=safeUrl(page,global.location?.href);
    if(!url)return page;
    applyParams(url,normalized,options);
    return url.pathname.split('/').pop()+url.search+url.hash;
  }
  function replace(context={},options={}){
    const href=buildHref(options.target||'',context,options);
    try{global.history?.replaceState?.(options.state||null,'',href)}catch(error){}
    remember(context,options);
    return href;
  }
  function push(context={},options={}){
    const href=buildHref(options.target||'',context,options);
    try{global.history?.pushState?.(options.state||null,'',href)}catch(error){}
    remember(context,options);
    return href;
  }
  function navigate(target,context={},options={}){
    const href=buildHref(target,context,options);
    remember(context,options);
    if(options.newTab){global.open?.(href,'_blank');return href}
    if(global.location)global.location.href=href;
    return href;
  }
  function returnUrl(context={},fallback='index.html'){
    const normalized=normalize(context,{returnUrl:fallback});
    return normalizeReturnUrl(normalized.returnUrl||fallback,fallback);
  }
  function goBack(context={},fallback='index.html'){
    const destination=returnUrl(context,fallback);
    if(global.location)global.location.href=destination;
    return destination;
  }
  function withResolved(result,route={},options={}){
    if(!result?.ok)return normalize(route,options);
    return normalize({...route,...result.context,paperId:result.paper?.paperId||result.context?.paperId,releaseId:result.paper?.releaseId||result.context?.releaseId,questionId:result.question?.id||result.context?.questionId,bankId:result.bank?.id||result.context?.bankId},options);
  }

  const api=Object.freeze({SESSION_PREFIX,MODE_PAGES,normalize,parse,remember,read,clear,buildHref,replace,push,navigate,returnUrl,goBack,normalizeReturnUrl,withResolved,clone});
  global.KGLearningRouteContext=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
