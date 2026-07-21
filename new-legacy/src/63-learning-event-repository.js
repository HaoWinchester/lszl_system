'use strict';

/*
 * LearningEventRepository
 * 集中保存学习行为事件和兼容版轮次摘要。后续可改为批量 API 上报。
 */
(function(global){
  const EVENT_PREFIX='kg_learning_events_v1__';
  const LEGACY_ROUND_PREFIX='kg_learning_rounds_v1__';
  const MAX_EVENTS=3000;
  const MAX_ROUNDS=500;

  function clone(value){
    if(value===undefined)return undefined;
    try{return JSON.parse(JSON.stringify(value))}catch(e){return value}
  }
  function currentUserId(){
    return global.KGLearningSessionStore?.currentUserId?.()||'guest';
  }
  function key(userId=currentUserId()){return EVENT_PREFIX+encodeURIComponent(String(userId||'guest'))}
  function read(userId=currentUserId()){
    try{
      const value=JSON.parse(localStorage.getItem(key(userId))||'[]');
      return Array.isArray(value)?value:[];
    }catch(e){console.warn('学习事件读取失败',e);return[]}
  }
  function append(type,payload={},context={}){
    const userId=String(context.userId||currentUserId());
    const event={
      id:'event-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),
      type:String(type||'UNKNOWN'),
      userId,
      sessionId:String(context.sessionId||payload.sessionId||''),
      questionId:String(context.questionId||payload.questionId||''),
      payload:clone(payload)||{},
      occurredAt:Date.now()
    };
    try{
      const events=read(userId);
      events.unshift(event);
      localStorage.setItem(key(userId),JSON.stringify(events.slice(0,MAX_EVENTS)));
    }catch(e){console.warn('学习事件保存失败',e)}
    try{global.dispatchEvent(new CustomEvent('kg:learning-event',{detail:event}))}catch(e){}
    return clone(event);
  }
  function list(options={}){
    const userId=String(options.userId||currentUserId());
    let events=read(userId);
    if(options.questionId)events=events.filter(e=>String(e.questionId)===String(options.questionId));
    if(options.sessionId)events=events.filter(e=>String(e.sessionId)===String(options.sessionId));
    if(options.type)events=events.filter(e=>String(e.type)===String(options.type));
    return events.slice(0,Math.max(1,Number(options.limit||MAX_EVENTS)));
  }
  function saveRoundSummary(record={}){
    const userId=String(record.userId||currentUserId());
    try{
      const storageKey=LEGACY_ROUND_PREFIX+encodeURIComponent(userId);
      const old=JSON.parse(localStorage.getItem(storageKey)||'[]');
      const list=Array.isArray(old)?old:[];
      list.unshift(clone(record));
      localStorage.setItem(storageKey,JSON.stringify(list.slice(0,MAX_ROUNDS)));
    }catch(e){console.warn('学习轮次摘要保存失败',e)}
    append('SESSION_COMPLETED',record,{
      userId,
      sessionId:record.sessionId||record.id,
      questionId:record.questionId
    });
    return clone(record);
  }

  global.KGLearningEventRepository=Object.freeze({
    EVENT_PREFIX,
    append,
    list,
    saveRoundSummary
  });
})(window);
