'use strict';
(function(){
  const byId=id=>document.getElementById(id);
  function activateQuestionWorkspace(name,updateUrl=true){
    const safe=name==='entry'?'entry':'library';
    document.querySelectorAll('[data-question-workspace]').forEach(button=>{const active=button.dataset.questionWorkspace===safe;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active))});
    document.querySelectorAll('[data-question-workspace-panel]').forEach(panel=>{const active=panel.dataset.questionWorkspacePanel===safe;panel.hidden=!active;panel.classList.toggle('active',active)});
    if(safe==='entry'){
      const frame=byId('questionEntryFrame');if(frame&&!frame.hasAttribute('src'))frame.src=frame.dataset.embedSrc;
    }
    if(updateUrl){const url=new URL(location.href);safe==='library'?url.searchParams.delete('workspace'):url.searchParams.set('workspace',safe);history.replaceState(null,'',url)}
  }
  function initQuestionWorkspace(){
    const tabs=document.querySelectorAll('[data-question-workspace]');const params=new URLSearchParams(location.search);const requested=params.get('workspace');
    if(!tabs.length){
      if(requested==='entry'){
        document.querySelector('[data-main-tab="base"]')?.click();document.querySelector('[data-tq-entry-mode="paste"]')?.click();
        const url=new URL(location.href);url.searchParams.delete('workspace');url.searchParams.set('view','content');url.searchParams.set('entry','paste');history.replaceState(null,'',url);
        requestAnimationFrame(()=>byId('tqPasteInput')?.focus());
      }
      return;
    }
    tabs.forEach(button=>button.addEventListener('click',()=>activateQuestionWorkspace(button.dataset.questionWorkspace)));
    activateQuestionWorkspace(requested==='entry'?'entry':'library',false);
  }
  function initFrameReloads(){
    document.querySelectorAll('[data-reload-embedded]').forEach(button=>button.addEventListener('click',()=>{const frame=byId(button.dataset.reloadEmbedded);if(frame&&frame.src)frame.contentWindow.location.reload()}));
  }
  function receiveHeight(event){
    if(!event.data||event.data.type!=='kg-embedded-workspace-height')return;
    const frame=[...document.querySelectorAll('iframe[data-embed-frame]')].find(item=>item.contentWindow===event.source);if(!frame)return;
    const height=Math.max(620,Math.min(Number(event.data.height)||800,1800));frame.style.height=`${height}px`;
  }
  function init(){initQuestionWorkspace();initFrameReloads();window.addEventListener('message',receiveHeight)}
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init):init();
})();
