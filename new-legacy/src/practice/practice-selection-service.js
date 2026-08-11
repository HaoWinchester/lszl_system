'use strict';
(function(global){
  const Difficulty=global.KGDifficultyService||global.KGTeacherDomains?.DifficultyService||{};
  const clean=value=>String(value||'').trim().replace(/^原则\s*[:：-]?\s*/,'');
  function questionPrincipleIds(question={}){return [...new Set([...(Array.isArray(question.principleIds)?question.principleIds:[]),...(Array.isArray(question.metadata?.principleIds)?question.metadata.principleIds:[])].map(String).filter(Boolean))]}
  function legacyPrincipleNames(question={}){
    const metadata=question.metadata||{};
    const explicit=[question.principleTag,question.ruleTag,question.strategyTag,metadata.principleTag,metadata.ruleTag,metadata.strategyTag].map(clean).filter(Boolean);
    const tagged=(Array.isArray(question.tags)?question.tags:[]).map(value=>{
      if(value&&typeof value==='object'){
        const type=String(value.type||value.kind||value.category||'');
        return /principle|rule|strategy|原则|策略/i.test(type)?clean(value.name||value.label||value.title||value.value||''):'';
      }
      const text=String(value||'').trim();
      return /^(?:原则|做题原则|原则标签|principle|rule|strategy)\s*[:：-]/i.test(text)?clean(text.replace(/^(?:做题原则|原则标签|principle|rule|strategy)\s*[:：-]\s*/i,'')):'';
    });
    return [...new Set([...explicit,...tagged].filter(Boolean))];
  }
  function matches(item,principleId,principleName=''){const q=item.question||item;const ids=questionPrincipleIds(q);if(ids.includes(String(principleId)))return true;return principleName&&legacyPrincipleNames(q).includes(clean(principleName))}
  function difficulty(item){return Difficulty.normalize?.((item.question||item).difficulty)||''}
  function key(item){const q=item.question||item,b=item.bank||{};return [b.id||q.sourceBankId||'',q.id||q.sourceQuestionId||''].map(String).join('::')}
  function shuffled(items){return items.map(item=>({item,sort:Math.random()})).sort((a,b)=>a.sort-b.sort).map(row=>row.item)}
  function take(pool,count,used,output){for(const item of shuffled(pool)){const id=key(item);if(output.length>=count||used.has(id))continue;used.add(id);output.push(item)}return output}
  function select(options={}){
    const items=Array.isArray(options.items)?options.items:[],level=Math.max(1,Math.min(3,Number(options.level||1))),count=Math.max(1,Number(options.count||3));
    const used=new Set((options.excludeKeys||[]).map(String)),chosen=[];
    const own=items.filter(item=>matches(item,options.principleId,options.principleName));
    if(level===1){take(own.filter(item=>difficulty(item)==='easy'),count,used,chosen);take(own.filter(item=>!difficulty(item)),count,used,chosen)}
    else if(level===2){take(own.filter(item=>difficulty(item)==='medium'),count,used,chosen);take(own.filter(item=>!difficulty(item)),count,used,chosen)}
    else{
      take(own.filter(item=>difficulty(item)==='hard'),Math.min(2,count),used,chosen);take(own.filter(item=>!difficulty(item)),Math.min(2,count),used,chosen);
      const confusable=new Set((options.confusablePrincipleIds||[]).map(String));
      const other=items.filter(item=>!matches(item,options.principleId,options.principleName)&&['medium','hard'].includes(difficulty(item)));
      const preferred=other.filter(item=>questionPrincipleIds(item.question||item).some(id=>confusable.has(id)));
      take(preferred,count,used,chosen);take(other,count,used,chosen);
      take(own.filter(item=>difficulty(item)==='hard'),count,used,chosen);
    }
    return {level,items:chosen.slice(0,count),requested:count,shortage:Math.max(0,count-chosen.length)};
  }
  global.KGPracticeSelectionService=Object.freeze({select,questionPrincipleIds,legacyPrincipleNames,matches,key});
})(globalThis);
