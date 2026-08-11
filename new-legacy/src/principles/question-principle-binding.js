'use strict';
(function(global){
  function uniqueIds(values){
    if(!Array.isArray(values))return [];
    return [...new Set(values.map(value=>String(value||'').trim()).filter(Boolean))];
  }
  function optionIdsFrom(question={}){
    return (Array.isArray(question.options)?question.options:[]).map(option=>String(option?.id||'').trim()).filter(Boolean);
  }
  function normalize(metadata={},optionIds=[]){
    const source=metadata&&typeof metadata==='object'?metadata:{};
    const allowed=new Set((optionIds||[]).map(value=>String(value||'').trim()).filter(Boolean));
    const legacy=uniqueIds(source.principleIds);
    const stem=uniqueIds(source.stemPrincipleIds).length?uniqueIds(source.stemPrincipleIds):legacy;
    const optionMap={};
    if(source.optionPrincipleMap&&typeof source.optionPrincipleMap==='object'){
      Object.entries(source.optionPrincipleMap).forEach(([optionId,values])=>{
        const id=String(optionId||'').trim();if(!allowed.has(id))return;
        optionMap[id]=uniqueIds(values);
      });
    }
    const principleIds=[...stem];Object.values(optionMap).forEach(values=>values.forEach(id=>{if(!principleIds.includes(id))principleIds.push(id)}));
    return {stemPrincipleIds:stem,optionPrincipleMap:optionMap,principleIds};
  }
  function correctOptionId(question={}){
    const explicit=String(question.correctAnswer||'').trim();if(explicit)return explicit;
    return optionIdsFrom(question).find(id=>(question.options||[]).find(option=>String(option?.id||'')===id)?.correct===true)||'';
  }
  function correctOptionPrinciple(question={}){
    const correctId=correctOptionId(question);
    const metadata=question.metadata&&typeof question.metadata==='object'?question.metadata:{};
    const ids=uniqueIds(metadata.optionPrincipleMap?.[correctId]);
    if(ids.length===1)return {ok:true,correctOptionId:correctId,principleId:ids[0]};
    return {ok:false,reason:ids.length?'multiple':'missing',correctOptionId:correctId,principleIds:ids};
  }
  function selectionPrinciple(questions=[]){
    const results=(Array.isArray(questions)?questions:[]).map(correctOptionPrinciple);
    const invalid=results.find(result=>!result.ok);
    if(invalid)return {ok:false,reason:invalid.reason,correctOptionId:invalid.correctOptionId,principleIds:invalid.principleIds||[]};
    const principleIds=[...new Set(results.map(result=>result.principleId))];
    return principleIds.length===1?{ok:true,principleId:principleIds[0]}:{ok:false,reason:'mismatch',principleIds};
  }
  global.KGQuestionPrincipleBinding=Object.freeze({normalize,correctOptionId,correctOptionPrinciple,selectionPrinciple,uniqueIds});
})(globalThis);
