"use strict";

/*
 * KGAppStorage 通用存储模块。
 *
 * 基线重构 B：统一本地存储读写入口，后续业务模块不再直接散落调用
 * localStorage。当前仍保持所有既有 key、value 格式和业务行为不变，
 * 仅提供安全 JSON / 字符串读写、删除、更新、迁移辅助和变更事件。
 *
 * 说明：这是纯前端原型的本地存储适配层；正式联网版应在本层或服务层
 * 对接后端 API，并在服务端再次校验权限和订阅状态。
 */
(function(){
  const CHANGE_EVENT = "kg-app-storage-change";
  const ERROR_EVENT = "kg-app-storage-error";

  function keyOf(key){
    return String(key || "");
  }
  function storage(){
    try{return window.localStorage || null}catch(e){return null}
  }
  function cloneFallback(value){
    if(value == null) return value;
    if(typeof structuredClone === "function"){
      try{return structuredClone(value)}catch(e){}
    }
    try{return JSON.parse(JSON.stringify(value))}catch(e){return value}
  }
  function emit(name, detail){
    try{window.dispatchEvent(new CustomEvent(name, {detail}))}catch(e){}
  }
  function reportError(action, key, error){
    console.warn("[KGAppStorage] " + action + " failed", key, error);
    emit(ERROR_EVENT, {action, key:keyOf(key), error});
  }
  function readString(key, fallback=""){
    key = keyOf(key);
    try{
      const store = storage();
      if(!store || !key) return fallback;
      const value = store.getItem(key);
      return value == null ? fallback : value;
    }catch(e){
      return fallback;
    }
  }
  function writeString(key, value){
    key = keyOf(key);
    try{
      const store = storage();
      if(!store || !key) return false;
      store.setItem(key, String(value));
      emit(CHANGE_EVENT, {type:"string", action:"write", key, value:String(value)});
      return true;
    }catch(e){
      reportError("writeString", key, e);
      return false;
    }
  }
  function readJSON(key, fallback=null){
    key = keyOf(key);
    try{
      const store = storage();
      if(!store || !key) return cloneFallback(fallback);
      const raw = store.getItem(key);
      if(raw == null || raw === "") return cloneFallback(fallback);
      const parsed = JSON.parse(raw);
      return parsed == null ? cloneFallback(fallback) : parsed;
    }catch(e){
      return cloneFallback(fallback);
    }
  }
  function writeJSON(key, value){
    key = keyOf(key);
    try{
      const store = storage();
      if(!store || !key) return false;
      store.setItem(key, JSON.stringify(value));
      emit(CHANGE_EVENT, {type:"json", action:"write", key, value});
      return true;
    }catch(e){
      reportError("writeJSON", key, e);
      return false;
    }
  }
  function updateJSON(key, updater, fallback=null){
    const current = readJSON(key, fallback);
    const next = typeof updater === "function" ? updater(current) : current;
    return writeJSON(key, next) ? next : current;
  }
  function remove(key){
    key = keyOf(key);
    try{
      const store = storage();
      if(!store || !key) return false;
      store.removeItem(key);
      emit(CHANGE_EVENT, {type:"raw", action:"remove", key});
      return true;
    }catch(e){
      reportError("remove", key, e);
      return false;
    }
  }
  function exists(key){
    key = keyOf(key);
    try{
      const store = storage();
      return !!(store && key && store.getItem(key) != null);
    }catch(e){return false}
  }
  function keys(prefix=""){
    const out=[];
    prefix=String(prefix||"");
    try{
      const store=storage();
      if(!store)return out;
      for(let i=0;i<store.length;i++){
        const key=store.key(i);
        if(key && (!prefix || key.startsWith(prefix))) out.push(key);
      }
    }catch(e){}
    return out.sort();
  }
  function namespacedKey(area, name, version="v1"){
    return ["kg", area, name, version].map(part=>String(part||"").trim()).filter(Boolean).join("_");
  }
  function migrateJSON({sourceKey,targetKey,versionKey,migrate,removeSource=false}={}){
    sourceKey=keyOf(sourceKey);targetKey=keyOf(targetKey);versionKey=keyOf(versionKey);
    if(!sourceKey || !targetKey || !versionKey || exists(versionKey)) return false;
    const source=readJSON(sourceKey,null);
    if(source == null) return false;
    const next=typeof migrate === "function" ? migrate(source) : source;
    if(!writeJSON(targetKey,next)) return false;
    writeString(versionKey,"1");
    if(removeSource) remove(sourceKey);
    return true;
  }

  window.KGAppStorage = {
    CHANGE_EVENT,
    ERROR_EVENT,
    readString,
    writeString,
    readJSON,
    writeJSON,
    updateJSON,
    remove,
    exists,
    keys,
    namespacedKey,
    migrateJSON
  };
})();
