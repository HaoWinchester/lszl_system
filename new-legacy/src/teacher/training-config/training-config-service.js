'use strict';
(function(global){
  const root=global.KGTeacherDomains=global.KGTeacherDomains||{},Core=root.Core;
  function create(options={}){
    const batch=options.batch||root.QuestionBank?.BatchOperationService?.create?.({transaction:options.transaction,audit:options.audit});
    function normalizePatch(patch={}){return {clues:Array.isArray(patch.clues)?Core.clone(patch.clues):undefined,concepts:Array.isArray(patch.concepts)?Core.clone(patch.concepts):undefined,reasoningSteps:Array.isArray(patch.reasoningSteps)?Core.clone(patch.reasoningSteps):undefined,metadata:patch.metadata&&typeof patch.metadata==='object'?Core.clone(patch.metadata):undefined}}
    function update(question,patch={}){if(!question)return Core.result(false,null,['题目不存在。']);const next=normalizePatch(patch);Object.keys(next).forEach(key=>{if(next[key]!==undefined)question[key]=next[key]});question.status={...(question.status||{}),keywordsReady:(question.clues||[]).length>0,knowledgeReady:!!question.metadata?.knowledge?.primaryNodeId||(question.concepts||[]).length>0,reasoningReady:(question.reasoningSteps||[]).length>0};return Core.result(true,question)}
    function updateMany(questions,patchFactory,persist){return batch.execute({prefix:'training-config-batch',items:questions,apply:(question,index,transactionId)=>update(question,typeof patchFactory==='function'?patchFactory(question,index,transactionId):patchFactory),persist,audit:{action:'training_config.bulk_update',entityType:'question',summary:`批量更新 ${questions.length} 道题的训练配置`}})}
    return Object.freeze({update,updateMany,normalizePatch});
  }
  root.TrainingConfig=root.TrainingConfig||{};root.TrainingConfig.TrainingConfigService=Object.freeze({create});
})(globalThis);
