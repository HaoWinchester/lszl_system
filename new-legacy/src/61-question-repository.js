'use strict';

/*
 * QuestionRepository
 * 统一当前训练题的读取入口。阶段1仍兼容现有 qb* API 和 PMP_QUESTION_MVP，
 * 后续卡片不得自行读取 localStorage 或直接遍历题库全局状态。
 */
(function(global){
  const listeners=new Set();

  function clone(value){
    if(value===undefined)return undefined;
    try{return JSON.parse(JSON.stringify(value))}catch(e){return value}
  }

  function appliedQuestion(){
    try{
      if(typeof PMP_QUESTION_MVP!=='undefined'&&PMP_QUESTION_MVP)return PMP_QUESTION_MVP;
    }catch(e){}
    return null;
  }

  function sourceQuestion(){
    try{
      if(typeof qbCurrentQuestion==='function')return qbCurrentQuestion();
    }catch(e){}
    return appliedQuestion();
  }

  function current(){
    return clone(appliedQuestion()||sourceQuestion()||null);
  }

  function currentBank(){
    try{
      if(typeof qbCurrentBank==='function')return clone(qbCurrentBank());
    }catch(e){}
    return null;
  }

  function currentId(){
    const q=appliedQuestion()||sourceQuestion()||{};
    return String(q.sourceQuestionId||q.id||q.title||'current');
  }

  function currentBankId(){
    const q=appliedQuestion()||{};
    try{
      if(typeof qCurrentQuestionBankId==='function')return String(qCurrentQuestionBankId()||'');
    }catch(e){}
    const bank=currentBank();
    return String(q.sourceBankId||bank?.id||'');
  }

  function currentRevision(){
    const q=appliedQuestion()||sourceQuestion()||{};
    return String(q.revision||q.version||q.updatedAt||'1');
  }

  function descriptor(){
    const q=current()||{};
    return {
      id:currentId(),
      bankId:currentBankId(),
      revision:currentRevision(),
      title:String(q.title||'未命名题目'),
      question:q
    };
  }

  function notify(reason='changed'){
    const payload={reason,descriptor:descriptor(),at:Date.now()};
    listeners.forEach(listener=>{
      try{listener(payload)}catch(error){console.error('QuestionRepository listener error',error)}
    });
    try{global.dispatchEvent(new CustomEvent('kg:question-changed',{detail:payload}))}catch(e){}
    return payload;
  }

  function subscribe(listener){
    if(typeof listener!=='function')return()=>{};
    listeners.add(listener);
    return()=>listeners.delete(listener);
  }

  function next(delta=1){
    if(typeof qbNext!=='function')return false;
    qbNext(Number(delta)||1);
    notify(delta>=0?'next':'previous');
    return true;
  }

  function applyCurrent(reset=true){
    if(typeof qbApplyCurrentQuestion!=='function')return current();
    qbApplyCurrentQuestion(reset);
    notify(reset?'apply-reset':'apply');
    return current();
  }

  global.KGQuestionRepository=Object.freeze({
    current,
    currentId,
    currentBank,
    currentBankId,
    currentRevision,
    descriptor,
    subscribe,
    notify,
    next,
    applyCurrent
  });
})(window);
