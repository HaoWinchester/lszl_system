'use strict';
(function(){
  const root=document.documentElement;
  if(!root.classList.contains('kg-embedded')||window.parent===window)return;
  const params=new URLSearchParams(location.search),source=params.get('embed')||root.dataset.embedMode||'workspace';
  let timer=0;
  function report(){
    clearTimeout(timer);timer=setTimeout(()=>{
      const height=Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0,620);
      window.parent.postMessage({type:'kg-embedded-workspace-height',source,height},'*');
    },40);
  }
  window.addEventListener('load',report);window.addEventListener('resize',report);document.addEventListener('click',report);document.addEventListener('input',report);
  if('ResizeObserver'in window)new ResizeObserver(report).observe(document.body);else setInterval(report,1200);
  report();
})();
