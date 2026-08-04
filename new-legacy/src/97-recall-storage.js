'use strict';

/*
 * 深度回忆存储服务 v2。
 *
 * 目标：
 * - 账号、题库、题目三级隔离，避免同浏览器多账号或重复题号串数据；
 * - 兼容读取 v1 当前题目和进度，并在能够确认归属时迁移；
 * - 维护轻量“已探索”索引，题目库筛选不再逐题解析完整图数据。
 */
(function(global){
  const LEGACY_CURRENT_KEY='kg_deep_recall_current_question_v1';
  const LEGACY_PROGRESS_PREFIX='kg_deep_recall_progress_v1__';
  const CURRENT_PREFIX='kg_deep_recall_current_question_v2__';
  const PROGRESS_PREFIX='kg_deep_recall_progress_v2__';
  const EXPLORED_PREFIX='kg_deep_recall_explored_v2__';
  const LEGACY_OWNER_KEY='kg_deep_recall_legacy_owner_v1';
  const AUTH_SESSION_KEY='kg_local_current_user_v1';
  const Store=global.KGAppStorage||{};
  const exploredCache=new Map();

  function clean(value,fallback=''){
    const text=String(value??'').trim();
    return text||fallback;
  }
  function clone(value){
    if(value==null)return value;
    try{return JSON.parse(JSON.stringify(value))}catch(error){return value}
  }
  function readString(key,fallback=''){
    try{return Store.readString?Store.readString(key,fallback):(global.localStorage?.getItem(key)??fallback)}catch(error){return fallback}
  }
  function writeString(key,value){
    try{return Store.writeString?Store.writeString(key,value):(global.localStorage?.setItem(key,String(value)),true)}catch(error){return false}
  }
  function readJSON(key,fallback=null){
    try{return Store.readJSON?Store.readJSON(key,fallback):JSON.parse(global.localStorage?.getItem(key)||'null')??clone(fallback)}catch(error){return clone(fallback)}
  }
  function writeJSON(key,value){
    try{return Store.writeJSON?Store.writeJSON(key,value):(global.localStorage?.setItem(key,JSON.stringify(value)),true)}catch(error){return false}
  }
  function remove(key){
    try{return Store.remove?Store.remove(key):(global.localStorage?.removeItem(key),true)}catch(error){return false}
  }
  function currentUserId(){
    try{
      return clean(
        global.KGAuthCore?.currentUsername?.() ||
        global.KGAuthCore?.currentUser?.()?.username ||
        global.localStorage?.getItem(AUTH_SESSION_KEY),
        'guest'
      );
    }catch(error){return 'guest'}
  }
  function encoded(value,fallback){return encodeURIComponent(clean(value,fallback))}
  function currentKey(userId=currentUserId()){
    return CURRENT_PREFIX+'user__'+encoded(userId,'guest');
  }
  function questionIdentity(questionOrId={},bankId=''){
    if(typeof questionOrId==='string'||typeof questionOrId==='number'){
      return {bankId:clean(bankId,'unknown'),questionId:clean(questionOrId,'current')};
    }
    const question=questionOrId&&typeof questionOrId==='object'?questionOrId:{};
    return {
      bankId:clean(bankId||question.sourceBankId||question.bankId,'unknown'),
      questionId:clean(question.sourceQuestionId||question.id,'current')
    };
  }
  function identityToken(questionOrId={},bankId=''){
    const identity=questionIdentity(questionOrId,bankId);
    return identity.bankId+'::'+identity.questionId;
  }
  function progressKey(questionOrId={},bankId='',userId=currentUserId()){
    const identity=questionIdentity(questionOrId,bankId);
    return PROGRESS_PREFIX+
      'user__'+encoded(userId,'guest')+
      '__bank__'+encoded(identity.bankId,'unknown')+
      '__question__'+encoded(identity.questionId,'current');
  }
  function legacyProgressKey(questionOrId={}){
    const identity=questionIdentity(questionOrId);
    return LEGACY_PROGRESS_PREFIX+encodeURIComponent(identity.questionId);
  }
  function exploredKey(userId=currentUserId()){
    return EXPLORED_PREFIX+'user__'+encoded(userId,'guest');
  }
  function payloadUser(payload){return clean(payload?.userId||payload?.username,'')}
  function legacyOwner(){return clean(readString(LEGACY_OWNER_KEY,''),'')}
  function canAdoptLegacy(payload,userId=currentUserId()){
    const claimed=payloadUser(payload);
    if(claimed)return claimed===userId;
    const owner=legacyOwner();
    return !owner||owner===userId;
  }
  function adoptLegacyOwner(userId=currentUserId()){
    const owner=legacyOwner();
    if(owner&&owner!==userId)return false;
    if(!owner)writeString(LEGACY_OWNER_KEY,userId);
    return true;
  }
  function savedAt(payload){return Number(payload?.savedAt)||0}
  function sameQuestion(payload,questionOrId={},bankId=''){
    const expected=questionIdentity(questionOrId,bankId);
    const actual=questionIdentity(payload?.question||payload?.sourceQuestionId||'',payload?.sourceBankId||'');
    if(actual.questionId!==expected.questionId)return false;
    if(actual.bankId!=='unknown'&&expected.bankId!=='unknown'&&actual.bankId!==expected.bankId)return false;
    return true;
  }
  function normalizeCurrentPayload(payload,userId=currentUserId()){
    if(!payload||typeof payload!=='object'||!payload.question)return null;
    const next=clone(payload);
    next.userId=userId;
    next.schemaVersion=2;
    next.savedAt=savedAt(next)||Date.now();
    const identity=questionIdentity(next.question,next.sourceBankId||'');
    next.sourceBankId=identity.bankId;
    next.sourceQuestionId=identity.questionId;
    next.question.sourceBankId=identity.bankId;
    next.question.sourceQuestionId=identity.questionId;
    return next;
  }
  function readCurrent(){
    const userId=currentUserId();
    const scoped=readJSON(currentKey(userId),null);
    const legacy=readJSON(LEGACY_CURRENT_KEY,null);
    const eligibleLegacy=legacy&&canAdoptLegacy(legacy,userId)?normalizeCurrentPayload(legacy,userId):null;
    const scopedPayload=scoped&&payloadUser(scoped)===userId?normalizeCurrentPayload(scoped,userId):null;
    if(scopedPayload&&(!eligibleLegacy||savedAt(scopedPayload)>=savedAt(eligibleLegacy)))return scopedPayload;
    if(eligibleLegacy&&(payloadUser(legacy)||adoptLegacyOwner(userId))){
      writeJSON(currentKey(userId),eligibleLegacy);
      return eligibleLegacy;
    }
    return scopedPayload;
  }
  function writeCurrent(payload,{writeLegacy=true}={}){
    const userId=currentUserId();
    const next=normalizeCurrentPayload(payload,userId);
    if(!next)return false;
    const scopedOk=writeJSON(currentKey(userId),next);
    if(writeLegacy)writeJSON(LEGACY_CURRENT_KEY,next);
    adoptLegacyOwner(userId);
    return scopedOk;
  }
  function emptyExploredIndex(){return {schemaVersion:2,items:{}}}
  function invalidateExploredCache(userId=''){
    const id=clean(userId,'');
    if(id)exploredCache.delete(id);else exploredCache.clear();
  }
  function readExploredIndex(userId=currentUserId()){
    const id=clean(userId,'guest');
    const cached=exploredCache.get(id);
    if(cached)return cached;
    const raw=readJSON(exploredKey(id),null);
    const index=!raw||typeof raw!=='object'?emptyExploredIndex():{schemaVersion:2,items:raw.items&&typeof raw.items==='object'?{...raw.items}:{}};
    exploredCache.set(id,index);
    return index;
  }
  function writeExploredIndex(index,userId=currentUserId()){
    const id=clean(userId,'guest');
    const next={schemaVersion:2,items:{...(index?.items||{})},savedAt:Date.now()};
    const ok=writeJSON(exploredKey(id),next);
    if(ok)exploredCache.set(id,{schemaVersion:2,items:{...next.items}});
    return ok;
  }
  function markExplored(questionOrId={},bankId='',explored=true,saved=Date.now()){
    const userId=currentUserId();
    const token=identityToken(questionOrId,bankId);
    const index=readExploredIndex(userId);
    const exists=Object.prototype.hasOwnProperty.call(index.items,token);
    if(explored){
      if(exists)return true;
      index.items[token]=Number(saved)||Date.now();
    }else{
      if(!exists)return true;
      delete index.items[token];
    }
    return writeExploredIndex(index,userId);
  }
  function isProgressPayload(raw){
    return Boolean(raw&&Array.isArray(raw.nodes)&&Array.isArray(raw.edges));
  }
  function readProgress(questionOrId={},bankId='',{migrateLegacy=true}={}){
    const userId=currentUserId();
    const key=progressKey(questionOrId,bankId,userId);
    const scoped=readJSON(key,null);
    if(isProgressPayload(scoped)){
      markExplored(questionOrId,bankId,Boolean(scoped.nodes.length||(scoped.activeKeywords||[]).length),scoped.savedAt);
      return clone(scoped);
    }
    if(!migrateLegacy)return null;
    const legacy=readJSON(legacyProgressKey(questionOrId),null);
    if(!isProgressPayload(legacy))return null;
    const legacyCurrent=readJSON(LEGACY_CURRENT_KEY,null);
    if(!legacyCurrent||!sameQuestion(legacyCurrent,questionOrId,bankId)||!canAdoptLegacy(legacyCurrent,userId)||!adoptLegacyOwner(userId))return null;
    const migrated={...clone(legacy),schemaVersion:2,userId,...questionIdentity(questionOrId,bankId),migratedFrom:'v1',savedAt:savedAt(legacy)||Date.now()};
    if(writeJSON(key,migrated))markExplored(questionOrId,bankId,Boolean(migrated.nodes.length||(migrated.activeKeywords||[]).length),migrated.savedAt);
    return migrated;
  }
  function writeProgress(questionOrId={},bankId='',payload={}){
    const userId=currentUserId();
    const identity=questionIdentity(questionOrId,bankId);
    const next={...clone(payload),schemaVersion:2,userId,bankId:identity.bankId,questionId:identity.questionId,savedAt:Date.now()};
    const ok=writeJSON(progressKey(questionOrId,bankId,userId),next);
    if(ok)markExplored(questionOrId,bankId,Boolean((next.nodes||[]).length||(next.activeKeywords||[]).length),next.savedAt);
    return ok;
  }
  function removeProgress(questionOrId={},bankId=''){
    const ok=remove(progressKey(questionOrId,bankId));
    markExplored(questionOrId,bankId,false);
    return ok;
  }
  function exploredSet(bankId=''){
    const target=clean(bankId,'unknown')+'::';
    const items=readExploredIndex().items;
    return new Set(Object.keys(items).filter(token=>token.startsWith(target)).map(token=>token.slice(target.length)));
  }
  function hasExplored(questionOrId={},bankId=''){
    const identity=questionIdentity(questionOrId,bankId);
    return exploredSet(identity.bankId).has(identity.questionId);
  }

  try{
    global.addEventListener?.('storage',event=>{
      if(String(event?.key||'').startsWith(EXPLORED_PREFIX))invalidateExploredCache();
    });
    global.addEventListener?.('kg-app-storage-change',event=>{
      if(String(event?.detail?.key||'').startsWith(EXPLORED_PREFIX))invalidateExploredCache();
    });
  }catch(error){}

  const api=Object.freeze({
    LEGACY_CURRENT_KEY,LEGACY_PROGRESS_PREFIX,CURRENT_PREFIX,PROGRESS_PREFIX,
    currentUserId,currentKey,questionIdentity,identityToken,progressKey,legacyProgressKey,
    readCurrent,writeCurrent,readProgress,writeProgress,removeProgress,exploredSet,hasExplored,
    invalidateExplored(questionOrId={},bankId=''){markExplored(questionOrId,bankId,false)},
    invalidateCache:invalidateExploredCache
  });
  global.KGRecallStorage=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
