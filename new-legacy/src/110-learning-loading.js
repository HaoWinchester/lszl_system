'use strict';

(function(global){
  let root=null;

  function ensure(){
    if(root&&root.isConnected)return root;
    const doc=global.document;
    if(!doc?.body)return null;
    root=doc.createElement('div');
    root.className='learning-loading-backdrop';
    root.hidden=true;
    root.dataset.learningLoading='true';
    root.setAttribute('role','status');
    root.setAttribute('aria-live','polite');
    root.setAttribute('aria-atomic','true');
    root.setAttribute('aria-busy','false');
    root.innerHTML='<div class="learning-loading-card"><span class="learning-loading-spinner" aria-hidden="true"></span><strong data-learning-loading-title></strong><span data-learning-loading-message></span></div>';
    doc.body.appendChild(root);
    return root;
  }

  function show({title='正在加载',message='请稍候…'}={}){
    const node=ensure();
    if(!node)return null;
    node.querySelector('[data-learning-loading-title]').textContent=String(title||'正在加载');
    node.querySelector('[data-learning-loading-message]').textContent=String(message||'请稍候…');
    node.hidden=false;
    node.setAttribute('aria-busy','true');
    return node;
  }

  function hide(){
    const node=ensure();
    if(!node)return;
    node.hidden=true;
    node.setAttribute('aria-busy','false');
  }

  global.KGLearningLoading=Object.freeze({show,hide});
})(typeof window!=='undefined'?window:globalThis);
