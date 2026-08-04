'use strict';

/*
 * PracticeNavigation v1
 * 学习路径与自由练习页之间的轻量返回上下文。
 * 自由练习不写入课程成绩、节点完成或解锁状态。
 */
(function(global){
  const CONTEXT_KEY='kg_guided_practice_return_v1';

  function safeUrl(value,base){
    try{return new URL(String(value||''),base||global.location?.href||'http://localhost/')}catch(error){return null}
  }
  function currentParams(){
    try{return new URLSearchParams(global.location?.search||'')}catch(error){return new URLSearchParams()}
  }
  function normalizeReturnUrl(value,fallback='learning-path.html'){
    const url=safeUrl(value,global.location?.href);
    if(!url)return String(fallback||'learning-path.html');
    const current=safeUrl(global.location?.href);
    if(current&&url.origin!==current.origin)return String(fallback||'learning-path.html');
    return url.pathname.split('/').pop()+(url.search||'')+(url.hash||'');
  }
  function saveContext(context={}){
    const payload={
      source:String(context.source||'guided-learning'),
      stageId:String(context.stageId||''),
      partId:String(context.partId||''),
      entryId:String(context.entryId||''),
      returnUrl:normalizeReturnUrl(context.returnUrl||'learning-path.html'),
      scrollLeft:Math.max(0,Number(context.scrollLeft)||0),
      scrollTop:Math.max(0,Number(context.scrollTop)||0),
      savedAt:Date.now()
    };
    try{global.sessionStorage?.setItem(CONTEXT_KEY,JSON.stringify(payload))}catch(error){}
    return payload;
  }
  function readContext(){
    try{
      const payload=JSON.parse(global.sessionStorage?.getItem(CONTEXT_KEY)||'null');
      if(!payload||typeof payload!=='object')return null;
      if(Date.now()-Number(payload.savedAt||0)>6*60*60*1000)return null;
      return payload;
    }catch(error){return null}
  }
  function clearContext(){try{global.sessionStorage?.removeItem(CONTEXT_KEY)}catch(error){}}
  function returnUrl(fallback='learning-path.html'){
    const params=currentParams();
    const explicit=params.get('return');
    if(explicit)return normalizeReturnUrl(explicit,fallback);
    return normalizeReturnUrl(readContext()?.returnUrl||fallback,fallback);
  }
  function isGuidedPractice(){
    const params=currentParams();
    return params.get('practice')==='1'||params.get('source')==='guided-learning'||readContext()?.source==='guided-learning';
  }
  function buildPracticeHref(target,context={}){
    const base=safeUrl(target,global.location?.href);
    if(!base)return String(target||'');
    const returnTarget=new URL('learning-path.html',global.location?.href||base.href);
    if(context.stageId)returnTarget.searchParams.set('stage',String(context.stageId));
    if(context.partId)returnTarget.searchParams.set('part',String(context.partId));
    returnTarget.searchParams.set('practiceReturn','1');
    const returnValue=returnTarget.pathname.split('/').pop()+returnTarget.search;
    base.searchParams.set('practice','1');
    base.searchParams.set('source','guided-learning');
    base.searchParams.set('return',returnValue);
    if(context.stageId)base.searchParams.set('stage',String(context.stageId));
    if(context.partId)base.searchParams.set('part',String(context.partId));
    if(context.entryId)base.searchParams.set('entry',String(context.entryId));
    return base.pathname.split('/').pop()+base.search+base.hash;
  }
  function goBack(fallback='learning-path.html'){
    const destination=returnUrl(fallback);
    clearContext();
    if(global.location)global.location.href=destination;
    return destination;
  }
  function applyPageContext(){
    const guided=isGuidedPractice();
    try{global.document?.body?.classList.toggle('is-guided-practice',guided)}catch(error){}
    const back=global.document?.querySelector?.('[data-practice-back]');
    if(back){
      back.setAttribute('href',returnUrl(back.getAttribute('href')||'learning-path.html'));
      back.addEventListener('click',event=>{
        if(!guided)return;
        event.preventDefault();
        goBack(back.getAttribute('href')||'learning-path.html');
      });
    }
    global.document?.querySelectorAll?.('[data-practice-only]').forEach(element=>{element.hidden=!guided});
  }

  const api=Object.freeze({saveContext,readContext,clearContext,returnUrl,isGuidedPractice,buildPracticeHref,goBack,applyPageContext,normalizeReturnUrl});
  global.KGPracticeNavigation=api;
  if(typeof document!=='undefined')document.addEventListener('DOMContentLoaded',applyPageContext);
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
