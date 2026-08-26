'use strict';

(function installHomepageLoader(global){
  if(global.KGHomepageLoader)return;

  const groups=Object.freeze({
    graph:{bundle:'home-graph',style:true},
    fileLibrary:{bundle:'home-file-library',style:true},
    question:{bundle:'home-question',style:false},
    secondary:{bundle:'home-secondary',style:true}
  });
  const records=new Map(Object.keys(groups).map(name=>[name,{state:'idle',promise:null,nodes:[]}]))
  const replaying=new WeakSet();

  function version(){
    return document.querySelector('meta[name="kg-homepage-bundle-version"]')?.content||'';
  }
  function url(bundle,extension){
    const release=version();
    return `bundles/${bundle}.${extension}${release?`?v=${encodeURIComponent(release)}`:''}`;
  }
  function graphStatus(state,message){
    document.documentElement.dataset.homeGraphState=state;
    const status=document.getElementById('status');
    if(!status)return;
    status.textContent=message;
    status.classList?.add?.('show');
    if(state==='error'){
      const retry=document.createElement('button');
      retry.type='button';
      retry.className='home-graph-retry';
      retry.textContent='重试';
      retry.addEventListener('click',()=>load('graph'));
      status.append(retry);
    }
  }
  function appendAsset(kind,bundle){
    return new Promise((resolve,reject)=>{
      const node=document.createElement(kind==='style'?'link':'script');
      if(kind==='style'){
        node.rel='stylesheet';
        node.href=url(bundle,'css');
      }else{
        node.async=false;
        node.src=url(bundle,'js');
      }
      node.onload=()=>resolve(node);
      node.onerror=()=>reject(new Error(`homepage ${bundle} ${kind} load failed`));
      document.head.appendChild(node);
    });
  }
  async function initialize(name){
    if(name==='graph'&&global.KGHomepageGraphBootstrap&&typeof global.KGHomepageGraphBootstrap.then==='function'){
      await global.KGHomepageGraphBootstrap;
    }
    if(name==='fileLibrary'&&global.KGGraphFileTabs?.init)await global.KGGraphFileTabs.init();
    if(name==='question'){
      global.bindQuestionTrainer?.();
      global.bindQuestionBankManager?.();
      global.bindQuestionTrainerSafe?.();
      global.ensureQuestionFontScale?.();
    }
  }
  function dispatch(type,name,error){
    global.dispatchEvent(new CustomEvent(type,{detail:{group:groups[name].bundle.replace(/^home-/,''),...(error?{error}: {})}}));
  }
  function load(name){
    const config=groups[name];
    const record=records.get(name);
    if(!config)return Promise.reject(new Error(`unknown homepage group: ${name}`));
    if(record.state==='ready')return record.promise||Promise.resolve();
    if(record.promise)return record.promise;
    record.state='loading';
    if(name==='graph')graphStatus('loading','正在加载当前知识图谱…');
    const pending=[];
    if(config.style)pending.push(appendAsset('style',config.bundle));
    pending.push(appendAsset('script',config.bundle));
    record.promise=Promise.all(pending)
      .then(nodes=>{
        record.nodes=nodes;
        return initialize(name);
      })
      .then(()=>{
        record.state='ready';
        if(name==='graph')graphStatus('ready','当前知识图谱已加载');
        dispatch('kg:homepage-group-ready',name);
      })
      .catch(error=>{
        for(const node of record.nodes)node.remove?.();
        for(const item of pending)item.catch(()=>{});
        document.querySelectorAll?.(`link[href*="${config.bundle}.css"],script[src*="${config.bundle}.js"]`)?.forEach?.(node=>node.remove?.());
        record.nodes=[];
        record.promise=null;
        record.state='error';
        if(name==='graph')graphStatus('error','知识图谱加载失败，请重试');
        dispatch('kg:homepage-group-error',name,error);
        throw error;
      });
    return record.promise;
  }
  function replayAfterLoad(event,name){
    const target=event.target?.closest?.(selectors[name]);
    if(!target||replaying.has(target)||records.get(name).state==='ready')return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    load(name).then(()=>{
      replaying.add(target);
      target.click?.();
      replaying.delete(target);
    }).catch(error=>console.warn(`[KGHomepageLoader] ${name} unavailable`,error));
  }
  const selectors=Object.freeze({
    fileLibrary:'#graphFileHomeBtn,#graphFileAddBtn,[data-open-file-library],[data-open-file-tabs]',
    question:'#questionBankBtn,#questionTrainerBtn,#openQuestionTrainerBtn,[data-open-question-bank],[data-open-question-trainer]',
    secondary:'#accountMenuUserCenterBtn,#accountMenuUpgradeBtn,#supportCenterBtn,[data-support-action],[data-open-subscription-detail]'
  });
  document.addEventListener('click',event=>{
    replayAfterLoad(event,'fileLibrary');
    replayAfterLoad(event,'question');
    replayAfterLoad(event,'secondary');
  },true);

  const api=Object.freeze({
    loadGraph:()=>load('graph'),
    loadFileLibrary:()=>load('fileLibrary'),
    loadQuestion:()=>load('question'),
    loadSecondary:()=>load('secondary'),
    state:name=>records.get(name)?.state||'unknown'
  });
  global.KGHomepageLoader=api;
  const schedule=global.requestAnimationFrame||function(callback){return global.setTimeout(callback,0)};
  schedule(()=>api.loadGraph().catch(error=>console.warn('[KGHomepageLoader] graph unavailable',error)));
})(window);
