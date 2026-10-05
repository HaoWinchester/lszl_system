'use strict';

(function(global){
  let root=null;
  // 每次加载随机展示一条鼓励语，让等待不那么枯燥。
  const ENCOURAGEMENTS=[
    '知识正在向你赶来…',
    '坚持是通往优秀最短的路！',
    '每一秒等待，都是知识的沉淀',
    '学习加油，马上就好～',
    '你在进步的路上，稳稳的',
    '深呼吸，好内容即将呈现',
    '日拱一卒，功不唐捐',
    '今天的你比昨天更接近目标',
    '稍等片刻，知识地图正在展开',
    '为坚持学习的你点个赞！'
  ];
  function pickEncouragement(){
    const list=ENCOURAGEMENTS;
    if(!list.length)return '请稍候…';
    return list[Math.floor(Math.random()*list.length)];
  }

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

  function show({title='正在加载',message}={}){
    const node=ensure();
    if(!node)return null;
    node.querySelector('[data-learning-loading-title]').textContent=String(title||'正在加载');
    node.querySelector('[data-learning-loading-message]').textContent=String(message||pickEncouragement());
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
