/* A template link opens a publication; only an explicit load makes a copy. */
(function(global){
  'use strict';
  function templateTarget(search){
    const value=new URLSearchParams(search).get('templateId')||'';
    return /^[a-zA-Z0-9_-]{1,64}$/.test(value)?value:'';
  }
  function createController({target,getUser,openCenter,onState}){
    let handledOwner='';
    function refresh(){
      if(!target)return;
      const owner=getUser();
      if(!owner){handledOwner='';onState('guest');return}
      if(handledOwner===owner)return;
      handledOwner=owner;onState('ready');openCenter({templateId:target});
    }
    return {refresh};
  }
  function init(){
    const target=templateTarget(global.location?.search||'');
    if(!target||!global.document?.body)return;
    const document=global.document,prompt=document.createElement('aside');prompt.className='graph-template-entry-prompt';prompt.setAttribute('aria-label','模板入口');
    const message=document.createElement('p');message.textContent='登录后预览这个学习模板。加载为新图谱需要你再次点击确认，不会替换当前文件。';
    const login=document.createElement('button');login.type='button';login.textContent='登录并查看模板';
    const dismiss=document.createElement('button');dismiss.type='button';dismiss.textContent='暂不查看';
    prompt.append(message,login,dismiss);prompt.hidden=true;document.body.append(prompt);
    const getUser=()=>global.KGAuthCore?.currentUser?.()?.username||'';
    const controller=createController({target,getUser,openCenter:options=>global.KGGraphTemplateCenter?.open(options),onState:state=>{prompt.hidden=state!=='guest'}});
    login.addEventListener('click',()=>{prompt.hidden=true;document.getElementById('authLoginBtn')?.click()});
    dismiss.addEventListener('click',()=>{prompt.hidden=true});
    global.addEventListener?.('kg-auth-session-change',()=>{global.setTimeout(()=>controller.refresh(),0)});
    // A template URL already selects the graph destination. Close the generic
    // post-login chooser through its existing action before it can leave this
    // publication dialog inert or hidden from assistive technology.
    const enterGraph=()=>{if(getUser())global.setTimeout(()=>document.getElementById('learningEntryDismissBtn')?.click(),0)};
    global.addEventListener?.('kg-learning-entry-dialog-opened',enterGraph);
    enterGraph();controller.refresh();
  }
  global.KGTemplateDeepLink={init};
  if(typeof module==='object'&&module.exports)module.exports={templateTarget,createController};
  else if(global.document?.readyState==='loading')global.document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})(typeof window!=='undefined'?window:globalThis);
