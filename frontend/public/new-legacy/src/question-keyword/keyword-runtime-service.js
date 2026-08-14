'use strict';

/* Keyword hierarchy is semantic for learners: priority may differ, styling may not. */
(function(global){
  const ROLE_LABELS=Object.freeze({
    'decision-cue':'Decision Cue / 决策提示',
    'concept-anchor':'Concept Anchor / 知识锚点',
    'condition-anchor':'Condition Anchor / 情境条件',
    'answer-anchor':'Answer Anchor / 答案判断',
    'context':'Context / 普通语境'
  });
  function level(clue){
    const value=String(clue?.keywordLevel||'').toLowerCase();
    return value==='core'||clue?.isCore===true?'core':'normal';
  }
  function solutionRole(clue){
    const isCore=level(clue)==='core',raw=String(clue?.solutionRole||'').trim();
    return isCore?(raw&&raw!=='context'?raw:'concept-anchor'):'context';
  }
  function profile(clue){
    const keywordLevel=level(clue),isCore=keywordLevel==='core',role=solutionRole(clue);
    return Object.freeze({
      keywordLevel,isCore,solutionRole:role,
      coreReason:String(clue?.coreReason||''),
      priority:isCore?100:10
    });
  }
  function compare(a,b){
    const pa=profile(a),pb=profile(b);
    if(pb.priority!==pa.priority)return pb.priority-pa.priority;
    return String(b?.text||'').length-String(a?.text||'').length;
  }
  function learnerClass(){return 'kr-keyword-token'}

  const api=Object.freeze({version:'2.0.0',ROLE_LABELS,level,solutionRole,profile,compare,learnerClass});
  global.KGQuestionKeywordRuntime=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
