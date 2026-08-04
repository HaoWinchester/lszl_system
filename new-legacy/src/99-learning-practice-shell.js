
'use strict';
(function(){
  function syncSingleQuestionChrome(){
    const root=document.documentElement,topbar=document.querySelector('.question-training-page .qt-topbar');
    if(topbar){
      root.style.setProperty('--qt-topbar-bottom',Math.max(0,Math.round(topbar.getBoundingClientRect().bottom))+'px');
    }
    const zoom=document.querySelector('.question-training-page #qtCanvasZoomDock');
    if(zoom){
      const gap=Math.max(0,Math.round(window.innerHeight-zoom.getBoundingClientRect().bottom));
      root.style.setProperty('--qt-bottom-tool-gap',gap+'px');
    }
  }
  function initSingleQuestionChrome(){
    syncSingleQuestionChrome();requestAnimationFrame(syncSingleQuestionChrome);
    window.addEventListener('resize',syncSingleQuestionChrome,{passive:true});
    if(window.ResizeObserver){
      const topbar=document.querySelector('.question-training-page .qt-topbar');
      const canvas=document.querySelector('.question-training-page #qtCanvasShell');
      const observer=new ResizeObserver(syncSingleQuestionChrome);
      if(topbar)observer.observe(topbar);if(canvas)observer.observe(canvas);
    }
  }
  initSingleQuestionChrome();

  function closeMenus(except){document.querySelectorAll('details.lp-view-menu[open]').forEach(item=>{if(item!==except)item.removeAttribute('open')})}
  function syncMirror(el){const target=document.getElementById(el.dataset.lpMirrorTarget||'');if(!target)return;const apply=()=>{el.textContent=target.textContent||'100%'};apply();new MutationObserver(apply).observe(target,{childList:true,subtree:true,characterData:true})}
  document.addEventListener('DOMContentLoaded',()=>document.querySelectorAll('[data-lp-mirror-target]').forEach(syncMirror));
  document.addEventListener('click',event=>{
    const proxy=event.target.closest?.('[data-lp-proxy-target]');
    if(proxy){const target=document.getElementById(proxy.dataset.lpProxyTarget||'');if(target){event.preventDefault();target.click()}return}
    const menu=event.target.closest?.('details.lp-view-menu');if(menu){closeMenus(menu);return}closeMenus(null);
  });
  window.addEventListener('kg:question-language-mode',()=>{if(document.body?.matches?.('.question-training-page')){try{window.KGCardRuntime?.update?.('answer-card','language-mode')}catch(e){}try{if(!window.KGCardRuntime?.isMounted?.('answer-card')&&typeof window.renderQuestionTrainer==='function')window.renderQuestionTrainer()}catch(e){}}});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenus(null)});
})();

