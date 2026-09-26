'use strict';

// Hold an import for its entire async lifetime, including file reads and reloads.
(function(global){
  const pending=new Map();
  function run(key,task,controls=[]){
    if(pending.has(key))return pending.get(key);
    const nodes=controls.map(value=>typeof value==='string'?global.document?.getElementById(value):value).filter(Boolean);
    const previous=nodes.map(node=>({node,disabled:node.disabled}));
    previous.forEach(({node})=>{node.disabled=true;node.setAttribute?.('aria-busy','true')});
    let start;
    const work=new Promise((resolve,reject)=>{start=()=>{try{resolve(task())}catch(error){reject(error)}}});
    const promise=work.finally(()=>{
      pending.delete(key);
      previous.forEach(({node,disabled})=>{node.disabled=disabled;node.removeAttribute?.('aria-busy')});
    });
    pending.set(key,promise);
    start();
    return promise;
  }
  function fileHandler(task){
    return event=>run('prep-file-import',()=>task(event),Array.from(global.document.querySelectorAll('input[type="file"]')));
  }
  global.KGImportGuard=Object.freeze({run,fileHandler,isBusy:key=>pending.has(key)});
})(globalThis);
