'use strict';

(function(global){
  const ACTIONS=Object.freeze(['raise','lower','front','back']);
  const ACTION_SET=new Set(ACTIONS);
  function idOf(item){return item&&item.id!=null?String(item.id):''}
  function selectedSet(ids){return new Set((Array.isArray(ids)?ids:[ids]).map(String).filter(Boolean))}
  function sameOrder(a,b){return a.length===b.length&&a.every((item,index)=>item===b[index])}
  function reorder(items,ids,action){
    const source=Array.isArray(items)?items:[],selected=selectedSet(ids),mode=String(action||'');
    if(!ACTION_SET.has(mode)||!selected.size)return{items:source.slice(),changed:false};
    const next=source.slice();
    if(mode==='raise'){
      for(let index=next.length-2;index>=0;index--){
        if(selected.has(idOf(next[index]))&&!selected.has(idOf(next[index+1]))) [next[index],next[index+1]]=[next[index+1],next[index]];
      }
    }else if(mode==='lower'){
      for(let index=1;index<next.length;index++){
        if(selected.has(idOf(next[index]))&&!selected.has(idOf(next[index-1]))) [next[index],next[index-1]]=[next[index-1],next[index]];
      }
    }else{
      const picked=next.filter(item=>selected.has(idOf(item))),rest=next.filter(item=>!selected.has(idOf(item)));
      next.splice(0,next.length,...(mode==='front'?[...rest,...picked]:[...picked,...rest]));
    }
    return{items:next,changed:!sameOrder(source,next)};
  }
  global.KGGraphLayerController=Object.freeze({ACTIONS,reorder});
})(typeof window!=='undefined'?window:globalThis);
