'use strict';
(function(global){
  const Store=global.KGAppStorage||{};
  const KEY='kg_principle_repository_v1';
  const listeners=new Set();
  const clone=value=>{try{return JSON.parse(JSON.stringify(value))}catch(error){return value}};
  const now=()=>Date.now();
  function readRaw(){try{return Store.readJSON?Store.readJSON(KEY,null):JSON.parse(localStorage.getItem(KEY)||'null')}catch(error){return null}}
  function writeRaw(value){try{return Store.writeJSON?Store.writeJSON(KEY,value):(localStorage.setItem(KEY,JSON.stringify(value)),true)}catch(error){return false}}
  function slug(value){const text=String(value||'principle').trim().toLowerCase().replace(/^原则\s*[:：-]?\s*/,'').replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-+|-+$/g,'').slice(0,56);return text||('principle-'+now().toString(36))}
  function normalize(item={},index=0){
    const name=String(item.name||item.title||'未命名原则').trim()||'未命名原则';
    return {
      id:String(item.id||('principle-'+slug(name)+'-'+index)),
      name,
      status:String(item.status||'active')==='inactive'?'inactive':'active',
      confusablePrincipleIds:[...new Set((Array.isArray(item.confusablePrincipleIds)?item.confusablePrincipleIds:[]).map(String).filter(Boolean))],
      createdAt:Number(item.createdAt||now()),updatedAt:Number(item.updatedAt||now())
    };
  }
  function model(value){const items=(Array.isArray(value?.items)?value.items:[]).map(normalize);return {schemaVersion:1,items,updatedAt:Number(value?.updatedAt||now())}}
  function read(){return model(readRaw()||{})}
  function emit(reason,item){const payload={reason,item:clone(item),items:list(),at:now()};listeners.forEach(fn=>{try{fn(payload)}catch(error){}});try{global.dispatchEvent(new CustomEvent('kg:principles-changed',{detail:payload}))}catch(error){}return payload}
  function save(items){const value=model({items,updatedAt:now()});writeRaw(value);return value}
  function list(options={}){const items=read().items;return clone(options.includeInactive?items:items.filter(item=>item.status==='active'))}
  function get(id){return clone(read().items.find(item=>String(item.id)===String(id))||null)}
  function findByName(name){const target=String(name||'').trim().replace(/^原则\s*[:：-]?\s*/,'');return clone(read().items.find(item=>item.name===target)||null)}
  function upsert(payload={}){
    const data=read(),existing=payload.id?data.items.find(item=>item.id===String(payload.id)):findByName(payload.name);
    const base=normalize({...existing,...payload,id:existing?.id||payload.id||('principle-'+slug(payload.name))});
    let id=base.id,suffix=2;while(data.items.some(item=>item.id===id&&item.id!==existing?.id))id=base.id+'-'+suffix++;
    const next={...base,id,updatedAt:now()};
    const index=data.items.findIndex(item=>item.id===next.id);if(index>=0)data.items[index]=next;else data.items.push(next);
    save(data.items);emit(index>=0?'updated':'created',next);return clone(next);
  }
  function ensureFromLabels(labels=[]){const created=[];[...new Set(labels.map(value=>String(value||'').trim().replace(/^原则\s*[:：-]?\s*/,'')).filter(Boolean))].forEach(name=>{if(!findByName(name))created.push(upsert({name}))});return created}
  function setStatus(id,status='active'){const item=get(id);if(!item)return null;return upsert({...item,status:status==='inactive'?'inactive':'active'})}
  function replaceAll(payload={}){
    const items=model(payload).items,ids=new Set(items.map(item=>item.id));
    if(ids.size!==items.length)throw new Error('原则 ID 不能重复。');
    save(items);emit('replaced',null);return clone(items);
  }
  function subscribe(listener){if(typeof listener!=='function')return()=>{};listeners.add(listener);return()=>listeners.delete(listener)}
  global.KGPrincipleRepository=Object.freeze({KEY,list,get,findByName,upsert,ensureFromLabels,setStatus,replaceAll,subscribe});
})(globalThis);
