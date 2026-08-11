'use strict';
(function(global){
  const Store=global.KGAppStorage||{},PREFIX='kg_practice_attempts_v1__';
  const user=()=>{try{return global.KGAuthCore?.currentUsername?.()||'guest'}catch(error){return'guest'}};
  const key=()=>PREFIX+encodeURIComponent(String(user()));
  function read(){try{const value=Store.readJSON?Store.readJSON(key(),[]):JSON.parse(localStorage.getItem(key())||'[]');return Array.isArray(value)?value:[]}catch(error){return[]}}
  function record(payload={}){const items=read();const item={id:'attempt-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6),principleId:String(payload.principleId||''),presetId:String(payload.presetId||''),level:Math.max(1,Math.min(3,Number(payload.level||1))),questionId:String(payload.questionId||''),bankId:String(payload.bankId||''),correct:!!payload.correct,firstAttempt:payload.firstAttempt!==false,attemptedAt:Number(payload.attemptedAt||Date.now())};items.push(item);const next=items.slice(-5000);if(Store.writeJSON)Store.writeJSON(key(),next);else localStorage.setItem(key(),JSON.stringify(next));return item}
  function list(filters={}){return read().filter(item=>(!filters.principleId||item.principleId===String(filters.principleId))&&(!filters.level||item.level===Number(filters.level)))}
  global.KGPracticeAttemptRepository=Object.freeze({record,list});
})(globalThis);
