/* Shared, read-only explanation content for both learning canvases. */
(function(global){
  'use strict';
  const rows=value=>Array.isArray(value)?value:[];
  const text=value=>String(value||'').trim();
  function sections(question={},library={}){
    const allClues=rows(question.clues).filter(item=>text(item?.text));
    const core=allClues.filter(item=>item.isCore||item.keywordLevel==='core');
    const clues=(core.length?core:allClues).slice(0,6);
    let concepts=rows(question.concepts).filter(item=>text(item?.title)).slice(0,6);
    if(!concepts.length){
      const seen=new Set();
      for(const clue of allClues){
        const id=text(clue.recallNodeId);if(!id||seen.has(id))continue;
        const node=global.KGRecallAssociationLibrary?.resolve?.(library||{},id);if(!node||seen.has(node.id))continue;
        seen.add(node.id);concepts.push({title:node.title,titleEn:node.titleEn,rule:text(node.hint),ruleEn:node.hintEn});
        if(concepts.length===6)break;
      }
    }
    const optionHints=rows(question.options).filter(item=>text(item?.trap));
    // Imported lessons retain authored option explanations in this named step.
    const traps=optionHints.length?optionHints:rows(question.reasoningSteps).filter(step=>text(step?.title)==='逐项排除'&&text(step?.content)).map(step=>({id:step.title,trap:step.content,trapEn:step.contentEn||''}));
    return {concepts,clues,clueTitle:core.length?'核心关键词':'关键词',traps:traps.slice(0,8)};
  }
  function createLibraryLoader(request){
    const values=new Map(),pending=new Map();
    return {peek:subject=>values.get(String(subject||'PMP'))||null,load(subject='PMP'){
      subject=String(subject||'PMP');if(values.has(subject))return Promise.resolve(values.get(subject));
      if(!pending.has(subject))pending.set(subject,(async()=>{
        const response=await request('/api/v1/recall/libraries/'+encodeURIComponent(subject),{credentials:'include'});
        if(!response.ok)throw new Error('知识点关联暂未加载，请重新打开解析重试。');
        const data=await response.json();const library=data.payload||{nodes:[],edges:[]};values.set(subject,library);return library;
      })().finally(()=>pending.delete(subject)));
      return pending.get(subject);
    }};
  }
  const api={sections,createLibraryLoader};global.KGQuestionAnalysis=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
