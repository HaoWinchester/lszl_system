/* Shared, demand-only classic script/style loading with retry and dependency ordering. */
(function(global){
  'use strict';
  const assets=new Map();
  function asset(kind,url){
    const key=kind+':'+url;if(assets.has(key))return assets.get(key);
    const promise=new Promise((resolve,reject)=>{
      const node=document.createElement(kind==='style'?'link':'script');
      if(kind==='style'){node.rel='stylesheet';node.href=url}else{node.async=false;node.src=url}
      node.onload=()=>resolve(node);node.onerror=()=>{node.remove();assets.delete(key);reject(new Error('资源加载失败，请重试：'+url))};
      document.head.appendChild(node);
    });assets.set(key,promise);return promise;
  }
  function create({groups,loadScript=url=>asset('script',url),loadStyle=url=>asset('style',url)}){
    const records=new Map();
    function load(name){
      const config=groups[name];if(!config)return Promise.reject(new Error('未知功能资源组：'+name));
      const existing=records.get(name);if(existing?.promise)return existing.promise;
      const record={state:'loading',promise:null};records.set(name,record);
      record.promise=(async()=>{
        for(const dependency of config.depends||[])await load(dependency);
        await Promise.all((config.styles||[]).map(loadStyle));
        for(const script of config.scripts||[])await loadScript(script);
        record.state='ready';
      })().catch(error=>{record.state='error';record.promise=null;throw error});
      return record.promise;
    }
    return Object.freeze({load,state:name=>records.get(name)?.state||'idle'});
  }
  global.KGFeatureAssets=Object.freeze({create,forget:(kind,url)=>assets.delete(kind+':'+url),loadScript:url=>asset('script',url),loadStyle:url=>asset('style',url)});
})(typeof window!=='undefined'?window:globalThis);
