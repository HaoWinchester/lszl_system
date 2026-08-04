'use strict';
(function(global){
  const names=Object.freeze(['arrow-left','chevron-down','circle-help','circle-user-round','diamond','heart','library','log-in','log-out','palette','plus','sparkles','timer','x','zap']);
  const allowed=new Set(names);
  const fallback='circle-help';
  const warned=new Set();
  const script=global.document&&global.document.currentScript;
  const sprite=script&&script.src?new URL('../assets/icons/lucide-learning.svg',script.src).href:'assets/icons/lucide-learning.svg';
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const normalizeSize=value=>[16,18,20].includes(Number(value))?Number(value):18;
  function isDevelopment(){
    const location=global.location;
    return !!location&&(location.protocol==='file:'||['localhost','127.0.0.1','0.0.0.0','::1','[::1]'].includes(location.hostname));
  }
  function resolve(name){
    const value=String(name||'');
    if(allowed.has(value))return value;
    if(isDevelopment()&&!warned.has(value)&&global.console&&typeof global.console.warn==='function'){
      warned.add(value);
      global.console.warn(`[KGLearningIcons] Unknown icon "${value||'(empty)'}"; using "${fallback}".`);
    }
    return fallback;
  }
  function render(name,{label='',size=18,className=''}={}){
    const resolved=resolve(name),safeSize=normalizeSize(size);
    const accessibility=label?`role="img" aria-label="${esc(label)}"`:'aria-hidden="true" focusable="false"';
    return `<svg class="kg-icon${className?' '+esc(className):''}" width="${safeSize}" height="${safeSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${accessibility}><use href="${esc(sprite)}#${resolved}"></use></svg>`;
  }
  function hydrate(root=global.document){
    if(!root||!root.querySelectorAll)return 0;
    const nodes=[];
    if(root.matches&&root.matches('[data-kg-icon]'))nodes.push(root);
    nodes.push(...root.querySelectorAll('[data-kg-icon]'));
    nodes.forEach(node=>{
      const name=resolve(node.dataset.kgIcon),label=node.dataset.kgIconLabel||'',size=normalizeSize(node.dataset.kgIconSize||18);
      const signature=JSON.stringify([name,label,size]);
      if(node.dataset.kgIconHydrated===name&&node.dataset.kgIconHydration===signature)return;
      node.innerHTML=render(name,{label,size});
      node.dataset.kgIconHydrated=name;
      node.dataset.kgIconHydration=signature;
    });
    return nodes.length;
  }
  const api=Object.freeze({names,render,hydrate});
  global.KGLearningIcons=api;
  if(global.document){
    if(global.document.readyState==='loading')global.document.addEventListener('DOMContentLoaded',()=>hydrate(),{once:true});
    else hydrate();
  }
})(typeof window==='object'?window:globalThis);
