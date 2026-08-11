'use strict';
(function(global){
  const Store=global.KGAppStorage||{};
  const KEY='kg_synthesis_preset_repository_v1';
  const clone=value=>{try{return JSON.parse(JSON.stringify(value))}catch(error){return value}};
  const now=()=>Date.now();
  function readRaw(){try{return Store.readJSON?Store.readJSON(KEY,null):JSON.parse(localStorage.getItem(KEY)||'null')}catch(error){return null}}
  function writeRaw(value){try{return Store.writeJSON?Store.writeJSON(KEY,value):(localStorage.setItem(KEY,JSON.stringify(value)),true)}catch(error){return false}}
  function normalize(item={},index=0){return {id:String(item.id||('preset-'+now().toString(36)+'-'+index)),principleId:String(item.principleId||''),title:String(item.title||'').trim(),content:String(item.content||item.description||'').trim(),status:['draft','active','inactive'].includes(String(item.status||''))?String(item.status):'draft',version:Math.max(1,Number(item.version||1)),createdAt:Number(item.createdAt||now()),updatedAt:Number(item.updatedAt||now())}}
  function read(){return {schemaVersion:1,items:(Array.isArray(readRaw()?.items)?readRaw().items:[]).map(normalize)}}
  function save(items){writeRaw({schemaVersion:1,items,updatedAt:now()});return items}
  function list(options={}){const items=read().items;return clone(options.includeInactive?items:items.filter(item=>item.status!=='inactive'))}
  function get(id){return clone(read().items.find(item=>item.id===String(id))||null)}
  function getByPrincipleId(principleId,{activeOnly=false}={}){const items=read().items.filter(item=>item.principleId===String(principleId));return clone(items.find(item=>!activeOnly||item.status==='active')||null)}
  function upsert(payload={}){const data=read(),existing=payload.id?data.items.find(item=>item.id===String(payload.id)):data.items.find(item=>item.principleId===String(payload.principleId));const next=normalize({...existing,...payload,id:existing?.id||payload.id||('preset-'+now().toString(36)),version:existing&&((existing.title!==payload.title)||(existing.content!==payload.content))?Number(existing.version||1)+1:Number(existing?.version||1)});const index=data.items.findIndex(item=>item.id===next.id);if(index>=0)data.items[index]=next;else data.items.push(next);save(data.items);try{global.dispatchEvent(new CustomEvent('kg:synthesis-presets-changed',{detail:{item:clone(next)}}))}catch(error){}return clone(next)}
  global.KGSynthesisPresetRepository=Object.freeze({KEY,list,get,getByPrincipleId,upsert});
})(globalThis);
