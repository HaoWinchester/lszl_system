'use strict';

(function(global){
  function clone(value){try{return JSON.parse(JSON.stringify(value))}catch(error){return value}}
  function create(options={}){
    let payload=null;
    function write(nodes){payload=Array.isArray(nodes)?clone(nodes):null;if(typeof options.onChange==='function')options.onChange({type:'write',count:payload?.length||0});return payload?.length||0}
    function read(){return clone(payload||[])}
    function clear(){payload=null;if(typeof options.onChange==='function')options.onChange({type:'clear'})}
    function hasData(){return !!(payload&&payload.length)}
    function bounds(nodes=payload||[]){
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      for(const item of nodes||[]){const x=Number(item.x)||0,y=Number(item.y)||0,w=Number(item.w||item.width)||128,h=Number(item.h||item.height)||132;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x+w);maxY=Math.max(maxY,y+h)}
      if(!Number.isFinite(minX))return{x:0,y:0,w:0,h:0,cx:0,cy:0};
      return{x:minX,y:minY,w:maxX-minX,h:maxY-minY,cx:(minX+maxX)/2,cy:(minY+maxY)/2};
    }
    function placeAt(point,nodes=payload||[]){const list=clone(nodes||[]),box=bounds(list),x=Number(point&&point.x)||0,y=Number(point&&point.y)||0;return list.map(item=>({...item,x:Math.round(x+(Number(item.x)||0)-box.cx),y:Math.round(y+(Number(item.y)||0)-box.cy)}))}
    return Object.freeze({write,read,clear,hasData,bounds,placeAt});
  }
  global.KGGraphClipboardController=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
