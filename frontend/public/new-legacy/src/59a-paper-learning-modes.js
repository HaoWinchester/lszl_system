'use strict';

/* 已发布试卷学习入口兼容策略。 */
(function(global){
  const IDS=Object.freeze(['practice_mode','deep_recall','multi_question_canvas','single_deep_study']);
  const LABELS=Object.freeze({
    practice_mode:'做题模式',
    deep_recall:'深度回忆',
    multi_question_canvas:'多题画布',
    single_deep_study:'单题深学'
  });
  const CONFIG_VERSION=2;
  const ALIASES=Object.freeze({
    practice:'practice_mode',
    practice_mode:'practice_mode',
    recall:'deep_recall',
    deep_recall:'deep_recall',
    'deep-recall':'deep_recall',
    multi_question:'multi_question_canvas',
    multi_question_canvas:'multi_question_canvas',
    'multi-question':'multi_question_canvas',
    canvas:'multi_question_canvas',
    single_deep:'single_deep_study',
    single_deep_study:'single_deep_study',
    'single-deep':'single_deep_study'
  });
  const PUBLISHED_STATUSES=Object.freeze(['published','active','released']);
  const WITHDRAWN_STATUSES=Object.freeze(['withdrawn','revoked','unpublished','archived','disabled']);

  function number(value,fallback=0){
    const resolved=Number(value);
    return Number.isFinite(resolved)?resolved:fallback;
  }
  function canonical(value){
    const raw=String(value||'').trim();
    return ALIASES[raw]||ALIASES[raw.toLowerCase()]||'';
  }
  function normalize(value,version=0){
    const explicit=Array.isArray(value);
    const resolvedVersion=number(version,0);
    const rows=explicit?value.map(canonical).filter(Boolean):[];
    if(!explicit)return Array.from(IDS);
    if(!rows.length)return resolvedVersion>=CONFIG_VERSION?[]:Array.from(IDS);
    const modes=Array.from(new Set(rows));
    if(resolvedVersion<CONFIG_VERSION&&!modes.includes('practice_mode'))modes.unshift('practice_mode');
    return modes;
  }
  function normalizePaper(paper){return normalize(paper?.enabledModes,paper?.modeConfigVersion)}
  function supports(paper,mode){
    const raw=String(mode||'').trim(),resolved=canonical(raw)||raw;
    return !resolved||normalizePaper(paper).includes(resolved);
  }
  function validate(paper,options={}){
    const modes=normalizePaper(paper);
    const requireOne=options.requireOne!==false;
    return Object.freeze({
      ok:!requireOne||modes.length>0,
      modes,
      error:requireOne&&!modes.length?'请至少选择一种学习模式后再发布。':''
    });
  }
  function status(value,fallback='draft'){return String(value||fallback).trim().toLowerCase()||fallback}
  function isPublishedStatus(value){return PUBLISHED_STATUSES.includes(status(value,'published'))}
  function isWithdrawnStatus(value){return WITHDRAWN_STATUSES.includes(status(value,''))}
  function label(mode){return LABELS[String(mode||'')]||String(mode||'')}
  function labels(value,version=0){return normalize(value,version).map(label)}

  const api=Object.freeze({
    IDS,LABELS,ALIASES,CONFIG_VERSION,PUBLISHED_STATUSES,WITHDRAWN_STATUSES,
    canonical,normalize,normalizePaper,supports,validate,status,isPublishedStatus,isWithdrawnStatus,label,labels
  });
  global.KGPaperLearningModes=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
