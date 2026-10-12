'use strict';

(function(global){
  function clone(value){return JSON.parse(JSON.stringify(value))}
  function create(options={}){
    let payload=null;
    function write(nodes){payload=Array.isArray(nodes)?clone(nodes):null;if(typeof options.onChange==='function')options.onChange({type:'write',count:payload?.length||0});return payload?.length||0}
    function writeFragment(fragment){global.KGGraphFragment.validate(fragment);payload=clone(fragment);return payload.nodes.length+payload.elements.length+payload.tables.length}
    function readFragment(){return payload&&!Array.isArray(payload)?clone(payload):null}
    function read(){return clone(Array.isArray(payload)?payload:payload?.nodes||[])}
    function exportEvent(event){const fragment=readFragment();if(!fragment||!event.clipboardData)return false;const text=JSON.stringify(fragment);event.clipboardData.setData(global.KGGraphFragment.mime,text);event.clipboardData.setData('text/plain',text);return true}
    function importEvent(event){const data=event.clipboardData;if(!data)return false;const fragment=global.KGGraphFragment.parse(data.getData(global.KGGraphFragment.mime)||data.getData('text/plain'));if(!fragment)return false;writeFragment(fragment);return true}
    function clear(){payload=null;if(typeof options.onChange==='function')options.onChange({type:'clear'})}
    function hasData(){return !!(payload&&(Array.isArray(payload)?payload.length:payload.nodes.length+payload.elements.length+payload.tables.length))}
    function bounds(nodes=read()){
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      for(const item of nodes||[]){const geometry=item.geometry||item,x=Number(geometry.x??item.x)||0,y=Number(geometry.y??item.y)||0,w=Number(geometry.width||item.w||item.width)||128,h=Number(geometry.height||item.h||item.height)||132;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x+w);maxY=Math.max(maxY,y+h)}
      if(!Number.isFinite(minX))return{x:0,y:0,w:0,h:0,cx:0,cy:0};
      return{x:minX,y:minY,w:maxX-minX,h:maxY-minY,cx:(minX+maxX)/2,cy:(minY+maxY)/2};
    }
    function placeAt(point,nodes=read()){const list=clone(nodes||[]),box=bounds(list),x=Number(point&&point.x)||0,y=Number(point&&point.y)||0;return list.map(item=>({...item,x:Math.round(x+(Number(item.x)||0)-box.cx),y:Math.round(y+(Number(item.y)||0)-box.cy)}))}
    return Object.freeze({write,read,writeFragment,readFragment,exportEvent,importEvent,clear,hasData,bounds,placeAt});
  }
  global.KGGraphClipboardController=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
