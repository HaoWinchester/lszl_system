'use strict';
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
    const isCore=level(clue)==='core';
    const raw=String(clue?.solutionRole||'').trim();
    return isCore?(raw&&raw!=='context'?raw:'concept-anchor'):'context';
  }
  function profile(clue){
    const keywordLevel=level(clue),isCore=keywordLevel==='core',role=solutionRole(clue);
    return Object.freeze({keywordLevel,isCore,solutionRole:role,coreReason:String(clue?.coreReason||''),levelLabel:isCore?'核心关键词':'普通关键词',roleLabel:ROLE_LABELS[role]||role||'Context / 普通语境',priority:isCore?100:10});
  }
  function compare(a,b){
    const pa=profile(a),pb=profile(b);
    if(pb.priority!==pa.priority)return pb.priority-pa.priority;
    return String(b?.text||'').length-String(a?.text||'').length;
  }
  global.KGQuestionKeywordRuntime=Object.freeze({version:'1.0.0',ROLE_LABELS,level,solutionRole,profile,compare});
})(globalThis);
