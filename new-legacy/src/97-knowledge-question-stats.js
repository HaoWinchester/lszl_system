'use strict';

/* V9.0-P3.5.7 正式题库知识点题量统计。只读，不修改题库或题目。 */
(function(global){
  const BANK_PREFIX='kg_question_banks_v1__';
  const PUBLISHED_BANKS_KEY='kg_question_banks_published_v1';
  const AUTH_SESSION_KEY='kg_local_current_user_v1';
  const clean=value=>String(value??'').trim();
  const clone=value=>{try{return JSON.parse(JSON.stringify(value))}catch(error){return value}};
  function readJson(key,fallback){try{const value=global.localStorage?.getItem(key);return value?JSON.parse(value):fallback}catch(error){return fallback}}
  function sessionScope(){try{const username=global.KGAuthCore?.currentUsername?.()||global.localStorage?.getItem(AUTH_SESSION_KEY);return username?'user__'+encodeURIComponent(username):'public'}catch(error){return 'public'}}
  function userBanksKey(){return BANK_PREFIX+sessionScope()}
  function isDeleted(question){return question?.lifecycle?.status==='deleted'||!!question?.deletedAt||!!question?.lifecycle?.deletedAt}
  function questionTitle(question){return clean(question?.title||question?.stem||question?.content?.zh?.stem||question?.content?.zh?.prompt||question?.teacherNumber||question?.id)||'未命名题目'}
  function bankSubjectMatches(bank,{subjectId='',subjectCode=''}={}){
    const raw=clean(bank?.subject).toUpperCase(),id=clean(subjectId).toUpperCase(),code=clean(subjectCode).toUpperCase();
    return !raw||raw===id||raw===code||raw===id.replace(/^SUBJECT-/,'');
  }
  function loadBanks(){
    const personal=readJson(userBanksKey(),[]),published=readJson(PUBLISHED_BANKS_KEY,[]),rows=[];
    (Array.isArray(personal)?personal:[]).forEach(bank=>rows.push({...clone(bank),__source:'personal'}));
    (Array.isArray(published)?published:[]).forEach(bank=>rows.push({...clone(bank),__source:'published'}));
    return rows;
  }
  function collect(options={}){
    const taxonomyId=clean(options.taxonomyId),nodeIds=new Set((options.nodes||[]).map(node=>clean(node?.id)).filter(Boolean));
    const byKey=new Map();
    loadBanks().filter(bank=>bankSubjectMatches(bank,options)).forEach(bank=>{
      (Array.isArray(bank?.questions)?bank.questions:[]).forEach(question=>{
        if(!question||isDeleted(question))return;
        const knowledge=question?.metadata?.knowledge||{},questionTaxonomy=clean(knowledge.taxonomyId);
        if(taxonomyId&&questionTaxonomy&&questionTaxonomy!==taxonomyId)return;
        const key=clean(bank.id)+'::'+clean(question.id);if(!key||key==='::')return;
        const record={
          id:clean(question.id),bankId:clean(bank.id),bankName:clean(bank.name||bank.title||bank.id)||'未命名题库',
          title:questionTitle(question),teacherNumber:clean(question.teacherNumber),type:clean(question.type),difficulty:clean(question.difficulty),
          primaryNodeId:clean(knowledge.primaryNodeId),taxonomyId:questionTaxonomy,pathSnapshot:Array.isArray(knowledge.pathSnapshot)?knowledge.pathSnapshot.slice():[],
          source:bank.__source,subject:clean(bank.subject)
        };
        if(!byKey.has(key)||bank.__source==='personal')byKey.set(key,record);
      });
    });
    const questions=[...byKey.values()],directCounts=new Map(),invalid=[];
    questions.forEach(question=>{
      if(!question.primaryNodeId)return;
      if(nodeIds.size&&!nodeIds.has(question.primaryNodeId)){invalid.push(question);return}
      directCounts.set(question.primaryNodeId,(directCounts.get(question.primaryNodeId)||0)+1);
    });
    const mapped=questions.filter(question=>question.primaryNodeId&&(!nodeIds.size||nodeIds.has(question.primaryNodeId)));
    const unmapped=questions.filter(question=>!question.primaryNodeId);
    function direct(nodeId){return directCounts.get(clean(nodeId))||0}
    function total(nodeId,descendantIds=[]){const ids=new Set([clean(nodeId),...(descendantIds||[]).map(clean)]);return mapped.filter(question=>ids.has(question.primaryNodeId)).length}
    function forNode(nodeId,descendantIds=[],includeChildren=false){const ids=new Set([clean(nodeId),...(includeChildren?(descendantIds||[]).map(clean):[])]);return questions.filter(question=>ids.has(question.primaryNodeId)).map(clone)}
    return Object.freeze({questions:questions.map(clone),mapped:mapped.map(clone),unmapped:unmapped.map(clone),invalid:invalid.map(clone),directCounts,totalCount:questions.length,direct,total,forNode,userBanksKey:userBanksKey()});
  }
  const api=Object.freeze({collect,loadBanks,userBanksKey,publishedBanksKey:PUBLISHED_BANKS_KEY,isDeleted,questionTitle});
  global.KGKnowledgeQuestionStats=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
