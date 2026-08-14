'use strict';

/*
 * Deep Recall compatibility facade after database migration.
 *
 * Current-question handoff and explored flags are transient navigation state
 * only.  Durable graph reads/writes are intentionally rejected so callers
 * cannot silently recreate a browser-side business source of truth.
 */
(function(global){
  const LEGACY_CURRENT_KEY='kg_deep_recall_current_question_v1';
  const LEGACY_PROGRESS_PREFIX='kg_deep_recall_progress_v1__';
  const CURRENT_PREFIX='kg_deep_recall_current_question_v2__';
  const PROGRESS_PREFIX='kg_deep_recall_progress_v2__';
  let currentPayload=null;
  const exploredByBank=new Map();

  function clean(value,fallback=''){
    const text=String(value??'').trim();
    return text||fallback;
  }
  function clone(value){
    if(value==null)return value;
    try{return JSON.parse(JSON.stringify(value))}catch(error){return value}
  }
  function currentUserId(){
    try{
      return clean(
        global.KGAuthCore?.currentUsername?.()||
        global.KGAuthCore?.currentUser?.()?.username,
        'guest'
      );
    }catch(error){return 'guest'}
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
  function encoded(value,fallback){return encodeURIComponent(clean(value,fallback))}
  function currentKey(userId=currentUserId()){
    return CURRENT_PREFIX+'user__'+encoded(userId,'guest');
  }
  function progressKey(questionOrId={},bankId='',userId=currentUserId()){
    const identity=questionIdentity(questionOrId,bankId);
    return 'server://deep-recall/'+encoded(userId,'guest')+'/'+encoded(identity.bankId,'unknown')+'/'+encoded(identity.questionId,'current');
  }
  function legacyProgressKey(questionOrId={}){
    return LEGACY_PROGRESS_PREFIX+encodeURIComponent(questionIdentity(questionOrId).questionId);
  }
  function normalizeCurrentPayload(payload,userId=currentUserId()){
    if(!payload||typeof payload!=='object'||!payload.question)return null;
    const next=clone(payload);
    const identity=questionIdentity(next.question,next.sourceBankId||'');
    next.userId=userId;
    next.schemaVersion=3;
    next.savedAt=Number(next.savedAt)||Date.now();
    next.sourceBankId=identity.bankId;
    next.sourceQuestionId=identity.questionId;
    next.question.sourceBankId=identity.bankId;
    next.question.sourceQuestionId=identity.questionId;
    return next;
  }
  function readCurrent(){
    return currentPayload?.userId===currentUserId()?clone(currentPayload):null;
  }
  function writeCurrent(payload){
    const next=normalizeCurrentPayload(payload);
    if(!next)return false;
    currentPayload=next;
    return true;
  }
  function persistenceDisabled(){
    const error=new Error('深度回忆进度已数据库化，请使用 KGDeepRecallServerAdapter');
    error.name='DeepRecallPersistenceDisabledError';
    error.code='deep_recall_server_adapter_required';
    throw error;
  }
  function exploredSet(bankId=''){
    return new Set(exploredByBank.get(clean(bankId,'unknown'))||[]);
  }
  function markExplored(questionOrId={},bankId='',explored=true){
    const identity=questionIdentity(questionOrId,bankId);
    const ids=exploredByBank.get(identity.bankId)||new Set();
    if(explored)ids.add(identity.questionId);else ids.delete(identity.questionId);
    exploredByBank.set(identity.bankId,ids);
    return true;
  }
  function hasExplored(questionOrId={},bankId=''){
    const identity=questionIdentity(questionOrId,bankId);
    return exploredSet(identity.bankId).has(identity.questionId);
  }

  const api=Object.freeze({
    LEGACY_CURRENT_KEY,LEGACY_PROGRESS_PREFIX,CURRENT_PREFIX,PROGRESS_PREFIX,
    currentUserId,currentKey,questionIdentity,identityToken,progressKey,legacyProgressKey,
    readCurrent,writeCurrent,
    readProgress:persistenceDisabled,
    writeProgress:persistenceDisabled,
    removeProgress:persistenceDisabled,
    exploredSet,hasExplored,
    markExplored,
    invalidateExplored(questionOrId={},bankId=''){return markExplored(questionOrId,bankId,false)},
    invalidateCache(){exploredByBank.clear()}
  });
  global.KGRecallStorage=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
